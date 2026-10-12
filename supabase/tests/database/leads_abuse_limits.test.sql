begin;

-- Leads Phase 3 (docs/security/leads-module-security-audit-and-remediation-plan.md, LD-12 / LD-18 / LD-21): the rate-limit counter, the audited export, and
-- the normalised e-mail. One agency, ADMIN / MARKETING / OPERATIONS. One transaction, rolled back. Expect zero rows from finish().

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into public.agencies (id, name, slug, status) values
  ('b0000000-0000-4000-8000-0000000000a1', 'Leads Abuse Agency', 'leads-abuse-agency', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('b1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin@leadsabuse.test', '', now(), '{}', '{}', now(), now()),
  ('b2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing@leadsabuse.test', '', now(), '{}', '{}', now(), now()),
  ('b3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops@leadsabuse.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('b1000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'Admin', 'admin@leadsabuse.test', 'ADMIN', 'ACTIVE'),
  ('b2000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'Marketing', 'marketing@leadsabuse.test', 'MARKETING', 'ACTIVE'),
  ('b3000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'Ops', 'ops@leadsabuse.test', 'OPERATIONS', 'ACTIVE');

insert into public.leads (id, agency_id, reference, full_name, mobile, email, assigned_to_id, assigned_to_name) values
  ('b9000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'LD-9999-0001', 'Mixed Case', '771110001', '  Ayesha@Example.COM ',
   'b2000000-0000-4000-8000-0000000000a1', 'Marketing'),
  ('b9000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000a1', 'LD-9999-0002', 'No Email', '771110002', '   ',
   'b2000000-0000-4000-8000-0000000000a1', 'Marketing');

-- C. Normalised e-mail --------------------------------------------------------------------------------------------------------------------------
select is((select email_normalised from public.leads where id = 'b9000000-0000-4000-8000-0000000000a1'), 'ayesha@example.com', 'The e-mail is stored trimmed and lower-cased');
select is((select email_normalised from public.leads where id = 'b9000000-0000-4000-8000-0000000000a2'), null, 'A blank e-mail is null, so it matches nobody');
select throws_ok($$update public.leads set email_normalised = 'x' where id = 'b9000000-0000-4000-8000-0000000000a1'$$, '428C9', null, 'The column cannot be written to');

-- A. Rate limit ---------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is((public.consume_staff_rate_limit('test.action', 2, 3600) ->> 'allowed')::boolean, true, 'The first use is allowed');
select is((public.consume_staff_rate_limit('test.action', 2, 3600) ->> 'allowed')::boolean, true, 'and the second');
select is(public.consume_staff_rate_limit('test.action', 2, 3600) ->> 'blocked_by', 'USER', 'the third is refused, and blamed on the user');
select ok((public.consume_staff_rate_limit('test.action', 2, 3600) ->> 'retry_after_seconds')::integer between 1 and 3600, 'with a wait the person can be told');
select is((public.consume_staff_rate_limit('other.action', 2, 3600) ->> 'allowed')::boolean, true, 'Another action has its own allowance');

select is((public.consume_staff_rate_limit('billed.action', 100, 3600, 1) ->> 'allowed')::boolean, true, 'An agency ceiling of one allows the first use');
select is(public.consume_staff_rate_limit('billed.action', 100, 3600, 1) ->> 'blocked_by', 'AGENCY', 'and refuses the second, blamed on the agency');

set local "request.jwt.claims" = '{"sub":"b1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is((public.consume_staff_rate_limit('test.action', 2, 3600) ->> 'allowed')::boolean, true, 'A colleague has their own allowance');
select throws_ok($$select public.consume_staff_rate_limit('x', 0, 3600)$$, '22023', null, 'A limit below one is refused as invalid');
select throws_ok($$select count(*) from public.staff_rate_limit_buckets$$, '42501', null, 'Nobody can read the counters directly');

-- B. Audited export -----------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"b2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.authorise_lead_export(25, '{"view":"All Leads","quickFilter":null}'::jsonb)$$, 'MARKETING can export, and it is recorded');
select throws_ok($$select public.authorise_lead_export(0)$$, '22023', null, 'There must be something to export');
select throws_ok($$insert into public.lead_export_logs (agency_id, row_count) values ('b0000000-0000-4000-8000-0000000000a1', 1)$$, '42501', null, 'The log cannot be written directly');

set local "request.jwt.claims" = '{"sub":"b3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.authorise_lead_export(10)$$, '42501', null, 'OPERATIONS cannot export');

reset role;
-- Nine more exports by MARKETING in the last hour (the owner writes the log directly), so the tenth call must refuse.
insert into public.lead_export_logs (agency_id, user_id, user_name, row_count)
  select 'b0000000-0000-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000a1', 'Marketing', 5 from generate_series(1, 9);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.authorise_lead_export(5)$$, 'P0001', null, 'The eleventh export in an hour is refused');

set local "request.jwt.claims" = '{"sub":"b1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select ok((select count(*) from public.lead_export_logs) >= 10, 'An administrator can read the export log');

select * from finish();
rollback;
