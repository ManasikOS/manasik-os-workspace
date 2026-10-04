-- Phase A: run using an authorized database audit connection. No mutations.
-- Results contain schema metadata, not traveller names/contact details.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';

select current_database() as database_name, current_user as audit_role,
       current_setting('server_version') as postgres_version,
       current_setting('TimeZone') as database_timezone, now() as captured_at;

-- A missing migration schema is an inventory failure, never "zero migrations".
select version from supabase_migrations.schema_migrations order by version;

select c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) as owner, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and (
  c.relname like 'departure_group%' or c.relname like 'finance_%'
  or c.relname like 'report_%' or c.relname in (
    'booking_payment_milestones','pilgrim_payment_milestones','payments','payment_allocations',
    'invoices','invoice_line_items','refund_requests','supplier_commitments','supplier_payments'))
order by c.relname;

select table_name, column_name, data_type, numeric_precision, numeric_scale,
       is_nullable, column_default, is_generated, generation_expression
from information_schema.columns
where table_schema = 'public' and (
  table_name like 'departure_group%' or table_name in (
    'booking_payment_milestones','pilgrim_payment_milestones','payments','payment_allocations',
    'invoices','invoice_line_items','refund_requests','supplier_commitments','supplier_payments'))
order by table_name, ordinal_position;

select c.relname as table_name, con.conname, con.contype,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and (c.relname like 'departure_group%' or c.relname in (
  'booking_payment_milestones','payments','payment_allocations','invoices','invoice_line_items','refund_requests'))
order by c.relname, con.conname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public' and (table_name like 'departure_group%' or table_name in (
  'payments','payment_allocations','booking_payment_milestones','invoices','refund_requests'))
order by table_name, grantee, privilege_type;

select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public' and (c.relname like 'departure_group%' or c.relname in (
  'payments','payment_allocations','booking_payment_milestones','invoices','invoice_line_items','refund_requests'))
order by c.relname, t.tgname;

select c.relname, pg_get_viewdef(c.oid, true) as definition
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v' and c.relname in (
  'departure_group_costing','departure_group_payment_summaries','finance_receivable_rows',
  'finance_invoice_rows','report_payment_facts','report_milestone_facts','report_group_facts');
rollback;
