-- ai_runs / ai_tool_calls — Phase 0 (P0.1) of
-- docs/modules/manasik-intelligence-build-roadmap.md: the unified telemetry table
-- every surface's AI call writes to, going forward.
--
-- Deliberately NEW tables, not an alteration of `agent_runs`/
-- `agent_tool_calls`. Those two have documented, unresolved schema drift
-- between their migration file (20260826090000_ai_agent.sql) and the live
-- database — see the header of
-- 20260919090000_departure_operations_agent.sql ("why this does not touch
-- agent_jobs / agent_runs / agent_tool_calls"): the live `agent_runs` has
-- `tier`/`role`/`model_requested`/`model_served`/`cost_usd`/`turn_count`,
-- not this repo's `model`/`effort`/`stop_reason` shape, and no migration in
-- this repo has ever been applied through tracked history against the
-- linked remote. The Departure Operations Agent already set the precedent
-- of sidestepping that dispute by writing to its own
-- `departure_ops_runs`/`departure_ops_tool_calls` (20260919090000) instead
-- of entangling itself with it. This migration follows the same
-- precedent for every AI surface built from Phase 1 onward: a clean table,
-- never touching `agent_runs`/`agent_tool_calls`, which the WhatsApp agent
-- keeps writing to exactly as it does today (lib/agent/kernel/telemetry.ts
-- is unchanged).
--
-- `surface` is deliberately free text, not a check constraint enum — every
-- module lag the platform has already hit (see
-- docs/modules/manasik-intelligence-implementation-plan.md §1.3 finding F5) came
-- from a hard-coded list of "every module that currently exists." A new
-- surface added in Phase 2+ must not require a migration just to be
-- nameable in its own telemetry row.

create table if not exists public.ai_runs (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null default public.current_agency_id() references public.agencies (id),

  surface               text not null,
  tier                  text,
  subject_type          text,
  subject_id            uuid,
  pack_fingerprint      text,

  model                 text not null,

  input_tokens          integer,
  output_tokens         integer,
  cache_read_tokens     integer,
  cache_creation_tokens integer,
  cost_usd              numeric(10, 4),

  latency_ms            integer,
  status                text not null check (status in ('OK', 'TOOL_ERROR', 'MODEL_ERROR', 'GUARDRAIL_BLOCKED', 'REFUSAL')),
  stop_reason           text,
  error                 text,

  created_at            timestamptz not null default now()
);

comment on table public.ai_runs is
  'One row per model call from any AI surface built from Phase 0 onward — the unified twin of the pre-existing (and drifted) agent_runs, which the WhatsApp agent keeps writing to unchanged. See this migration''s header.';

create index if not exists ai_runs_agency_idx on public.ai_runs (agency_id, created_at desc);
create index if not exists ai_runs_surface_idx on public.ai_runs (agency_id, surface, created_at desc);
create index if not exists ai_runs_subject_idx on public.ai_runs (subject_type, subject_id) where subject_id is not null;

alter table public.ai_runs enable row level security;

drop policy if exists "staff read ai_runs" on public.ai_runs;
create policy "staff read ai_runs" on public.ai_runs
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- Written only by server code through the admin/session client inside
-- `lib/ai/telemetry.ts` — same posture as `agent_proposals`/
-- `staff_notifications`: no insert policy for `authenticated` at all, so an
-- ordinary session can never write a run record for itself.

create table if not exists public.ai_tool_calls (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_agency_id() references public.agencies (id),
  ai_run_id      uuid not null references public.ai_runs (id) on delete cascade,

  tool_name      text not null,
  arguments      jsonb not null default '{}'::jsonb,
  result_summary text,
  is_error       boolean not null default false,
  latency_ms     integer,

  created_at     timestamptz not null default now()
);

comment on table public.ai_tool_calls is
  'One row per tool call within an ai_runs turn, arguments/results redacted per lib/ai/trust/redaction.ts before they ever reach this table.';

create index if not exists ai_tool_calls_run_idx on public.ai_tool_calls (ai_run_id);
create index if not exists ai_tool_calls_agency_idx on public.ai_tool_calls (agency_id);

alter table public.ai_tool_calls enable row level security;

drop policy if exists "staff read ai_tool_calls" on public.ai_tool_calls;
create policy "staff read ai_tool_calls" on public.ai_tool_calls
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- ai_action_history — one timeline across every AI-adjacent table this
-- repo can safely read (Plan §3.8). Deliberately excludes `agent_runs` /
-- `agent_tool_calls` / `agent_jobs` — the drifted trio this migration's
-- header explains — rather than unioning against a shape nobody here can
-- verify. `security_invoker` so the view carries no more access than the
-- underlying tables' own RLS already grants the caller.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.ai_action_history
  with (security_invoker = true) as
select
  r.id,
  r.agency_id,
  'AI_RUN'::text as event_type,
  r.surface,
  null::text as actor_name,
  r.status as summary,
  r.subject_type,
  r.subject_id,
  r.created_at as occurred_at
from public.ai_runs r
union all
select
  d.id,
  d.agency_id,
  'DEPARTURE_OPS_RUN'::text as event_type,
  'DEPARTURE_OPS'::text as surface,
  null::text as actor_name,
  d.status as summary,
  'DEPARTURE_GROUP'::text as subject_type,
  d.departure_group_id as subject_id,
  d.created_at as occurred_at
from public.departure_ops_runs d
union all
select
  e.id,
  e.agency_id,
  ('PROPOSAL_' || e.event)::text as event_type,
  null::text as surface,
  e.actor_name,
  e.event as summary,
  null::text as subject_type,
  e.proposal_id as subject_id,
  e.created_at as occurred_at
from public.agent_proposal_events e
union all
select
  o.id,
  o.agency_id,
  ('INSIGHT_' || o.outcome_type)::text as event_type,
  null::text as surface,
  o.actor_name,
  o.outcome_type as summary,
  'INSIGHT'::text as subject_type,
  o.insight_id as subject_id,
  o.created_at as occurred_at
from public.insight_outcomes o;

comment on view public.ai_action_history is
  'Cross-surface AI timeline for /ai-insights -> AI Action History. Unions ai_runs, departure_ops_runs, agent_proposal_events, insight_outcomes. Never agent_runs/agent_tool_calls/agent_jobs -- see this migration''s header.';

-- Rollback (commented — additive migration, not applied automatically):
-- drop view if exists public.ai_action_history;
-- drop table if exists public.ai_tool_calls;
-- drop table if exists public.ai_runs;

notify pgrst, 'reload schema';
