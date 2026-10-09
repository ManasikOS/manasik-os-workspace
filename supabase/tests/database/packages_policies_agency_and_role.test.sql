begin;

-- TASK-041 (F1, F2): the row-level-security policies on public.packages check the caller's agency AND role. Two agencies, and one user of each role that matters.
-- Proves: nobody can insert into another agency; read-only roles (CEO, VISA) cannot create or delete; GUIDE reads nothing; another agency sees and changes nothing;
-- MARKETING can only create an unfeatured Draft; an ADMIN can still do the whole normal job. One transaction, rolled back. Expect zero rows from finish().

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.agencies (id, name, slug, status) values
  ('e0000000-0000-4000-8000-0000000000a1', 'Pkg Policy Agency A', 'pkg-policy-agency-a', 'ACTIVE'),
  ('e0000000-0000-4000-8000-0000000000b2', 'Pkg Policy Agency B', 'pkg-policy-agency-b', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('e1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@pkgpolicy.test', '', now(), '{}', '{}', now(), now()),
  ('e2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops-a@pkgpolicy.test', '', now(), '{}', '{}', now(), now()),
  ('e3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing-a@pkgpolicy.test', '', now(), '{}', '{}', now(), now()),
  ('e4000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ceo-a@pkgpolicy.test', '', now(), '{}', '{}', now(), now()),
  ('e5000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'visa-a@pkgpolicy.test', '', now(), '{}', '{}', now(), now()),
  ('e6000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'guide-a@pkgpolicy.test', '', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'admin-b@pkgpolicy.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('e1000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@pkgpolicy.test', 'ADMIN', 'ACTIVE'),
  ('e2000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'Ops A', 'ops-a@pkgpolicy.test', 'OPERATIONS', 'ACTIVE'),
  ('e3000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'Marketing A', 'marketing-a@pkgpolicy.test', 'MARKETING', 'ACTIVE'),
  ('e4000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'CEO A', 'ceo-a@pkgpolicy.test', 'CEO', 'ACTIVE'),
  ('e5000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'Visa A', 'visa-a@pkgpolicy.test', 'VISA', 'ACTIVE'),
  ('e6000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'Guide A', 'guide-a@pkgpolicy.test', 'GUIDE', 'ACTIVE'),
  ('e1000000-0000-4000-8000-0000000000b2', 'e0000000-0000-4000-8000-0000000000b2', 'Admin B', 'admin-b@pkgpolicy.test', 'ADMIN', 'ACTIVE');

-- Existing packages, created by the test owner (bypassing RLS): one in agency A that the tests try to read, change and delete, one in agency B.
insert into public.packages (id, agency_id, owner_id, title, status) values
  ('e9000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000a1', 'Existing A', 'Open for Sale'),
  ('e9000000-0000-4000-8000-0000000000b2', 'e0000000-0000-4000-8000-0000000000b2', 'e1000000-0000-4000-8000-0000000000b2', 'Existing B', 'Draft');

-- Counts the rows a statement changed, as the CALLER (security invoker), so row-level security applies. Dies with the transaction.
create function public.zz_rows_changed(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- ADMIN of agency A: the normal job still works ---------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000a1', 'New A', 'Draft')$$, 'ADMIN can create a package in their own agency');
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000a3', 'e0000000-0000-4000-8000-0000000000b2', 'e1000000-0000-4000-8000-0000000000a1', 'Planted in B', 'Draft')$$, '42501', null, 'ADMIN cannot create a package in ANOTHER agency by naming its id (F1)');
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000a4', 'e0000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-0000000000a1', 'Someone else owns', 'Draft')$$, '42501', null, 'ADMIN cannot create a package owned by someone else');
select is((select count(*)::int from public.packages), 2, 'ADMIN sees exactly their own agency''s two packages');
select is(public.zz_rows_changed($$update public.packages set title = 'Renamed' where id = 'e9000000-0000-4000-8000-0000000000a1'$$), 1, 'ADMIN can edit a package in their own agency');
select throws_ok($$update public.packages set agency_id = 'e0000000-0000-4000-8000-0000000000b2' where id = 'e9000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'ADMIN cannot move a package into another agency');

-- ADMIN of agency B: a different tenant sees and changes nothing of agency A's -----------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e1000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.packages where agency_id = 'e0000000-0000-4000-8000-0000000000a1'), 0, 'Another agency''s ADMIN sees none of agency A''s packages');
select is(public.zz_rows_changed($$update public.packages set title = 'Hijacked' where id = 'e9000000-0000-4000-8000-0000000000a1'$$), 0, 'Another agency''s ADMIN cannot edit agency A''s package');
select is(public.zz_rows_changed($$delete from public.packages where id = 'e9000000-0000-4000-8000-0000000000a1'$$), 0, 'Another agency''s ADMIN cannot delete agency A''s package');

-- OPERATIONS of agency A ------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000a5', 'e0000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-0000000000a1', 'Ops package', 'Draft')$$, 'OPERATIONS can create a package in their own agency');
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000a6', 'e0000000-0000-4000-8000-0000000000b2', 'e2000000-0000-4000-8000-0000000000a1', 'Ops into B', 'Draft')$$, '42501', null, 'OPERATIONS cannot create a package in another agency');

-- MARKETING of agency A: only an unfeatured Draft ------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into public.packages (id, agency_id, owner_id, title, status, featured) values ('e9000000-0000-4000-8000-0000000000a7', 'e0000000-0000-4000-8000-0000000000a1', 'e3000000-0000-4000-8000-0000000000a1', 'Marketing draft', 'Draft', false)$$, 'MARKETING can create an unfeatured Draft');
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status, featured) values ('e9000000-0000-4000-8000-0000000000a8', 'e0000000-0000-4000-8000-0000000000a1', 'e3000000-0000-4000-8000-0000000000a1', 'Marketing live', 'Open for Sale', false)$$, '42501', null, 'MARKETING cannot create a package that is already Open for Sale');

-- CEO and VISA: read-only roles (F2) -----------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e4000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select ok((select count(*) from public.packages) > 0, 'CEO can read packages');
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000a9', 'e0000000-0000-4000-8000-0000000000a1', 'e4000000-0000-4000-8000-0000000000a1', 'CEO package', 'Draft')$$, '42501', null, 'CEO cannot create a package');
select is(public.zz_rows_changed($$delete from public.packages where id = 'e9000000-0000-4000-8000-0000000000a1'$$), 0, 'CEO cannot delete a package');
set local "request.jwt.claims" = '{"sub":"e5000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000aa', 'e0000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-0000000000a1', 'Visa package', 'Draft')$$, '42501', null, 'VISA cannot create a package');

-- GUIDE: no access to packages at all ------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e6000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.packages), 0, 'GUIDE reads no packages');
select throws_ok($$insert into public.packages (id, agency_id, owner_id, title, status) values ('e9000000-0000-4000-8000-0000000000ab', 'e0000000-0000-4000-8000-0000000000a1', 'e6000000-0000-4000-8000-0000000000a1', 'Guide package', 'Draft')$$, '42501', null, 'GUIDE cannot create a package');

-- ADMIN of agency A deletes (the only role that can) -----------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(public.zz_rows_changed($$delete from public.packages where id = 'e9000000-0000-4000-8000-0000000000a2'$$), 0, 'ADMIN cannot delete a package by writing to the table: delete_package() is the only way (20270120090600)');

-- The policies themselves: each of the four names an agency check and a role check ---------------------------------------------------------------------
reset role;
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.packages'::regclass
      and polname in ('staff read packages', 'staff insert packages', 'staff update packages', 'staff delete packages')
      and pg_get_expr(coalesce(polwithcheck, polqual), polrelid) like '%current_agency_id%'
      and pg_get_expr(coalesce(polwithcheck, polqual), polrelid) like '%staff_role_in%'),
  4, 'All four staff policies check the agency and the role');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.packages'::regclass and polname = 'staff update packages'
      and pg_get_expr(polqual, polrelid) like '%current_agency_id%' and pg_get_expr(polwithcheck, polrelid) like '%current_agency_id%'),
  1, 'The update policy checks the agency both before and after the change');

select * from finish();
rollback;
