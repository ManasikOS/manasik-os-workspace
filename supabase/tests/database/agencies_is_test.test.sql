begin;

-- TASK-032 S1: agencies.is_test is a flag only the service role can set. A platform admin (the only signed-in user who can write agencies at
-- all) must not be able to create a test agency or change the flag on an existing one. Everything runs in one transaction and is rolled back.
-- Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_column('public', 'agencies', 'is_test', 'agencies.is_test exists');
select col_type_is('public', 'agencies', 'is_test', 'boolean', 'agencies.is_test is a boolean');
select col_not_null('public', 'agencies', 'is_test', 'agencies.is_test is never null');
select col_default_is('public', 'agencies', 'is_test', 'false', 'agencies.is_test defaults to false');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('51000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', 'operator@istest.test', '', now(), '{}', '{}', now(), now());
insert into public.platform_admins (user_id) values ('51000000-0000-4000-8000-0000000000e1');

insert into public.agencies (id, name, slug) values ('50000000-0000-4000-8000-0000000000a1', 'Is Test Agency A', 'is-test-agency-a');
select is((select is_test from public.agencies where id = '50000000-0000-4000-8000-0000000000a1'), false, 'An agency created without the flag is a real agency');

-- A platform admin signed in through the app ---------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"51000000-0000-4000-8000-0000000000e1","role":"authenticated"}';

select throws_ok($$insert into public.agencies (id, name, slug, is_test) values ('50000000-0000-4000-8000-0000000000b2', 'Sneaky Test Agency', 'sneaky-test-agency', true)$$, '42501', null, 'A signed-in platform admin cannot create a test agency');
select lives_ok($$insert into public.agencies (id, name, slug) values ('50000000-0000-4000-8000-0000000000c3', 'Operator Made Agency', 'operator-made-agency')$$, 'A signed-in platform admin can still create an ordinary agency');
select throws_ok($$update public.agencies set is_test = true where id = '50000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'A signed-in platform admin cannot turn an agency into a test agency');
select lives_ok($$update public.agencies set name = 'Is Test Agency A renamed' where id = '50000000-0000-4000-8000-0000000000a1'$$, 'A signed-in platform admin can still edit other agency fields');
select is((select is_test from public.agencies where id = '50000000-0000-4000-8000-0000000000a1'), false, 'The flag is unchanged after those attempts');

-- A migration or SQL session (the owner role) --------------------------------------------------------------------------------------------
reset role;
select lives_ok($$update public.agencies set is_test = true where id = '50000000-0000-4000-8000-0000000000a1'$$, 'A SQL session can mark an agency as a test agency');
select is((select is_test from public.agencies where id = '50000000-0000-4000-8000-0000000000a1'), true, 'The flag is now set');

-- The service role (what the application and the go-live gate use) -----------------------------------------------------------------------
set local role service_role;
select lives_ok($$update public.agencies set is_test = false where id = '50000000-0000-4000-8000-0000000000a1'$$, 'The service role can change the flag back');
reset role;
select is((select is_test from public.agencies where id = '50000000-0000-4000-8000-0000000000a1'), false, 'The flag is cleared');

select * from finish();
rollback;
