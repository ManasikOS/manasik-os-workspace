begin;

-- TASK-032 S4 / audit item D1: the twenty server-only tables (row-level security on, no policy) cannot be reached by `anon` or `authenticated`,
-- the server key still can, and no new table slips through. Everything runs in one transaction and is rolled back. Expect zero rows from
-- finish() when every assertion passes.

create extension if not exists pgtap with schema extensions;
select plan(10);

-- 1. The named tables that exist: row-level security on and no policy ----------------------------------------------------------------------
select is_empty(
  $$select c.relname
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname = any (array['agency_smtp_settings','ai_conversation_meter_events','conversation_message_counters','conversation_queue_counts','cron_route_calls','inbox_intake_states','inbox_reply_queue_agencies','message_delivery_status_buffer','onboarding_events','outbox_messages','reply_intents','signup_attempts','knowledge_chunks','pending_agency_signups','platform_admins','whatsapp_webhook_hits','package_content','package_faqs','package_media','package_seo_analyses'])
       and (not c.relrowsecurity or exists (select 1 from pg_policy p where p.polrelid = c.oid))$$,
  'Every server-only table has row-level security on and no policy');

-- 2. ...and no privilege for the client roles ---------------------------------------------------------------------------------------------
select is_empty(
  $$select c.relname
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname = any (array['agency_smtp_settings','ai_conversation_meter_events','conversation_message_counters','conversation_queue_counts','cron_route_calls','inbox_intake_states','inbox_reply_queue_agencies','message_delivery_status_buffer','onboarding_events','outbox_messages','reply_intents','signup_attempts','knowledge_chunks','pending_agency_signups','platform_admins','whatsapp_webhook_hits','package_content','package_faqs','package_media','package_seo_analyses'])
       and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references') or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')
            or has_table_privilege('anon', c.oid, 'delete,truncate,trigger') or has_table_privilege('authenticated', c.oid, 'delete,truncate,trigger'))$$,
  'No server-only table carries a privilege for anon or authenticated');

-- 3. The general rule, so a NEW table cannot slip through: row-level security on and no policy means no client privilege --------------------
select is_empty(
  $$select c.relname
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
       and (has_any_column_privilege('anon', c.oid, 'select,insert,update,references') or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references'))$$,
  'Any public table with row-level security and no policy has no client privilege (add a policy or revoke the grant)');

-- 4. A signed-in user is refused outright, not merely shown nothing ------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$select count(*) from public.outbox_messages$$, '42501', null, 'A signed-in user cannot read the outbox');
select throws_ok($$select count(*) from public.platform_admins$$, '42501', null, 'A signed-in user cannot read the list of platform operators');
select throws_ok($$select count(*) from public.pending_agency_signups$$, '42501', null, 'A signed-in user cannot read pending agency sign-ups');
select throws_ok($$select count(*) from public.knowledge_chunks$$, '42501', null, 'A signed-in user cannot read knowledge chunks directly');

-- 5. An anonymous caller likewise ----------------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select count(*) from public.whatsapp_webhook_hits$$, '42501', null, 'An anonymous caller cannot read webhook rate-limit rows');
reset role;

-- 6. The server key is unaffected, and the security-definer helper that reads a server-only table still works for a signed-in user -----------
set local role service_role;
select lives_ok($$select count(*) from public.outbox_messages$$, 'The service role can still read the outbox');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select results_eq($$select public.is_platform_admin()$$, array[false], 'is_platform_admin still answers for a signed-in user, because it runs with its owner''s rights');
reset role;

select * from finish();
rollback;
