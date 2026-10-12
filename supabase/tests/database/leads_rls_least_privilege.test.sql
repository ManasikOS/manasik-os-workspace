begin;

-- Leads Phase 1 (docs/security/leads-module-security-audit-and-remediation-plan.md, LD-01 / LD-02 / LD-03 / LD-11): the lead tables are enforced by the
-- database, not only by the Server Actions. Two agencies; one user of each role that matters. One transaction, rolled back. Expect zero rows from finish().

create extension if not exists pgtap with schema extensions;
select plan(39);

insert into public.agencies (id, name, slug, status) values
  ('d0000000-0000-4000-8000-0000000000a1', 'Leads RLS Agency A', 'leads-rls-agency-a', 'ACTIVE'),
  ('d0000000-0000-4000-8000-0000000000b2', 'Leads RLS Agency B', 'leads-rls-agency-b', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('d1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@leadsrls.test', '', now(), '{}', '{}', now(), now()),
  ('d2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing-a@leadsrls.test', '', now(), '{}', '{}', now(), now()),
  ('d3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops-a@leadsrls.test', '', now(), '{}', '{}', now(), now()),
  ('d4000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'finance-a@leadsrls.test', '', now(), '{}', '{}', now(), now()),
  ('d5000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ceo-a@leadsrls.test', '', now(), '{}', '{}', now(), now()),
  ('d6000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'guide-a@leadsrls.test', '', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'admin-b@leadsrls.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('d1000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@leadsrls.test', 'ADMIN', 'ACTIVE'),
  ('d2000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'Marketing A', 'marketing-a@leadsrls.test', 'MARKETING', 'ACTIVE'),
  ('d3000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'Ops A', 'ops-a@leadsrls.test', 'OPERATIONS', 'ACTIVE'),
  ('d4000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'Finance A', 'finance-a@leadsrls.test', 'FINANCE', 'ACTIVE'),
  ('d5000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'CEO A', 'ceo-a@leadsrls.test', 'CEO', 'ACTIVE'),
  ('d6000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'Guide A', 'guide-a@leadsrls.test', 'GUIDE', 'ACTIVE'),
  ('d1000000-0000-4000-8000-0000000000b2', 'd0000000-0000-4000-8000-0000000000b2', 'Admin B', 'admin-b@leadsrls.test', 'ADMIN', 'ACTIVE');

-- Fixtures, written by the test owner (bypassing RLS). L1 is an ordinary open lead; L2 has converted (the booking id is fake, so the foreign key is
-- skipped for this one insert only).
insert into public.leads (id, agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name, created_at) values
  ('d9000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'LD-9999-0001', 'Open Lead', '771110001', 'd2000000-0000-4000-8000-0000000000a1', 'Marketing A', now() - interval '2 days');
insert into public.leads (id, agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name, created_at) values
  ('d9000000-0000-4000-8000-0000000000a4', 'd0000000-0000-4000-8000-0000000000a1', 'LD-9999-0004', 'Second Open Lead', '771110004', 'd2000000-0000-4000-8000-0000000000a1', 'Marketing A', now() - interval '2 days');
set local session_replication_role = replica;
insert into public.leads (id, agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name, stage, booking_id, created_at) values
  ('d9000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a1', 'LD-9999-0002', 'Converted Lead', '771110002', 'd2000000-0000-4000-8000-0000000000a1', 'Marketing A', 'BOOKED', gen_random_uuid(), now() - interval '2 days');
set local session_replication_role = origin;

insert into public.lead_activity (id, agency_id, lead_id, type, message, actor_name) values
  ('da000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a1', 'CREATED', 'open lead event', 'Marketing A'),
  ('da000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a2', 'CREATED', 'converted lead event', 'Marketing A');
insert into public.lead_notes (id, agency_id, lead_id, body, author_name) values
  ('db000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a1', 'open lead note', 'Marketing A'),
  ('db000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a2', 'converted lead note', 'Marketing A');
insert into public.lead_quotes (id, agency_id, lead_id, reference, valid_until, created_by_name, status, discount_amount, total_lkr) values
  ('dc000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a1', 'QT-9999-0001', now() + interval '7 days', 'Marketing A', 'SENT', 0, 1000000),
  ('dc000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a2', 'QT-9999-0002', now() + interval '7 days', 'Marketing A', 'ACCEPTED', 0, 1000000),
  ('dc000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a1', 'QT-9999-0003', now() + interval '7 days', 'Marketing A', 'PENDING_APPROVAL', 50000, 950000),
  ('dc000000-0000-4000-8000-0000000000a4', 'd0000000-0000-4000-8000-0000000000a1', 'd9000000-0000-4000-8000-0000000000a4', 'QT-9999-0007', now() + interval '7 days', 'Marketing A', 'SENT', 0, 1000000);

-- Counts rows a statement changed AS THE CALLER, so row-level security applies.
create function public.zz_rows_changed(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Structure ---------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and cmd = 'ALL'
              and tablename in ('leads', 'lead_activity', 'lead_notes', 'lead_quotes', 'lead_sources', 'lead_copilot_context', 'lead_copilot_dismissals', 'lead_communication_drafts')),
          0, 'No lead table keeps a FOR ALL policy');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('lead_activity', 'lead_notes', 'lead_copilot_dismissals') and cmd in ('UPDATE', 'DELETE')),
          0, 'The history tables have no UPDATE or DELETE policy');

-- MARKETING of agency A ---------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select lives_ok($$insert into public.leads (id, reference, full_name, mobile, assigned_to_id, assigned_to_name) values ('d9000000-0000-4000-8000-0000000000a3', 'LD-9999-0003', 'Fresh Lead', '771110003', 'd2000000-0000-4000-8000-0000000000a1', 'Marketing A')$$,
  'MARKETING can create a lead');
select is((select created_by_id from public.leads where id = 'd9000000-0000-4000-8000-0000000000a3'), 'd2000000-0000-4000-8000-0000000000a1'::uuid, 'The creator is stamped from the session, not from the payload');
select is(public.zz_rows_changed($$delete from public.leads where id = 'd9000000-0000-4000-8000-0000000000a3'$$), 1, 'MARKETING can take back a lead they created minutes ago that nothing refers to');
select is(public.zz_rows_changed($$delete from public.leads where id = 'd9000000-0000-4000-8000-0000000000a1'$$), 0, 'MARKETING cannot delete an older lead (LD-02)');
select is(public.zz_rows_changed($$delete from public.leads where id = 'd9000000-0000-4000-8000-0000000000a2'$$), 0, 'MARKETING cannot delete a converted lead');
select is(public.zz_rows_changed($$update public.leads set temperature = 'HOT' where id = 'd9000000-0000-4000-8000-0000000000a1'$$), 1, 'MARKETING can still edit a lead');

select lives_ok($$insert into public.lead_activity (lead_id, type, message, actor_name) values ('d9000000-0000-4000-8000-0000000000a1', 'NOTE_ADDED', 'hello', 'Marketing A')$$, 'MARKETING can append to the activity trail');
select is((select actor_id from public.lead_activity where message = 'hello'), 'd2000000-0000-4000-8000-0000000000a1'::uuid, 'The actor id is stamped from the session (LD-11)');
select throws_ok($$update public.lead_activity set message = 'rewritten' where id = 'da000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot rewrite the activity trail (LD-02)');
select throws_ok($$delete from public.lead_activity where id = 'da000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot erase activity');
select throws_ok($$update public.lead_notes set body = 'edited' where id = 'db000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot edit a note');
select throws_ok($$delete from public.lead_notes where id = 'db000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot delete a note');

-- Quote guard (LD-01)
select lives_ok($$insert into public.lead_quotes (id, lead_id, reference, valid_until, created_by_name, status, discount_amount, total_lkr) values ('dc000000-0000-4000-8000-0000000000b1', 'd9000000-0000-4000-8000-0000000000a1', 'QT-9999-0004', now() + interval '7 days', 'Marketing A', 'PENDING_APPROVAL', 25000, 975000)$$,
  'MARKETING can save a discounted quote that waits for approval');
select throws_ok($$insert into public.lead_quotes (id, lead_id, reference, valid_until, created_by_name, status, discount_amount, total_lkr) values ('dc000000-0000-4000-8000-0000000000b2', 'd9000000-0000-4000-8000-0000000000a1', 'QT-9999-0005', now() + interval '7 days', 'Marketing A', 'SENT', 25000, 975000)$$,
  '42501', null, 'MARKETING cannot insert a discounted quote already SENT');
select throws_ok($$insert into public.lead_quotes (id, lead_id, reference, valid_until, created_by_name, status, discount_amount, total_lkr, discount_approved_by) values ('dc000000-0000-4000-8000-0000000000b3', 'd9000000-0000-4000-8000-0000000000a1', 'QT-9999-0006', now() + interval '7 days', 'Marketing A', 'DRAFT', 25000, 975000, 'someone')$$,
  '42501', null, 'MARKETING cannot forge an approval on insert');
select throws_ok($$update public.lead_quotes set status = 'SENT' where id = 'dc000000-0000-4000-8000-0000000000a3'$$, '42501', null, 'MARKETING cannot release a quote waiting for approval');
select throws_ok($$update public.lead_quotes set discount_approved_by = 'me' where id = 'dc000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot stamp an approval');
select throws_ok($$update public.lead_quotes set total_lkr = 1 where id = 'dc000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'MARKETING cannot change a saved quote''s amount');
select is(public.zz_rows_changed($$update public.lead_quotes set status = 'EXPIRED' where id = 'dc000000-0000-4000-8000-0000000000a1'$$), 1, 'MARKETING can still move a sent quote through its normal states');
select is(public.zz_rows_changed($$update public.lead_quotes set status = 'CANCELLED' where id = 'dc000000-0000-4000-8000-0000000000a3'$$), 1, 'MARKETING can withdraw a quote that was waiting for approval');
select is(public.zz_rows_changed($$delete from public.lead_quotes where id = 'dc000000-0000-4000-8000-0000000000a1'$$), 0, 'MARKETING cannot delete a quote');

select is(public.zz_rows_changed($$update public.lead_sources set label = 'Hacked' where code = 'WHATSAPP'$$), 0, 'MARKETING cannot edit lead sources');

-- ADMIN of agency A -------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(public.zz_rows_changed($$update public.lead_quotes set status = 'SENT' where id = 'dc000000-0000-4000-8000-0000000000b1'$$), 1, 'ADMIN can approve a discounted quote');
select is((select discount_approved_by from public.lead_quotes where id = 'dc000000-0000-4000-8000-0000000000b1'), 'd1000000-0000-4000-8000-0000000000a1', 'and the approval carries their user id');
select is(public.zz_rows_changed($$delete from public.leads where id = 'd9000000-0000-4000-8000-0000000000a1'$$), 1, 'ADMIN can delete a lead');
select is((select count(*)::int from public.lead_activity where lead_id = 'd9000000-0000-4000-8000-0000000000a1'), 0, 'and its history goes with it (cascade is not blocked by the append-only guard)');

-- OPERATIONS: converted leads only, for the child tables -------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"d3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.lead_notes), 1, 'OPERATIONS sees notes of converted leads only (LD-03)');
select is((select body from public.lead_notes), 'converted lead note', 'and it is the converted lead''s note');
select is((select count(*)::int from public.lead_activity), 1, 'OPERATIONS sees activity of converted leads only');
select is((select count(*)::int from public.lead_quotes), 1, 'OPERATIONS sees quotes of converted leads only');
select is(public.zz_rows_changed($$delete from public.lead_notes where id = 'db000000-0000-4000-8000-0000000000a2'$$), 0, 'OPERATIONS cannot delete a note');

-- FINANCE keeps the quote ledger ------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"d4000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.lead_quotes), 2, 'FINANCE reads quotes of unconverted leads too (the /quotes ledger)');
select is((select count(*)::int from public.lead_notes), 1, 'FINANCE sees notes of converted leads only');

-- CEO: read-only, but may dismiss a copilot alert ------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$insert into public.lead_communication_drafts (lead_id, purpose, tone, language, body, created_by_name) values ('d9000000-0000-4000-8000-0000000000a2', 'FOLLOW_UP', 'WARM', 'EN', 'x', 'CEO A')$$, '42501', null, 'CEO cannot save a customer draft');

-- GUIDE reads nothing, another agency's ADMIN sees and changes nothing -----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"d6000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.lead_activity) + (select count(*)::int from public.lead_notes) + (select count(*)::int from public.lead_quotes), 0, 'GUIDE reads no lead history');
set local "request.jwt.claims" = '{"sub":"d1000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from public.leads), 0, 'Another agency''s ADMIN sees none of agency A''s leads');
select is(public.zz_rows_changed($$delete from public.leads where id = 'd9000000-0000-4000-8000-0000000000a2'$$), 0, 'and cannot delete one');

select * from finish();
rollback;
