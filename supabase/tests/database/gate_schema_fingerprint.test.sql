begin;

-- TASK-032 (gate G15): public.gate_schema_fingerprint() reports one short hash per public-schema object, changes when an object changes, is
-- executable by the service role only, and returns names and hashes only. One transaction, rolled back. Expect zero rows from finish().

create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(not has_function_privilege('anon', 'public.gate_schema_fingerprint()', 'execute') and not has_function_privilege('authenticated', 'public.gate_schema_fingerprint()', 'execute') and has_function_privilege('service_role', 'public.gate_schema_fingerprint()', 'execute'),
  'Only the service role can run the fingerprint');

create temp table fingerprint_before on commit drop as select public.gate_schema_fingerprint() -> 'objects' as objects;
grant select on fingerprint_before to public;

select ok((select objects ? 'table:conversations' and objects ? 'constraint:conversations' and objects ? 'policy:conversations' and objects ? 'grant:conversations' and objects ? 'function:gate_schema_fingerprint()' from fingerprint_before),
  'It covers tables, constraints, policies, grants and functions');
select ok((select bool_and(value #>> '{}' ~ '^[0-9a-f]{10}$') from fingerprint_before, jsonb_each(objects)), 'Every value is a 10-character hash, never a definition or a value');
select ok((select public.gate_schema_fingerprint() -> 'objects' = objects from fingerprint_before), 'Asking twice gives the same answer');

alter table public.agencies add column fingerprint_probe text;
select isnt((select public.gate_schema_fingerprint() -> 'objects' ->> 'table:agencies'), (select objects ->> 'table:agencies' from fingerprint_before), 'Adding a column changes that table''s hash');
select is((select public.gate_schema_fingerprint() -> 'objects' ->> 'table:conversations'), (select objects ->> 'table:conversations' from fingerprint_before), 'and leaves other tables alone');

create policy fingerprint_probe_policy on public.agencies for select using (true);
select isnt((select public.gate_schema_fingerprint() -> 'objects' ->> 'policy:agencies'), (select objects ->> 'policy:agencies' from fingerprint_before), 'Adding a policy changes that table''s policy hash');

create index fingerprint_probe_idx on public.agencies (name);
select isnt((select public.gate_schema_fingerprint() -> 'objects' ->> 'index:agencies'), (select objects ->> 'index:agencies' from fingerprint_before), 'Adding an index changes that table''s index hash');

-- Whatever the table's privileges were, giving anon alone everything is a different set.
revoke all on public.agencies from anon, authenticated;
grant all on public.agencies to anon;
select isnt((select public.gate_schema_fingerprint() -> 'objects' ->> 'grant:agencies'), (select objects ->> 'grant:agencies' from fingerprint_before), 'Changing which roles hold table privileges changes the grant hash');

select * from finish();
rollback;
