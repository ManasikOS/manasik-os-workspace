begin;

-- TASK-043 Phase 3 (PKG-10): deleting a package is controlled and recorded. Fixtures: one agency (A) with an ADMIN, a custom ADMIN-tier role without
-- deletePackage, and an OPERATIONS user; a second agency (B) with an ADMIN; in A a Draft with a code, an Archived package with an activity-log row, a
-- Draft with no code, a Draft used by a departure group, and a live package.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.agencies (id, name, slug, status) values
  ('b0000000-0000-4000-8000-0000000000a1', 'Pkg Delete Agency A', 'pkg-delete-a', 'ACTIVE'),
  ('b0000000-0000-4000-8000-0000000000b2', 'Pkg Delete Agency B', 'pkg-delete-b', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('b1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin@pkgdel.test', '', now(), '{}', '{}', now(), now()),
  ('b2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'nodelete@pkgdel.test', '', now(), '{}', '{}', now(), now()),
  ('b3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops@pkgdel.test', '', now(), '{}', '{}', now(), now()),
  ('b4000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'adminb@pkgdel.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_roles (id, agency_id, name, base_role, is_system) values
  ('bb000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000a1', 'Pkg Delete Admin Without Delete', 'ADMIN', false);
insert into public.role_permissions (role_id, module, capabilities) values
  ('bb000000-0000-4000-8000-0000000000b1', 'packages', '{"deletePackage": false}');

insert into public.staff_profiles (id, agency_id, full_name, email, role, status, role_id) values
  ('b1000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin@pkgdel.test', 'ADMIN', 'ACTIVE', null),
  ('b2000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'Admin No Delete', 'nodelete@pkgdel.test', 'ADMIN', 'ACTIVE', 'bb000000-0000-4000-8000-0000000000b1'),
  ('b3000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'Ops', 'ops@pkgdel.test', 'OPERATIONS', 'ACTIVE', null),
  ('b4000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-0000000000b2', 'Admin B', 'adminb@pkgdel.test', 'ADMIN', 'ACTIVE', null);

insert into public.packages (id, agency_id, owner_id, title, internal_code, status) values
  ('b9000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1', 'Draft with code', 'PKG-DEL-1', 'Draft'),
  ('b9000000-0000-4000-8000-0000000000d2', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1', 'Draft used by a group', 'PKG-DEL-2', 'Draft'),
  ('b9000000-0000-4000-8000-0000000000d3', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1', 'Draft with no code yet', '', 'Draft'),
  ('b9000000-0000-4000-8000-0000000000e4', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1', 'Live package', 'PKG-DEL-LIVE', 'Open for Sale');
insert into public.packages (id, agency_id, owner_id, title, internal_code, status, archived_at) values
  ('b9000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1', 'Archived package', 'PKG-DEL-ARCH', 'Archived', now());

insert into public.package_activity_logs (package_id, agency_id, action_type, before_status, after_status)
values ('b9000000-0000-4000-8000-0000000000a5', 'b0000000-0000-4000-8000-0000000000a1', 'ARCHIVED', 'Open for Sale', 'Archived');

insert into public.departure_groups (id, agency_id, group_name, group_code, departure_date, return_date, capacity, package_template_id)
values ('bd000000-0000-4000-8000-0000000000d4', 'b0000000-0000-4000-8000-0000000000a1', 'Delete Test Group', 'PKG-DEL-GRP', current_date + 60, current_date + 70, 10, 'b9000000-0000-4000-8000-0000000000d2');

create function public.zz_pkgdel_rows_changed(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Who may call it ----------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', null, 'PKG-DEL-1', 'Not needed')$$,
  '42501', 'Your role cannot delete packages.', 'OPERATIONS cannot delete a package');

set local "request.jwt.claims" = '{"sub":"b2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', null, 'PKG-DEL-1', 'Not needed')$$,
  '42501', 'Your role cannot delete packages.', 'An ADMIN whose role has deletePackage switched off cannot delete a package');
select throws_ok($$select public.package_delete_impact('b9000000-0000-4000-8000-0000000000d1')$$,
  '42501', 'Your role cannot delete packages.', 'Nor can they ask what a delete would touch');

set local "request.jwt.claims" = '{"sub":"b4000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', null, 'PKG-DEL-1', 'Not mine')$$,
  'P0002', 'That package no longer exists.', 'An ADMIN of another agency cannot delete this agency''s package');

-- The rules ----------------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"b1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', null, 'PKG-DEL-1', '   ')$$,
  '22023', 'A reason is required to delete a package.', 'A reason is required');
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000e4', null, 'PKG-DEL-LIVE', 'Cleaning up')$$,
  '22023', 'This package is Open for Sale — a package must be archived before it can be deleted.', 'A package on sale cannot be deleted');
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', null, 'PKG-DEL-WRONG', 'Cleaning up')$$,
  '22023', 'The confirmation text does not match the package code.', 'The wrong confirmation text is refused');
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', '2000-01-01T00:00:00Z', 'PKG-DEL-1', 'Cleaning up')$$,
  '40001', 'This package changed elsewhere. Reload and try again.', 'A stale delete is refused');
select throws_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d2', null, 'PKG-DEL-2', 'Cleaning up')$$,
  '22023', 'This package cannot be deleted — departure groups use it. Archive it instead, or move those groups to another package first.', 'A package a departure group uses cannot be deleted');
select is((public.package_delete_impact('b9000000-0000-4000-8000-0000000000d2')->>'departureGroups')::int, 1, 'The impact check counts the group that blocks it');
select is(public.zz_pkgdel_rows_changed($$delete from public.packages where id = 'b9000000-0000-4000-8000-0000000000d1'$$), 0,
  'A direct DELETE on the table removes nothing, even for an ADMIN');
select is((select count(*)::int from public.packages where id = 'b9000000-0000-4000-8000-0000000000d1'), 1, 'The package is still there after all the refusals');

-- Deleting ----------------------------------------------------------------------------------------------------------------------------------------------
select lives_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d1', null, '  pkg-del-1 ', 'Duplicate draft')$$,
  'An ADMIN can delete a Draft by typing its code (case and spaces do not matter)');
select is((select count(*)::int from public.packages where id = 'b9000000-0000-4000-8000-0000000000d1'), 0, 'The package is gone');
select is((select reason from public.package_deletions where package_id = 'b9000000-0000-4000-8000-0000000000d1'), 'Duplicate draft', 'The reason was recorded');
select is((select package ->> 'title' from public.package_deletions where package_id = 'b9000000-0000-4000-8000-0000000000d1'), 'Draft with code', 'The whole package row was kept');
select is((select deleted_by_name from public.package_deletions where package_id = 'b9000000-0000-4000-8000-0000000000d1'), 'Admin A', 'Who deleted it was recorded');

select lives_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000a5', null, 'PKG-DEL-ARCH', 'Retired')$$, 'An Archived package can be deleted');
select is((select jsonb_array_length(activity) from public.package_deletions where package_id = 'b9000000-0000-4000-8000-0000000000a5'), 1,
  'Its activity log was copied into the record before the cascade removed it');

select lives_ok($$select public.delete_package('b9000000-0000-4000-8000-0000000000d3', null, 'b9000000', 'No code was ever set')$$,
  'A package with no code is confirmed with the first 8 characters of its id');

-- Who can read the record -----------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.package_deletions), 3, 'The ADMIN reads all three records');
set local "request.jwt.claims" = '{"sub":"b3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.package_deletions), 0, 'OPERATIONS reads none');

reset role;
select * from finish();
rollback;
