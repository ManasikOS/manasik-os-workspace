create or replace view public.inbox_owner_kpis
with (security_invoker = true) as
select
  q.agency_id,
  count(distinct q.conversation_id) filter (where q.queue_code = 'NEW_ENQUIRIES')::bigint as new_enquiries,
  count(distinct q.conversation_id) filter (where q.queue_code = 'QUALIFIED')::bigint as qualified_opportunities,
  count(distinct q.conversation_id) filter (where q.queue_code = 'BOOKING_READY')::bigint as booking_ready,
  count(distinct q.conversation_id) filter (where q.queue_code = 'NEEDS_REPLY')::bigint as awaiting_staff_reply,
  count(distinct q.conversation_id) filter (where q.queue_code = 'NEARING_DEADLINE')::bigint as nearing_channel_deadline,
  count(distinct q.conversation_id) filter (where q.queue_code in ('DOCUMENTS','VISA_ISSUES'))::bigint as document_visa_escalations,
  count(distinct q.conversation_id) filter (where q.queue_code = 'RESOLVED')::bigint as ai_safe_resolutions,
  count(distinct i.conversation_id) filter (where i.kind = 'PAYMENT_CLAIM' and i.status in ('OPEN','ACKNOWLEDGED'))::bigint as payment_claims_needing_verification,
  count(distinct i.conversation_id) filter (where i.status in ('OPEN','ACKNOWLEDGED'))::bigint as human_interventions_required,
  count(distinct s.conversation_id) filter (where s.signal_code = 'GROUP_BOOKING_12_PLUS' and s.superseded_at is null)::bigint as high_value_group_enquiries
from public.conversation_queue_membership q
left join public.conversation_interventions i on i.agency_id = q.agency_id and i.conversation_id = q.conversation_id
left join public.conversation_signals s on s.agency_id = q.agency_id and s.conversation_id = q.conversation_id
group by q.agency_id;

revoke all on public.inbox_owner_kpis from anon;
grant select on public.inbox_owner_kpis to authenticated;

notify pgrst, 'reload schema';
