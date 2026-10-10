begin;

-- TASK-043 Phase 3 (PKG-17): exporting the catalogue is audited and limited. Fixtures: one agency with an ADMIN, a FINANCE user, a MARKETING user, and a
-- custom FINANCE-tier role with exportCatalogue switched off; a second agency with an ADMIN.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.agencies (id, name, slug, status) values
  ('c0000000-0000-4000-8000-0000000000a1', 'Pkg Export Agency A', 'pkg-export-a', 'ACTIVE'),
  ('c0000000-0000-4000-8000-0000000000b2', 'Pkg Export Agency B', 'pkg-export-b', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('c1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin@pkgexp.test', '', now(), '{}', '{}', now(), now()),
  ('c2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'fin@pkgexp.test', '', now(), '{}', '{}', now(), now()),
  ('c3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'mkt@pkgexp.test', '', now(), '{}', '{}', now(), now()),
  ('c4000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'noexp@pkgexp.test', '', now(), '{}', '{}', now(), now()),
  ('c5000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'adminb@pkgexp.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_roles (id, agency_id, name, base_role, is_system) values
  ('cc000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-0000000000a1', 'Pkg Export Finance Without Export', 'FINANCE', false);
insert into public.role_permissions (role_id, module, capabilities) values
  ('cc000000-0000-4000-8000-0000000000b1', 'packages', '{"exportCatalogue": false}');

insert into public.staff_profiles (id, agency_id, full_name, email, role, status, role_id) values
  ('c1000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin@pkgexp.test', 'ADMIN', 'ACTIVE', null),
  ('c2000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Finance A', 'fin@pkgexp.test', 'FINANCE', 'ACTIVE', null),
  ('c3000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Marketing A', 'mkt@pkgexp.test', 'MARKETING', 'ACTIVE', null),
  ('c4000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'No Export', 'noexp@pkgexp.test', 'FINANCE', 'ACTIVE', 'cc000000-0000-4000-8000-0000000000b1'),
  ('c5000000-0000-4000-8000-0000000000b2', 'c0000000-0000-4000-8000-0000000000b2', 'Admin B', 'adminb@pkgexp.test', 'ADMIN', 'ACTIVE', null);

-- Who may export ------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.authorise_package_export('csv', 5, '{}')$$, '42501', 'Your role cannot export packages.', 'MARKETING cannot export');

set local "request.jwt.claims" = '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.authorise_package_export('csv', 5, '{}')$$, '42501', 'Your role cannot export packages.',
  'A role with exportCatalogue switched off cannot export, even though its base tier could');

-- The rules ----------------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.authorise_package_export('pdf', 5, '{}')$$, '22023', 'The export format is not supported.', 'Only csv and xlsx are accepted');
select throws_ok($$select public.authorise_package_export('csv', 0, '{}')$$, '22023', 'There is nothing to export.', 'An empty export is refused');
select is((select count(*)::int from public.package_export_logs), 0, 'Refusals leave no audit row');

-- Exporting ----------------------------------------------------------------------------------------------------------------------------------------------
select is((public.authorise_package_export('csv', 7, '{"view":"All Packages"}')->>'remaining')::int, 9, 'FINANCE can export and has 9 left');
reset role;
select is((select row_count from public.package_export_logs where user_name = 'Finance A'), 7, 'The export was recorded with its row count');
select is((select filters ->> 'view' from public.package_export_logs where user_name = 'Finance A'), 'All Packages', 'and the filters used');
select is((select agency_id from public.package_export_logs where user_name = 'Finance A'), 'c0000000-0000-4000-8000-0000000000a1'::uuid, 'in the caller''s own agency');

-- The hourly limit -----------------------------------------------------------------------------------------------------------------------------------------
insert into public.package_export_logs (agency_id, user_id, user_name, format, row_count)
select 'c0000000-0000-4000-8000-0000000000a1', 'c2000000-0000-4000-8000-0000000000a1', 'Finance A', 'csv', 1 from generate_series(1, 9);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_matching($$select public.authorise_package_export('csv', 3, '{}')$$, 'You have reached the limit of 10 exports an hour\. Try again in \d+ minute\(s\)\.',
  'The 11th export in an hour is refused');
set local "request.jwt.claims" = '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.authorise_package_export('xlsx', 3, '{}')$$, 'The limit is per person: the ADMIN can still export');

-- Who can read the log -----------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.package_export_logs) >= 11, true, 'The ADMIN reads the whole agency''s log');
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.package_export_logs), 0, 'FINANCE reads none of it');

reset role;
select * from finish();
rollback;
