-- TASK-043 Phase 1, steps 1 and 2: one database path for a package's lifecycle columns, and versions that are built from the row itself.
--
-- Phase 0 proved on staging (2026-10-09) that:
--   * an ADMIN or OPERATIONS session can set `status` directly with a plain UPDATE, with no validation and no activity-log row (PKG-01);
--   * any ADMIN or OPERATIONS session can store any JSON as a package's published version (PKG-05).
--
-- What this migration does
--   A. Trigger `packages_guard_lifecycle_columns`: a caller running as `authenticated` or `anon` (a direct API call) cannot insert a package that is not a
--      plain Draft, and cannot change status, previous_status, archived_at, published_at or published_version_id. The SECURITY DEFINER lifecycle functions run as
--      their owner, so they pass; migrations and service_role pass. The check is on current_user, which a signed-in caller cannot change.
--   B. `packages_record_version(uuid)` (internal): writes the next package_versions row from the locked package row itself. Nothing the caller supplies goes in.
--   C. `packages_apply_status_transition` now records that version whenever the result is 'Open for Sale', in the same transaction as the status change, so a
--      publish or reopen can no longer succeed without its version, and the version always matches what was published.
--   D. `package_versions_create(uuid, jsonb)` is kept (same signature, so nothing that names it breaks) but ignores the caller's snapshot, requires an Open for
--      Sale package, and is no longer executable by signed-in users.
--   E. `publish_package_with_content(uuid, jsonb, timestamptz)`: the single call the wizard's Publish uses. In one transaction it checks role, the publish capability
--      (plus create for a new package, edit for an existing one, see 20270120090050) and agency,
--      locks the row, compares updated_at, writes only an allow-listed set of content columns, makes the status change and logs and versions it.
--      The application still validates completeness (the Zod step schemas); this function enforces WHO, WHICH columns and WHICH transition.
--
-- The application change that stops writing `status` directly ships in the same pull request (app/(main)/packages/actions.ts). Deploying this migration
-- without it makes the old publish path fail with 42501.
--
-- Rollback: drop trigger packages_guard_lifecycle_columns and its function; re-apply the previous definitions of packages_apply_status_transition
-- (20261006090000) and package_versions_create (20270104090000); grant execute on package_versions_create to authenticated; drop the two new functions.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Lifecycle-column guard
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.packages_guard_lifecycle_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only direct API callers are held to this. SECURITY DEFINER functions run as their owner; migrations and service_role are not `authenticated`/`anon`.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'Draft'
       or new.previous_status is not null
       or new.archived_at is not null
       or new.published_at is not null
       or new.published_version_id is not null then
      raise exception 'A package is created as a Draft. Publish it through the publish action.' using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.status, new.previous_status, new.archived_at, new.published_at, new.published_version_id)
     is distinct from
     (old.status, old.previous_status, old.archived_at, old.published_at, old.published_version_id) then
    raise exception 'A package''s status can only change through the publish, close sales, reopen, archive and restore actions.' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.packages_guard_lifecycle_columns() is
  'BEFORE INSERT/UPDATE guard: a direct API caller (current_user authenticated/anon) cannot create a non-Draft package or change status, previous_status, archived_at, published_at or published_version_id. Only the SECURITY DEFINER lifecycle functions can. TASK-043 PKG-01.';

revoke all on function public.packages_guard_lifecycle_columns() from public, anon, authenticated;

drop trigger if exists packages_guard_lifecycle_columns on public.packages;
create trigger packages_guard_lifecycle_columns
  before insert or update on public.packages
  for each row execute function public.packages_guard_lifecycle_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Internal version writer — built from the row, never from the caller
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.packages_record_version(p_package_id uuid)
returns public.package_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_pkg public.packages;
  v_next integer;
  v_row public.package_versions;
begin
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  select * into v_pkg from public.packages where id = p_package_id and agency_id = v_agency for update;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.package_versions where package_id = p_package_id;

  insert into public.package_versions
    (package_id, agency_id, version_number, snapshot, published_by, published_by_name)
  values
    (p_package_id, v_agency, v_next, to_jsonb(v_pkg) - 'published_version_id', v_actor, coalesce(v_actor_name, 'Staff'))
  returning * into v_row;

  update public.packages set published_version_id = v_row.id where id = p_package_id;
  return v_row;
end;
$$;

comment on function public.packages_record_version(uuid) is
  'Internal. Writes the next package_versions row from the locked package row (the caller supplies no content). Called by the lifecycle functions only; not executable by signed-in users.';

revoke all on function public.packages_record_version(uuid) from public, anon, authenticated;
grant execute on function public.packages_record_version(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. The shared transition now records the version in the same transaction
--    (body identical to 20261006090000 except for the final `perform`).
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

  -- A package that becomes sellable always gets a version, in this same transaction.
  if p_to_status = 'Open for Sale' then
    perform public.packages_record_version(p_package_id);
    select * into v_row from public.packages where id = p_package_id;
  end if;

  return v_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. package_versions_create — same signature, no caller content, not callable by signed-in users
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.package_versions_create(p_package_id uuid, p_snapshot jsonb)
returns public.package_versions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot publish packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  perform 1 from public.packages where id = p_package_id and agency_id = v_agency and status = 'Open for Sale';
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  -- p_snapshot is deliberately ignored: a version is a copy of the package row, never something a caller states.
  return public.packages_record_version(p_package_id);
end;
$$;

comment on function public.package_versions_create(uuid, jsonb) is
  'Deprecated. Ignores p_snapshot and records a version built from the Open for Sale package row itself. No longer executable by signed-in users; the lifecycle functions record versions themselves.';

revoke all on function public.package_versions_create(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.package_versions_create(uuid, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. publish_package_with_content
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.publish_package_with_content(
  p_package_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz default null
)
returns public.packages
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- The only columns a publish may write: public.package_content_columns() (status, featured and every lifecycle column are deliberately absent).
  v_agency uuid := public.current_agency_id();
  v_unknown text[];
  v_id uuid;
  v_status text;
  v_updated timestamptz;
  v_result public.packages;
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('publishPackage'), false) then
    raise exception 'Your role cannot publish packages.' using errcode = '42501';
  end if;
  if p_package_id is null and not coalesce(public.has_package_capability('createPackage'), false) then
    raise exception 'Your role cannot create packages.' using errcode = '42501';
  end if;
  if p_package_id is not null and not coalesce(public.has_package_capability('editPackage'), false) then
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

  if p_package_id is null then
    -- Created as a Draft (the guard allows that), filled below, then published.
    insert into public.packages (title) values ('') returning id into v_id;
    v_status := 'Draft';
  else
    select id, status, updated_at into v_id, v_status, v_updated
      from public.packages where id = p_package_id and agency_id = v_agency for update;
    if v_id is null then
      raise exception 'That package no longer exists.' using errcode = 'P0002';
    end if;
    if p_expected_updated_at is not null and v_updated is distinct from p_expected_updated_at then
      raise exception 'This package changed elsewhere. Reload and try again.' using errcode = '40001';
    end if;
    if v_status not in ('Draft', 'Sales Closed') then
      raise exception 'This package is % and cannot be published from here.', v_status using errcode = '22023';
    end if;
  end if;

  -- Keys absent from p_content keep their current value (see packages_apply_content, 20270120090060).
  perform public.packages_apply_content(v_id, p_content);

  v_result := public.packages_apply_status_transition(
    v_id, null, array['Draft', 'Sales Closed'], 'Open for Sale',
    case when v_status = 'Sales Closed' then 'REOPENED' else 'PUBLISHED' end, null
  );
  return v_result;
end;
$$;

comment on function public.publish_package_with_content(uuid, jsonb, timestamptz) is
  'Publishes a package in one transaction: ADMIN/OPERATIONS only, own agency only, optimistic-concurrency compare, writes only the allow-listed content columns (never status/featured/lifecycle columns), moves Draft or Sales Closed to Open for Sale, logs it and records the version. p_package_id null creates the package. The application validates completeness; this function enforces who, which columns and which transition.';

revoke all on function public.publish_package_with_content(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.publish_package_with_content(uuid, jsonb, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
