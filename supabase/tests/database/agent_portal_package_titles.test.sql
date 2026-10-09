begin;

-- TASK-043 Phase 1, step 5 (PKG-06): a sales agent (external, portal login) cannot read package rows. They get the id and title of their own allocated
-- packages from agent_allocated_package_titles() and nothing else. Staff are unaffected.
-- Fixtures: one agency; staff ADMIN; two sales agents with portal logins; a live package allocated to agent 1 (with an internal note in its itinerary), a
-- draft allocated to agent 2, and an unallocated live package.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.agencies (id, name, slug, status) values
  ('a0000000-0000-4000-8000-0000000000a1', 'Agent Portal Agency', 'agent-portal-pkg', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin@agentpkg.test', '', now(), '{}', '{}', now(), now()),
  ('a2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'agent1@agentpkg.test', '', now(), '{}', '{}', now(), now()),
  ('a3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'agent2@agentpkg.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('a1000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'Admin', 'admin@agentpkg.test', 'ADMIN', 'ACTIVE');

insert into public.sales_agents (id, agency_id, name, created_by_name, portal_user_id) values
  ('a4000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'Agent One', 'Admin', 'a2000000-0000-4000-8000-0000000000a1'),
  ('a5000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'Agent Two', 'Admin', 'a3000000-0000-4000-8000-0000000000a1');

insert into public.packages (id, agency_id, owner_id, title, status, itinerary) values
  ('a6000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'Live for agent one', 'Open for Sale',
   '[{"id":"d1","dayNumber":1,"internalNotes":"supplier margin 12%"}]'::jsonb),
  ('a7000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'Draft for agent two', 'Draft', '[]'::jsonb),
  ('a8000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', 'Not allocated', 'Open for Sale', '[]'::jsonb);

insert into public.agent_package_allocations (agency_id, sales_agent_id, package_id, allocated_seats, created_by_name) values
  ('a0000000-0000-4000-8000-0000000000a1', 'a4000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-0000000000a1', 10, 'Admin'),
  ('a0000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-0000000000b2', 5, 'Admin');

-- Agent one ---------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.packages), 0, 'An agent cannot read any package row, not even an allocated one');
select is((select count(*)::int from public.agent_allocated_package_titles()), 1, 'The agent gets one row from the titles function: their own allocation');
select is((select title from public.agent_allocated_package_titles()), 'Live for agent one', 'It carries the title');
select is(pg_get_function_result('public.agent_allocated_package_titles()'::regprocedure), 'TABLE(package_id uuid, title text)', 'The function returns only the package id and the title');
select is(has_function_privilege('anon', 'public.agent_allocated_package_titles()', 'execute'), false, 'An anonymous caller cannot execute the function');
select is((select count(*)::int from public.agent_package_allocations), 1, 'The agent can still read their own allocation');

-- Agent two ---------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"a3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select title from public.agent_allocated_package_titles()), 'Draft for agent two', 'Another agent sees only their own allocated package''s title');

-- Staff -------------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.packages), 3, 'Staff still read every package in their agency');
select is((select count(*)::int from public.agent_allocated_package_titles()), 0, 'A staff member who is not an agent gets nothing from the agent function');

reset role;
select * from finish();
rollback;
