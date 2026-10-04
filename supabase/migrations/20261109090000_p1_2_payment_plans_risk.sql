-- Phase 1 (P1.2) — Payment Plans: reminder queue + collection risk.
-- docs/modules/manasik-intelligence-build-roadmap.md §P1.2, plan §4.14.
--
-- Three new tables, all scoped through `booking_payment_milestones` /
-- `departure_group_bookings` exactly like the rest of the finance module
-- (see 20260818090000_finance_payments.sql) — RLS floor is `to authenticated
-- using (true)` on this module throughout; capability gating happens in
-- `lib/access/finance-access.ts` and `lib/data/finance-repository.ts` before
-- a row is ever fetched or written, not in Postgres policy.

-- ── milestone_change_events ────────────────────────────────────────────────
-- A structured, queryable log of every due-date change, separate from the
-- generic `finance_activity_events` feed (which stays as the human-readable
-- activity trail). This is what the Σ-milestones invariant check and the
-- collection-risk scorer's "rescheduled" factor read.
create table if not exists public.milestone_change_events (
  id                uuid primary key default gen_random_uuid(),
  milestone_id      uuid not null references public.booking_payment_milestones (id) on delete cascade,
  booking_id        uuid not null references public.departure_group_bookings (id) on delete cascade,
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  change_type       text not null default 'DUE_DATE_CHANGED'
                       check (change_type in ('DUE_DATE_CHANGED', 'WAIVED', 'AMOUNT_ADJUSTED')),
  due_at_from       timestamptz,
  due_at_to         timestamptz,
  amount_from       numeric(14, 2),
  amount_to         numeric(14, 2),
  reason            text not null,
  approver_id       uuid,
  approver_name     text not null,
  created_at        timestamptz not null default now()
);

create index if not exists milestone_change_events_milestone_idx on public.milestone_change_events (milestone_id);
create index if not exists milestone_change_events_booking_idx   on public.milestone_change_events (booking_id);

alter table public.milestone_change_events enable row level security;

drop policy if exists milestone_change_events_select on public.milestone_change_events;
create policy milestone_change_events_select on public.milestone_change_events
  for select to authenticated using (true);

drop policy if exists milestone_change_events_write on public.milestone_change_events;
create policy milestone_change_events_write on public.milestone_change_events
  for insert to authenticated with check (true);

-- ── payment_reminders ───────────────────────────────────────────────────────
-- Generated daily by the deterministic cadence rule in
-- `lib/finance/reminder-rules.ts` (T-3 / T0 / T+3 / T+10). Nothing in this
-- table is ever sent automatically — `status` starts at DRAFT and only
-- becomes SENT through a human action or an approved
-- `PAYMENT_REMINDER_SEND` proposal (Class 2, HIGH risk).
create table if not exists public.payment_reminders (
  id                uuid primary key default gen_random_uuid(),
  milestone_id      uuid not null references public.booking_payment_milestones (id) on delete cascade,
  booking_id        uuid not null references public.departure_group_bookings (id) on delete cascade,
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  offset_days       integer not null,
  channel           text not null default 'WHATSAPP' check (channel in ('WHATSAPP', 'EMAIL', 'SMS')),
  scheduled_for     timestamptz not null,
  status            text not null default 'DRAFT'
                       check (status in ('DRAFT', 'APPROVED', 'SENT', 'SKIPPED')),
  message           text,
  skip_reason       text,
  sent_at           timestamptz,
  approved_by       uuid,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One reminder per milestone per cadence step — the generator is safe to
  -- re-run daily without duplicating an already-queued reminder.
  constraint payment_reminders_milestone_offset_unique unique (milestone_id, offset_days)
);

create index if not exists payment_reminders_status_idx on public.payment_reminders (status, scheduled_for);
create index if not exists payment_reminders_booking_idx on public.payment_reminders (booking_id);

drop trigger if exists payment_reminders_set_updated_at on public.payment_reminders;
create trigger payment_reminders_set_updated_at
  before update on public.payment_reminders
  for each row execute function public.set_updated_at();

alter table public.payment_reminders enable row level security;

drop policy if exists payment_reminders_select on public.payment_reminders;
create policy payment_reminders_select on public.payment_reminders
  for select to authenticated using (true);

drop policy if exists payment_reminders_write on public.payment_reminders;
create policy payment_reminders_write on public.payment_reminders
  for all to authenticated using (true) with check (true);

-- ── booking_collection_risk ─────────────────────────────────────────────────
-- Materialised nightly by the (future) Finance review agent (P1.7) from the
-- pure scorer in `lib/finance/collection-risk.ts`. The Payment Plans page
-- computes the same score live from the milestones it already loads rather
-- than reading this table — this table exists so the score has a stable,
-- queryable history for the nightly agent and system signals to read, per
-- plan §4.14's "materialised daily" schema note.
create table if not exists public.booking_collection_risk (
  booking_id        uuid primary key references public.departure_group_bookings (id) on delete cascade,
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  score             numeric(5, 2) not null default 0 check (score >= 0 and score <= 100),
  band              text not null default 'LOW' check (band in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  factors           jsonb not null default '{}'::jsonb,
  computed_at       timestamptz not null default now()
);

create index if not exists booking_collection_risk_band_idx on public.booking_collection_risk (band);
create index if not exists booking_collection_risk_group_idx on public.booking_collection_risk (departure_group_id);

alter table public.booking_collection_risk enable row level security;

drop policy if exists booking_collection_risk_select on public.booking_collection_risk;
create policy booking_collection_risk_select on public.booking_collection_risk
  for select to authenticated using (true);

drop policy if exists booking_collection_risk_write on public.booking_collection_risk;
create policy booking_collection_risk_write on public.booking_collection_risk
  for all to authenticated using (true) with check (true);
