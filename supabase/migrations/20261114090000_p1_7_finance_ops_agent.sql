-- Phase 1 (P1.7) — Nightly Finance review agent (SHADOW). docs/manasik-
-- intelligence-build-roadmap.md §P1.7, plan §3.11.
--
-- The agent's own code lives entirely under lib/ai/surfaces/finance/agent/
-- and reads/writes only through Phase 0's generic kernel (ai_runs,
-- agent_proposals, insights) — this migration is the small amount of
-- schema/data setup that work needs: room for a COPILOT-origin insight
-- with no single natural entity, and the ai_surface_settings row the
-- rollout plan requires to exist (disabled) before any agency can turn it
-- on.

-- `insight_subject_type_check` (widened once already in 20261107090000 for
-- BOOKING/QUOTE/REFUND_REQUEST/SUPPLIER/BANK_TRANSACTION) gains two more:
-- INVOICE (an insight naming one specific invoice) and AGENCY (an
-- agency-wide/period-level finding — e.g. "12 bank transactions
-- unmatched" — that has no single natural entity; subject_id is the
-- agency's own id in that case).
alter table public.insights drop constraint if exists insights_subject_type_check;
alter table public.insights add constraint insights_subject_type_check
  check (subject_type in (
    'LEAD', 'PILGRIM', 'DEPARTURE_GROUP', 'SURVEY_RESPONSE', 'AGENT', 'CAMPAIGN',
    'BOOKING', 'QUOTE', 'REFUND_REQUEST', 'SUPPLIER', 'BANK_TRANSACTION',
    'INVOICE', 'AGENCY'
  ));

-- Seed one FINANCE_OPS row per agency, disabled — mirrors
-- 20261108090000_ai_surface_settings.sql's seed for DEPARTURE_OPS/
-- WHATSAPP exactly. `enabled = false` until a human turns it on per
-- agency (plan §P1.7 rollout); `mode = 'SHADOW'` is what that human
-- graduates it out of once a week of SHADOW output has been reviewed.
insert into public.ai_surface_settings (agency_id, surface, enabled, mode)
select id, 'FINANCE_OPS', false, 'SHADOW'
from public.agencies
on conflict (agency_id, surface) do nothing;
