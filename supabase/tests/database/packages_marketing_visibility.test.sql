begin;

-- TASK-043 Phase 1 (PKG-03, PKG-12): MARKETING reads only Open for Sale packages and its own drafts, the version and activity history follow the package,
-- the list function does not trust its arguments, and group revenue figures are visible to ADMIN, CEO and FINANCE only.
-- Fixtures: one agency; ADMIN, MARKETING, CEO and FINANCE users; a live package, an admin-owned draft, a MARKETING-owned draft; one version and one
-- activity-log row for the live package and for the admin draft; one departure group with one booking.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.agencies (id, name, slug, status) values
  ('70000000-0000-4000-8000-0000000000a1', 'Pkg Visibility Agency', 'pkg-visibility', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('71000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin@pkgvis.test', '', now(), '{}', '{}', now(), now()),
  ('72000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing@pkgvis.test', '', now(), '{}', '{}', now(), now()),
  ('73000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ceo@pkgvis.test', '', now(), '{}', '{}', now(), now()),
  ('74000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'finance@pkgvis.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('71000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'Admin', 'admin@pkgvis.test', 'ADMIN', 'ACTIVE'),
  ('72000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'Marketing', 'marketing@pkgvis.test', 'MARKETING', 'ACTIVE'),
  ('73000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'CEO', 'ceo@pkgvis.test', 'CEO', 'ACTIVE'),
  ('74000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'Finance', 'finance@pkgvis.test', 'FINANCE', 'ACTIVE');

insert into public.packages (id, agency_id, owner_id, title, status) values
  ('7a000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', '71000000-0000-4000-8000-0000000000a1', 'Live package', 'Open for Sale'),
  ('7b000000-0000-4000-8000-0000000000b2', '70000000-0000-4000-8000-0000000000a1', '71000000-0000-4000-8000-0000000000a1', 'Admin draft', 'Draft'),
  ('7c000000-0000-4000-8000-0000000000c3', '70000000-0000-4000-8000-0000000000a1', '72000000-0000-4000-8000-0000000000a1', 'Marketing draft', 'Draft');

insert into public.package_versions (package_id, agency_id, version_number, snapshot) values
  ('7a000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 1, '{}'),
  ('7b000000-0000-4000-8000-0000000000b2', '70000000-0000-4000-8000-0000000000a1', 1, '{}');

insert into public.package_activity_logs (package_id, agency_id, action_type, after_status) values
  ('7a000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'PUBLISHED', 'Open for Sale'),
  ('7b000000-0000-4000-8000-0000000000b2', '70000000-0000-4000-8000-0000000000a1', 'PUBLISHED', 'Open for Sale');

insert into public.departure_groups (id, agency_id, group_name, group_code, departure_date, return_date, capacity, package_template_id)
values ('7d000000-0000-4000-8000-0000000000d4', '70000000-0000-4000-8000-0000000000a1', 'Visibility Group', 'PKG-VIS-1', current_date + 60, current_date + 70, 10, '7a000000-0000-4000-8000-0000000000a1');
insert into public.departure_group_bookings (id, agency_id, departure_group_id, booking_reference)
values ('7e000000-0000-4000-8000-0000000000e5', '70000000-0000-4000-8000-0000000000a1', '7d000000-0000-4000-8000-0000000000d4', 'PKG-VIS-BK');

-- MARKETING --------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"72000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.packages), 2, 'MARKETING reads exactly two packages: the live one and its own draft');
select is((select count(*)::int from public.packages where id = '7b000000-0000-4000-8000-0000000000b2'), 0, 'MARKETING cannot read another user''s draft');
select is((select count(*)::int from public.packages where id = '7c000000-0000-4000-8000-0000000000c3'), 1, 'MARKETING can read its own draft');
select is((select count(*)::int from public.list_packages_with_usage(null, null)), 2, 'The list function with no arguments still returns only what MARKETING may read');
select is((select count(*)::int from public.package_versions), 1, 'MARKETING sees the live package''s version but not the hidden draft''s');
select is((select count(*)::int from public.package_activity_logs), 1, 'MARKETING sees the live package''s activity but not the hidden draft''s');
select is((select count(*)::int from public.departure_group_payment_summaries), 0, 'MARKETING gets no group revenue rows');

-- ADMIN ------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"71000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.packages), 3, 'ADMIN still reads all three packages');
select is((select count(*)::int from public.list_packages_with_usage('MARKETING', '72000000-0000-4000-8000-0000000000a1')), 3, 'Passing p_role = MARKETING does not narrow an ADMIN''s list: the arguments are ignored');
select is((select count(*)::int from public.package_versions), 2, 'ADMIN still reads both versions');
select is((select count(*)::int from public.package_activity_logs), 2, 'ADMIN still reads both activity entries');
select is((select count(*)::int from public.departure_group_payment_summaries), 1, 'ADMIN still gets the group revenue row');

-- CEO and FINANCE --------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"73000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.packages), 3, 'CEO still reads all three packages');
select is((select count(*)::int from public.departure_group_payment_summaries), 1, 'CEO still gets the group revenue row');

set local "request.jwt.claims" = '{"sub":"74000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.packages), 3, 'FINANCE still reads all three packages');
select is((select count(*)::int from public.departure_group_payment_summaries), 1, 'FINANCE still gets the group revenue row');

-- anon -------------------------------------------------------------------------------------------------------------------------------------
reset role;
select is(has_function_privilege('anon', 'public.list_packages_with_usage(text, uuid)', 'execute'), false, 'An anonymous caller cannot execute the list function');

select * from finish();
rollback;
