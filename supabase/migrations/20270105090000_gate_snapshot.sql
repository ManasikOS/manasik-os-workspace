-- TASK-032 S7: a read-only snapshot of the facts the production go-live gate checks in the database, returned as one JSON document.
--
-- The gate (`npm run verify:production`) needs to know which migrations are applied, whether the tenant-isolation rules hold, whether the
-- scheduled jobs are healthy and whether the storage buckets are private. Those facts live in system catalogues and in schemas the API does
-- not expose (supabase_migrations, cron, storage policies), and the gate should not need a raw database password to read them. This function
-- gathers them with the owner's rights, changes nothing, and is executable by the service role only, so the credential the gate already uses
-- for the application is enough.
--
-- What it returns carries NAMES and COUNTS only (migration names, table names, bucket names, job states): no row of customer data, no secret.
-- The checks mirror scripts/sql/verify-tenant-isolation.sql so the gate and the manual audit cannot drift apart.
--
-- Safe to apply: a new read-only function, no table or policy change. Idempotent.
-- Rollback: `drop function public.gate_snapshot();`

create or replace function public.gate_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'generated_at', now(),

    -- Applied migration names, oldest first. The gate compares them by NAME with the repository's files.
    'migrations', coalesce((select jsonb_agg(m.name order by m.version) from supabase_migrations.schema_migrations m where m.name is not null), '[]'::jsonb),

    -- 1. A table with an agency_id column and row-level security off.
    'tenant_tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
         and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'agency_id' and not a.attisdropped)
    ), '[]'::jsonb),

    -- 1b. A server-only table (row-level security on, no policy) that a client role can still reach.
    'server_only_tables_with_client_privilege', coalesce((
      select jsonb_agg(c.relname order by c.relname)
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
         and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
         and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
              or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')
              or has_table_privilege('anon', c.oid, 'delete,truncate,trigger')
              or has_table_privilege('authenticated', c.oid, 'delete,truncate,trigger'))
    ), '[]'::jsonb),

    -- 2. A policy that is unconditionally true, other than on the two genuinely global reference tables.
    'unconditional_policies', coalesce((
      select jsonb_agg(c.relname || '.' || p.polname order by c.relname, p.polname)
        from pg_policy p join pg_class c on c.oid = p.polrelid
       where c.relnamespace = 'public'::regnamespace
         and c.relname not in ('ai_model_rates', 'country_locale_defaults')
         and (pg_get_expr(p.polqual, p.polrelid) in ('true', '(true)') or pg_get_expr(p.polwithcheck, p.polrelid) in ('true', '(true)'))
    ), '[]'::jsonb),

    -- 3. Storage buckets (all of them, with their visibility) and any policy on a tenant bucket that lacks an agency check.
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'public', b.public) order by b.id) from storage.buckets b), '[]'::jsonb),
    'storage_policies_without_agency_check', coalesce((
      select jsonb_agg(p.policyname order by p.policyname)
        from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'bucket_id = ''(pilgrim-documents|whatsapp-media|inbox-attachments|content-vault|payment-proofs|supplier-evidence|agency-assets|knowledge-base)'''
         and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%current_agency_id%'
    ), '[]'::jsonb),

    -- 4. A security-definer function in public that anonymous callers can execute.
    'anon_executable_definer_functions', coalesce((
      select jsonb_agg(p.proname order by p.proname)
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    ), '[]'::jsonb),

    -- 5. Scheduled jobs, as cron_job_health() reports them, and when the Inbox health check last succeeded.
    'cron', coalesce((select jsonb_agg(jsonb_build_object('jobname', h.jobname, 'state', h.state, 'reason', h.reason, 'last_success_at', h.last_success_at) order by h.jobname) from public.cron_job_health() h), '[]'::jsonb),
    'inbox_health_last_success_at', (
      select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'inbox-health' and d.status = 'succeeded'
    )
  );
$$;

revoke all on function public.gate_snapshot() from public, anon, authenticated;
grant execute on function public.gate_snapshot() to service_role;

comment on function public.gate_snapshot() is
  'Read-only facts for the production go-live gate (TASK-032 S7): applied migration names, tenant-isolation findings, bucket visibility, cron health. Names and counts only. service_role only.';
