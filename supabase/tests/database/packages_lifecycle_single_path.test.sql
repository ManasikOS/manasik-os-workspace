begin;

-- TASK-043 Phase 1 (PKG-01, PKG-05): a package's lifecycle columns change only through the lifecycle functions, a publish is one transaction that logs and
-- versions itself, and nobody can write a version's content. Fixtures: two agencies, an ADMIN and a CEO in agency A, an ADMIN in agency B.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(28);

insert into public.agencies (id, name, slug, status) values
  ('50000000-0000-4000-8000-0000000000a1', 'Pkg Single Path A', 'pkg-single-path-a', 'ACTIVE'),
  ('60000000-0000-4000-8000-0000000000b2', 'Pkg Single Path B', 'pkg-single-path-b', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('51000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@pkgsingle.test', '', now(), '{}', '{}', now(), now()),
  ('52000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ceo-a@pkgsingle.test', '', now(), '{}', '{}', now(), now()),
  ('61000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'admin-b@pkgsingle.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('51000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@pkgsingle.test', 'ADMIN', 'ACTIVE'),
  ('52000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-0000000000a1', 'CEO A', 'ceo-a@pkgsingle.test', 'CEO', 'ACTIVE'),
  ('61000000-0000-4000-8000-0000000000b2', '60000000-0000-4000-8000-0000000000b2', 'Admin B', 'admin-b@pkgsingle.test', 'ADMIN', 'ACTIVE');

-- A Draft owned by admin A (created by the test owner, so the guard does not apply to the fixture itself).
insert into public.packages (id, agency_id, owner_id, title)
values ('5f000000-0000-4000-8000-0000000000a1', '50000000-0000-4000-8000-0000000000a1', '51000000-0000-4000-8000-0000000000a1', 'Fixture draft');

-- ADMIN of agency A, acting through the API ----------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"51000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$insert into public.packages (id, owner_id, title, status) values ('5f000000-0000-4000-8000-0000000000a2', '51000000-0000-4000-8000-0000000000a1', 'Straight to live', 'Open for Sale')$$,
  '42501', 'A package is created as a Draft. Publish it through the publish action.',
  'An ADMIN cannot insert a package that is already Open for Sale');
select lives_ok(
  $$insert into public.packages (id, owner_id, title, status) values ('5f000000-0000-4000-8000-0000000000a3', '51000000-0000-4000-8000-0000000000a1', 'A plain draft', 'Draft')$$,
  'An ADMIN can still insert a Draft');
select throws_ok(
  $$update public.packages set status = 'Open for Sale' where id = '5f000000-0000-4000-8000-0000000000a1'$$,
  '42501', 'A package''s status can only change through the publish, close sales, reopen, archive and restore actions.',
  'An ADMIN cannot set status directly');
select throws_ok(
  $$update public.packages set published_at = now() where id = '5f000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'An ADMIN cannot stamp published_at directly');
select throws_ok(
  $$update public.packages set archived_at = now(), status = 'Archived' where id = '5f000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'An ADMIN cannot archive a package directly');
select throws_ok(
  $$update public.packages set published_version_id = gen_random_uuid() where id = '5f000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'An ADMIN cannot point a package at a version directly');
select lives_ok(
  $$update public.packages set title = 'Renamed draft', featured = true where id = '5f000000-0000-4000-8000-0000000000a1'$$,
  'An ADMIN can still change ordinary columns directly (title, featured)');

-- publish_package_with_content: refusals -----------------------------------------------------------------------------------------------------
select throws_ok(
  $$select public.publish_package_with_content(null, '{"title":"X","status":"Archived"}'::jsonb)$$,
  '22023', 'The package content has fields that cannot be published.', 'Content naming status is refused');
select throws_ok(
  $$select public.publish_package_with_content(null, '{"title":"X","featured":true}'::jsonb)$$,
  '22023', 'The package content has fields that cannot be published.', 'Content naming featured is refused');
select throws_ok(
  $$select public.publish_package_with_content(null, '{"owner_id":"52000000-0000-4000-8000-0000000000a1"}'::jsonb)$$,
  '22023', 'The package content has fields that cannot be published.', 'Content naming owner_id is refused');
select throws_ok(
  $$select public.publish_package_with_content(null, '[]'::jsonb)$$,
  '22023', 'The package content is missing.', 'Content that is not an object is refused');
select throws_ok(
  $$select public.publish_package_with_content('5f000000-0000-4000-8000-0000000000a1', '{"title":"Stale"}'::jsonb, '2000-01-01T00:00:00Z')$$,
  '40001', 'This package changed elsewhere. Reload and try again.', 'A stale expected updated_at is refused');
select is((select count(*)::int from public.packages where title = 'Stale'), 0, 'A refused publish wrote nothing');

-- publish_package_with_content: a new package, end to end -----------------------------------------------------------------------------------
select lives_ok(
  $$select set_config('test.pub_id', (public.publish_package_with_content(null, '{"title":"Brand new","internal_code":"PS-NEW-1","days":5,"nights":4}'::jsonb)).id::text, true)$$,
  'An ADMIN can create and publish a package in one call');
select is((select status from public.packages where id = current_setting('test.pub_id')::uuid), 'Open for Sale', 'The new package is Open for Sale');
select is((select internal_code from public.packages where id = current_setting('test.pub_id')::uuid), 'PS-NEW-1', 'The allow-listed content was written');
select is((select count(*)::int from public.package_activity_logs where package_id = current_setting('test.pub_id')::uuid and action_type = 'PUBLISHED'), 1,
  'The publish wrote its activity-log entry');
select is((select count(*)::int from public.package_versions where package_id = current_setting('test.pub_id')::uuid), 1,
  'The publish recorded exactly one version');
select is((select snapshot->>'title' from public.package_versions where package_id = current_setting('test.pub_id')::uuid), 'Brand new',
  'The version was built from the package row itself');
select is((select published_version_id is not null from public.packages where id = current_setting('test.pub_id')::uuid), true,
  'The package points at its version');

-- Publishing something that is not publishable ---------------------------------------------------------------------------------------------
select throws_ok(
  $$select public.publish_package_with_content(current_setting('test.pub_id')::uuid, '{"title":"Again"}'::jsonb)$$,
  '22023', null, 'An Open for Sale package cannot be published again from here');

-- A Sales Closed package cannot be rewritten through publish: it is reopened with reopen_package, and content changes go through the review ------------
select lives_ok($$select public.close_package_sales(current_setting('test.pub_id')::uuid)$$, 'An ADMIN can close sales');
select throws_ok(
  $$select public.publish_package_with_content(current_setting('test.pub_id')::uuid, '{"title":"Brand new, edited"}'::jsonb)$$,
  '22023', 'This package is Sales Closed and cannot be published from here.',
  'A Sales Closed package cannot be published with new content');
select lives_ok($$select public.reopen_package(current_setting('test.pub_id')::uuid)$$, 'It is reopened with reopen_package instead');
select is((select count(*)::int from public.package_versions where package_id = current_setting('test.pub_id')::uuid), 2, 'Reopening recorded a second version');

-- Other callers ------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"52000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.publish_package_with_content(null, '{"title":"CEO attempt"}'::jsonb)$$,
  '42501', 'Your role cannot publish packages.', 'A CEO cannot publish');

set local "request.jwt.claims" = '{"sub":"61000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$select public.publish_package_with_content('5f000000-0000-4000-8000-0000000000a1', '{"title":"Cross tenant"}'::jsonb)$$,
  'P0002', 'That package no longer exists.', 'An admin of another agency cannot publish this agency''s package');

-- The service role / migrations are not held to the guard ----------------------------------------------------------------------------------
reset role;
select lives_ok(
  $$update public.packages set status = 'Sales Closed' where id = '5f000000-0000-4000-8000-0000000000a1'$$,
  'The database owner (migrations, service role) can still change status directly');

select * from finish();
rollback;
