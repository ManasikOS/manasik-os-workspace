-- MI0.3 — observability baseline (docs/inbox/implementation-plan.md, Architecture §12).
--
-- The KPIs the Inbox programme is judged against must be queryable BEFORE the features they measure exist,
-- so the first answer is a truthful zero rather than a missing table. Three views, all `security_invoker`
-- so the caller's RLS on the base tables decides which rows they see (never a definer that could leak a tenant):
--
--   inbox_intelligence_kpis_daily  per (agency, UTC day): inbound volume, gate decisions, S0 skip rate,
--                                  Inbox AI cost and enriched conversations, cost per enriched conversation
--   inbox_lane_health              per (agency, lane): depth, in-flight, dead, oldest queued age.
--                                  Reads today's agent_jobs as lane 'LEGACY_AGENT'; MI1.1 replaces this view
--                                  (create or replace) to add channel_jobs' REALTIME/STANDARD/BULK lanes.
--   inbox_gate_skip_reasons        per (agency, day, decision, reason): how many messages the S0 gate skipped, and why
--
-- One deliberate addition to the plan's file list: inbox_gate_decisions, the append-only log the S0 gate
-- (MI2.3) writes to. A view needs a base table, and MI2.3's exit criterion is "every skip recorded with a
-- reason in inbox_gate_skip_reasons"; creating the empty table here keeps that view real from day one.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. inbox_gate_decisions — one row per S0 decision, written by the pipeline (service_role) only
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.inbox_gate_decisions (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null default public.current_agency_id() references public.agencies (id),
  conversation_id    uuid not null,
  message_id         uuid,
  decision           text not null check (decision in ('ENRICH', 'SKIP')),
  -- Free text here; MI2.3 constrains it to the GateReason list once that list exists in code.
  reason             text not null,
  escalate_to_risk   boolean not null default false,
  created_at         timestamptz not null default now(),

  foreign key (conversation_id) references public.conversations (id) on delete cascade
);

comment on table public.inbox_gate_decisions is
  'Append-only S0 gate log: one row per inbound message the intelligence pipeline evaluated. Feeds inbox_gate_skip_reasons and the s0_skip_rate KPI. Written by server code (service_role) only.';

create index if not exists inbox_gate_decisions_agency_day_idx on public.inbox_gate_decisions (agency_id, created_at desc);
create index if not exists inbox_gate_decisions_conversation_idx on public.inbox_gate_decisions (conversation_id, created_at desc);

alter table public.inbox_gate_decisions enable row level security;

drop policy if exists "staff read inbox_gate_decisions" on public.inbox_gate_decisions;
create policy "staff read inbox_gate_decisions" on public.inbox_gate_decisions
  for select to authenticated
  using (agency_id = public.current_agency_id());

-- No insert/update/delete policy for authenticated: only the pipeline (service_role) writes.

-- ─────────────────────────────────────────────────────────────────────────────
-- B. inbox_gate_skip_reasons
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.inbox_gate_skip_reasons
with (security_invoker = true) as
select d.agency_id,
       (d.created_at at time zone 'UTC')::date as day,
       d.decision,
       d.reason,
       count(*)::integer                       as decisions,
       count(*) filter (where d.escalate_to_risk)::integer as escalated_to_risk
  from public.inbox_gate_decisions d
 group by d.agency_id, (d.created_at at time zone 'UTC')::date, d.decision, d.reason;

comment on view public.inbox_gate_skip_reasons is
  'S0 gate decisions per agency, UTC day, decision and reason. security_invoker: RLS on inbox_gate_decisions applies to the caller.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. inbox_lane_health
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.inbox_lane_health
with (security_invoker = true) as
select j.agency_id,
       'LEGACY_AGENT'::text                                                      as lane,
       count(*) filter (where j.status = 'QUEUED')::integer                      as queued,
       count(*) filter (where j.status = 'RUNNING')::integer                     as running,
       count(*) filter (where j.status = 'FAILED')::integer                      as failed,
       count(*) filter (where j.status = 'DEAD')::integer                        as dead,
       coalesce(
         extract(epoch from (now() - min(j.run_after) filter (where j.status = 'QUEUED')))::integer,
         0
       )                                                                         as oldest_queued_age_seconds
  from public.agent_jobs j
 group by j.agency_id;

comment on view public.inbox_lane_health is
  'Queue depth and age per agency and lane. Today: agent_jobs as lane LEGACY_AGENT. MI1.1 re-creates this view to add channel_jobs lanes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. inbox_intelligence_kpis_daily
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.inbox_intelligence_kpis_daily
with (security_invoker = true) as
with inbound as (
  select m.agency_id,
         (m.created_at at time zone 'UTC')::date as day,
         count(*)::integer                       as inbound_messages
    from public.conversation_messages m
   where m.actor_kind = 'CUSTOMER'
   group by m.agency_id, (m.created_at at time zone 'UTC')::date
),
gate as (
  select g.agency_id,
         (g.created_at at time zone 'UTC')::date as day,
         count(*)::integer                                       as gate_evaluated,
         count(*) filter (where g.decision = 'SKIP')::integer    as gate_skipped
    from public.inbox_gate_decisions g
   group by g.agency_id, (g.created_at at time zone 'UTC')::date
),
usage as (
  select u.agency_id,
         u.day,
         sum(u.runs)::integer                    as ai_runs,
         sum(u.cost_usd)                         as ai_cost_usd,
         sum(u.conversations_enriched)::integer  as conversations_enriched
    from public.ai_usage_daily u
   where u.surface like 'INBOX\_%' escape '\'
   group by u.agency_id, u.day
),
keys as (
  select agency_id, day from inbound
  union select agency_id, day from gate
  union select agency_id, day from usage
)
select k.agency_id,
       k.day,
       coalesce(i.inbound_messages, 0)          as inbound_messages,
       coalesce(g.gate_evaluated, 0)            as gate_evaluated,
       coalesce(g.gate_skipped, 0)              as gate_skipped,
       case when coalesce(g.gate_evaluated, 0) = 0 then null
            else round(g.gate_skipped::numeric / g.gate_evaluated, 4) end as s0_skip_rate,
       coalesce(u.ai_runs, 0)                   as ai_runs,
       coalesce(u.ai_cost_usd, 0)               as ai_cost_usd,
       coalesce(u.conversations_enriched, 0)    as conversations_enriched,
       case when coalesce(u.conversations_enriched, 0) = 0 then null
            else round(u.ai_cost_usd / u.conversations_enriched, 6) end as cost_per_enriched_conversation_usd
  from keys k
  left join inbound i on i.agency_id = k.agency_id and i.day = k.day
  left join gate    g on g.agency_id = k.agency_id and g.day = k.day
  left join usage   u on u.agency_id = k.agency_id and u.day = k.day;

comment on view public.inbox_intelligence_kpis_daily is
  'Per agency and UTC day: inbound volume, S0 gate skip rate, Inbox-surface AI cost and cost per enriched conversation. Rates are null (not 0) when there is nothing to divide by. security_invoker.';
