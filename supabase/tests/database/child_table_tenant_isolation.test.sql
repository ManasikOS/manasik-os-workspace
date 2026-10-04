begin;

-- TASK-029 P2.4, finding F2: tenant isolation for the tables that belong to a tenant only through a parent row (payment_reminders,
-- booking_collection_risk, milestone_change_events, quote_line_items), plus the staging-only package_* tables.
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(27);

insert into public.agencies (id, name, slug) values
  ('10000000-0000-4000-8000-0000000000a1', 'Child Iso Agency A', 'child-iso-agency-a'),
  ('20000000-0000-4000-8000-0000000000b2', 'Child Iso Agency B', 'child-iso-agency-b');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('11000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'finance-a@childiso.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops-a@childiso.test', '', now(), '{}', '{}', now(), now()),
  ('13000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'guide-a@childiso.test', '', now(), '{}', '{}', now(), now()),
  ('14000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'marketing-a@childiso.test', '', now(), '{}', '{}', now(), now()),
  ('21000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'finance-b@childiso.test', '', now(), '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'nobody@childiso.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('11000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Finance A', 'finance-a@childiso.test', 'FINANCE', 'ACTIVE'),
  ('12000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Operations A', 'ops-a@childiso.test', 'OPERATIONS', 'ACTIVE'),
  ('13000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Guide A', 'guide-a@childiso.test', 'GUIDE', 'ACTIVE'),
  ('14000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Marketing A', 'marketing-a@childiso.test', 'MARKETING', 'ACTIVE'),
  ('21000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'Finance B', 'finance-b@childiso.test', 'FINANCE', 'ACTIVE');

-- Parents, one chain per agency.
insert into public.departure_groups (id, agency_id, group_name, group_code, departure_date, return_date, capacity) values
  ('1a000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Child Iso Group A', 'CHILD-ISO-A', current_date + 60, current_date + 70, 10),
  ('2b000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'Child Iso Group B', 'CHILD-ISO-B', current_date + 60, current_date + 70, 10);
insert into public.departure_group_bookings (id, agency_id, departure_group_id, booking_reference) values
  ('1b000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 'CHILD-ISO-BK-A'),
  ('2c000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2', 'CHILD-ISO-BK-B');
insert into public.booking_payment_milestones (id, agency_id, booking_id, departure_group_id, label) values
  ('1c000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 'Deposit A'),
  ('2d000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', '2c000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2', 'Deposit B');
insert into public.leads (id, agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name) values
  ('1d000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'CHILD-ISO-LEAD-A', 'Lead A', '0000000001', 'x', 'x'),
  ('2e000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'CHILD-ISO-LEAD-B', 'Lead B', '0000000002', 'x', 'x');
insert into public.lead_quotes (id, agency_id, lead_id, reference, valid_until, created_by_name) values
  ('1e000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', '1d000000-0000-4000-8000-0000000000a1', 'CHILD-ISO-Q-A', now() + interval '7 days', 'Test'),
  ('2f000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', '2e000000-0000-4000-8000-0000000000b2', 'CHILD-ISO-Q-B', now() + interval '7 days', 'Test');

-- Children, one row per agency.
insert into public.payment_reminders (milestone_id, booking_id, departure_group_id, offset_days, scheduled_for) values
  ('1c000000-0000-4000-8000-0000000000a1', '1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', -3, now()),
  ('2d000000-0000-4000-8000-0000000000b2', '2c000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2', -3, now());
insert into public.booking_collection_risk (booking_id, departure_group_id) values
  ('1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1'),
  ('2c000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2');
insert into public.milestone_change_events (milestone_id, booking_id, departure_group_id, reason, approver_name) values
  ('1c000000-0000-4000-8000-0000000000a1', '1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 'seed', 'Seed'),
  ('2d000000-0000-4000-8000-0000000000b2', '2c000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2', 'seed', 'Seed');
insert into public.quote_line_items (quote_id, scope, label) values
  ('1e000000-0000-4000-8000-0000000000a1', 'PARTY', 'Line A'),
  ('2f000000-0000-4000-8000-0000000000b2', 'PARTY', 'Line B');

-- Finance in agency A -----------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select results_eq($$select count(*) from public.payment_reminders$$, array[1::bigint], 'Finance A sees only its own payment reminders');
select results_eq($$select count(*) from public.booking_collection_risk$$, array[1::bigint], 'Finance A sees only its own collection risk');
select results_eq($$select count(*) from public.milestone_change_events$$, array[1::bigint], 'Finance A sees only its own milestone change events');
select results_eq($$select count(*) from public.quote_line_items$$, array[1::bigint], 'Finance A sees only its own quote line items');
select lives_ok($$insert into public.payment_reminders (milestone_id, booking_id, departure_group_id, offset_days, scheduled_for) values ('1c000000-0000-4000-8000-0000000000a1', '1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 7, now())$$, 'Finance A can queue a reminder for its own booking');
select throws_ok($$insert into public.payment_reminders (milestone_id, booking_id, departure_group_id, offset_days, scheduled_for) values ('2d000000-0000-4000-8000-0000000000b2', '2c000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2', 7, now())$$, '42501', null, 'Finance A cannot queue a reminder under agency B''s group');
select throws_ok($$insert into public.payment_reminders (milestone_id, booking_id, departure_group_id, offset_days, scheduled_for) values ('2d000000-0000-4000-8000-0000000000b2', '2c000000-0000-4000-8000-0000000000b2', '1a000000-0000-4000-8000-0000000000a1', 8, now())$$, '42501', null, 'Finance A cannot attach a reminder to agency B''s booking, even under its own group');
select results_eq($$with changed as (update public.payment_reminders set status = 'SKIPPED' where departure_group_id = '2b000000-0000-4000-8000-0000000000b2' returning 1) select count(*) from changed$$, array[0::bigint], 'Finance A cannot update agency B''s reminders');
select results_eq($$with removed as (delete from public.booking_collection_risk where departure_group_id = '2b000000-0000-4000-8000-0000000000b2' returning 1) select count(*) from removed$$, array[0::bigint], 'Finance A cannot delete agency B''s collection risk');
select lives_ok($$insert into public.milestone_change_events (milestone_id, booking_id, departure_group_id, reason, approver_name) values ('1c000000-0000-4000-8000-0000000000a1', '1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 'test', 'Finance A')$$, 'Finance A can record a change event for its own milestone');
select throws_ok($$insert into public.milestone_change_events (milestone_id, booking_id, departure_group_id, reason, approver_name) values ('2d000000-0000-4000-8000-0000000000b2', '2c000000-0000-4000-8000-0000000000b2', '2b000000-0000-4000-8000-0000000000b2', 'test', 'Finance A')$$, '42501', null, 'Finance A cannot record a change event under agency B');
select throws_ok($$insert into public.quote_line_items (quote_id, scope, label) values ('1e000000-0000-4000-8000-0000000000a1', 'PARTY', 'not allowed')$$, '42501', null, 'Finance can read but not write quote line items');

-- Operations in agency A: may read finance data, may not write it -------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq($$select count(*) from public.payment_reminders$$, array[2::bigint], 'Operations A can read its own agency''s payment reminders');
select throws_ok($$insert into public.payment_reminders (milestone_id, booking_id, departure_group_id, offset_days, scheduled_for) values ('1c000000-0000-4000-8000-0000000000a1', '1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1', 9, now())$$, '42501', null, 'Operations A cannot write payment reminders');

-- A guide in agency A can see the group itself but not its finance or quote detail ----------------------------------------------------
set local "request.jwt.claims" = '{"sub":"13000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq($$select count(*) from public.departure_groups where id = '1a000000-0000-4000-8000-0000000000a1'$$, array[1::bigint], 'A guide can see their own agency''s departure group');
select results_eq($$select (select count(*) from public.payment_reminders) + (select count(*) from public.booking_collection_risk) + (select count(*) from public.quote_line_items)$$, array[0::bigint], 'The same guide sees no reminders, collection risk or quote lines, so seeing the parent group is not enough');

-- Marketing in agency A writes quote lines for its own quotes only --------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"14000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into public.quote_line_items (quote_id, scope, label) values ('1e000000-0000-4000-8000-0000000000a1', 'PARTY', 'Marketing line')$$, 'Marketing A can add a line to its own quote');
select throws_ok($$insert into public.quote_line_items (quote_id, scope, label) values ('2f000000-0000-4000-8000-0000000000b2', 'PARTY', 'planted')$$, '42501', null, 'Marketing A cannot add a line to agency B''s quote');

-- Finance in agency B -----------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"21000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select results_eq($$select count(*) from public.payment_reminders$$, array[1::bigint], 'Finance B sees only its own payment reminders');
select results_eq($$select count(*) from public.payment_reminders where departure_group_id = '1a000000-0000-4000-8000-0000000000a1'$$, array[0::bigint], 'Finance B cannot see agency A''s payment reminders');
select results_eq($$select count(*) from public.quote_line_items where quote_id = '1e000000-0000-4000-8000-0000000000a1'$$, array[0::bigint], 'Finance B cannot see agency A''s quote lines');

-- A signed-in user who belongs to no agency (a portal login or a new sign-up) ----------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select results_eq($$select (select count(*) from public.payment_reminders) + (select count(*) from public.booking_collection_risk) + (select count(*) from public.milestone_change_events) + (select count(*) from public.quote_line_items)$$, array[0::bigint], 'A signed-in user with no agency sees none of the four tables');
select throws_ok($$insert into public.booking_collection_risk (booking_id, departure_group_id) values ('1b000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-0000000000a1')$$, '42501', null, 'A signed-in user with no agency cannot write collection risk');

-- No unconditional policy remains, and the staging-only package tables have none -----------------------------------------------------
reset role;
select is_empty(
  $$select c.relname || '.' || p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace and c.relname not in ('ai_model_rates', 'country_locale_defaults')
       and (pg_get_expr(p.polqual, p.polrelid) in ('true', '(true)') or pg_get_expr(p.polwithcheck, p.polrelid) in ('true', '(true)'))$$,
  'No public table keeps an unconditional policy, apart from the two global reference tables');
select is_empty(
  $$select c.relname || '.' || p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relnamespace = 'public'::regnamespace and c.relname in ('package_content', 'package_faqs', 'package_media', 'package_seo_analyses')$$,
  'The package_* tables, where they exist, have no policy and so no user access');
select is_empty(
  $$select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('package_content', 'package_faqs', 'package_media', 'package_seo_analyses') and not c.relrowsecurity$$,
  'Row-level security stays on for the package_* tables');
select ok(
  (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace and c.relname in ('payment_reminders', 'booking_collection_risk', 'milestone_change_events', 'quote_line_items')) = 8,
  'Each of the four repository tables has its read and write policy');

select * from finish();
rollback;
