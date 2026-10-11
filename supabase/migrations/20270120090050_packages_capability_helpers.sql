-- TASK-043 Phase 1, step 3 (PKG-04): make the database understand a person's package capabilities, including the ones an ADMIN switched on or off for a
-- custom role in Management → Teams → Roles & Permissions.
--
-- Phase 0 (test T5, 2026-10-09) showed that a custom role with `deletePackage` switched off could still delete a package straight through the API, because
-- every policy and function only knew the base-tier text role. This migration adds the two helpers the policies and functions use; the migrations that follow
-- use them.
--
-- How a capability is resolved (the same order as lib/access/dynamic-capabilities.ts + lib/access/packages-access.ts):
--   1. The caller's staff_profiles.role_id -> role_permissions (module 'packages') -> capabilities JSON.
--   2. If the JSON has the key, only the JSON value `true` grants it. Any other value, including a string or a number, denies.
--   3. If there is no role, no permissions row, or the key is absent (a capability added after the role was saved), the caller's base-tier default applies.
--   4. A caller with no staff profile has no capabilities.
-- A capability can only narrow what the base tier allows: the policies still require the tier (staff_role_in) AND the capability.
--
-- package_tier_default_capability must stay identical to CAPABILITIES in lib/access/packages-access.ts; lib/security/packages-capability-helpers-migration.test.ts
-- compares them and fails if they drift.
--
-- Idempotent. Rollback: drop both functions (nothing else references them until the later migrations in this series are applied).

create or replace function public.package_tier_default_capability(p_role text, p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    case p_role
      when 'ADMIN' then p_key = any (array[
        'viewModule', 'createPackage', 'editPackage', 'publishPackage', 'duplicatePackage', 'archiveOrRestorePackage',
        'deletePackage', 'toggleFeatured', 'viewInternalFinance', 'exportCatalogue', 'createGroupFromPackage',
        'editSensitiveTerms', 'approvePackageChanges'])
      when 'CEO' then p_key = any (array['viewModule', 'viewInternalFinance', 'exportCatalogue'])
      when 'OPERATIONS' then p_key = any (array[
        'viewModule', 'createPackage', 'editPackage', 'publishPackage', 'duplicatePackage', 'archiveOrRestorePackage',
        'toggleFeatured', 'exportCatalogue', 'createGroupFromPackage', 'editSensitiveTerms'])
      when 'FINANCE' then p_key = any (array['viewModule', 'viewInternalFinance', 'exportCatalogue'])
      when 'MARKETING' then p_key = any (array['viewModule', 'duplicatePackage', 'toggleFeatured'])
      when 'VISA' then p_key = any (array['viewModule', 'exportCatalogue'])
      else false
    end,
    false)
$$;

comment on function public.package_tier_default_capability(text, text) is
  'The built-in package capabilities of a base role tier. Mirrors CAPABILITIES in lib/access/packages-access.ts; a test fails if they differ.';

create or replace function public.has_package_capability(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_staff_role();
  v_caps jsonb;
begin
  if v_role is null then
    return false;
  end if;

  select rp.capabilities into v_caps
    from public.staff_profiles sp
    join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'packages'
   where sp.id = auth.uid();

  if v_caps is null or jsonb_typeof(v_caps) <> 'object' or not (v_caps ? p_key) then
    return public.package_tier_default_capability(v_role, p_key);
  end if;

  return (v_caps -> p_key) = 'true'::jsonb;
end;
$$;

comment on function public.has_package_capability(text) is
  'Whether the calling staff member holds a package capability: their custom role''s saved value if it has one for this key (only boolean true grants), otherwise the default for their base tier. Reads only the caller''s own role. SECURITY DEFINER so row security on role_permissions does not hide the row; used inside policies and the package functions.';

revoke all on function public.package_tier_default_capability(text, text) from public, anon;
grant execute on function public.package_tier_default_capability(text, text) to authenticated, service_role;
revoke all on function public.has_package_capability(text) from public, anon;
grant execute on function public.has_package_capability(text) to authenticated, service_role;

notify pgrst, 'reload schema';
