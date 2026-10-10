begin;

-- TASK-043 Phase 1, step 2: changes to the payment, contract and booking terms of a live package are reviewed and approved in the database.
-- Fixtures: one agency; ADMIN `a` (approver), OPERATIONS `o` (requester, no approval capability by default), CEO `c`; one live package, one draft,
-- one archived package. The agency's two approval switches start ON (their default).
-- One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(38);

insert into public.agencies (id, name, slug, status) values
  ('90000000-0000-4000-8000-0000000000a1', 'Pkg Change Agency', 'pkg-change', 'ACTIVE');

do $$ begin
  if not exists (select 1 from public.agency_settings where agency_id = '90000000-0000-4000-8000-0000000000a1') then
    insert into public.agency_settings (agency_id) values ('90000000-0000-4000-8000-0000000000a1');
  end if;
end $$;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('91000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'a@pkgchange.test', '', now(), '{}', '{}', now(), now()),
  ('92000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'o@pkgchange.test', '', now(), '{}', '{}', now(), now()),
  ('93000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'c@pkgchange.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('91000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a1', 'Admin A', 'a@pkgchange.test', 'ADMIN', 'ACTIVE'),
  ('92000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a1', 'Ops O', 'o@pkgchange.test', 'OPERATIONS', 'ACTIVE'),
  ('93000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a1', 'CEO C', 'c@pkgchange.test', 'CEO', 'ACTIVE');

insert into public.packages (id, agency_id, owner_id, title, status, payment_terms, cancellation_policy, default_capacity, itinerary) values
  ('9a000000-0000-4000-8000-0000000000a1', '90000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-0000000000a1', 'Old title', 'Open for Sale',
   'Old terms', 'Old cancellation', 40, '[{"id":"d1","dayNumber":1,"category":"Flight","title":"Fly"}]'::jsonb),
  ('9b000000-0000-4000-8000-0000000000b2', '90000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-0000000000a1', 'A draft', 'Draft',
   'Draft terms', '', 10, '[]'::jsonb);
insert into public.packages (id, agency_id, owner_id, title, status, archived_at) values
  ('9c000000-0000-4000-8000-0000000000c3', '90000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-0000000000a1', 'Archived one', 'Archived', now());

create function public.zz_pkgchange_rows_changed(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- O (OPERATIONS): the requester ------------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"92000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(
  (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"title":"New title"}'::jsonb,
     (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1')))->>'status',
  'BASIC_APPLIED', 'A display-only change is saved at once');
select is((select title from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'New title', 'The new title is on the package');

select throws_ok(
  $$select public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"payment_terms":"New terms"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'))$$,
  '22023', 'A reason is required for changes to payment or booking terms.', 'A payment change needs a reason');

select lives_ok(
  $$select set_config('test.req1', (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"payment_terms":"New terms"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Customer asked for it')->>'request_id'), true)$$,
  'A payment change with a reason becomes a request');
select is((select status from public.package_change_requests where id = current_setting('test.req1')::uuid), 'PENDING', 'The request is waiting for approval');
select is((select payment_terms from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Old terms', 'The live package has not changed');
select is((select highest_tier::int from public.package_change_requests where id = current_setting('test.req1')::uuid), 1, 'A payment change is Tier 1');

select throws_ok(
  $$select public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"cancellation_policy":"Stricter"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Another reason')$$,
  '22023', 'Another change is already waiting for approval for this package.', 'A second request is refused while one is waiting');

select throws_ok(
  $$update public.packages set payment_terms = 'Sneaky terms' where id = '9a000000-0000-4000-8000-0000000000a1'$$,
  '42501', 'Changes to payment or booking terms on a package that is on sale must go through the review.', 'A direct update cannot skip the review');
select lives_ok($$update public.packages set title = 'Direct title' where id = '9a000000-0000-4000-8000-0000000000a1'$$, 'A direct update of a display-only column still works');
select lives_ok($$update public.packages set payment_terms = 'Draft edit' where id = '9b000000-0000-4000-8000-0000000000b2'$$, 'A draft''s payment terms can still be edited directly');
select throws_ok($$update public.packages set title = 'Archived edit' where id = '9c000000-0000-4000-8000-0000000000c3'$$,
  '42501', 'An archived package cannot be edited. Restore it first.', 'An archived package cannot be edited directly');

select throws_ok(
  $$select public.decide_package_change(current_setting('test.req1')::uuid, true)$$,
  '42501', 'Your role cannot approve package changes.', 'OPERATIONS cannot approve');

-- A (ADMIN): the approver ----------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"91000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is((public.decide_package_change(current_setting('test.req1')::uuid, true, 'Looks right'))->>'status', 'APPROVED', 'An administrator can approve the request');
select is((select payment_terms from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'New terms', 'Approval applied the change');
select is((select count(*)::int from public.package_versions where package_id = '9a000000-0000-4000-8000-0000000000a1'), 1, 'Approval on a package that is for sale recorded a version');
select is((select count(*)::int from public.package_activity_logs where package_id = '9a000000-0000-4000-8000-0000000000a1' and action_type = 'CHANGE_APPLIED'), 1, 'Approval was logged');
select is((select decided_by_name from public.package_change_requests where id = current_setting('test.req1')::uuid), 'Admin A', 'The approver is recorded');
select throws_ok(
  $$select public.decide_package_change(current_setting('test.req1')::uuid, true)$$,
  '22023', 'This change is no longer waiting for approval.', 'A request cannot be approved twice');

select lives_ok(
  $$select set_config('test.req2', (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"cancellation_policy":"Admin wants this"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Admin request')->>'request_id'), true)$$,
  'An administrator can also make a request');
select throws_ok(
  $$select public.decide_package_change(current_setting('test.req2')::uuid, true)$$,
  '42501', 'You cannot approve your own change.', 'Nobody can approve their own request');
select is((public.withdraw_package_change(current_setting('test.req2')::uuid))->>'status', 'WITHDRAWN', 'The requester can withdraw their own request');

-- Rejecting -----------------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"92000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$select set_config('test.req3', (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"cancellation_policy":"No refunds"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Ops request')->>'request_id'), true)$$,
  'OPERATIONS makes another request after the first was decided');
set local "request.jwt.claims" = '{"sub":"91000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.decide_package_change(current_setting('test.req3')::uuid, false)$$,
  '22023', 'A note is required when a change is rejected.', 'A rejection needs a note');
select is((public.decide_package_change(current_setting('test.req3')::uuid, false, 'Not now'))->>'status', 'REJECTED', 'An administrator can reject with a note');
select is((select cancellation_policy from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Old cancellation', 'A rejected change leaves the package alone');

-- The itinerary: wording is basic, structure is Tier 2 -----------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"92000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(
  (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"itinerary":[{"id":"d1","dayNumber":1,"category":"Flight","title":"Fly out"}]}'::jsonb,
     (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1')))->>'status',
  'BASIC_APPLIED', 'Rewording an itinerary day is a display-only change');
select is(
  (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1',
     '{"itinerary":[{"id":"d1","dayNumber":1,"category":"Flight","title":"Fly out"},{"id":"d2","dayNumber":2,"category":"Hotel","title":"Check in"}]}'::jsonb,
     (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Added a day'))->>'status',
  'PENDING', 'Adding a day changes the structure and waits for approval');

-- A change made behind the request's back blocks approval -----------------------------------------------------------------------------------------------------
select lives_ok(
  $$select public.withdraw_package_change((select id from public.package_change_requests where package_id = '9a000000-0000-4000-8000-0000000000a1' and status = 'PENDING'))$$,
  'The requester withdraws the itinerary request');
select lives_ok(
  $$select set_config('test.req5', (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"cancellation_policy":"Strict"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Tighten')->>'request_id'), true)$$,
  'Another cancellation request is made');
reset role;
update public.packages set cancellation_policy = 'Changed meanwhile' where id = '9a000000-0000-4000-8000-0000000000a1';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"91000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.decide_package_change(current_setting('test.req5')::uuid, true)$$,
  '40001', 'This package changed since the request was made. Ask for the change to be submitted again.', 'Approval is blocked when the package changed since the request');

-- Switching a tier's approval off ----------------------------------------------------------------------------------------------------------------------
select lives_ok($$update public.agency_settings set package_approval_bookings_ops = false where agency_id = '90000000-0000-4000-8000-0000000000a1'$$,
  'An administrator can switch Tier 2 approval off');
set local "request.jwt.claims" = '{"sub":"92000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(public.zz_pkgchange_rows_changed($$update public.agency_settings set package_approval_money_contract = false where agency_id = '90000000-0000-4000-8000-0000000000a1'$$), 0,
  'OPERATIONS cannot switch an approval off');
select is(
  (public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"default_capacity":55}'::jsonb,
     (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 'Bigger coach'))->>'status',
  'APPLIED', 'With Tier 2 approval off a capacity change applies at once');
select is((select default_capacity from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'), 55, 'The capacity changed');
select is((select approval_required from public.package_change_requests where package_id = '9a000000-0000-4000-8000-0000000000a1' and status = 'APPLIED'), false,
  'It is recorded as applied without approval');

-- Other callers ---------------------------------------------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"93000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.submit_package_change('9a000000-0000-4000-8000-0000000000a1', '{"title":"CEO edit"}'::jsonb,
      (select updated_at from public.packages where id = '9a000000-0000-4000-8000-0000000000a1'))$$,
  '42501', 'Your role cannot edit packages.', 'A CEO cannot change a package');

reset role;
select is((select count(*)::int from public.settings_activity_logs where event_type = 'PACKAGE_APPROVAL_POLICY_CHANGED'), 1, 'Switching an approval off was logged');

select * from finish();
rollback;
