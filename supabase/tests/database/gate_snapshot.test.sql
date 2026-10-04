begin;

-- TASK-032 S7: public.gate_snapshot() is read-only, callable by the service role only, and returns names and counts, never rows of customer
-- data. One transaction, rolled back. Expect zero rows from finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function('public', 'gate_snapshot', array[]::text[], 'gate_snapshot() exists');
select ok(not has_function_privilege('anon', 'public.gate_snapshot()', 'execute'), 'Anonymous callers cannot run it');
select ok(not has_function_privilege('authenticated', 'public.gate_snapshot()', 'execute'), 'Signed-in users cannot run it');
select ok(has_function_privilege('service_role', 'public.gate_snapshot()', 'execute'), 'The service role can run it');

set local role service_role;
select ok((select public.gate_snapshot() ?& array['generated_at','migrations','tenant_tables_without_rls','server_only_tables_with_client_privilege','unconditional_policies','buckets','storage_policies_without_agency_check','anon_executable_definer_functions','cron','inbox_health_last_success_at']), 'The snapshot has every key the gate reads');
select ok((select jsonb_typeof(public.gate_snapshot() -> 'migrations')) = 'array' and (select jsonb_array_length(public.gate_snapshot() -> 'migrations')) > 0, 'It lists the applied migrations by name');
select ok((select bool_and(jsonb_typeof(x) = 'string') from jsonb_array_elements(public.gate_snapshot() -> 'migrations') x), 'Every migration entry is a name, nothing else');
reset role;

-- A table without row-level security and with an agency_id column is reported, so the check is not vacuous ----------------------------------
create table public.gate_snapshot_probe (id int, agency_id uuid);
select ok((select public.gate_snapshot() -> 'tenant_tables_without_rls') @> '["gate_snapshot_probe"]'::jsonb, 'A tenant table without row-level security shows up in the snapshot');

-- ...and a public bucket is reported ----------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('gate-snapshot-probe', 'gate-snapshot-probe', true);
select ok((select public.gate_snapshot() -> 'buckets') @> '[{"id":"gate-snapshot-probe","public":true}]'::jsonb, 'A public bucket shows up in the snapshot with public = true');

select * from finish();
rollback;
