-- FIX10: deterministic language buckets from stored conversation state, never model-generated totals.
create or replace view public.inbox_language_kpis_daily
with (security_invoker = true) as
select
  agency_id,
  (computed_at at time zone 'UTC')::date as day,
  coalesce(nullif(language_code, ''), 'unknown') as language_code,
  count(*)::integer as conversations
from public.conversation_intelligence
where state in ('FRESH', 'STALE')
group by agency_id, (computed_at at time zone 'UTC')::date, coalesce(nullif(language_code, ''), 'unknown');

revoke all on public.inbox_language_kpis_daily from anon;
grant select on public.inbox_language_kpis_daily to authenticated;
notify pgrst, 'reload schema';
