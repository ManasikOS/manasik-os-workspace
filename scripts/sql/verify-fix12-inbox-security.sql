-- FIX12 database verification. Run after applying Inbox migrations in a transaction; it deliberately rolls back.
-- The raised JSON names applied migrations, RLS coverage, invoker views, hardened definers, source composite keys and checks.
-- It inspects only relations and RPCs changed by the Inbox programme; it is not
-- a substitute for the project's full security-advisor review.
begin;
do $$
declare result jsonb;
begin
  select jsonb_build_object(
    'applied_inbox_migrations', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version between '20261202090000' and '20261202093700'),
    'rls_missing', (select jsonb_agg(relname order by relname) from pg_class where relnamespace = 'public'::regnamespace and relname in ('channel_jobs','conversation_intelligence','conversation_queue_membership','contact_identity_links','inbox_routing_policy','agency_payment_accounts','conversation_handoffs','conversation_answer_cache','message_media_analyses','inbox_autonomy_decisions','inbox_retention_sweeps','inbox_sla_policies') and not relrowsecurity),
    'invoker_views_missing', (select jsonb_agg(relname order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' and relname in ('inbox_intelligence_kpis_daily','inbox_gate_skip_reasons','inbox_lane_health','inbox_owner_kpis','inbox_language_kpis_daily') and not (coalesce(reloptions, '{}'::text[]) @> array['security_invoker=true'])),
    'unsafe_definers', (select jsonb_agg(proname order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enqueue_channel_job','claim_channel_jobs','complete_channel_job','fail_channel_job','release_stale_channel_jobs','inbox_queue_counts','record_conversation_answer_candidate','record_conversation_answer_cache_hit','reject_conversation_answer_cache_hit','set_inbox_autonomy_level','meter_ai_conversation','inbox_retention_candidate_conversations','recompute_conversation_commercial_projection') and (not prosecdef or not (coalesce(proconfig, '{}'::text[]) @> array['search_path=""']))),
    'missing_source_composite_fks', (select jsonb_agg(rel.relname order by rel.relname) from pg_class rel where rel.relnamespace = 'public'::regnamespace and relname in ('leads','lead_quotes','departure_group_bookings','departure_group_tasks','pilgrim_support_requests','pilgrims','booking_traveller_relationships','lead_notes') and (not exists (select 1 from pg_constraint c where c.conrelid = rel.oid and c.contype = 'f' and pg_get_constraintdef(c.oid) like '%FOREIGN KEY (source_conversation_id, agency_id)%') or not exists (select 1 from pg_constraint c where c.conrelid = rel.oid and c.contype = 'f' and pg_get_constraintdef(c.oid) like '%FOREIGN KEY (source_message_id, agency_id)%'))),
    'missing_source_pair_checks', (select jsonb_agg(rel.relname order by rel.relname) from pg_class rel where rel.relnamespace = 'public'::regnamespace and relname in ('leads','lead_quotes','departure_group_bookings','departure_group_tasks','pilgrim_support_requests','pilgrims','booking_traveller_relationships','lead_notes') and not exists (select 1 from pg_constraint c where c.conrelid = rel.oid and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%source_message_id IS NULL OR source_conversation_id IS NOT NULL%')),
    'missing_sla_minute_checks', (select jsonb_agg(column_name order by column_name) from (values ('first_reply_minutes', '%first_reply_minutes >= 1%first_reply_minutes <= 86400%'), ('resolution_minutes', '%resolution_minutes >= 1%resolution_minutes <= 86400%')) as expected(column_name, definition_pattern) where not exists (select 1 from pg_constraint c where c.conrelid = 'public.inbox_sla_policies'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike expected.definition_pattern))
  ) into result;
  raise exception 'VERIFY_FIX12 %', result::text;
end $$;
rollback;
