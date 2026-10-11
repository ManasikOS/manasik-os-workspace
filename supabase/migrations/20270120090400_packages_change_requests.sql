-- TASK-043 Phase 1, step 2: changes to the payment, contract and booking terms of a package that is already on sale are reviewed, and (by default) approved
-- by a second person, in the database.
--
-- Why: a package edit becomes the payment schedule and terms of every departure group created afterwards, and what leads, agents and the inbox assistant
-- quote. Until now an ADMIN or OPERATIONS user could change a live package's cancellation policy or payment plan with one autosave and no trace.
-- Phase 0 (2026-10-09) also showed the application was the only thing deciding it.
--
-- What this migration adds
--   * Two agency switches (both ON): package_approval_money_contract (Tier 1) and package_approval_bookings_ops (Tier 2) on agency_settings, with a guard
--     so only an administrator holding the settings capability can change them, and a settings activity-log entry for every change.
--   * package_change_requests: one row per reviewed change. Status PENDING / APPROVED / APPLIED (approval was switched off) / REJECTED / WITHDRAWN / EXPIRED /
--     SUPERSEDED. It holds, per changed column, the old value, the new value and the tier. Written only by the three functions below.
--   * submit_package_change(...): for an Open for Sale or Sales Closed package. Display-only (Basic) changes are saved at once. Tier 1 and Tier 2 changes need
--     the editSensitiveTerms capability and a written reason; each tier whose switch is ON becomes a PENDING request, each tier whose switch is OFF is
--     applied at once and recorded as APPLIED. The live package does not change while a request is pending.
--   * decide_package_change(...): approve or reject. Needs approvePackageChanges, never your own request, a request that is still pending and unexpired,
--     and every changed column must still hold the value the request was made against. Approval applies the change, records a version when the package is
--     Open for Sale, and logs it.
--   * withdraw_package_change(...): the requester (or an approver) cancels a pending request.
--   * package_activity_logs gains the action type CHANGE_APPLIED.
--
-- Draft packages are not touched by any of this: drafts are edited and saved directly. Archived packages cannot be edited.
-- A trigger (packages_guard_live_terms) makes the review impossible to bypass: a direct API write cannot change a Tier 1/2 column of a package that is on sale.
-- Requests expire 14 days after they are made (checked whenever one is read or decided; no background job is needed).
-- Idempotent. Rollback: drop the three functions, the guard trigger and function, the table, and the two settings columns; re-add the old CHECK on action_type.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The two approval switches
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.agency_settings
  add column if not exists package_approval_money_contract boolean not null default true,
  add column if not exists package_approval_bookings_ops boolean not null default true;

comment on column public.agency_settings.package_approval_money_contract is
  'When true, a change to a live package''s payment milestones, payment terms, cancellation, late-payment or price-change terms needs a second person''s approval. TASK-043.';
comment on column public.agency_settings.package_approval_bookings_ops is
  'When true, a change to a live package''s capacity, duration, accommodation, transport, inclusions, requirements, code, visibility or similar booking/operations terms needs a second person''s approval. TASK-043.';

-- Who may change the switches: the ADMIN tier, and not if their saved settings permissions explicitly withhold managePackageApprovalPolicy.
create or replace function public.has_package_approval_policy_capability()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caps jsonb;
begin
  if not coalesce(public.staff_role_in('ADMIN'), false) then
    return false;
  end if;

  select rp.capabilities into v_caps
    from public.staff_profiles sp
    join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'settings'
   where sp.id = auth.uid();

  if v_caps is null or jsonb_typeof(v_caps) <> 'object' or not (v_caps ? 'managePackageApprovalPolicy') then
    return true;
  end if;
  return (v_caps -> 'managePackageApprovalPolicy') = 'true'::jsonb;
end;
$$;

revoke all on function public.has_package_approval_policy_capability() from public, anon;
grant execute on function public.has_package_approval_policy_capability() to authenticated, service_role;

create or replace function public.agency_settings_guard_package_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text;
begin
  if new.package_approval_money_contract is not distinct from old.package_approval_money_contract
     and new.package_approval_bookings_ops is not distinct from old.package_approval_bookings_ops then
    return new;
  end if;

  -- Migrations and the service role have no signed-in user; every signed-in caller is held to the rule.
  if auth.uid() is not null and not coalesce(public.has_package_approval_policy_capability(), false) then
    raise exception 'Your role cannot change the package approval policy.' using errcode = '42501';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = auth.uid();
  insert into public.settings_activity_logs
    (actor_id, actor_name_snapshot, section, event_type, entity_type, entity_label, before_value, after_value, message)
  values (
    auth.uid(), coalesce(v_actor_name, 'Staff'), 'OPERATIONS', 'PACKAGE_APPROVAL_POLICY_CHANGED', 'SETTINGS', 'Package change approval',
    jsonb_build_object('moneyAndContract', old.package_approval_money_contract, 'bookingsAndOperations', old.package_approval_bookings_ops),
    jsonb_build_object('moneyAndContract', new.package_approval_money_contract, 'bookingsAndOperations', new.package_approval_bookings_ops),
    'Package change approval policy changed.'
  );
  return new;
end;
$$;

revoke all on function public.agency_settings_guard_package_approval() from public, anon, authenticated;

drop trigger if exists agency_settings_guard_package_approval on public.agency_settings;
create trigger agency_settings_guard_package_approval
  before update on public.agency_settings
  for each row execute function public.agency_settings_guard_package_approval();

-- Does a change in this tier need a second person's approval right now? A missing settings row means yes.
create or replace function public.package_change_requires_approval(p_tier integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case p_tier
              when 1 then s.package_approval_money_contract
              when 2 then s.package_approval_bookings_ops
              else false
            end
       from public.agency_settings s
      where s.agency_id = public.current_agency_id()
      limit 1),
    true)
$$;

revoke all on function public.package_change_requires_approval(integer) from public, anon;
grant execute on function public.package_change_requires_approval(integer) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Activity log: a new action type
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.package_activity_logs drop constraint if exists package_activity_logs_action_type_check;
alter table public.package_activity_logs
  add constraint package_activity_logs_action_type_check
  check (action_type in ('PUBLISHED', 'SALES_CLOSED', 'REOPENED', 'ARCHIVED', 'RESTORED', 'CHANGE_APPLIED'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Direct API writes cannot skip the review
--     Without this, the review could be bypassed by updating the table directly. For a caller running as `authenticated` or `anon`:
--       * a package that is Open for Sale or Sales Closed cannot have a Tier 1 or Tier 2 column changed (display-only columns still can);
--       * an Archived package cannot have any content column changed.
--     The SECURITY DEFINER functions above run as their owner and are not held to it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.packages_guard_live_terms()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_column text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if old.status = 'Archived' then
    foreach v_column in array public.package_content_columns() loop
      if (v_old -> v_column) is distinct from (v_new -> v_column) then
        raise exception 'An archived package cannot be edited. Restore it first.' using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  if old.status in ('Open for Sale', 'Sales Closed') then
    foreach v_column in array public.package_content_columns() loop
      if (v_old -> v_column) is distinct from (v_new -> v_column)
         and (public.package_field_tier(v_column) > 0
              or (v_column = 'itinerary' and public.package_itinerary_structure_changed(v_old -> v_column, v_new -> v_column))) then
        raise exception 'Changes to payment or booking terms on a package that is on sale must go through the review.' using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

comment on function public.packages_guard_live_terms() is
  'BEFORE UPDATE guard for direct API callers: no Tier 1/2 column of a package that is on sale and no content column of an archived package can be changed directly; use submit_package_change. TASK-043.';

revoke all on function public.packages_guard_live_terms() from public, anon, authenticated;

drop trigger if exists packages_guard_live_terms on public.packages;
create trigger packages_guard_live_terms
  before update on public.packages
  for each row execute function public.packages_guard_live_terms();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. package_change_requests
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.package_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null default public.current_agency_id() references public.agencies (id),
  package_id         uuid not null references public.packages (id) on delete cascade,
  status             text not null default 'PENDING'
                       check (status in ('PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'SUPERSEDED')),
  -- 1 or 2: the highest tier among the changed columns.
  highest_tier       smallint not null check (highest_tier in (1, 2)),
  -- { "<column>": { "old": <json>, "new": <json>, "tier": 1|2 }, ... }
  changes            jsonb not null check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  reason             text not null check (char_length(btrim(reason)) between 1 and 500),
  requested_by       uuid references auth.users (id) on delete set null,
  requested_by_name  text not null default 'Staff',
  approval_required  boolean not null default true,
  decided_by         uuid references auth.users (id) on delete set null,
  decided_by_name    text,
  decision_note      text check (decision_note is null or char_length(decision_note) <= 500),
  decided_at         timestamptz,
  applied_version_id uuid references public.package_versions (id) on delete set null,
  expires_at         timestamptz not null default (now() + interval '14 days'),
  created_at         timestamptz not null default now()
);

comment on table public.package_change_requests is
  'Reviewed changes to the payment, contract and booking terms of a live package. Written only by submit_package_change / decide_package_change / withdraw_package_change; there is deliberately no INSERT, UPDATE or DELETE policy. TASK-043.';

create index if not exists package_change_requests_package_idx on public.package_change_requests (package_id, created_at desc);
create index if not exists package_change_requests_agency_status_idx on public.package_change_requests (agency_id, status);
create unique index if not exists package_change_requests_one_pending
  on public.package_change_requests (package_id) where status = 'PENDING';

alter table public.package_change_requests enable row level security;
revoke insert, update, delete on public.package_change_requests from anon, authenticated;

drop policy if exists "staff read package change requests" on public.package_change_requests;
create policy "staff read package change requests" on public.package_change_requests
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (
      requested_by = (select auth.uid())
      or (
        public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS')
        and (select public.has_package_capability('viewModule'))
      )
    )
    and exists (select 1 from public.packages p where p.id = package_change_requests.package_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. submit_package_change
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.submit_package_change(
  p_package_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_reason text default null,
  p_supersede boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_row public.packages;
  v_unknown text[];
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_tier integer;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_basic jsonb := '{}'::jsonb;            -- column -> new value, saved at once
  v_pending jsonb := '{}'::jsonb;          -- column -> {old,new,tier}, waits for approval
  v_direct jsonb := '{}'::jsonb;           -- column -> {old,new,tier}, applied at once (approval switched off)
  v_direct_content jsonb := '{}'::jsonb;
  v_change jsonb;
  v_version public.package_versions;
  v_request_id uuid;
  v_existing public.package_change_requests;
  v_pending_cols text[] := '{}';
  v_applied_cols text[] := '{}';
  v_status text;
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('editPackage'), false) then
    raise exception 'Your role cannot edit packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'The package content is missing.' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_unknown from jsonb_object_keys(p_content) as k where k <> all (public.package_content_columns());
  if v_unknown is not null then
    raise exception 'The package content has fields that cannot be published.' using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'The time you last loaded this package is missing.' using errcode = '22023';
  end if;

  select * into v_row from public.packages where id = p_package_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('Open for Sale', 'Sales Closed') then
    raise exception 'This package is % — that is not a valid starting point for this action.', v_row.status using errcode = '22023';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'This package changed elsewhere. Reload and try again.' using errcode = '40001';
  end if;

  -- What actually changes, split by tier.
  for v_key in select jsonb_object_keys(p_content) loop
    v_old := coalesce(to_jsonb(v_row) -> v_key, 'null'::jsonb);
    v_new := coalesce(p_content -> v_key, 'null'::jsonb);
    if v_old is not distinct from v_new then
      continue;
    end if;

    v_tier := public.package_field_tier(v_key);
    if v_key = 'itinerary' and public.package_itinerary_structure_changed(v_old, v_new) then
      v_tier := 2;
    end if;

    v_change := jsonb_build_object('old', v_old, 'new', v_new, 'tier', v_tier);
    if v_tier = 0 then
      v_basic := v_basic || jsonb_build_object(v_key, v_new);
    elsif public.package_change_requires_approval(v_tier) then
      v_pending := v_pending || jsonb_build_object(v_key, v_change);
    else
      v_direct := v_direct || jsonb_build_object(v_key, v_change);
      v_direct_content := v_direct_content || jsonb_build_object(v_key, v_new);
    end if;
  end loop;

  if v_basic = '{}'::jsonb and v_pending = '{}'::jsonb and v_direct = '{}'::jsonb then
    return jsonb_build_object('status', 'NONE', 'request_id', null, 'applied_columns', '[]'::jsonb, 'pending_columns', '[]'::jsonb);
  end if;

  if v_pending <> '{}'::jsonb or v_direct <> '{}'::jsonb then
    if not coalesce(public.has_package_capability('editSensitiveTerms'), false) then
      raise exception 'Your role cannot change payment or booking terms.' using errcode = '42501';
    end if;
    if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
      raise exception 'A reason is required for changes to payment or booking terms.' using errcode = '22023';
    end if;
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  -- A waiting request for this package: refuse, or replace it when the caller said so.
  if v_pending <> '{}'::jsonb then
    select * into v_existing from public.package_change_requests where package_id = p_package_id and status = 'PENDING' for update;
    if found then
      if v_existing.expires_at <= now() then
        update public.package_change_requests set status = 'EXPIRED' where id = v_existing.id;
      elsif p_supersede then
        update public.package_change_requests set status = 'SUPERSEDED' where id = v_existing.id;
      else
        raise exception 'Another change is already waiting for approval for this package.' using errcode = '22023';
      end if;
    end if;
  end if;

  -- 1. Display-only changes are saved at once.
  if v_basic <> '{}'::jsonb then
    perform public.packages_apply_content(p_package_id, v_basic);
    v_applied_cols := v_applied_cols || array(select jsonb_object_keys(v_basic));
  end if;

  -- 2. Sensitive changes whose tier needs no approval are applied at once and recorded.
  if v_direct <> '{}'::jsonb then
    perform public.packages_apply_content(p_package_id, v_direct_content);
    if v_row.status = 'Open for Sale' then
      v_version := public.packages_record_version(p_package_id);
    end if;
    insert into public.package_change_requests
      (package_id, agency_id, status, highest_tier, changes, reason, requested_by, requested_by_name, approval_required,
       decided_by, decided_by_name, decided_at, applied_version_id)
    values
      (p_package_id, v_agency, 'APPLIED',
       (select max((value ->> 'tier')::integer) from jsonb_each(v_direct)), v_direct, v_reason, v_actor, coalesce(v_actor_name, 'Staff'), false,
       v_actor, coalesce(v_actor_name, 'Staff'), now(), v_version.id)
    returning id into v_request_id;
    insert into public.package_activity_logs
      (package_id, agency_id, actor_id, actor_name_snapshot, action_type, before_status, after_status, reason, message)
    values
      (p_package_id, v_agency, v_actor, coalesce(v_actor_name, 'Staff'), 'CHANGE_APPLIED', v_row.status, v_row.status, v_reason,
       'Changed ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(v_direct) as k) || '.');
    v_applied_cols := v_applied_cols || array(select jsonb_object_keys(v_direct));
  end if;

  -- 3. Sensitive changes whose tier needs approval wait for a second person.
  if v_pending <> '{}'::jsonb then
    insert into public.package_change_requests
      (package_id, agency_id, status, highest_tier, changes, reason, requested_by, requested_by_name, approval_required)
    values
      (p_package_id, v_agency, 'PENDING',
       (select max((value ->> 'tier')::integer) from jsonb_each(v_pending)), v_pending, v_reason, v_actor, coalesce(v_actor_name, 'Staff'), true)
    returning id into v_request_id;
    v_pending_cols := array(select jsonb_object_keys(v_pending));
  end if;

  v_status := case when v_pending <> '{}'::jsonb then 'PENDING'
                   when v_direct <> '{}'::jsonb then 'APPLIED'
                   else 'BASIC_APPLIED' end;
  return jsonb_build_object(
    'status', v_status,
    'request_id', v_request_id,
    'applied_columns', to_jsonb(v_applied_cols),
    'pending_columns', to_jsonb(v_pending_cols)
  );
end;
$$;

comment on function public.submit_package_change(uuid, jsonb, timestamptz, text, boolean) is
  'Edit a package that is Open for Sale or Sales Closed. Display-only changes save at once; payment/contract (Tier 1) and booking/operations (Tier 2) changes need editSensitiveTerms and a reason and either wait for approval (agency switch ON) or apply at once and are recorded (switch OFF). Never touches status or featured. TASK-043.';

revoke all on function public.submit_package_change(uuid, jsonb, timestamptz, text, boolean) from public, anon;
grant execute on function public.submit_package_change(uuid, jsonb, timestamptz, text, boolean) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. decide_package_change
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.decide_package_change(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_req public.package_change_requests;
  v_pkg public.packages;
  v_note text := btrim(coalesce(p_note, ''));
  v_key text;
  v_content jsonb := '{}'::jsonb;
  v_version public.package_versions;
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('approvePackageChanges'), false) then
    raise exception 'Your role cannot approve package changes.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;
  if p_approve is null then
    raise exception 'The decision is missing.' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'The note is too long.' using errcode = '22023';
  end if;
  if not p_approve and char_length(v_note) < 1 then
    raise exception 'A note is required when a change is rejected.' using errcode = '22023';
  end if;

  select * into v_req from public.package_change_requests where id = p_request_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That change request no longer exists.' using errcode = 'P0002';
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'This change is no longer waiting for approval.' using errcode = '22023';
  end if;
  if v_req.expires_at <= now() then
    update public.package_change_requests set status = 'EXPIRED' where id = v_req.id;
    return jsonb_build_object('status', 'EXPIRED', 'request_id', v_req.id);
  end if;
  if v_req.requested_by is not distinct from v_actor then
    raise exception 'You cannot approve your own change.' using errcode = '42501';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  if not p_approve then
    update public.package_change_requests
       set status = 'REJECTED', decided_by = v_actor, decided_by_name = coalesce(v_actor_name, 'Staff'), decision_note = v_note, decided_at = now()
     where id = v_req.id;
    return jsonb_build_object('status', 'REJECTED', 'request_id', v_req.id);
  end if;

  select * into v_pkg from public.packages where id = v_req.package_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;
  if v_pkg.status not in ('Open for Sale', 'Sales Closed') then
    raise exception 'This package is % — that is not a valid starting point for this action.', v_pkg.status using errcode = '22023';
  end if;

  -- Every changed column must still hold the value the request was made against.
  for v_key in select jsonb_object_keys(v_req.changes) loop
    if coalesce(to_jsonb(v_pkg) -> v_key, 'null'::jsonb) is distinct from (v_req.changes -> v_key -> 'old') then
      raise exception 'This package changed since the request was made. Ask for the change to be submitted again.' using errcode = '40001';
    end if;
    v_content := v_content || jsonb_build_object(v_key, v_req.changes -> v_key -> 'new');
  end loop;

  perform public.packages_apply_content(v_req.package_id, v_content);
  if v_pkg.status = 'Open for Sale' then
    v_version := public.packages_record_version(v_req.package_id);
  end if;

  update public.package_change_requests
     set status = 'APPROVED', decided_by = v_actor, decided_by_name = coalesce(v_actor_name, 'Staff'), decision_note = nullif(v_note, ''),
         decided_at = now(), applied_version_id = v_version.id
   where id = v_req.id;

  insert into public.package_activity_logs
    (package_id, agency_id, actor_id, actor_name_snapshot, action_type, before_status, after_status, reason, message)
  values
    (v_req.package_id, v_agency, v_actor, coalesce(v_actor_name, 'Staff'), 'CHANGE_APPLIED', v_pkg.status, v_pkg.status, v_req.reason,
     'Approved a change requested by ' || v_req.requested_by_name || ': ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(v_req.changes) as k) || '.');

  return jsonb_build_object('status', 'APPROVED', 'request_id', v_req.id, 'version_id', v_version.id);
end;
$$;

comment on function public.decide_package_change(uuid, boolean, text) is
  'Approve or reject a pending package change. Needs approvePackageChanges, never your own request, still pending and unexpired, and every changed column must still hold the value the request was made against. Approval applies the change, records a version when the package is Open for Sale and logs it. TASK-043.';

revoke all on function public.decide_package_change(uuid, boolean, text) from public, anon;
grant execute on function public.decide_package_change(uuid, boolean, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. withdraw_package_change
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.withdraw_package_change(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_req public.package_change_requests;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot withdraw package changes.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'The note is too long.' using errcode = '22023';
  end if;

  select * into v_req from public.package_change_requests where id = p_request_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That change request no longer exists.' using errcode = 'P0002';
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'This change is no longer waiting for approval.' using errcode = '22023';
  end if;
  if v_req.requested_by is distinct from v_actor and not coalesce(public.has_package_capability('approvePackageChanges'), false) then
    raise exception 'Your role cannot withdraw package changes.' using errcode = '42501';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;
  update public.package_change_requests
     set status = 'WITHDRAWN', decided_by = v_actor, decided_by_name = coalesce(v_actor_name, 'Staff'), decision_note = nullif(v_note, ''), decided_at = now()
   where id = v_req.id;
  return jsonb_build_object('status', 'WITHDRAWN', 'request_id', v_req.id);
end;
$$;

revoke all on function public.withdraw_package_change(uuid, text) from public, anon;
grant execute on function public.withdraw_package_change(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
