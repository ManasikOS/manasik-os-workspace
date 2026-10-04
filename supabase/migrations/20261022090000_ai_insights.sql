-- ─────────────────────────────────────────────────────────────────────────────
-- AI Insights (M15) — insight / evidence / outcome model, deterministic
-- generators only.
--
-- "AI Insights" here means rule-based analysis over existing data, not an
-- LLM call: each generator in lib/insights/generators/*.ts is a pure
-- function reading current rows (leads, survey_responses, consent fields,
-- …) and deciding whether a situation is worth surfacing. Nothing here
-- calls a model — the name matches the brief, the implementation is
-- deterministic so every insight is explainable and reproducible.
--
-- insights are deduplicated by (insight_type, subject_type, subject_id):
-- re-running a generator against an unchanged situation is a no-op rather
-- than a duplicate row, and once an insight already has an outcome
-- (acknowledged/dismissed/resolved) it will not be silently reopened by the
-- next run — see lib/insights/service.ts.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  insight_type text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  title text not null,
  description text not null,

  subject_type text not null check (subject_type in ('LEAD', 'PILGRIM', 'DEPARTURE_GROUP', 'SURVEY_RESPONSE', 'AGENT')),
  subject_id uuid not null,

  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED')),
  generator_version text not null,

  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (agency_id, insight_type, subject_type, subject_id)
);

comment on table public.insights is
  'One surfaced situation from a deterministic rule generator. Unique per (insight_type, subject), so re-running generators upserts rather than duplicates.';

create index if not exists insights_agency_idx on public.insights (agency_id);
create index if not exists insights_status_idx on public.insights (status) where status = 'OPEN';

alter table public.insights enable row level security;

drop policy if exists "staff read insights" on public.insights;
create policy "staff read insights" on public.insights
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write insights" on public.insights;
create policy "staff write insights" on public.insights
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- insight_evidence — the specific data points that justified an insight, so
-- a reader never has to trust the title/description alone.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.insight_evidence (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  insight_id uuid not null references public.insights (id) on delete cascade,

  label text not null,
  detail text not null,

  created_at timestamptz not null default now()
);

comment on table public.insight_evidence is
  'One supporting fact for an insight (e.g. "Last contacted 14 days ago").';

create index if not exists insight_evidence_insight_idx on public.insight_evidence (insight_id);
create index if not exists insight_evidence_agency_idx on public.insight_evidence (agency_id);

alter table public.insight_evidence enable row level security;

drop policy if exists "staff read insight_evidence" on public.insight_evidence;
create policy "staff read insight_evidence" on public.insight_evidence
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write insight_evidence" on public.insight_evidence;
create policy "staff write insight_evidence" on public.insight_evidence
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- insight_outcomes — an append-only record of what staff actually did about
-- an insight. insights.status is the current state; this is the history of
-- how it got there (a staff member's own note, not a generator's).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.insight_outcomes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  insight_id uuid not null references public.insights (id) on delete cascade,

  outcome_type text not null check (outcome_type in ('ACKNOWLEDGED', 'ACTED_ON', 'DISMISSED', 'FALSE_POSITIVE', 'RESOLVED')),
  note text,
  actor_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.insight_outcomes is
  'Append-only log of staff actions taken against one insight.';

create index if not exists insight_outcomes_insight_idx on public.insight_outcomes (insight_id, created_at desc);
create index if not exists insight_outcomes_agency_idx on public.insight_outcomes (agency_id);

alter table public.insight_outcomes enable row level security;

drop policy if exists "staff read insight_outcomes" on public.insight_outcomes;
create policy "staff read insight_outcomes" on public.insight_outcomes
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write insight_outcomes" on public.insight_outcomes;
create policy "staff write insight_outcomes" on public.insight_outcomes
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'));

notify pgrst, 'reload schema';
