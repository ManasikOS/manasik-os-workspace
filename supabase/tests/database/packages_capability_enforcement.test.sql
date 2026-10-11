begin;

-- TASK-043 Phase 1 (PKG-04): the database honours the package capabilities saved for a custom role in Roles & Permissions. Reproduces Phase 0 test T5 (a role with
-- deletePackage switched off could still delete directly) and checks the rules for a missing key and for a value that is not boolean true.
-- Fixtures: one agency; ADMIN `a` with no custom role (base-tier defaults); a custom ADMIN-tier role `b` {deletePackage:false, editPackage:false, toggleFeatured:true,
-- publishPackage:"yes"}; a custom OPERATIONS-tier role `c` {createPackage:false, publishPackage:true}.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into public.agencies (id, name, slug, status) values
  ('80000000-0000-4000-8000-0000000000a1', 'Pkg Capability Agency', 'pkg-capability', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('81000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'a@pkgcap.test', '', now(), '{}', '{}', now(), now()),
  ('82000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'b@pkgcap.test', '', now(), '{}', '{}', now(), now()),
  ('83000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'c@pkgcap.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_roles (id, agency_id, name, base_role, is_system) values
  ('84000000-0000-4000-8000-0000000000b1', '80000000-0000-4000-8000-0000000000a1', 'Pkg Cap Admin Without Edit', 'ADMIN', false),
  ('85000000-0000-4000-8000-0000000000c1', '80000000-0000-4000-8000-0000000000a1', 'Pkg Cap Ops Without Create', 'OPERATIONS', false);

insert into public.role_permissions (role_id, module, capabilities) values
  ('84000000-0000-4000-8000-0000000000b1', 'packages', '{"deletePackage": false, "editPackage": false, "toggleFeatured": true, "publishPackage": "yes"}'),
  ('85000000-0000-4000-8000-0000000000c1', 'packages', '{"createPackage": false, "publishPackage": true}');

insert into public.staff_profiles (id, agency_id, full_name, email, role, status, role_id) values
  ('81000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-0000000000a1', 'Admin A', 'a@pkgcap.test', 'ADMIN', 'ACTIVE', null),
  ('82000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-0000000000a1', 'Admin B', 'b@pkgcap.test', 'ADMIN', 'ACTIVE', '84000000-0000-4000-8000-0000000000b1'),
  ('83000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-0000000000a1', 'Ops C', 'c@pkgcap.test', 'OPERATIONS', 'ACTIVE', '85000000-0000-4000-8000-0000000000c1');

insert into public.packages (id, agency_id, owner_id, title, status) values
  ('8a000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-0000000000a1', '81000000-0000-4000-8000-0000000000a1', 'Draft for features', 'Draft'),
  ('8b000000-0000-4000-8000-0000000000b2', '80000000-0000-4000-8000-0000000000a1', '81000000-0000-4000-8000-0000000000a1', 'Draft to delete (a)', 'Draft'),
  ('8c000000-0000-4000-8000-0000000000c3', '80000000-0000-4000-8000-0000000000a1', '81000000-0000-4000-8000-0000000000a1', 'Draft to delete (b)', 'Draft');

create function public.zz_pkgcap_rows_changed(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- a: no custom role, base-tier defaults ---------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"81000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(public.has_package_capability('deletePackage'), true, 'An ADMIN with no custom role holds deletePackage by default');
select is(public.has_package_capability('madeUpCapability'), false, 'An unknown capability is never granted');
select is(public.zz_pkgcap_rows_changed($$delete from public.packages where id = '8b000000-0000-4000-8000-0000000000b2'$$), 0, 'Nobody deletes a package by writing to the table any more, not even an ADMIN: delete_package() is the only way (20270120090600)');

-- b: custom ADMIN-tier role with delete and edit switched off, and a non-boolean publish value -------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"82000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(public.has_package_capability('deletePackage'), false, 'deletePackage is false when the role says false');
select is(public.has_package_capability('editPackage'), false, 'editPackage is false when the role says false');
select is(public.has_package_capability('toggleFeatured'), true, 'toggleFeatured is true when the role says true');
select is(public.has_package_capability('publishPackage'), false, 'A value that is not boolean true ("yes") does not grant the capability');
select is(public.has_package_capability('createPackage'), true, 'A key the role never saved falls back to the ADMIN tier default');
select is(public.zz_pkgcap_rows_changed($$delete from public.packages where id = '8c000000-0000-4000-8000-0000000000c3'$$), 0,
  'Phase 0 test T5: that role can no longer delete a package directly');
select throws_ok(
  $$update public.packages set title = 'Retitled' where id = '8a000000-0000-4000-8000-0000000000a1'$$,
  '42501', null, 'Without editPackage that role cannot change a package''s other columns');
select lives_ok(
  $$update public.packages set featured = true where id = '8a000000-0000-4000-8000-0000000000a1'$$,
  'With toggleFeatured that role can still change the featured flag');
select throws_ok(
  $$select public.publish_package('8a000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'Your role cannot publish packages.', 'Without a true publishPackage that role cannot publish through the function either');

-- c: custom OPERATIONS-tier role without createPackage -----------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"83000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$select public.publish_package_with_content(null, '{"title":"New one"}'::jsonb)$$,
  '42501', 'Your role cannot create packages.', 'Without createPackage that role cannot create a package through publish');
select lives_ok(
  $$select public.publish_package('8a000000-0000-4000-8000-0000000000a1')$$,
  'With publishPackage true that role can publish an existing draft');

reset role;
select is((select status from public.packages where id = '8a000000-0000-4000-8000-0000000000a1'), 'Open for Sale', 'The draft is now Open for Sale');

select * from finish();
rollback;
