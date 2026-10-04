begin;

-- TASK-032 S5: the protections the clean-rebuild proof found missing on staging, and the two places a fresh build was looser than staging. One
-- transaction, rolled back. Expect zero rows from finish() when every assertion passes. The same file passes on a database built from the
-- repository and on staging after 20270106090000_clean_rebuild_alignment.sql.

create extension if not exists pgtap with schema extensions;
select plan(12);

-- 1a. The MARKETING column scope on packages -----------------------------------------------------------------------------------------------------
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.packages'::regclass and t.tgname = 'packages_enforce_marketing_scope' and not t.tgisinternal), 'The MARKETING column-scope trigger exists on packages');
select ok(not has_function_privilege('anon', 'public.packages_enforce_marketing_column_scope()', 'execute') and not has_function_privilege('authenticated', 'public.packages_enforce_marketing_column_scope()', 'execute'), 'No client role can execute the trigger function directly');

insert into public.agencies (id, name, slug, status) values ('10000000-0000-4000-8000-0000000000a1', 'Rebuild Align Agency A', 'rebuild-align-agency-a', 'ACTIVE');
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('11000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@align.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing-a@align.test', '', now(), '{}', '{}', now(), now());
insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('11000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@align.test', 'ADMIN', 'ACTIVE'),
  ('12000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Marketing A', 'marketing-a@align.test', 'MARKETING', 'ACTIVE');
insert into public.packages (id, agency_id, owner_id) values ('1f000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1');

-- The trigger decides on the acting user's role, so it is exercised here with the user's identity and a session that skips the row policy,
-- which isolates the trigger from the policy in front of it.
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$update public.packages set title = 'changed by marketing' where id = '1f000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot change a package field other than featured');
select lives_ok($$update public.packages set featured = true where id = '1f000000-0000-4000-8000-0000000000a1'$$, 'MARKETING can still change the featured flag');
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$update public.packages set title = 'changed by admin' where id = '1f000000-0000-4000-8000-0000000000a1'$$, 'An ADMIN can still change any field');
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select throws_ok($$update public.packages set title = 'changed by a stranger' where id = '1f000000-0000-4000-8000-0000000000a1'$$, '42501', 'Your role cannot update packages.', 'A caller with no role is refused by the backstop');

-- 1b. The departure-group audit log -----------------------------------------------------------------------------------------------------------
select ok(not exists (select 1 from pg_policy p where p.polrelid = 'public.departure_group_activity_logs'::regclass and p.polname = 'staff write departure_group_activity_logs'), 'The all-commands "staff write" policy on the departure-group activity log is gone');
select is_empty($$select p.polname from pg_policy p where p.polrelid = 'public.departure_group_activity_logs'::regclass and p.polcmd::text in ('w', 'd', '*')$$, 'No policy lets a signed-in user update or delete the departure-group activity log');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.departure_group_activity_logs'::regclass and p.polcmd::text = 'r') and exists (select 1 from pg_policy p where p.polrelid = 'public.departure_group_activity_logs'::regclass and p.polcmd::text = 'a'), 'The read policy and the insert policy remain');

-- 2c. The no-argument reset function ---------------------------------------------------------------------------------------------------------
select ok(to_regprocedure('public.reset_agency_business_data()') is null, 'The no-argument reset_agency_business_data() does not exist');
select ok(to_regprocedure('public.reset_agency_business_data(uuid)') is not null and not has_function_privilege('authenticated', 'public.reset_agency_business_data(uuid)', 'execute') and has_function_privilege('service_role', 'public.reset_agency_business_data(uuid)', 'execute'), 'The agency-scoped reset exists and only the service role can run it');

-- The go-live gate's isolation findings are empty for the anonymous-callable function check -------------------------------------------------------
select is_empty($$select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')$$, 'No security-definer function in public is callable by anonymous users');

select * from finish();
rollback;
