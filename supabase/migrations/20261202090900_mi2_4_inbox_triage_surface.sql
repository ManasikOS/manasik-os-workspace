-- MI2.4 — S1 triage: the INBOX_TRIAGE surface and the rolling digest column.
--
-- 1. Seeds ai_surface_settings for surface INBOX_TRIAGE as SHADOW and DISABLED for every existing agency. Nothing runs
--    until someone switches it on (Architecture §6 S1, §16 R-decisions). The pipeline treats an agency with NO row as
--    off too (lib/inbox/intelligence/pipeline.ts) — lib/ai/budget.ts is permissive for a missing row, so the pipeline
--    must not lean on that for a surface that costs money. Agencies created later therefore stay off until seeded.
-- 2. conversation_intelligence.digest — the rolling ~400-token conversation digest S1 reads instead of the whole
--    thread, maintained incrementally (lib/inbox/intelligence/digest.ts). Internal input for the model: never shown to
--    staff as a fact and never sent to a customer.
--
-- Additive and idempotent. RLS is unchanged: both objects already sit behind their tables' existing policies.

insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select a.id, 'INBOX_TRIAGE', false, 'SHADOW'
from public.agencies a
on conflict (agency_id, surface) do nothing;

alter table public.conversation_intelligence
  add column if not exists digest text;

comment on column public.conversation_intelligence.digest is
  'Rolling conversation digest (~400 tokens, oldest turns dropped first) that the S1 triage prompt reads instead of the full thread. Model input only.';

notify pgrst, 'reload schema';

-- Rollback (commented — additive migration, not applied automatically):
-- alter table public.conversation_intelligence drop column if exists digest;
-- delete from public.ai_surface_settings where surface = 'INBOX_TRIAGE';
