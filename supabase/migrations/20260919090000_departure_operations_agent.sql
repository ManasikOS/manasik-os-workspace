-- Departure Operations Agent — Phase 1 schema. See
-- docs/modules/departure-operations-agent-implementation-plan.md §6.
--
-- This is the second agent on the platform, after the WhatsApp Sales Agent
-- (nominally 20260826090000_ai_agent.sql). It is not conversational: it
-- reads one departure group's operational state on a schedule and either
-- does internal work itself (a task, a note, a finding) or asks a human for
-- permission (a proposal).
--
-- IMPORTANT — why this does not touch agent_jobs / agent_runs / agent_tool_calls:
-- the original plan (D10) intended to reuse those three tables, adding two
-- job kinds and two columns. `supabase migration list` against this
-- project's linked remote shows every migration file in this repo with an
-- EMPTY "Remote" column — none of them were ever applied through tracked
-- migration history. Most modules were still hand-copied into the SQL
-- editor and match their migration file exactly (verified column-by-column:
-- departure_groups, leads, staff_profiles, packages, and every
-- departure_group_* table). The WhatsApp/AI-agent tables did not: the live
-- `agent_jobs` has `job_type`/`lease_until`, not `kind`/`locked_at`/
-- `locked_by`; the live `agent_runs` has `tier`/`role`/`model_requested`/
-- `model_served`/`cost_usd`/`turn_count`, not this repo's `model`/`effort`/
-- `stop_reason` design; and `ai_settings` does not exist in the live
-- database at all. All of it (agent_jobs, agent_runs, agent_tool_calls,
-- conversations, conversation_messages, booking_sessions) is empty — no
-- rows are at risk — but reconciling *why* three tables were built from a
-- different draft than what's in git, and fixing the `lib/agent/whatsapp/*`
-- code that already doesn't match either shape, is a separate, pre-existing
-- problem with the WhatsApp Sales Agent feature. It does not block, and
-- should not be entangled with, this migration.
--
-- So: this agent gets its own queue and run-log (§A/§B/§C below), never
-- touching the disputed tables, and `ai_settings` is created fresh here
-- (§D) — it is a pure addition, since nothing live conflicts with it.
--
-- Safe to run standalone against the live project as of 2026-09-19,
-- independent of whichever of 20260808090000…20260918090000 have or have
-- not actually been applied — it creates only tables/functions that do not
-- yet exist under these names.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. ai_settings — one row per agency. Created fresh (F-DRIFT above): it is
--    absent from the live database entirely. Shape matches
--    20260826090000_ai_agent.sql §A exactly, plus this migration's own
--    departure_ops_* columns (§ the plan's D10) — one singleton for every
--    agent's configuration, not a table per agent.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_settings (
  agency_id                      uuid primary key references public.agencies (id),
  enabled                        boolean not null default false,
  agent_name                     text not null default 'Assistant',
  persona_instructions           text not null default '',
  languages                      text[] not null default '{en}',
  tone                           text not null default 'FRIENDLY_PROFESSIONAL'
                                    check (tone in ('FRIENDLY_PROFESSIONAL', 'FORMAL', 'CONCISE')),

  lead_capture_enabled           boolean not null default true,
  booking_enabled                boolean not null default false,
  handoff_enabled                boolean not null default true,
  voice_enabled                  boolean not null default false,

  working_hours                  jsonb not null default '{}'::jsonb,
  out_of_hours_message           text not null default '',

  default_lead_owner_id          uuid references public.staff_profiles (id) on delete set null,
  seat_hold_hours                integer not null default 24 check (seat_hold_hours > 0),
  max_turns_per_conversation     integer not null default 40 check (max_turns_per_conversation > 0),
  escalate_after_failed_turns    integer not null default 3 check (escalate_after_failed_turns > 0),

  -- Departure Operations Agent configuration — a sibling set of columns on
  -- the same singleton, read together with the switches above on the one
  -- screen that edits AI configuration (D10 of this plan).
  departure_ops_enabled                 boolean not null default false,
  departure_ops_mode                    text not null default 'SHADOW'
                                           check (departure_ops_mode in ('OFF', 'SHADOW', 'PROPOSE', 'ACTIVE')),
  departure_ops_autonomy                jsonb not null default '{}'::jsonb,
  departure_ops_max_proposals_per_run   integer not null default 5
                                           check (departure_ops_max_proposals_per_run > 0),
  departure_ops_max_tasks_per_run       integer not null default 10
                                           check (departure_ops_max_tasks_per_run > 0),
  departure_ops_high_risk_roles         text[] not null default '{ADMIN,CEO}',
  departure_ops_rejection_cooldown_days integer not null default 14
                                           check (departure_ops_rejection_cooldown_days > 0),

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

-- 20260826090000 may already have created the shared settings table. `create
-- table if not exists` then leaves its newer departure-operations columns
-- absent, so add them explicitly before the comments, seeds, and policies
-- below reference them. These are no-ops on a fresh install.
alter table public.ai_settings add column if not exists departure_ops_enabled boolean not null default false;
alter table public.ai_settings add column if not exists departure_ops_mode text not null default 'SHADOW'
  check (departure_ops_mode in ('OFF', 'SHADOW', 'PROPOSE', 'ACTIVE'));
alter table public.ai_settings add column if not exists departure_ops_autonomy jsonb not null default '{}'::jsonb;
alter table public.ai_settings add column if not exists departure_ops_max_proposals_per_run integer not null default 5
  check (departure_ops_max_proposals_per_run > 0);
alter table public.ai_settings add column if not exists departure_ops_max_tasks_per_run integer not null default 10
  check (departure_ops_max_tasks_per_run > 0);
alter table public.ai_settings add column if not exists departure_ops_high_risk_roles text[] not null default '{ADMIN,CEO}';
alter table public.ai_settings add column if not exists departure_ops_rejection_cooldown_days integer not null default 14
  check (departure_ops_rejection_cooldown_days > 0);

comment on table public.ai_settings is
  'Per-agency AI configuration for every agent on the platform — persona/capability switches for the WhatsApp Sales Agent, departure_ops_* for the Departure Operations Agent. One inert row per agency, seeded below, so every read site can assume a row exists.';
comment on column public.ai_settings.departure_ops_mode is
  'OFF | SHADOW (runs the loop, writes nothing) | PROPOSE (Class-1 autonomous, Class-2 proposed) | ACTIVE. Per-group mode in departure_group_agent_state can override this for a single group — see D12.';

drop trigger if exists ai_settings_set_updated_at on public.ai_settings;
create trigger ai_settings_set_updated_at
  before update on public.ai_settings
  for each row execute function public.set_updated_at();

insert into public.ai_settings (agency_id)
select id from public.agencies
on conflict (agency_id) do nothing;

alter table public.ai_settings enable row level security;

drop policy if exists "staff read ai_settings" on public.ai_settings;
create policy "staff read ai_settings" on public.ai_settings
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

drop policy if exists "staff write ai_settings" on public.ai_settings;
create policy "staff write ai_settings" on public.ai_settings
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'));

-- ─────────────────────────────────────────────────────────────────────────────
-- B. departure_ops_jobs — this agent's own queue. Deliberately not
--    agent_jobs (see the header note): same shape and claim pattern as that
--    table's original design, scoped to the two job kinds this agent uses.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_ops_jobs (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id),
  kind           text not null check (kind in ('DEPARTURE_OPS_SWEEP', 'DEPARTURE_OPS_REVIEW')),
  payload        jsonb not null default '{}'::jsonb,

  status         text not null default 'QUEUED'
                   check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD')),
  attempts       integer not null default 0 check (attempts >= 0),
  max_attempts   integer not null default 3 check (max_attempts > 0),
  last_error     text,

  run_after      timestamptz not null default now(),
  locked_at      timestamptz,
  locked_by      text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.departure_ops_jobs is
  'The Departure Operations Agent''s job queue — DEPARTURE_OPS_SWEEP (fan-out) and DEPARTURE_OPS_REVIEW (one group). Drained the same way agent_jobs is: after() off the triggering write, swept by a cron for anything a cold start dropped.';

create index if not exists departure_ops_jobs_claim_idx on public.departure_ops_jobs (status, run_after);
create index if not exists departure_ops_jobs_agency_id_idx on public.departure_ops_jobs (agency_id);

-- F5 of the plan: coalesce duplicate queued reviews for the same group — a
-- burst of high-impact edits must enqueue one review, not one per edit.
create unique index if not exists departure_ops_jobs_queued_group_idx
  on public.departure_ops_jobs (agency_id, kind, (payload ->> 'groupId'))
  where status = 'QUEUED';

drop trigger if exists departure_ops_jobs_set_updated_at on public.departure_ops_jobs;
create trigger departure_ops_jobs_set_updated_at
  before update on public.departure_ops_jobs
  for each row execute function public.set_updated_at();

-- `SKIP LOCKED` has no PostgREST/supabase-js equivalent, so claiming due
-- jobs safely under concurrent cron invocations has to be a stored
-- procedure — mirrors public.claim_agent_jobs exactly, scoped to this
-- table. security definer so the service-role caller (no session, no
-- RLS-visible agency) can see and lock jobs across every agency in one pass.
create or replace function public.claim_departure_ops_jobs(p_worker_id text, p_limit integer)
returns setof public.departure_ops_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
    update public.departure_ops_jobs
    set status = 'RUNNING', locked_at = now(), locked_by = p_worker_id
    where id in (
      select id from public.departure_ops_jobs
      where status = 'QUEUED' and run_after <= now()
      order by run_after
      limit p_limit
      for update skip locked
    )
    returning *;
end;
$$;

comment on function public.claim_departure_ops_jobs(text, integer) is
  'Claims up to p_limit due departure_ops_jobs with FOR UPDATE SKIP LOCKED, so overlapping cron invocations never process the same job twice.';

revoke all on function public.claim_departure_ops_jobs(text, integer) from public, authenticated, anon;

alter table public.departure_ops_jobs enable row level security;

drop policy if exists "staff read departure_ops_jobs" on public.departure_ops_jobs;
create policy "staff read departure_ops_jobs" on public.departure_ops_jobs
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));
    
-- ─────────────────────────────────────────────────────────────────────────────
-- C. departure_ops_runs / departure_ops_tool_calls — this agent's own
--    observability, mirroring agent_runs / agent_tool_calls' original
--    design (model, effort, token/latency accounting, redacted tool
--    results) with two differences: every run is scoped to a group
--    (`departure_group_id not null`, this agent never runs without one),
--    and `status` includes 'NOOP' (D9 — the run found nothing new and
--    skipped the model call) and 'INCOMPLETE' (the run's wall-clock budget
--    ran out before `submit_review`) from the start.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_ops_runs (
  id                       uuid primary key default gen_random_uuid(),
  agency_id                uuid not null references public.agencies (id),
  departure_group_id       uuid not null references public.departure_groups (id) on delete cascade,
  job_id                   uuid references public.departure_ops_jobs (id) on delete set null,

  model                    text not null,
  effort                   text,

  input_tokens             integer,
  output_tokens            integer,
  cache_read_tokens        integer,
  cache_creation_tokens    integer,

  latency_ms               integer,
  status                   text not null
                             check (status in ('OK', 'TOOL_ERROR', 'MODEL_ERROR', 'GUARDRAIL_BLOCKED',
                                               'REFUSAL', 'NOOP', 'INCOMPLETE')),
  stop_reason              text,
  error                    text,

  created_at               timestamptz not null default now()
);

comment on table public.departure_ops_runs is
  'One row per Departure Operations Agent review — cost, latency and outcome. Every row is scoped to the group it reviewed.';

create index if not exists departure_ops_runs_agency_id_idx on public.departure_ops_runs (agency_id, created_at desc);
create index if not exists departure_ops_runs_group_idx on public.departure_ops_runs (departure_group_id, created_at desc);

create table if not exists public.departure_ops_tool_calls (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies (id),
  agent_run_id       uuid not null references public.departure_ops_runs (id) on delete cascade,
  tool_name          text not null,
  arguments          jsonb not null default '{}'::jsonb,
  -- A redacted summary only, never the full result payload — mirrors
  -- agent_tool_calls' own posture (§7.2 of the WhatsApp plan).
  result_summary     text,
  is_error           boolean not null default false,
  latency_ms         integer,
  created_at         timestamptz not null default now()
);

comment on table public.departure_ops_tool_calls is
  'One row per tool call inside a departure_ops_runs row. result_summary is redacted.';

create index if not exists departure_ops_tool_calls_run_idx on public.departure_ops_tool_calls (agent_run_id);
create index if not exists departure_ops_tool_calls_agency_id_idx on public.departure_ops_tool_calls (agency_id);

alter table public.departure_ops_runs enable row level security;
alter table public.departure_ops_tool_calls enable row level security;

drop policy if exists "staff read departure_ops_runs" on public.departure_ops_runs;
create policy "staff read departure_ops_runs" on public.departure_ops_runs
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

drop policy if exists "staff read departure_ops_tool_calls" on public.departure_ops_tool_calls;
create policy "staff read departure_ops_tool_calls" on public.departure_ops_tool_calls
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- D. departure_group_agent_state — one row per group: the scheduler's
--    memory (D9, D11). `next_run_at` is what the sweep selects on;
--    `last_fingerprint`/`last_tier` are what let a review skip the model
--    call when nothing material has changed.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_agent_state (
  departure_group_id      uuid primary key references public.departure_groups (id) on delete cascade,
  agency_id                uuid not null references public.agencies (id),

  mode                     text not null default 'INHERIT'
                             check (mode in ('INHERIT', 'OFF', 'SHADOW', 'PROPOSE', 'ACTIVE')),

  last_run_at              timestamptz,
  next_run_at              timestamptz not null default now(),
  last_fingerprint         text,
  last_tier                text,
  consecutive_noop_runs    integer not null default 0 check (consecutive_noop_runs >= 0),

  -- A human can mute a group the agent is being unhelpful about, without
  -- disabling it agency-wide.
  suppressed_until         timestamptz,
  suppressed_by            uuid references auth.users (id) on delete set null,
  suppressed_reason        text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.departure_group_agent_state is
  'One row per departure group — the Departure Operations Agent scheduler''s memory. Not agent output; nothing here is shown to a customer or supplier.';
comment on column public.departure_group_agent_state.mode is
  'INHERIT defers to ai_settings.departure_ops_mode. Any other value overrides it for this one group — how a pilot rolls out on a single group before an agency-wide change.';

create index if not exists dg_agent_state_due_idx
  on public.departure_group_agent_state (next_run_at)
  where mode <> 'OFF';
create index if not exists dg_agent_state_agency_idx
  on public.departure_group_agent_state (agency_id);

drop trigger if exists dg_agent_state_set_updated_at on public.departure_group_agent_state;
create trigger dg_agent_state_set_updated_at
  before update on public.departure_group_agent_state
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- E. agent_proposals / agent_proposal_events — the approval queue and its
--    append-only decision trail (D4–D7). Named generically (not
--    "departure_ops_proposals") because this subsystem is shared kernel
--    infrastructure — every future agent that needs human approval for an
--    external commitment reuses it, not just this one (§2 of the plan).
--
-- A proposal is never executed by the agent. A human approves it, and only
-- then does an executor run — under that human's own actor and capability
-- set — the same *InStore mutator a manual click in Departure Groups
-- already runs. This table exists to carry the ask, the evidence for it,
-- and what must still be true when a human acts on it; it never becomes a
-- second way to write a departure group.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_proposals (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies (id),
  departure_group_id    uuid not null references public.departure_groups (id) on delete cascade,
  agent_run_id          uuid references public.departure_ops_runs (id) on delete set null,

  -- A closed set of kinds (D5) — validated against a Zod schema per kind in
  -- application code; the CHECK here is the same closed-set backstop every
  -- status/kind column in this schema already carries.
  kind                  text not null,
  payload               jsonb not null,
  required_capability   text not null,
  risk                  text not null check (risk in ('LOW', 'MEDIUM', 'HIGH')),

  -- What a human reads. Written by the agent, never re-derived at render
  -- time — the proposal must still make sense after the world has moved on.
  title                 text not null,
  rationale             text not null,
  human_diff            jsonb not null default '[]'::jsonb,
  evidence              jsonb not null default '[]'::jsonb,
  draft_body            text,

  -- D6/F8: what must still be true at approval time. Re-checked against a
  -- fresh snapshot before the executor runs; a mismatch supersedes the
  -- proposal instead of executing it.
  dependency_keys       text[] not null default '{}',
  dependency_hash       text not null,

  -- D7: dedupe + rejection cooldown, scoped to one open proposal per
  -- (group, fingerprint) by the partial unique index below.
  fingerprint           text not null,

  status                text not null default 'PROPOSED'
                          check (status in ('PROPOSED', 'APPROVED', 'EXECUTED', 'REJECTED',
                                            'SUPERSEDED', 'EXPIRED', 'FAILED')),
  expires_at            timestamptz not null,

  decided_by            uuid references auth.users (id) on delete set null,
  decided_by_name       text,
  decided_at            timestamptz,
  decision_note         text,
  executed_at           timestamptz,
  execution_error       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.agent_proposals is
  'The approval queue every agent on the platform that needs human sign-off writes into. Never executed by the agent that wrote it — see docs/modules/departure-operations-agent-implementation-plan.md D4.';
comment on column public.agent_proposals.required_capability is
  'A key of DepartureGroupCapabilities (lib/access/departure-groups-access.ts). Checked against the approving human''s role before the executor runs — RLS is the floor, the Server Action is the gate (F7).';

create unique index if not exists agent_proposals_open_fingerprint_idx
  on public.agent_proposals (departure_group_id, fingerprint)
  where status in ('PROPOSED', 'APPROVED');
create index if not exists agent_proposals_queue_idx
  on public.agent_proposals (agency_id, status, risk, created_at desc);
create index if not exists agent_proposals_group_idx
  on public.agent_proposals (departure_group_id, status);

drop trigger if exists agent_proposals_set_updated_at on public.agent_proposals;
create trigger agent_proposals_set_updated_at
  before update on public.agent_proposals
  for each row execute function public.set_updated_at();

create table if not exists public.agent_proposal_events (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies (id),
  proposal_id   uuid not null references public.agent_proposals (id) on delete cascade,
  event         text not null check (event in ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED',
                                               'EXPIRED', 'EXECUTED', 'EXECUTION_FAILED', 'EDITED')),
  actor_id      uuid references auth.users (id) on delete set null,
  actor_name    text not null default 'System',
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.agent_proposal_events is
  'Append-only decision trail for agent_proposals — the record that a human approved a supplier commitment. Survives the proposal being superseded or edited. No update or delete policy exists for any role (§G).';

create index if not exists agent_proposal_events_proposal_idx
  on public.agent_proposal_events (proposal_id, created_at);
create index if not exists agent_proposal_events_agency_idx
  on public.agent_proposal_events (agency_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. departure_group_agent_findings — the risk register. What the agent
--    concluded, and which deterministic blocker or readiness item
--    corroborates it (§11's corroboration guardrail) — an uncorroborated
--    finding is dropped before it ever reaches this table.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_agent_findings (
  id                        uuid primary key default gen_random_uuid(),
  agency_id                 uuid not null references public.agencies (id),
  departure_group_id        uuid not null references public.departure_groups (id) on delete cascade,
  agent_run_id               uuid not null references public.departure_ops_runs (id) on delete cascade,

  severity                  text not null check (severity in ('CRITICAL', 'WARNING', 'INFO')),
  category                  text not null check (category in ('FLIGHT', 'HOTEL', 'TRANSPORT', 'VISA',
                                                              'DOCUMENTS', 'ROOMING', 'PAYMENTS',
                                                              'GUIDE', 'MANIFEST')),
  headline                  text not null,
  detail                    text not null,

  -- Corroboration: the id of the buildBlockers() blocker or readiness item
  -- this finding restates the cause of. Null is allowed only for severity
  -- INFO — an advisory observation with nothing in the deterministic data
  -- to point at.
  corroborating_blocker_id  text,
  linked_task_id            uuid references public.departure_group_tasks (id) on delete set null,
  linked_proposal_id        uuid references public.agent_proposals (id) on delete set null,

  created_at                timestamptz not null default now(),

  constraint dg_agent_findings_corroboration check (
    severity = 'INFO' or corroborating_blocker_id is not null
  )
);

comment on table public.departure_group_agent_findings is
  'The Departure Operations Agent''s risk register — one row per finding per run. Every CRITICAL/WARNING row names the deterministic blocker or readiness item it corroborates; the agent never gets to assert a problem the real data does not already show.';

create index if not exists dg_agent_findings_group_idx
  on public.departure_group_agent_findings (departure_group_id, created_at desc);
create index if not exists dg_agent_findings_run_idx
  on public.departure_group_agent_findings (agent_run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Row Level Security — departure_group_agent_state, agent_proposals,
--    agent_proposal_events, departure_group_agent_findings.
--
-- All four carry `agency_id = current_agency_id()` on every policy, per the
-- tenancy retrofit. Select access mirrors the Departure Groups module's own
-- viewModule roles (every one of the 7 roles); GUIDE is further scoped to
-- their assigned groups via staff_assigned_to_group(), the same helper
-- 20260903090000_departure_group_guide_scoping.sql wires into the core
-- departure_group_* tables. agent_proposal_events has no join-aware path to
-- a group yet (its only edge is proposal_id), so it is left un-scoped to
-- GUIDE for now — a guide reads findings on their group, not the approval
-- history behind them.
--
-- Every write to all four tables is service-role only in this migration —
-- there is no agent yet to write proposals or findings, and no approval
-- Server Action yet to update a proposal. Phase 3 (the executor registry
-- and the approve/reject Server Actions) adds the authenticated UPDATE
-- policy on agent_proposals once there is a caller for it.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_agent_state enable row level security;
alter table public.agent_proposals enable row level security;
alter table public.agent_proposal_events enable row level security;
alter table public.departure_group_agent_findings enable row level security;

drop policy if exists "staff read dg_agent_state" on public.departure_group_agent_state;
create policy "staff read dg_agent_state" on public.departure_group_agent_state
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA', 'GUIDE')
    and (not public.staff_role_in('GUIDE') or public.staff_assigned_to_group(departure_group_id))
  );

drop policy if exists "staff read agent_proposals" on public.agent_proposals;
create policy "staff read agent_proposals" on public.agent_proposals
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA', 'GUIDE')
    and (not public.staff_role_in('GUIDE') or public.staff_assigned_to_group(departure_group_id))
  );

drop policy if exists "staff read agent_proposal_events" on public.agent_proposal_events;
create policy "staff read agent_proposal_events" on public.agent_proposal_events
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA')
  );

drop policy if exists "staff read dg_agent_findings" on public.departure_group_agent_findings;
create policy "staff read dg_agent_findings" on public.departure_group_agent_findings
  for select to authenticated
  using (
    agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'FINANCE', 'MARKETING', 'OPERATIONS', 'VISA', 'GUIDE')
    and (not public.staff_role_in('GUIDE') or public.staff_assigned_to_group(departure_group_id))
  );
