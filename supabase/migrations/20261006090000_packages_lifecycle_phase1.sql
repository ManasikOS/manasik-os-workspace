-- Packages Phase 1 — lifecycle state machine, archive guard, internal_code
-- uniqueness, and a usage view that stops overstating capacity.
--
-- See docs/modules/packages-production-readiness-plan.md, Phase 1 (findings B2, B3,
-- B4, B9). Phase 0 (20261005090000) stopped the app and the database from
-- being bypassed on WHO can change a package's status; this migration adds
-- WHAT changes are legal in the first place — until now, `status` was just
-- another text column any permitted UPDATE could set to anything:
--
--   * `unpublishPackageAction` could close sales on a Draft or an Archived
--     package (there was no earlier state to have "unpublished" from).
--   * `publishExistingPackageAction` could publish an ARCHIVED package —
--     `status` would become 'Open for Sale' while `archived_at` stayed
--     set, so the package was simultaneously sellable and hidden from the
--     active list.
--   * `restorePackageAction` always forced 'Draft', discarding whatever the
--     package's status was before it was archived (it might have been
--     'Open for Sale' or 'Sales Closed').
--   * Nothing ever recorded WHO changed a package's lifecycle state, WHEN,
--     or WHY — `departure_groups` has `departure_group_activity_logs`;
--     `packages` had nothing.
--
-- The fix: five SECURITY DEFINER RPCs (`publish_package`,
-- `close_package_sales`, `reopen_package`, `archive_package`,
-- `restore_package`) are now the only way `status` legally changes.
-- Each validates the FROM state, writes `previous_status`, and logs to the
-- new `package_activity_logs` table, sharing one internal helper so the
-- transition/staleness/audit-log mechanics can't drift between the five.
-- Every application code path (`app/(main)/packages/actions.ts`) is
-- updated in the same change that ships this migration to call these
-- instead of writing `status` directly.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. `previous_status` + the archived_at ⇔ status='Archived' invariant
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.packages
  add column if not exists previous_status text;

-- Backfill any row the pre-Phase-0 autosave bug (finding A1) could have left
-- inconsistent: `status = 'Archived'` with no `archived_at` stamp, or an
-- `archived_at` stamp on a row whose status was later changed out from under
-- it by the same bug. `archived_at` is treated as the more trustworthy
-- signal — `archivePackageAction`/`restorePackageAction` always set it and
-- `status` together — so a row with one but not the other is repaired
-- towards matching `archived_at`.
update public.packages
   set archived_at = coalesce(archived_at, updated_at)
 where status = 'Archived'
   and archived_at is null;

update public.packages
   set status = 'Archived'
 where archived_at is not null
   and status <> 'Archived';

alter table public.packages
  drop constraint if exists packages_archived_status_consistent;
alter table public.packages
  add constraint packages_archived_status_consistent
  check ((archived_at is not null) = (status = 'Archived'));

comment on column public.packages.previous_status is
  'The status this package held immediately before its most recent lifecycle transition. Written only by the lifecycle RPCs below; used by restore_package() to reopen an archived package into whatever state it was actually in (Draft / Open for Sale / Sales Closed) rather than always resetting it to Draft.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. package_activity_logs — one row per lifecycle transition.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.package_activity_logs (
  id                    uuid primary key default gen_random_uuid(),
  package_id            uuid not null
                          references public.packages (id) on delete cascade,
  agency_id             uuid not null default public.current_agency_id()
                          references public.agencies (id),
  actor_id              uuid references auth.users (id) on delete set null,
  actor_name_snapshot   text not null default 'System',
  action_type           text not null
                          check (action_type in ('PUBLISHED', 'SALES_CLOSED', 'REOPENED', 'ARCHIVED', 'RESTORED')),
  before_status         text,
  after_status          text not null,
  reason                text,
  message                text not null default '',
  created_at            timestamptz not null default now()
);

comment on table public.package_activity_logs is
  'Audit trail of package lifecycle transitions (publish / close sales / reopen / archive / restore). Written only by the SECURITY DEFINER RPCs in section D — there is deliberately no INSERT policy for `authenticated`.';

create index if not exists package_activity_logs_package_idx
  on public.package_activity_logs (package_id, created_at desc);
create index if not exists package_activity_logs_agency_idx
  on public.package_activity_logs (agency_id);

alter table public.package_activity_logs enable row level security;

drop policy if exists "staff read package activity" on public.package_activity_logs;
create policy "staff read package activity" on public.package_activity_logs
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'MARKETING', 'VISA')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Internal helper — the shared transition/staleness/audit-log mechanics.
--    Not exposed to PostgREST (no grant to `authenticated`); only the five
--    named wrappers in section D may call it. It does its own tenant
--    scoping (`agency_id = current_agency_id()`) since, as SECURITY
--    DEFINER, it bypasses RLS entirely — it is the trust boundary, not RLS.
--    It does NOT check role/capability itself; each wrapper in section D
--    does that before delegating here, since the legal FROM/TO states and
--    the required capability both differ per transition.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.packages_apply_status_transition(
  p_package_id uuid,
  p_expected_updated_at timestamptz,
  p_allowed_from text[],
  p_to_status text,
  p_action_type text,
  p_reason text
) returns public.packages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.packages;
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_message text;
begin
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  select * into v_row
    from public.packages
    where id = p_package_id and agency_id = v_agency
    for update;

  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'This package changed elsewhere. Reload and try again.' using errcode = '40001';
  end if;

  if not (v_row.status = any(p_allowed_from)) then
    raise exception 'This package is % — that is not a valid starting point for this action.', v_row.status
      using errcode = '22023';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  v_message := case p_action_type
    when 'PUBLISHED'     then 'Published — now Open for Sale.'
    when 'SALES_CLOSED'  then 'Sales closed.'
    when 'REOPENED'      then 'Reopened for sale.'
    when 'ARCHIVED'      then trim(both ' ' from 'Archived.' || case when coalesce(p_reason, '') <> '' then ' ' || p_reason else '' end)
    when 'RESTORED'      then 'Restored from archive to ' || p_to_status || '.'
    else 'Status changed to ' || p_to_status || '.'
  end;

  update public.packages
     set status = p_to_status,
         previous_status = v_row.status,
         archived_at = case when p_to_status = 'Archived' then now() else null end,
         published_at = case when p_to_status = 'Open for Sale' then now() else v_row.published_at end
   where id = p_package_id
   returning * into v_row;

  insert into public.package_activity_logs
    (package_id, agency_id, actor_id, actor_name_snapshot, action_type, before_status, after_status, reason, message)
  values
    (p_package_id, v_agency, v_actor, coalesce(v_actor_name, 'Staff'), p_action_type, v_row.previous_status, p_to_status, p_reason, v_message);

  return v_row;
end;
$$;

comment on function public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text) is
  'Internal — shared by the five lifecycle RPCs below. Locks the row, checks optimistic-concurrency staleness, validates the FROM state, writes the transition + previous_status + archived_at/published_at, and logs it. Not exposed to PostgREST.';

revoke all on function public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. The five lifecycle RPCs — the only legal way `packages.status` changes.
--    Role checks mirror `lib/access/packages-access.ts`
--    (`publishPackage` / `archiveOrRestorePackage`: ADMIN, OPERATIONS).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.publish_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
) returns public.packages
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_role() not in ('ADMIN', 'OPERATIONS') then
    raise exception 'Your role cannot publish packages.' using errcode = '42501';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Draft', 'Sales Closed'], 'Open for Sale', 'PUBLISHED', null
  );
end;
$$;

comment on function public.publish_package(uuid, timestamptz) is
  'Draft or Sales Closed -> Open for Sale. The caller (see savePackagePatchAction/publishPackageAction) is responsible for re-running the wizard''s step-completeness validation before calling this — the RPC enforces WHICH transitions are legal, not whether the package content is complete.';

revoke all on function public.publish_package(uuid, timestamptz) from public;
grant execute on function public.publish_package(uuid, timestamptz) to authenticated;

create or replace function public.close_package_sales(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
) returns public.packages
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_role() not in ('ADMIN', 'OPERATIONS') then
    raise exception 'Your role cannot close sales on packages.' using errcode = '42501';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Open for Sale'], 'Sales Closed', 'SALES_CLOSED', null
  );
end;
$$;

comment on function public.close_package_sales(uuid, timestamptz) is
  'Open for Sale -> Sales Closed. Replaces the old "unpublish" write, which could previously be aimed at a Draft or Archived row with no earlier "published" state to unpublish from.';

revoke all on function public.close_package_sales(uuid, timestamptz) from public;
grant execute on function public.close_package_sales(uuid, timestamptz) to authenticated;

create or replace function public.reopen_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
) returns public.packages
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_role() not in ('ADMIN', 'OPERATIONS') then
    raise exception 'Your role cannot reopen packages for sale.' using errcode = '42501';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Sales Closed'], 'Open for Sale', 'REOPENED', null
  );
end;
$$;

comment on function public.reopen_package(uuid, timestamptz) is
  'Sales Closed -> Open for Sale. There was previously no way back to Open for Sale after closing sales (finding E5) — Unpublish was a one-way door.';

revoke all on function public.reopen_package(uuid, timestamptz) from public;
grant execute on function public.reopen_package(uuid, timestamptz) to authenticated;

create or replace function public.archive_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null,
  p_reason text default null,
  p_force boolean default false
) returns public.packages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_live_groups integer;
begin
  if v_role not in ('ADMIN', 'OPERATIONS') then
    raise exception 'Your role cannot archive packages.' using errcode = '42501';
  end if;

  select coalesce(live_group_count, 0) into v_live_groups
    from public.package_usage
    where package_id = p_package_id;
  v_live_groups := coalesce(v_live_groups, 0);

  if v_live_groups > 0 and not p_force then
    raise exception 'This package has % live departure group(s). Close sales instead, or force-archive with a reason.', v_live_groups
      using errcode = '22023';
  end if;

  if v_live_groups > 0 and p_force then
    if v_role <> 'ADMIN' then
      raise exception 'Only an administrator can archive a package that still has live departure groups.' using errcode = '42501';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'A reason is required to archive a package that still has live departure groups.' using errcode = '22023';
    end if;
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Draft', 'Open for Sale', 'Sales Closed'], 'Archived', 'ARCHIVED', p_reason
  );
end;
$$;

comment on function public.archive_package(uuid, timestamptz, text, boolean) is
  'Any pre-archive status -> Archived. Refused when the package still has live departure groups unless p_force is true, the caller is ADMIN, and a non-empty p_reason is given — previously a package could be archived (and so drop out of the create-group picker and the Leads catalogue) while groups were still actively selling off it, with no warning (finding B3).';

revoke all on function public.archive_package(uuid, timestamptz, text, boolean) from public;
grant execute on function public.archive_package(uuid, timestamptz, text, boolean) to authenticated;

create or replace function public.restore_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
) returns public.packages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text;
begin
  if public.current_staff_role() not in ('ADMIN', 'OPERATIONS') then
    raise exception 'Your role cannot restore packages.' using errcode = '42501';
  end if;

  select case
           when previous_status in ('Draft', 'Open for Sale', 'Sales Closed') then previous_status
           else 'Draft'
         end
    into v_target
    from public.packages
    where id = p_package_id and agency_id = public.current_agency_id();

  if v_target is null then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Archived'], v_target, 'RESTORED', null
  );
end;
$$;

comment on function public.restore_package(uuid, timestamptz) is
  'Archived -> whatever status the package held immediately before it was archived (Draft / Open for Sale / Sales Closed), falling back to Draft only when that is unknown. Previously always reset to Draft regardless of what was archived (finding B2).';

revoke all on function public.restore_package(uuid, timestamptz) from public;
grant execute on function public.restore_package(uuid, timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. package_usage — stop overstating capacity with dead groups, and expose
--    the archived/cancelled counts the Groups tab needs to filter by.
--
--    Before: `seats_booked` / `seats_capacity` summed EVERY group, including
--    ones `live_group_count` itself already excludes (archived, cancelled).
--    A package with 3 cancelled groups and 1 live one reported the capacity
--    of all 4 (finding B9).
-- ─────────────────────────────────────────────────────────────────────────────

-- `CREATE OR REPLACE VIEW` can only APPEND output columns, never reorder or
-- remove them — `archived_group_count`/`cancelled_group_count` are new, so
-- they go after the original five, in their original order, not
-- interleaved where they'd read most naturally.
create or replace view public.package_usage as
  select package_template_id                                        as package_id,
         count(*)                                                    as group_count,
         count(*) filter (where archived = false
                            and group_status <> 'CANCELLED')         as live_group_count,
         coalesce(sum(booked_seats) filter (where archived = false
                            and group_status <> 'CANCELLED'), 0)     as seats_booked,
         coalesce(sum(capacity) filter (where archived = false
                            and group_status <> 'CANCELLED'), 0)     as seats_capacity,
         count(*) filter (where archived = true)                     as archived_group_count,
         count(*) filter (where group_status = 'CANCELLED')          as cancelled_group_count
    from public.departure_groups
   where package_template_id is not null
   group by package_template_id;

comment on view public.package_usage is
  'One row per package template with departure-group counts and seat totals. `seats_booked`/`seats_capacity` only ever sum LIVE groups (not archived, not cancelled) — the same scope as `live_group_count` — so a package''s reported capacity can never be inflated by dead groups. Used by the packages list/detail screens and by deletePackageAction/archive_package to refuse deleting or archiving a package groups still depend on.';

alter view public.package_usage set (security_invoker = true);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. internal_code uniqueness, per agency.
--
--    Before: no uniqueness at all. Duplicating a package twice produced two
--    identical "…-COPY" codes, and the code is what group snapshots, the
--    picker, and reports display (finding B4). Existing collisions are
--    deduplicated by suffixing every row after the first (ordered by
--    creation, so the original keeps its code) before the constraint is
--    added, so this migration can never fail on data that already exists.
-- ─────────────────────────────────────────────────────────────────────────────

with duplicates as (
  select id,
         internal_code,
         row_number() over (
           partition by agency_id, lower(internal_code)
           order by created_at asc, id asc
         ) as rn
    from public.packages
   where internal_code is not null and btrim(internal_code) <> ''
)
update public.packages p
   set internal_code = p.internal_code || '-' || d.rn
  from duplicates d
 where p.id = d.id
   and d.rn > 1;

drop index if exists packages_internal_code_agency_unique;
create unique index packages_internal_code_agency_unique
  on public.packages (agency_id, lower(internal_code))
  where internal_code is not null and btrim(internal_code) <> '';

comment on index public.packages_internal_code_agency_unique is
  'A blank internal_code (mid-draft, before the wizard''s Commercial Identity step is filled in) is excluded so autosave on a brand-new draft never collides with another brand-new draft — only a package that has actually been given a code competes for uniqueness.';

notify pgrst, 'reload schema';
