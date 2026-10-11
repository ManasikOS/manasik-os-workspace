begin;

-- TASK-043 Phase 3 (PKG-13): per-person hourly limits on busy package actions, and a cap on an agency's drafts. Fixtures: one agency with two staff.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.agencies (id, name, slug, status) values
  ('d0000000-0000-4000-8000-0000000000a1', 'Pkg Limits Agency', 'pkg-limits-a', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('d1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'one@pkglim.test', '', now(), '{}', '{}', now(), now()),
  ('d2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'two@pkglim.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status, role_id) values
  ('d1000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'One', 'one@pkglim.test', 'ADMIN', 'ACTIVE', null),
  ('d2000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'Two', 'two@pkglim.test', 'ADMIN', 'ACTIVE', null);

-- The rate limit -------------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((public.consume_package_rate_limit('duplicate')->>'remaining')::int, 19, 'The first copy leaves 19 of 20');
select throws_ok($$select public.consume_package_rate_limit('nonsense')$$, '22023', 'That action is not recognised.', 'An unknown action is refused');
select throws_ok($$select public.consume_package_rate_limit('')$$, '22023', 'That action is not recognised.', 'An empty action is refused');

reset role;
insert into public.package_rate_events (agency_id, user_id, action)
select 'd0000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000a1', 'duplicate' from generate_series(1, 19);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_matching($$select public.consume_package_rate_limit('duplicate')$$,
  'You can only copy a package 20 times an hour and you have reached that limit\. Try again in \d+ minute\(s\)\.', 'The 21st copy in an hour is refused');
select lives_ok($$select public.consume_package_rate_limit('publish')$$, 'Another action has its own count');
set local "request.jwt.claims" = '{"sub":"d2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.consume_package_rate_limit('duplicate')$$, 'The limit is per person');

-- Clients cannot touch the counters ---------------------------------------------------------------------------------------------------------------------
select throws_ok($$select count(*) from public.package_rate_events$$, '42501', null, 'A signed-in user cannot read the counters');

-- The draft cap ------------------------------------------------------------------------------------------------------------------------------------------------
reset role;
insert into public.packages (agency_id, owner_id, title, internal_code, status)
select 'd0000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000a1', 'Draft ' || n, 'LIM-' || n, 'Draft' from generate_series(1, 500) as n;
select throws_ok($$insert into public.packages (agency_id, owner_id, title, internal_code, status)
  values ('d0000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000a1', 'One too many', 'LIM-501', 'Draft')$$,
  'P0001', 'Your agency already holds 500 draft packages. Publish or delete some before creating more.', 'The 501st draft is refused');
select is((select count(*)::int from public.packages where agency_id = 'd0000000-0000-4000-8000-0000000000a1'), 500, 'and nothing was inserted');

select * from finish();
rollback;
