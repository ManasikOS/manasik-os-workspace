begin;

-- TASK-032 S4 / audit item D3: the six package wrappers refuse on their own. A caller with no staff profile has a NULL role, and the old guard
-- `current_staff_role() not in (...)` was NULL for them, so it let them through to the internal step. These tests use that caller, the admin of
-- a SUSPENDED agency (a role but no active agency), a role that is not allowed, and an admin of another agency, and they confirm a legitimate
-- admin still gets through the whole lifecycle. One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.agencies (id, name, slug, status) values
  ('10000000-0000-4000-8000-0000000000a1', 'Pkg Guard Agency A', 'pkg-guard-agency-a', 'ACTIVE'),
  ('20000000-0000-4000-8000-0000000000b2', 'Pkg Guard Agency B', 'pkg-guard-agency-b', 'ACTIVE'),
  ('30000000-0000-4000-8000-0000000000d4', 'Pkg Guard Suspended Agency', 'pkg-guard-suspended', 'SUSPENDED');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('11000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@pkgguard.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ceo-a@pkgguard.test', '', now(), '{}', '{}', now(), now()),
  ('21000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'admin-b@pkgguard.test', '', now(), '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'nobody@pkgguard.test', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'admin-suspended@pkgguard.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('11000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@pkgguard.test', 'ADMIN', 'ACTIVE'),
  ('12000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'CEO A', 'ceo-a@pkgguard.test', 'CEO', 'ACTIVE'),
  ('21000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'Admin B', 'admin-b@pkgguard.test', 'ADMIN', 'ACTIVE'),
  ('41000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000d4', 'Admin of a suspended agency', 'admin-suspended@pkgguard.test', 'ADMIN', 'ACTIVE');

insert into public.packages (id, agency_id, owner_id) values ('1f000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1');

-- A signed-in user who belongs to no agency: NULL role, NULL agency -----------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select throws_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot archive packages.', 'A user with no agency is refused by archive_package itself');
select throws_ok($$select public.close_package_sales('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot close sales on packages.', 'A user with no agency is refused by close_package_sales itself');
select throws_ok($$select public.publish_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot publish packages.', 'A user with no agency is refused by publish_package itself');
select throws_ok($$select public.reopen_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot reopen packages for sale.', 'A user with no agency is refused by reopen_package itself');
select throws_ok($$select public.restore_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot restore packages.', 'A user with no agency is refused by restore_package itself');
select throws_ok($$select public.package_versions_create('1f000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$, '42501', 'Your role cannot publish packages.', 'A user with no agency is refused by package_versions_create itself');

-- The admin of a SUSPENDED agency: a role, but no active agency ------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"41000000-0000-4000-8000-0000000000d4","role":"authenticated"}';
select throws_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, '28000', 'Your session has no active agency.', 'The admin of a suspended agency is refused by archive_package for having no active agency');
select throws_ok($$select public.publish_package('1f000000-0000-4000-8000-0000000000a1')$$, '28000', 'Your session has no active agency.', 'The admin of a suspended agency is refused by publish_package for having no active agency');
select throws_ok($$select public.package_versions_create('1f000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$, '28000', 'Your session has no active agency.', 'The admin of a suspended agency is refused by package_versions_create for having no active agency');

-- A role that is not allowed ----------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot archive packages.', 'A CEO is still refused by archive_package');
select throws_ok($$select public.publish_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot publish packages.', 'A CEO is still refused by publish_package');

-- A legitimate admin still gets through the whole lifecycle -----------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.publish_package('1f000000-0000-4000-8000-0000000000a1')$$, 'An admin can still publish a package');
select lives_ok($$select public.close_package_sales('1f000000-0000-4000-8000-0000000000a1')$$, 'An admin can still close sales');
select lives_ok($$select public.reopen_package('1f000000-0000-4000-8000-0000000000a1')$$, 'An admin can still reopen a package for sale');
select lives_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, 'An admin can still archive a package');
select lives_ok($$select public.restore_package('1f000000-0000-4000-8000-0000000000a1')$$, 'An admin can still restore a package');
select lives_ok($$select public.package_versions_create('1f000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$, 'An admin can still record a published version');

-- An admin of ANOTHER agency cannot touch this agency's package -----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"21000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, 'P0002', 'That package no longer exists.', 'An agency B admin cannot archive agency A''s package');
select throws_ok($$select public.publish_package('1f000000-0000-4000-8000-0000000000a1')$$, 'P0002', 'That package no longer exists.', 'An agency B admin cannot publish agency A''s package');
select throws_ok($$select public.package_versions_create('1f000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$, 'P0002', 'That package no longer exists.', 'An agency B admin cannot record a version for agency A''s package');

reset role;
select * from finish();
rollback;
