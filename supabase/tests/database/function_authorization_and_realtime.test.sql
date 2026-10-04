begin;

-- TASK-029 P2.4, finding F3: authorisation of the privileged functions that signed-in users can call, and the Inbox Realtime policies.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.
--
-- The common cause being tested: a comparison with NULL is never true, and `if NULL then` does not raise. current_agency_id() is NULL for a
-- user with no staff profile and for staff of a SUSPENDED agency, so a guard written as `if agency <> current_agency_id() ...` let them
-- through. The tests use both kinds of caller.

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into public.agencies (id, name, slug, status) values
  ('10000000-0000-4000-8000-0000000000a1', 'Func Iso Agency A', 'func-iso-agency-a', 'ACTIVE'),
  ('20000000-0000-4000-8000-0000000000b2', 'Func Iso Agency B', 'func-iso-agency-b', 'ACTIVE'),
  ('30000000-0000-4000-8000-0000000000d4', 'Func Iso Suspended Agency', 'func-iso-suspended', 'SUSPENDED');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('11000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@funciso.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ceo-a@funciso.test', '', now(), '{}', '{}', now(), now()),
  ('13000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'guide-a@funciso.test', '', now(), '{}', '{}', now(), now()),
  ('21000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'admin-b@funciso.test', '', now(), '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'nobody@funciso.test', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'admin-suspended@funciso.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('11000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@funciso.test', 'ADMIN', 'ACTIVE'),
  ('12000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'CEO A', 'ceo-a@funciso.test', 'CEO', 'ACTIVE'),
  ('13000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Guide A', 'guide-a@funciso.test', 'GUIDE', 'ACTIVE'),
  ('21000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'Admin B', 'admin-b@funciso.test', 'ADMIN', 'ACTIVE'),
  ('41000000-0000-4000-8000-0000000000d4', '30000000-0000-4000-8000-0000000000d4', 'Admin of a suspended agency', 'admin-suspended@funciso.test', 'ADMIN', 'ACTIVE');

insert into public.packages (id, agency_id, owner_id) values ('1f000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '11000000-0000-4000-8000-0000000000a1');

-- A Realtime message on agency A's Inbox topic, written by the platform, for the receive tests.
insert into realtime.messages (topic, extension, payload, event, private) values ('inbox:10000000-0000-4000-8000-0000000000a1:seed', 'broadcast', '{}'::jsonb, 'seed', true);

-- A signed-in user who belongs to no agency (a portal login or a new sign-up) -----------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';

select throws_ok($$select * from public.record_conversation_answer_candidate('10000000-0000-4000-8000-0000000000a1', 'fp-1', 'q', (array_fill(0.1::real, array[1024]))::extensions.vector(1024), 'planted answer', 'GENERAL', 1)$$, 'P0001', 'agency mismatch', 'A user with no agency cannot write an answer-cache row into agency A');
select throws_ok($$select * from public.record_conversation_answer_candidate('20000000-0000-4000-8000-0000000000b2', 'fp-2', 'q', (array_fill(0.1::real, array[1024]))::extensions.vector(1024), 'planted answer', 'GENERAL', 1)$$, 'P0001', 'agency mismatch', 'A user with no agency cannot write an answer-cache row into agency B either');
select throws_ok($$select public.set_inbox_autonomy_level('10000000-0000-4000-8000-0000000000a1', 'INBOX_REPLY', 'L3', 'ACTIVE', true, '{"level":"L3","approved_template_ids":[],"handover_triggers":[]}'::jsonb, '31000000-0000-4000-8000-0000000000c3', 'probe', '{}'::jsonb)$$, 'P0001', 'not permitted to change Inbox autonomy', 'A user with no agency cannot change an agency''s Inbox autonomy, and is refused by the check rather than by a constraint');
select results_eq($$select public.staff_role_in('ADMIN', 'CEO')$$, array[false], 'staff_role_in answers false, never NULL, for a user with no staff profile');

-- The admin of a SUSPENDED agency: has a role, but current_agency_id() is NULL -----------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"41000000-0000-4000-8000-0000000000d4","role":"authenticated"}';
select throws_ok($$select public.set_inbox_autonomy_level('10000000-0000-4000-8000-0000000000a1', 'INBOX_REPLY', 'L3', 'ACTIVE', true, '{"level":"L3","approved_template_ids":[],"handover_triggers":[]}'::jsonb, '41000000-0000-4000-8000-0000000000d4', 'probe', '{}'::jsonb)$$, 'P0001', 'not permitted to change Inbox autonomy', 'The admin of a suspended agency cannot switch another agency to autonomous replies');
select throws_ok($$select * from public.record_conversation_answer_candidate('10000000-0000-4000-8000-0000000000a1', 'fp-3', 'q', (array_fill(0.1::real, array[1024]))::extensions.vector(1024), 'planted answer', 'GENERAL', 1)$$, 'P0001', 'agency mismatch', 'The admin of a suspended agency cannot write into another agency''s answer cache');

-- Admin in agency A ------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_inbox_autonomy_level('10000000-0000-4000-8000-0000000000a1', 'INBOX_REPLY', 'L1', 'PROPOSE', true, '{"level":"L1","approved_template_ids":[],"handover_triggers":[]}'::jsonb, '11000000-0000-4000-8000-0000000000a1', 'legitimate change', '{}'::jsonb)$$, 'An agency A admin can still change agency A''s own Inbox autonomy');
select throws_ok($$select public.set_inbox_autonomy_level('20000000-0000-4000-8000-0000000000b2', 'INBOX_REPLY', 'L3', 'ACTIVE', true, '{"level":"L3","approved_template_ids":[],"handover_triggers":[]}'::jsonb, '11000000-0000-4000-8000-0000000000a1', 'probe', '{}'::jsonb)$$, 'P0001', 'not permitted to change Inbox autonomy', 'An agency A admin cannot change agency B''s Inbox autonomy');
select lives_ok($$select * from public.record_conversation_answer_candidate('10000000-0000-4000-8000-0000000000a1', 'fp-4', 'q', (array_fill(0.1::real, array[1024]))::extensions.vector(1024), 'own answer', 'GENERAL', 1)$$, 'An agency A admin can record an answer-cache candidate for agency A');
select throws_ok($$select * from public.record_conversation_answer_candidate('20000000-0000-4000-8000-0000000000b2', 'fp-5', 'q', (array_fill(0.1::real, array[1024]))::extensions.vector(1024), 'planted answer', 'GENERAL', 1)$$, 'P0001', 'agency mismatch', 'An agency A admin cannot write into agency B''s answer cache');
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"service_role"}';
select lives_ok($$select * from public.record_conversation_answer_candidate('20000000-0000-4000-8000-0000000000b2', 'fp-6', 'q', (array_fill(0.1::real, array[1024]))::extensions.vector(1024), 'server-written answer', 'GENERAL', 1)$$, 'The service role can still write for any agency, as the server does');

-- The package status step -------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.packages_apply_status_transition('1f000000-0000-4000-8000-0000000000a1', null, array['Draft'], 'Archived', 'ARCHIVED', 'probe')$$, '42501', null, 'A CEO cannot call the internal package status step directly');
select throws_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, '42501', 'Your role cannot archive packages.', 'A CEO is still refused by archive_package');
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.archive_package('1f000000-0000-4000-8000-0000000000a1')$$, 'An admin can still archive a package through archive_package, so the wrapper keeps working');

-- Inbox Realtime: insert -----------------------------------------------------------------------------------------------------------------
set local "realtime.topic" = 'inbox:10000000-0000-4000-8000-0000000000a1:list';
select lives_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('inbox:10000000-0000-4000-8000-0000000000a1:list', 'broadcast', '{}'::jsonb, 'probe', true)$$, 'An agency A admin can broadcast on agency A''s Inbox topic');
set local "realtime.topic" = 'inbox:20000000-0000-4000-8000-0000000000b2:list';
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('inbox:20000000-0000-4000-8000-0000000000b2:list', 'broadcast', '{}'::jsonb, 'probe', true)$$, '42501', null, 'An agency A admin cannot broadcast on agency B''s Inbox topic');
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
set local "realtime.topic" = 'inbox:10000000-0000-4000-8000-0000000000a1:list';
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('inbox:10000000-0000-4000-8000-0000000000a1:list', 'broadcast', '{}'::jsonb, 'probe', true)$$, '42501', null, 'A user with no agency cannot broadcast on any Inbox topic');
set local "request.jwt.claims" = '{"sub":"13000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('inbox:10000000-0000-4000-8000-0000000000a1:list', 'broadcast', '{}'::jsonb, 'probe', true)$$, '42501', null, 'A guide in the right agency but the wrong role cannot broadcast');

-- Inbox Realtime: receive ----------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local "realtime.topic" = 'inbox:10000000-0000-4000-8000-0000000000a1:seed';
select results_eq($$select count(*) from realtime.messages where topic = 'inbox:10000000-0000-4000-8000-0000000000a1:seed'$$, array[1::bigint], 'An agency A admin receives agency A''s Inbox messages');
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq($$select count(*) from realtime.messages where topic = 'inbox:10000000-0000-4000-8000-0000000000a1:seed'$$, array[1::bigint], 'An agency A CEO receives agency A''s Inbox messages');
set local "request.jwt.claims" = '{"sub":"21000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select results_eq($$select count(*) from realtime.messages where topic = 'inbox:10000000-0000-4000-8000-0000000000a1:seed'$$, array[0::bigint], 'An agency B admin does not receive agency A''s Inbox messages');
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select results_eq($$select count(*) from realtime.messages where topic = 'inbox:10000000-0000-4000-8000-0000000000a1:seed'$$, array[0::bigint], 'A user with no agency does not receive agency A''s Inbox messages');

-- Function privileges -------------------------------------------------------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('authenticated', 'public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text)', 'execute') and has_function_privilege('service_role', 'public.packages_apply_status_transition(uuid, timestamptz, text[], text, text, text)', 'execute'), 'The internal package status step is not executable by signed-in users but is by the service role');

select * from finish();
rollback;
