-- MI4.3 — model-assisted risk classification. docs/inbox/implementation-plan.md MI4.3.
--
-- Seeds ai_surface_settings for surface INBOX_RISK_MODEL as SHADOW and DISABLED for every existing agency. It is the on/off and the
-- spend cap for the ONE classify-tier call that reads the four judgement flags (complaint, fraud concern, medical urgency,
-- religious ruling) plus distress when the keyword rules cannot decide. Nothing calls a model until someone switches it on, and an
-- agency with no row is treated as OFF by the pipeline (lib/ai/budget.ts is permissive for a missing row, and this surface spends).
--
-- The plan's migration for this slice says "seed INBOX_RISK". INBOX_RISK was already seeded by 20261202091600 (MI4.1), where it
-- switches the free rule detectors on. The model call gets its OWN surface here so that turning the free detectors on can never
-- start spending: two switches, two budgets. INBOX_RISK stays as it is.
--
-- Additive and idempotent. No table changes; RLS is untouched (ai_surface_settings already has its policies).

insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select a.id, 'INBOX_RISK_MODEL', false, 'SHADOW'
from public.agencies a
on conflict (agency_id, surface) do nothing;

notify pgrst, 'reload schema';

-- Rollback (commented — additive migration, not applied automatically):
-- delete from public.ai_surface_settings where surface = 'INBOX_RISK_MODEL';
