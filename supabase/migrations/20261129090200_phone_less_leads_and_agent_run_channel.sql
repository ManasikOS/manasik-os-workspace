-- Phase 4 of docs/modules/messenger-instagram-ai-agent-implementation-plan.md: the AI agent on Messenger.
--
-- A. leads.preferred_channel may be INSTAGRAM or MESSENGER (finding F3). Until now a lead that only ever
--    wrote to the agency on Instagram was recorded as preferring WhatsApp, and follow-up automations would
--    pick the wrong channel.
-- B. agent_runs.channel, so turn latency, cost and outcomes can be sliced per channel — in particular the p95
--    turn latency against Meta's 30-second response rule for automated Pages/accounts.
--
-- Nothing here changes a column's meaning for WhatsApp. `leads.mobile` stays `text not null`: a lead from a
-- phone-less channel stores the empty string until the customer gives a number (finding F2). There is no
-- format CHECK or unique index on it (verified in 20260812100000_create_leads.sql and the tenancy migrations),
-- so '' is safe at the database level.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. leads.preferred_channel
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.leads drop constraint if exists leads_preferred_channel_check;
alter table public.leads
  add constraint leads_preferred_channel_check
  check (preferred_channel in ('WHATSAPP', 'CALL', 'EMAIL', 'SMS', 'IN_PERSON', 'INSTAGRAM', 'MESSENGER'));

-- ─────────────────────────────────────────────────────────────────────────────
-- B. agent_runs.channel
-- ─────────────────────────────────────────────────────────────────────────────
-- Defaults to WHATSAPP so every existing writer (which omits the column) keeps working unchanged and every
-- historical run is correctly attributed.
alter table public.agent_runs
  add column if not exists channel text not null default 'WHATSAPP';

alter table public.agent_runs drop constraint if exists agent_runs_channel_check;
alter table public.agent_runs
  add constraint agent_runs_channel_check check (channel in ('WHATSAPP', 'MESSENGER', 'INSTAGRAM'));

comment on column public.agent_runs.channel is
  'The channel the turn answered on. Latency per channel is read from here: p95(latency_ms) against 30 000 ms is the check for Meta''s 30-second response rule on automated Messenger/Instagram accounts.';

create index if not exists agent_runs_agency_channel_created_idx
  on public.agent_runs (agency_id, channel, created_at desc);
