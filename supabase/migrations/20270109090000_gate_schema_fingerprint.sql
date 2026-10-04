-- TASK-032 (gate G15): a fingerprint of the public schema, so the go-live gate can tell whether a database really IS what the repository's migrations build.
--
-- Why. The gate's migration check (G2) compares migration NAMES. Staging passed it while missing two security protections and fifteen tables'
-- worth of tenant-uniqueness (migrations recorded as applied whose effect was not in the database; found only by building a database from nothing
-- and comparing, TASK-032 S5 and S6). A name match cannot see that. This function reports one short hash per object, so a clean rebuild of the
-- repository (the baseline, committed as supabase/schema-fingerprint.json) can be compared with any environment, and the gate can name what differs.
--
-- What is hashed, per object in the public schema (a hash is 10 hex characters, never a definition, never a value):
--   table:<t>       the columns (name, type, not-null, default, generated expression) and whether row-level security is on and forced
--   constraint:<t>  every constraint's definition
--   index:<t>       every index's definition
--   trigger:<t>     every non-internal trigger's definition
--   policy:<t>      every policy (name, command, roles, USING, WITH CHECK)
--   grant:<t>       the table privileges held by anon, authenticated and service_role
--   function:<f>    the full definition (body included) and whether anon / authenticated may execute it; objects owned by extensions are left out
--   view:<v>        the view's definition
--
-- Read-only, a new function only, executable by the service role only (the credential the gate already uses). Names and hashes only: no row of customer
-- data. Idempotent. Rollback: `drop function public.gate_schema_fingerprint();`

create or replace function public.gate_schema_fingerprint()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  tables as (
    select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  ),
  per_table as (
    select 'table:' || t.relname as k,
           (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ' ' || a.attgenerated::text,
                              E'\n' order by a.attname collate "C")
              from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped)
           || E'\nrls ' || t.relrowsecurity::text || ' ' || t.relforcerowsecurity::text as def
      from tables t
    union all
    select 'constraint:' || t.relname,
           string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), E'\n' order by c.conname collate "C")
      from tables t join pg_constraint c on c.conrelid = t.oid group by t.relname
    union all
    select 'index:' || t.relname,
           string_agg(pg_get_indexdef(i.indexrelid), E'\n' order by pg_get_indexdef(i.indexrelid) collate "C")
      from tables t join pg_index i on i.indrelid = t.oid group by t.relname
    union all
    select 'trigger:' || t.relname,
           string_agg(pg_get_triggerdef(g.oid), E'\n' order by g.tgname collate "C")
      from tables t join pg_trigger g on g.tgrelid = t.oid and not g.tgisinternal group by t.relname
    union all
    select 'policy:' || t.relname,
           string_agg(p.polname || ' ' || p.polcmd::text || ' ' || coalesce((select string_agg(r.rolname, ',' order by r.rolname collate "C") from pg_roles r where r.oid = any (p.polroles)), 'public')
                      || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                      E'\n' order by p.polname collate "C")
      from tables t join pg_policy p on p.polrelid = t.oid group by t.relname
    union all
    select 'grant:' || t.relname,
           coalesce((select string_agg(x.grantee_name || ' ' || x.privilege_type, E'\n' order by x.grantee_name collate "C", x.privilege_type collate "C")
                       from (select r.rolname as grantee_name, e.privilege_type
                               from aclexplode(coalesce(t.relacl, acldefault('r', (select relowner from pg_class where oid = t.oid)))) e
                               join pg_roles r on r.oid = e.grantee
                              where r.rolname in ('anon', 'authenticated', 'service_role')) x), '')
      from tables t
  ),
  per_function as (
    select 'function:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
           pg_get_functiondef(p.oid) || E'\nanon ' || has_function_privilege('anon', p.oid, 'execute')::text || E'\nauthenticated ' || has_function_privilege('authenticated', p.oid, 'execute')::text as def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  ),
  per_view as (
    select 'view:' || c.relname as k, pg_get_viewdef(c.oid) as def
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  ),
  everything as (
    select k, def from per_table where def is not null
    union all select k, def from per_function
    union all select k, def from per_view
  )
  select jsonb_build_object(
    'generated_at', now(),
    'objects', coalesce((select jsonb_object_agg(e.k, left(md5(e.def), 10) order by e.k collate "C") from everything e), '{}'::jsonb)
  );
$$;

revoke all on function public.gate_schema_fingerprint() from public, anon, authenticated;
grant execute on function public.gate_schema_fingerprint() to service_role;

comment on function public.gate_schema_fingerprint() is
  'One short hash per public-schema object (columns, constraints, indexes, triggers, policies, grants, functions, views) for the go-live gate (G15). Names and hashes only. service_role only.';
