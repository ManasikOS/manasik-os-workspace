-- Tenant-isolation audit (TASK-029 P2.4). READ-ONLY: every statement is a select, and the behavioural test runs in a transaction
-- that is rolled back. Run it in the Supabase SQL editor against staging (and later production) after every migration batch.
-- Each query says what a clean result looks like. Record the output in docs/progress/, never customer data.
--
-- The app is multi-tenant with one shared set of environment variables, so row-level security and the application code are the only
-- things separating agencies. A finding here is a cross-agency exposure until proven otherwise.

-- 1. Every tenant table (one with an agency_id column) has row-level security on.
--    Clean: tables_without_rls is null. rls_on_but_no_policy lists tables only the server key can reach: review each, expect them to
--    be server-only tables.
with tenant_tables as (
  select c.oid, c.relname, c.relrowsecurity as rls_on
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'agency_id' and not a.attisdropped)
)
select (select count(*) from tenant_tables) as tenant_tables,
       (select array_agg(relname order by relname) from tenant_tables where not rls_on) as tables_without_rls,
       (select array_agg(t.relname order by t.relname) from tenant_tables t
          where t.rls_on and not exists (select 1 from pg_policy p where p.polrelid = t.oid)) as rls_on_but_no_policy,
       (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as public_tables_without_rls;

-- 1b. Server-only tables (row-level security on, no policy) must also have no table privilege for `anon` or `authenticated`.
--    With no policy the rows are already unreachable; the privilege is the second lock, so one mistaken `using (true)` policy or a
--    disabled row-level security cannot expose them (TASK-032 S4, audit item D1).
--    Clean: no rows. A row is a table that is server-only today but still carries a default grant: revoke it, or add the policy it needs.
select c.relname as server_only_table_with_client_privilege
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
   and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
   and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
        or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')
        or has_table_privilege('anon', c.oid, 'delete,truncate,trigger')
        or has_table_privilege('authenticated', c.oid, 'delete,truncate,trigger'))
 order by 1;

-- 2. No policy on a public table is unconditionally true. A "true" policy for a signed-in user lets every agency, and every portal
--    login, read or write every row, and it cannot be narrowed by any other policy (policies are OR-ed).
--    Clean: only genuinely global reference tables appear (for example country defaults and model rates).
select c.relname as tbl, p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end as cmd,
       exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'agency_id' and not a.attisdropped) as has_agency_id
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relnamespace = 'public'::regnamespace
  and (pg_get_expr(p.polqual, p.polrelid) in ('true', '(true)') or pg_get_expr(p.polwithcheck, p.polrelid) in ('true', '(true)'))
order by c.relname, p.polname;

-- 3. Storage: every bucket is private, and every policy that names a tenant bucket also checks the agency folder.
--    Clean: no row with public = true; no policy in the second list.
select id as bucket, public from storage.buckets where public order by id;

select p.policyname, p.cmd, p.roles::text as roles
from pg_policies p
where p.schemaname = 'storage' and p.tablename = 'objects'
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'bucket_id = ''(pilgrim-documents|whatsapp-media|inbox-attachments|content-vault|payment-proofs|supplier-evidence|agency-assets|knowledge-base)'''
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%current_agency_id%'
order by p.policyname;

-- 4. Privileged (security definer) functions: none may be callable by anon, each must fix its search_path, and the list of those
--    callable by signed-in users must be reviewed for an internal agency check. Clean: anon_exec is false on every row.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       (p.proconfig is not null and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')) as search_path_fixed
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
order by anon_exec desc, p.proname;

-- 5. Behavioural test. Replace the user id with a signed-in user who belongs to NO agency (find one with:
--      select u.id from auth.users u where not exists (select 1 from public.agency_members m where m.user_id = u.id);
--    run that first, separately, because the role switch below cannot read auth.users). Everything below must be 0 for such a user,
--    and a user in agency A must see 0 rows of agency B. Nothing is written; the transaction is rolled back.
--    Clean: every count is 0 and current_agency is null.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"sub":"<USER-ID-WITH-NO-AGENCY>","role":"authenticated"}', true);
-- select (select count(*) from storage.objects where bucket_id = 'pilgrim-documents') as pilgrim_documents,
--        (select count(*) from storage.objects where bucket_id = 'inbox-attachments') as inbox_attachments,
--        (select count(*) from storage.objects where bucket_id = 'payment-proofs') as payment_proofs,
--        (select count(*) from storage.objects where bucket_id = 'content-vault') as content_vault,
--        (select count(*) from public.conversations) as conversations,
--        (select count(*) from public.conversation_messages) as messages,
--        (select count(*) from public.agencies) as agencies,
--        (select public.current_agency_id()) as current_agency;
-- rollback;
