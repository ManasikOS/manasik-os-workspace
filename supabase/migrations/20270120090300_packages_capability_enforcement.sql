-- TASK-043 Phase 1, step 3 (PKG-04): the package policies, the column-scope trigger and the five lifecycle functions now check the caller's package
-- CAPABILITY, not only their base tier.
--
-- Phase 0 test T5 (2026-10-09): a role with `deletePackage` switched off in Roles & Permissions still deleted a package directly. After this migration the
-- database asks the same question the application asks (public.has_package_capability, 20270120090050). The tier check stays: a custom role can only ever
-- have LESS than its base tier allows, never more.
--
--   Policies
--     INSERT  tier ADMIN/OPERATIONS + createPackage or duplicatePackage; MARKETING keeps "unfeatured Draft" + duplicatePackage.
--     UPDATE  tier ADMIN/OPERATIONS + editPackage or toggleFeatured; MARKETING keeps "live or own" + toggleFeatured. Which COLUMNS apply is the trigger below.
--     DELETE  ADMIN tier + deletePackage.
--   Trigger packages_enforce_marketing_column_scope (name kept) now means "who may change which columns of a package row":
--     - the SECURITY DEFINER lifecycle functions run as their owner and are not held to it (they check their own capability);
--     - editPackage          -> any column (ADMIN/OPERATIONS tier);
--     - toggleFeatured only  -> `featured` (and updated_at) only (this is every MARKETING user, and an ADMIN/OPERATIONS custom role without editPackage);
--     - anything else        -> refused.
--   Lifecycle functions (same names, signatures, messages, error codes and return values; one added capability check each)
--     publish_package, close_package_sales, reopen_package -> publishPackage;  archive_package, restore_package -> archiveOrRestorePackage;
--     a force-archive additionally needs the ADMIN tier, as before.
--
-- A caller with no role row and a base tier sees no change: the tier default applies. System roles were seeded from the same defaults.
-- Idempotent. Rollback: re-apply 20270119090000 (policies), 20261005090000 section C (trigger) and 20270104090000 (functions).

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "staff insert packages" on public.packages;
create policy "staff insert packages" on public.packages
  for insert to authenticated
  with check (
    agency_id = (select public.current_agency_id())
    and owner_id = (select auth.uid())
    and (
      (
        public.staff_role_in('ADMIN', 'OPERATIONS')
        and ((select public.has_package_capability('createPackage')) or (select public.has_package_capability('duplicatePackage')))
      )
      or (
        public.staff_role_in('MARKETING')
        and status = 'Draft'
        and featured = false
        and (select public.has_package_capability('duplicatePackage'))
      )
    )
  );

drop policy if exists "staff update packages" on public.packages;
create policy "staff update packages" on public.packages
  for update to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (
      (
        public.staff_role_in('ADMIN', 'OPERATIONS')
        and ((select public.has_package_capability('editPackage')) or (select public.has_package_capability('toggleFeatured')))
      )
      or (
        public.staff_role_in('MARKETING')
        and (status = 'Open for Sale' or owner_id = (select auth.uid()))
        and (select public.has_package_capability('toggleFeatured'))
      )
    )
  )
  with check (
    agency_id = (select public.current_agency_id())
    and (
      (
        public.staff_role_in('ADMIN', 'OPERATIONS')
        and ((select public.has_package_capability('editPackage')) or (select public.has_package_capability('toggleFeatured')))
      )
      or (
        public.staff_role_in('MARKETING')
        and (status = 'Open for Sale' or owner_id = (select auth.uid()))
        and (select public.has_package_capability('toggleFeatured'))
      )
    )
  );

drop policy if exists "staff delete packages" on public.packages;
create policy "staff delete packages" on public.packages
  for delete to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN')
    and (select public.has_package_capability('deletePackage'))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Column scope
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.packages_enforce_marketing_column_scope()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose (it was SECURITY DEFINER before): the bypass below tests current_user, which inside a definer function would always be the
-- function owner and would let every caller through. Nothing here needs elevated rights: the two helpers it calls are definer functions themselves.
set search_path = public
as $$
declare
  -- `featured` is the only column a toggleFeatured-only caller may change; updated_at is stamped by packages_set_updated_at on every write.
  scope_exclusions text[] := array['featured', 'updated_at']
    || (select coalesce(array_agg(a.attname::text), '{}') from pg_attribute a
        where a.attrelid = 'public.packages'::regclass and a.attgenerated <> '' and not a.attisdropped);
begin
  -- The SECURITY DEFINER lifecycle functions (and migrations / service_role) are not `authenticated`; each lifecycle function checks its own capability.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.staff_role_in('ADMIN', 'OPERATIONS') and coalesce(public.has_package_capability('editPackage'), false) then
    return new;
  end if;

  if public.staff_role_in('ADMIN', 'OPERATIONS', 'MARKETING') and coalesce(public.has_package_capability('toggleFeatured'), false) then
    if (to_jsonb(old) - scope_exclusions) is distinct from (to_jsonb(new) - scope_exclusions) then
      raise exception 'MARKETING may only change a package''s featured flag, not its other fields.' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Your role cannot update packages.' using errcode = '42501';
end;
$$;

comment on function public.packages_enforce_marketing_column_scope() is
  'BEFORE UPDATE guard on who may change which columns: direct API callers with editPackage (ADMIN/OPERATIONS tier) may change any column; callers with only toggleFeatured (MARKETING, or a custom role without editPackage) may change only featured; everyone else is refused. SECURITY DEFINER lifecycle functions are not held to it. Deliberately SECURITY INVOKER so current_user is the real caller. See TASK-043 PKG-04.';

revoke all on function public.packages_enforce_marketing_column_scope() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lifecycle functions: one capability check added to each (bodies otherwise as in 20270104090000)
-- ─────────────────────────────────────────────────────────────────────────────
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
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('archiveOrRestorePackage'), false) then
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
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('publishPackage'), false) then
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
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('publishPackage'), false) then
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
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('publishPackage'), false) then
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
  if not coalesce(public.staff_role_in('ADMIN', 'OPERATIONS'), false)
     or not coalesce(public.has_package_capability('archiveOrRestorePackage'), false) then
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

-- Same guard as 20270104090000, extended: every wrapper must use the NULL-safe role helper, check the agency, and now check a package capability.
do $$
declare
  v_weak text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into v_weak
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('archive_package', 'close_package_sales', 'publish_package', 'reopen_package', 'restore_package', 'publish_package_with_content')
     and (p.prosrc ~ 'current_staff_role\(\)\s+not\s+in' or p.prosrc !~ 'staff_role_in\(' or p.prosrc !~ 'has_package_capability\(' or p.prosrc !~ 'current_agency_id\(\)|v_agency');

  if v_weak is not null then
    raise exception 'Package capability enforcement: these functions are missing a NULL-safe role guard, a capability check or an agency check: %', v_weak;
  end if;
end;
$$;

notify pgrst, 'reload schema';
