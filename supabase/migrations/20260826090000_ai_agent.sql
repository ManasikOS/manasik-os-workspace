-- AI Agent configuration and observability — the agent's persona/capability
-- switches, every model turn it ran, every tool it called, and the booking
-- state machine that keeps its write access bounded. See
-- docs/modules/whatsapp-ai-agent-implementation-plan.md §5.2/§8/§9.
--
-- Safe on a database with 20260808…20260825 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. ai_settings — one row per agency (D10: a separate table from
--    agency_settings, not more columns bolted onto that 60-column singleton
--    — AI configuration changes on a different cadence and is edited by a
--    different screen).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_settings (
  agency_id                      uuid primary key references public.agencies (id),
  enabled                        boolean not null default false,
  agent_name                     text not null default 'Assistant',
  persona_instructions            text not null default '',
  languages                      text[] not null default '{en}',
  tone                           text not null default 'FRIENDLY_PROFESSIONAL'
                                    check (tone in ('FRIENDLY_PROFESSIONAL', 'FORMAL', 'CONCISE')),

  lead_capture_enabled            boolean not null default true,
  booking_enabled                 boolean not null default false,
  handoff_enabled                 boolean not null default true,
  voice_enabled                   boolean not null default false,

  working_hours                  jsonb not null default '{}'::jsonb,
  out_of_hours_message            text not null default '',

  default_lead_owner_id           uuid references public.staff_profiles (id) on delete set null,
  seat_hold_hours                 integer not null default 24 check (seat_hold_hours > 0),
  max_turns_per_conversation      integer not null default 40 check (max_turns_per_conversation > 0),
  escalate_after_failed_turns     integer not null default 3 check (escalate_after_failed_turns > 0),

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

comment on table public.ai_settings is
  'Per-agency AI Agent configuration — persona, capability switches, escalation thresholds. See D10.';

drop trigger if exists ai_settings_set_updated_at on public.ai_settings;
create trigger ai_settings_set_updated_at
  before update on public.ai_settings
  for each row execute function public.set_updated_at();

-- One inert row per agency so every read site can assume a row exists
-- rather than null-checking — mirrors the agency_settings seeding pattern.
insert into public.ai_settings (agency_id)
select id from public.agencies
on conflict (agency_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. agent_runs / agent_tool_calls — one row per model turn, one row per
--    tool call inside it. The observability floor §14 of the plan reads.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_runs (
  id                       uuid primary key default gen_random_uuid(),
  agency_id                uuid not null references public.agencies (id),
  conversation_id          uuid references public.conversations (id) on delete set null,
  job_id                   uuid references public.agent_jobs (id) on delete set null,
  model                    text not null,
  effort                   text,

  input_tokens             integer,
  output_tokens            integer,
  cache_read_tokens        integer,
  cache_creation_tokens    integer,

  latency_ms               integer,
  status                   text not null
                             check (status in ('OK', 'TOOL_ERROR', 'MODEL_ERROR', 'GUARDRAIL_BLOCKED', 'REFUSAL')),
  stop_reason              text,
  error                    text,

  created_at               timestamptz not null default now()
);

comment on table public.agent_runs is
  'One row per model turn — cost, latency and outcome. See §14 of the plan.';

create index if not exists agent_runs_agency_id_idx on public.agent_runs (agency_id, created_at desc);
create index if not exists agent_runs_conversation_id_idx on public.agent_runs (conversation_id);

create table if not exists public.agent_tool_calls (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies (id),
  agent_run_id       uuid not null references public.agent_runs (id) on delete cascade,
  tool_name          text not null,
  arguments          jsonb not null default '{}'::jsonb,
  -- A redacted summary only, never the full result payload — tool results
  -- carry pilgrim data and there is no reason to duplicate it here.
  result_summary     text,
  is_error           boolean not null default false,
  latency_ms         integer,
  created_at         timestamptz not null default now()
);

comment on table public.agent_tool_calls is
  'One row per tool call inside an agent_run. result_summary is redacted — see §7.2 of the plan.';

create index if not exists agent_tool_calls_agent_run_id_idx on public.agent_tool_calls (agent_run_id);
create index if not exists agent_tool_calls_agency_id_idx on public.agent_tool_calls (agency_id);
create index if not exists agent_tool_calls_tool_name_idx on public.agent_tool_calls (agency_id, tool_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. booking_sessions — the state machine §9 of the plan describes. The
--    model conducts the conversation; this table decides what step is
--    actually permitted next.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.booking_sessions (
  id                      uuid primary key default gen_random_uuid(),
  agency_id               uuid not null references public.agencies (id),
  conversation_id         uuid not null references public.conversations (id) on delete cascade,
  lead_id                 uuid references public.leads (id) on delete set null,
  departure_group_id      uuid references public.departure_groups (id) on delete set null,

  current_step            text not null default 'START'
                            check (current_step in (
                              'START', 'SELECT_DEPARTURE', 'CHECK_AVAILABILITY', 'COLLECT_LEAD',
                              'COLLECT_TRAVELLERS', 'REVIEW', 'AWAIT_CONFIRMATION', 'CREATED', 'ABANDONED'
                            )),
  travellers              integer check (travellers is null or travellers > 0),
  room_preference         text,
  collected               jsonb not null default '{}'::jsonb,
  confirmation_text       text,

  booking_id              uuid references public.departure_group_bookings (id) on delete set null,
  status                  text not null default 'ACTIVE' check (status in ('ACTIVE', 'CREATED', 'ABANDONED')),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.booking_sessions is
  'The AI booking state machine — see §9 of the plan. Only one ACTIVE session per conversation (partial unique index below).';

create unique index if not exists booking_sessions_active_per_conversation
  on public.booking_sessions (conversation_id)
  where status = 'ACTIVE';
create index if not exists booking_sessions_agency_id_idx on public.booking_sessions (agency_id);

drop trigger if exists booking_sessions_set_updated_at on public.booking_sessions;
create trigger booking_sessions_set_updated_at
  before update on public.booking_sessions
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Row Level Security.
--
-- ai_settings / knowledge visibility into how the agent is configured:
-- ADMIN, CEO, MARKETING may read; only ADMIN writes. Observability
-- (agent_runs/agent_tool_calls) is ADMIN/CEO read-only, written only by the
-- service-role agent runtime. booking_sessions follows the Inbox posture —
-- the same roles that can see conversations can see the booking in progress
-- inside one.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ai_settings enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.booking_sessions enable row level security;

drop policy if exists "staff read ai_settings" on public.ai_settings;
create policy "staff read ai_settings" on public.ai_settings
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

drop policy if exists "staff write ai_settings" on public.ai_settings;
create policy "staff write ai_settings" on public.ai_settings
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN'));

drop policy if exists "staff read agent_runs" on public.agent_runs;
create policy "staff read agent_runs" on public.agent_runs
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

drop policy if exists "staff read agent_tool_calls" on public.agent_tool_calls;
create policy "staff read agent_tool_calls" on public.agent_tool_calls
  for select to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

drop policy if exists "staff read booking_sessions" on public.booking_sessions;
create policy "staff read booking_sessions" on public.booking_sessions
  for select to authenticated
  using (agency_id = public.current_agency_id()
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'FINANCE', 'VISA'));
