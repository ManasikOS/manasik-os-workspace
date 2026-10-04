-- TASK-032 S4 / audit item D1 (docs/progress/2026-10-02-tenant-isolation-audit.md): take the table privileges away from `anon` and `authenticated`
-- on every table that has row-level security and NO policy, because those tables are meant to be reached by the server key only.
--
-- State before this migration (staging, checked 2026-10-02): twenty public tables have row-level security enabled and no policy, so no client
-- can read or write them. Twelve of them also had no table privileges for the client roles. The other eight still carried Supabase's default
-- grants to `anon` and `authenticated`, so the ONLY thing between a signed-in or anonymous caller and each of them was that nobody had written
-- a policy: one mistaken `create policy ... using (true)`, or one `alter table ... disable row level security`, would have exposed the rows.
--
--   already without client privileges (12): agency_smtp_settings, ai_conversation_meter_events, conversation_message_counters,
--     conversation_queue_counts, cron_route_calls, inbox_intake_states, inbox_reply_queue_agencies, message_delivery_status_buffer,
--     onboarding_events, outbox_messages, reply_intents, signup_attempts
--   granted by default until now (8): knowledge_chunks, pending_agency_signups, platform_admins, whatsapp_webhook_hits, and the four staging-only
--     package_content, package_faqs, package_media, package_seo_analyses (defined in no migration; skipped on a database that lacks them)
--
-- Why it is safe: the application reads and writes all twenty with the service role (webhooks, cron routes, the worker, server actions that use
-- the admin client); every database function that touches them is either security definer (provision_agency_from_signup, is_platform_admin,
-- check_webhook_rate_limit) or executable by the service role only (search_knowledge_chunks). No policy, view or invoker function that a client
-- role can run references any of them (checked against pg_policy, the view definitions and the function bodies). The service role keeps every
-- privilege, so nothing the server does changes. The four existing server-only grants are listed too so the whole set is stated in one place.
--
-- Rollback: `grant all on table public.<table> to anon, authenticated;` for the table concerned (do not, for the reasons above). Idempotent.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'agency_smtp_settings', 'ai_conversation_meter_events', 'conversation_message_counters', 'conversation_queue_counts',
    'cron_route_calls', 'inbox_intake_states', 'inbox_reply_queue_agencies', 'message_delivery_status_buffer',
    'onboarding_events', 'outbox_messages', 'reply_intents', 'signup_attempts',
    'knowledge_chunks', 'pending_agency_signups', 'platform_admins', 'whatsapp_webhook_hits',
    'package_content', 'package_faqs', 'package_media', 'package_seo_analyses'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', v_table);
    end if;
  end loop;
end;
$$;

-- Guard: none of them may still be reachable by a client role -----------------------------------------------------------------------------
do $$
declare
  v_reachable text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_reachable
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname = any (array[
       'agency_smtp_settings', 'ai_conversation_meter_events', 'conversation_message_counters', 'conversation_queue_counts',
       'cron_route_calls', 'inbox_intake_states', 'inbox_reply_queue_agencies', 'message_delivery_status_buffer',
       'onboarding_events', 'outbox_messages', 'reply_intents', 'signup_attempts',
       'knowledge_chunks', 'pending_agency_signups', 'platform_admins', 'whatsapp_webhook_hits',
       'package_content', 'package_faqs', 'package_media', 'package_seo_analyses'
     ])
     and (
       has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
       or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')
       or has_table_privilege('anon', c.oid, 'delete,truncate,trigger')
       or has_table_privilege('authenticated', c.oid, 'delete,truncate,trigger')
     );

  if v_reachable is not null then
    raise exception 'Tenant isolation: these server-only tables are still reachable by a client role: %', v_reachable;
  end if;
end;
$$;
