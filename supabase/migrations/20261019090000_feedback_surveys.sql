-- ─────────────────────────────────────────────────────────────────────────────
-- Feedback & Complaints (M12).
--
-- Complaints: per the plan's own note ("prefer support_cases with case_type
-- = COMPLAINT over a separate complaints table — decide at slice time"),
-- this agency already has `pilgrim_support_requests` (Support & Incidents,
-- supabase/migrations/20260813090000_create_pilgrims.sql) with exactly the
-- severity/priority/assignment/resolution workflow a complaint needs. Rather
-- than build a second, near-identical table, this migration only widens its
-- `category` check to add COMPLAINT — the intake queue, SLA and resolution
-- tracking already exist and are reused as-is.
--
-- Feedback: satisfaction surveys are a genuine gap — new surveys /
-- survey_questions / survey_responses / survey_answers below. Responses are
-- recorded by staff from feedback collected out-of-band (phone/WhatsApp/
-- post-trip call) — there is no pilgrim-facing portal to self-submit yet
-- (see supabase/migrations/20261018090000_pilgrim_portal_access.sql).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.pilgrim_support_requests drop constraint if exists pilgrim_support_requests_category_check;
alter table public.pilgrim_support_requests add constraint pilgrim_support_requests_category_check
  check (category in ('MOBILITY', 'MEDICAL', 'DIETARY', 'FLIGHT', 'ROOMING', 'DOCUMENT', 'PAYMENT', 'COMPLAINT', 'OTHER'));

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  title text not null,
  description text,
  trigger text not null default 'MANUAL' check (trigger in ('POST_TRIP', 'MANUAL')),
  is_active boolean not null default true,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.surveys is
  'A satisfaction survey definition. trigger is informational only here — no automatic post-trip dispatch exists yet, responses are recorded manually by staff.';

create index if not exists surveys_agency_idx on public.surveys (agency_id);

alter table public.surveys enable row level security;

drop policy if exists "staff read surveys" on public.surveys;
create policy "staff read surveys" on public.surveys
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write surveys" on public.surveys;
create policy "staff write surveys" on public.surveys
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  survey_id uuid not null references public.surveys (id) on delete cascade,

  question_text text not null,
  question_type text not null check (question_type in ('RATING_1_5', 'RATING_NPS_0_10', 'YES_NO', 'TEXT')),
  sort_order integer not null default 0,

  created_at timestamptz not null default now()
);

comment on table public.survey_questions is
  'One question on one survey. question_type determines how survey_answers.answer_rating vs answer_text is used.';

create index if not exists survey_questions_survey_idx on public.survey_questions (survey_id, sort_order);
create index if not exists survey_questions_agency_idx on public.survey_questions (agency_id);

alter table public.survey_questions enable row level security;

drop policy if exists "staff read survey_questions" on public.survey_questions;
create policy "staff read survey_questions" on public.survey_questions
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write survey_questions" on public.survey_questions;
create policy "staff write survey_questions" on public.survey_questions
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- survey_responses / survey_answers — one pilgrim's completed survey.
-- overall_score is a snapshot computed at submission from that response's
-- own RATING answers, not recomputed later — editing a past answer would
-- need a new response, not a rewrite of history.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  survey_id uuid not null references public.surveys (id),
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,
  departure_group_id uuid references public.departure_groups (id) on delete set null,

  overall_score numeric,
  recorded_by_name text not null,
  submitted_at timestamptz not null default now()
);

comment on table public.survey_responses is
  'One pilgrim''s completed survey, recorded by staff from feedback collected out-of-band.';

create index if not exists survey_responses_survey_idx on public.survey_responses (survey_id);
create index if not exists survey_responses_pilgrim_idx on public.survey_responses (pilgrim_id);
create index if not exists survey_responses_agency_idx on public.survey_responses (agency_id);

alter table public.survey_responses enable row level security;

drop policy if exists "staff read survey_responses" on public.survey_responses;
create policy "staff read survey_responses" on public.survey_responses
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write survey_responses" on public.survey_responses;
create policy "staff write survey_responses" on public.survey_responses
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

create table if not exists public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  response_id uuid not null references public.survey_responses (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id),

  answer_rating numeric,
  answer_text text,

  unique (response_id, question_id)
);

comment on table public.survey_answers is
  'One answer within one survey_responses row.';

create index if not exists survey_answers_response_idx on public.survey_answers (response_id);
create index if not exists survey_answers_agency_idx on public.survey_answers (agency_id);

alter table public.survey_answers enable row level security;

drop policy if exists "staff read survey_answers" on public.survey_answers;
create policy "staff read survey_answers" on public.survey_answers
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write survey_answers" on public.survey_answers;
create policy "staff write survey_answers" on public.survey_answers
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

notify pgrst, 'reload schema';
