begin;

-- TASK-032 G9: public.gate_disposable_agency_leftovers() is read-only, service-role only, and reports every table, plus storage, that still holds
-- rows for an agency. Expect zero rows from finish() when every assertion passes. One transaction, rolled back.

create extension if not exists pgtap with schema extensions;
select plan(13);

select has_function('public', 'gate_disposable_agency_leftovers', array['uuid'], 'the function exists');
select ok(not has_function_privilege('anon', 'public.gate_disposable_agency_leftovers(uuid)', 'execute'), 'Anonymous callers cannot run it');
select ok(not has_function_privilege('authenticated', 'public.gate_disposable_agency_leftovers(uuid)', 'execute'), 'Signed-in users cannot run it');
select ok(has_function_privilege('service_role', 'public.gate_disposable_agency_leftovers(uuid)', 'execute'), 'The service role can run it');

select ok(public.gate_disposable_agency_leftovers(gen_random_uuid()) = '[]'::jsonb, 'An agency that never existed has no leftovers');

insert into public.agencies (id, name, slug, is_test) values ('00000000-0000-4000-8000-0000000000a9', 'Gate probe', 'e2e-gate-probe', true);
select ok(public.gate_disposable_agency_leftovers('00000000-0000-4000-8000-0000000000a9') @> '[{"table":"agencies","rows":1}]'::jsonb, 'A live agency row is reported');

insert into public.whatsapp_integrations (agency_id, phone_number_id, display_phone_number, business_name, credential_ref, status, funding_status)
values ('00000000-0000-4000-8000-0000000000a9', 'sim-gate-probe', '15550000009', 'Gate probe', 'simulator-no-secret', 'CONNECTED', 'FUNDED');
select ok(public.gate_disposable_agency_leftovers('00000000-0000-4000-8000-0000000000a9') @> '[{"table":"whatsapp_integrations","rows":1}]'::jsonb, 'A child table row is reported by name');

-- The remover: refuses a real agency, and clears a gate agency that has a child row with no cascade (a webhook event). -----------------------------
select ok(not has_function_privilege('authenticated', 'public.gate_delete_disposable_agency(uuid)', 'execute'), 'Signed-in users cannot run the remover');
select ok(has_function_privilege('service_role', 'public.gate_delete_disposable_agency(uuid)', 'execute'), 'The service role can run the remover');

insert into public.agencies (id, name, slug, is_test) values ('00000000-0000-4000-8000-0000000000b9', 'Real-looking agency', 'real-looking', false);
select throws_ok($$select public.gate_delete_disposable_agency('00000000-0000-4000-8000-0000000000b9')$$, '42501', null, 'It refuses an agency that is not a gate agency');
select ok(exists (select 1 from public.agencies where id = '00000000-0000-4000-8000-0000000000b9'), 'The refused agency is untouched');

insert into public.whatsapp_webhook_events (agency_id, external_event_id, payload, signature_valid)
values ('00000000-0000-4000-8000-0000000000a9', 'gate-probe-event', '{}'::jsonb, true);
select lives_ok($$select public.gate_delete_disposable_agency('00000000-0000-4000-8000-0000000000a9')$$, 'A gate agency with a non-cascading child row is removed');
select ok(public.gate_disposable_agency_leftovers('00000000-0000-4000-8000-0000000000a9') = '[]'::jsonb, 'After removal nothing is left');

select * from finish();
rollback;
