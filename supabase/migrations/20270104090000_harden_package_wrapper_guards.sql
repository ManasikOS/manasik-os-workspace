-- TASK-032 S4 / audit item D3 (docs/progress/2026-10-02-tenant-isolation-audit.md): make the six package wrappers refuse on their own, instead of
-- relying on the internal step they call to catch what their own guard lets through.
--
-- The pattern: `if public.current_staff_role() not in ('ADMIN', 'OPERATIONS') then raise ...`. For a caller with no staff profile,
-- current_staff_role() is NULL, `NULL not in (...)` is NULL, and `if NULL then` does not raise, so the guard let that caller straight through.
-- It was not exploitable only because the next call (packages_apply_status_transition) checks the agency and fails. After F3 that step is not
-- executable by signed-in users and still fails closed on a missing agency; this migration removes the dependence on it.
--
--   archive_package, close_package_sales, publish_package, reopen_package, restore_package, package_versions_create
--
-- What changes, for each: the role guard becomes `not coalesce(public.staff_role_in(...), false)` (false, never NULL, for a caller with no
-- profile), and a missing agency is refused up front with the same message the internal step would give ("Your session has no active agency.",
-- 28000). archive_package also confirms the package belongs to the caller's agency before it reads anything about it, with the message the
-- internal step already gives ("That package no longer exists.", P0002). The roles allowed, the messages, the error codes and the results for a
-- legitimate caller are unchanged. Signatures, defaults, return types and grants are unchanged (create or replace).
--
-- The one difference a caller can see: a user with no staff profile used to be refused with "no active agency" (28000) by the internal step and is
-- now refused with the wrapper's own role message (42501). Both are refusals.
--
-- Rollback: re-apply the previous definitions from the migrations that last defined them. Idempotent.

create or replace function public.archive_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null,
  p_reason text default null,
  p_force boolean default false
)
returns public.packages
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_live_groups integer;
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot archive packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  perform 1 from public.packages where id = p_package_id and agency_id = v_agency;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
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
    if not coalesce(public.staff_role_in('ADMIN'), false) then
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

create or replace function public.close_package_sales(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
)
returns public.packages
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot close sales on packages.' using errcode = '42501';
  end if;
  if public.current_agency_id() is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Open for Sale'], 'Sales Closed', 'SALES_CLOSED', null
  );
end;
$$;

create or replace function public.publish_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
)
returns public.packages
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot publish packages.' using errcode = '42501';
  end if;
  if public.current_agency_id() is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Draft', 'Sales Closed'], 'Open for Sale', 'PUBLISHED', null
  );
end;
$$;

create or replace function public.reopen_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
)
returns public.packages
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot reopen packages for sale.' using errcode = '42501';
  end if;
  if public.current_agency_id() is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  return public.packages_apply_status_transition(
    p_package_id, p_expected_updated_at,
    array['Sales Closed'], 'Open for Sale', 'REOPENED', null
  );
end;
$$;

create or replace function public.restore_package(
  p_package_id uuid,
  p_expected_updated_at timestamptz default null
)
returns public.packages
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target text;
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot restore packages.' using errcode = '42501';
  end if;
  if public.current_agency_id() is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
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

create or replace function public.package_versions_create(p_package_id uuid, p_snapshot jsonb)
returns public.package_versions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid := public.current_agency_id();
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_next_version integer;
  v_row public.package_versions;
begin
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false) then
    raise exception 'Your role cannot publish packages.' using errcode = '42501';
  end if;
  if v_agency is null then
    raise exception 'Your session has no active agency.' using errcode = '28000';
  end if;

  perform 1 from public.packages
    where id = p_package_id and agency_id = v_agency
    for update;
  if not found then
    raise exception 'That package no longer exists.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name from public.staff_profiles where id = v_actor;

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.package_versions
    where package_id = p_package_id;

  insert into public.package_versions
    (package_id, agency_id, version_number, snapshot, published_by, published_by_name)
  values
    (p_package_id, v_agency, v_next_version, p_snapshot, v_actor, coalesce(v_actor_name, 'Staff'))
  returning * into v_row;

  update public.packages set published_version_id = v_row.id where id = p_package_id;

  return v_row;
end;
$$;

-- Guard: none of the six may still compare the role with NULL-blind `not in`, and all six must refuse a caller with no agency ------------------
do $$
declare
  v_weak text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into v_weak
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('archive_package', 'close_package_sales', 'publish_package', 'reopen_package', 'restore_package', 'package_versions_create')
     and (p.prosrc ~ 'current_staff_role\(\)\s+not\s+in' or p.prosrc !~ 'staff_role_in\(' or p.prosrc !~ 'current_agency_id\(\)|v_agency');

  if v_weak is not null then
    raise exception 'Tenant isolation: these package functions still have a NULL-blind role guard or no agency check: %', v_weak;
  end if;
end;
$$;
