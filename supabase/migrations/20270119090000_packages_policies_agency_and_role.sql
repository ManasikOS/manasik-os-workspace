-- TASK-041 (F1, F2): the four row-level-security policies on public.packages, re-stated in full so that EVERY one checks the caller's agency AND the caller's role.
--
-- Two different problems, one fix.
--
--   F1 (every database built from the migrations, which is how production will be built). "staff insert packages" and "staff update packages" check the
--       role and the owner but never `agency_id`. The column default (`current_agency_id()`) only applies when the client leaves the column out, so a signed-in
--       ADMIN or OPERATIONS user could INSERT a package into ANOTHER agency by naming that agency's id. Proven on 2026-10-08 by replaying these policies inside a
--       rolled-back transaction on staging. (Moving an existing row to another agency was already refused, because the SELECT policy hides the new row.)
--   F2 (staging only). Staging still carries the pre-hardening policies, `agency_id = current_agency_id() AND true`: no role check on read, insert or delete,
--       so a read-only role (CEO) could create and delete packages straight through the API. Migrations 20260822090000 and 20261005090000 are recorded as applied
--       there but their policy effect is not in the database (the same pattern TASK-032 S5 found for the marketing-scope trigger). Staging's agency check on
--       INSERT/UPDATE is what happens to be hiding F1 there.
--
-- What the policies are after this migration (the role sets are the ones the repository already intended; only the agency check is new on insert/update):
--   SELECT  agency + ADMIN, CEO, OPERATIONS, FINANCE, MARKETING, VISA        (GUIDE reads no packages)
--   INSERT  agency + owner is the caller + (ADMIN/OPERATIONS, or MARKETING for an unfeatured Draft)
--   UPDATE  agency + (ADMIN/OPERATIONS, or MARKETING on Open for Sale / own rows); column scope for MARKETING stays in trigger packages_enforce_marketing_scope
--   DELETE  agency + ADMIN
-- The policy text deliberately matches what a clean rebuild already has for SELECT and DELETE (including the `(select ...)` form the initplan migration
-- 20261128090000 introduced), so the fingerprint of those two does not change. The "agent read allocated packages" policy is untouched.
--
-- Safe to apply: policy-only, no data and no column changes, idempotent (drop if exists + create). It runs in the migration's own transaction, so the table is
-- never without policies for a moment a request could see. On a database that already has these policies it recreates them unchanged.
-- Behaviour change on staging: GUIDE (none exist there) loses read access to packages, and CEO/VISA/GUIDE lose direct insert and delete; the application already
-- denies all of those (lib/access/packages-access.ts), so nothing the app does changes.
-- Rollback: recreate the previous policies. For a clean-build database that is migration 20261005090000 sections A and B (insert/update) with the select and
-- delete definitions below left as they are. On staging, the previous select/delete/insert/update text was `agency_id = current_agency_id() AND true`
-- (insert: `agency_id = current_agency_id() AND owner_id = (select auth.uid())`); there is no reason to go back to it.

-- SELECT -------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "staff read packages" on public.packages;
create policy "staff read packages" on public.packages
  for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'FINANCE', 'MARKETING', 'VISA')
  );

-- INSERT -------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "staff insert packages" on public.packages;
create policy "staff insert packages" on public.packages
  for insert to authenticated
  with check (
    agency_id = (select public.current_agency_id())
    and owner_id = (select auth.uid())
    and (
      public.staff_role_in('ADMIN', 'OPERATIONS')
      or (
        public.staff_role_in('MARKETING')
        and status = 'Draft'
        and featured = false
      )
    )
  );

-- UPDATE -------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "staff update packages" on public.packages;
create policy "staff update packages" on public.packages
  for update to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (
      public.staff_role_in('ADMIN', 'OPERATIONS')
      or (
        public.staff_role_in('MARKETING')
        and (status = 'Open for Sale' or owner_id = (select auth.uid()))
      )
    )
  )
  with check (
    agency_id = (select public.current_agency_id())
    and (
      public.staff_role_in('ADMIN', 'OPERATIONS')
      or (
        public.staff_role_in('MARKETING')
        and (status = 'Open for Sale' or owner_id = (select auth.uid()))
      )
    )
  );

-- DELETE -------------------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "staff delete packages" on public.packages;
create policy "staff delete packages" on public.packages
  for delete to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and public.staff_role_in('ADMIN')
  );

notify pgrst, 'reload schema';
