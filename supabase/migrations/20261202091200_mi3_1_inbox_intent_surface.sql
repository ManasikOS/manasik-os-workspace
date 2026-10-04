-- MI3.1 — S2 structured travel intent: the INBOX_INTENT surface and the per-field evidence column.
--
-- 1. Seeds ai_surface_settings for surface INBOX_INTENT as SHADOW and DISABLED for every existing agency. Nothing runs until
--    someone switches it on. The pipeline treats an agency with NO row as off (lib/inbox/intelligence/pipeline.ts) —
--    lib/ai/budget.ts is permissive for a missing row, and this surface can spend money.
-- 2. conversation_intelligence.travel_intent_evidence — one entry per travel detail S2 read (journey, travellers, window,
--    room, hotelDistance, budget, origin): { source: RULES | LLM, value, evidence: [{ messageId, snippet }] }. TravelIntent
--    (the existing `travel_intent` column) has no slot for where the customer is travelling from and carries evidence only as
--    loose text, so the rail reads this instead. Shape validated by travelIntentEvidenceSchema on every read.
--
-- Additive and idempotent. RLS is unchanged: both objects sit behind their tables' existing policies.

insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select a.id, 'INBOX_INTENT', false, 'SHADOW'
from public.agencies a
on conflict (agency_id, surface) do nothing;

alter table public.conversation_intelligence
  add column if not exists travel_intent_evidence jsonb not null default '{}'::jsonb;

comment on column public.conversation_intelligence.travel_intent_evidence is
  'Per-field S2 readings: { <field>: { source: RULES|LLM, value, evidence: [{ messageId, snippet }] } }. Every value carries the customer words it came from.';

notify pgrst, 'reload schema';

-- Rollback (commented — additive migration, not applied automatically):
-- alter table public.conversation_intelligence drop column if exists travel_intent_evidence;
-- delete from public.ai_surface_settings where surface = 'INBOX_INTENT';
