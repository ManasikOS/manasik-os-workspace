begin;

-- Leads Phase 2 (docs/security/leads-module-security-audit-and-remediation-plan.md, LD-09 / LD-10 / LD-17): reference allocation and the atomic consent
-- change. Two agencies; ADMIN, MARKETING, OPERATIONS and GUIDE in agency A. One transaction, rolled back. Expect zero rows from finish().

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.agencies (id, name, slug, status) values
  ('c0000000-0000-4000-8000-0000000000a1', 'Leads Integrity Agency A', 'leads-integrity-agency-a', 'ACTIVE'),
  ('c0000000-0000-4000-8000-0000000000b2', 'Leads Integrity Agency B', 'leads-integrity-agency-b', 'ACTIVE');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('c1000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@leadsint.test', '', now(), '{}', '{}', now(), now()),
  ('c2000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing-a@leadsint.test', '', now(), '{}', '{}', now(), now()),
  ('c3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops-a@leadsint.test', '', now(), '{}', '{}', now(), now()),
  ('c4000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'guide-a@leadsint.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('c1000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Admin A', 'admin-a@leadsint.test', 'ADMIN', 'ACTIVE'),
  ('c2000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Marketing A', 'marketing-a@leadsint.test', 'MARKETING', 'ACTIVE'),
  ('c3000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Ops A', 'ops-a@leadsint.test', 'OPERATIONS', 'ACTIVE'),
  ('c4000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'Guide A', 'guide-a@leadsint.test', 'GUIDE', 'ACTIVE');

-- An existing lead (and quote) numbered by the old scheme, so the counter has to continue after it rather than restart at 1.
insert into public.leads (id, agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name) values
  ('c9000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1',
   'LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0041', 'Existing Lead', '771110041', 'c2000000-0000-4000-8000-0000000000a1', 'Marketing A');

insert into public.lead_quotes (id, agency_id, lead_id, reference, valid_until, created_by_name) values
  ('c8000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000a1', 'c9000000-0000-4000-8000-0000000000a1',
   'QT-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0007', now() + interval '7 days', 'Marketing A'),
  ('c8000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-0000000000a1', 'c9000000-0000-4000-8000-0000000000a1',
   'QT-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0007-R1', now() + interval '7 days', 'Marketing A');

-- ── Reference allocation ──────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(public.allocate_references('LEAD', 1), array['LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0042'],
  'The first allocation continues after the highest existing lead reference');
select is(public.allocate_references('LEAD', 3), array[
    'LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0043',
    'LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0044',
    'LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0045'],
  'A block is consecutive and never repeats a number already issued');
select is(public.allocate_references('QUOTE', 1), array['QT-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0008'],
  'Quotes have their own counter, and a revision suffix does not count as a number');
select throws_ok($$select public.allocate_references('INVOICE', 1)$$, '22023', null, 'An unknown kind is refused');
select throws_ok($$select public.allocate_references('LEAD', 0)$$, '22023', null, 'A count below one is refused');
select throws_ok($$select public.allocate_references('LEAD', 1001)$$, '22023', null, 'A huge block is refused');
select throws_ok($$select count(*) from public.agency_reference_counters$$, '42501', null, 'Staff cannot read the counter table directly');

set local "request.jwt.claims" = '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.allocate_references('LEAD', 1)$$, '42501', null, 'OPERATIONS cannot allocate references');
set local "request.jwt.claims" = '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.allocate_references('LEAD', 1)$$, '42501', null, 'GUIDE cannot allocate references');

-- A staff session cannot ask for another agency's counter: the argument is ignored for it.
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(public.allocate_references('LEAD', 1, 'c0000000-0000-4000-8000-0000000000b2'),
  array['LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0046'],
  'A staff session allocates for its own agency whatever agency it names');

-- Service role (no signed-in user): needs an agency.
reset role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(public.allocate_references('LEAD', 1, 'c0000000-0000-4000-8000-0000000000b2'),
  array['LD-' || extract(year from (now() at time zone 'Asia/Colombo'))::int || '-0001'],
  'The service role allocates for the agency it names, counting from 1 for an agency with no leads');
select throws_ok($$select public.allocate_references('LEAD', 1)$$, '22023', null, 'and must name one');

-- ── Consent ───────────────────────────────────────────────────────────────────
create function public.zz_consent(p_status text, p_dnc boolean, p_source text default 'WhatsApp reply') returns void language sql as $$
  select public.set_lead_consent('c9000000-0000-4000-8000-0000000000a1', p_status, p_dnc, array['WHATSAPP'], p_source, 'note');
$$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select lives_ok($$select public.zz_consent('OPTED_IN', false)$$, 'MARKETING can record an opt-in');
select is((select consent_status from public.leads where id = 'c9000000-0000-4000-8000-0000000000a1'), 'OPTED_IN', 'the lead carries it');
select ok(exists (select 1 from public.consent_events where subject_id = 'c9000000-0000-4000-8000-0000000000a1' and action = 'OPT_IN'), 'and an audit row says what happened');
select ok(exists (select 1 from public.consent_events where subject_id = 'c9000000-0000-4000-8000-0000000000a1' and action = 'OPT_IN' and actor_name = 'Marketing A' and actor_id = 'c2000000-0000-4000-8000-0000000000a1'),
  'with the actor taken from the session');
select is((select count(*)::int from public.lead_activity where lead_id = 'c9000000-0000-4000-8000-0000000000a1' and type = 'CONSENT_UPDATED'), 1,
  'and a timeline entry');

select lives_ok($$select public.zz_consent('OPTED_OUT', true)$$, 'MARKETING can set do-not-contact');
select ok(exists (select 1 from public.consent_events where subject_id = 'c9000000-0000-4000-8000-0000000000a1' and action = 'DNC_SET'), 'recorded as DNC_SET');
select throws_ok($$select public.zz_consent('OPTED_IN', false)$$, '42501', null, 'MARKETING cannot lift do-not-contact');
select throws_ok($$select public.zz_consent('MAYBE', false)$$, '22023', null, 'An unknown status is refused');

set local "request.jwt.claims" = '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.zz_consent('OPTED_IN', false)$$, 'ADMIN can lift do-not-contact');
select ok(exists (select 1 from public.consent_events where subject_id = 'c9000000-0000-4000-8000-0000000000a1' and action = 'DNC_CLEARED' and actor_name = 'Admin A'), 'recorded as DNC_CLEARED, by the admin');

set local "request.jwt.claims" = '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.zz_consent('OPTED_IN', false)$$, '42501', null, 'OPERATIONS cannot record a consent decision, and leaves no audit row');

select * from finish();
rollback;
