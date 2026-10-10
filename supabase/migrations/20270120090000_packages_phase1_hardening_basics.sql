-- TASK-043 Phase 1, step 6 (and the first half of the Phase 0 findings): three small, independent hardening changes to the Packages module.
-- Verified against staging on 2026-10-09 (docs/progress/2026-10-09-packages-phase0-verification.md).
--
--   1. public.staff_role_in had no fixed search_path (Supabase security advisor, WARN). Every policy on `packages` calls it, so it is fixed
--      first. Same signature and result; only the schema lookup is now pinned. The body already schema-qualifies its one call.
--   2. public.list_packages_with_usage was executable by PUBLIC and `anon` (the ACL shows `=X` and `anon=X`). It is `security invoker` and the table
--      policies are `to authenticated`, so an anonymous call should return no rows; it should not be callable at all. Signed-in staff keep EXECUTE.
--   3. package_activity_logs.reason had no length limit. The force-archive reason is free text typed by a person and shown on the Activity tab.
--      Added NOT VALID so existing rows are never rewritten or rejected; new and changed rows must be 500 characters or fewer.
--
-- Changes no table data and no policy. Idempotent.
-- Rollback: recreate staff_role_in without the `set search_path` line; grant execute on list_packages_with_usage to public, anon; drop the constraint.

create or replace function public.staff_role_in(variadic roles text[]) returns boolean
language sql stable
set search_path = public
as $$
  select coalesce(public.current_staff_role() = any(roles), false)
$$;

revoke execute on function public.list_packages_with_usage(text, uuid) from public, anon;
grant execute on function public.list_packages_with_usage(text, uuid) to authenticated, service_role;

alter table public.package_activity_logs
  drop constraint if exists package_activity_logs_reason_length;
alter table public.package_activity_logs
  add constraint package_activity_logs_reason_length
  check (reason is null or char_length(reason) <= 500) not valid;

notify pgrst, 'reload schema';
