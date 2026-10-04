-- Phase 1 (P1.5) — Bookings canonical detail, blockers & inconsistency
-- analysis. docs/modules/manasik-intelligence-build-roadmap.md §P1.5, plan §4.5.
--
-- Deliberately does NOT widen `departure_group_bookings.booking_status`'s
-- check constraint to add CANCELLATION_REQUESTED/TRAVELLED/TRANSFERRED/
-- ARCHIVED (plan §4.5 gap 3). That enum is read by `bookingConsumesSeats()`
-- and every status badge/filter across the app (~20 files) — widening it
-- correctly means auditing every one of those call sites in the same pass,
-- which is its own slice's worth of risk. Instead this migration adds the
-- underlying columns as DERIVED state layered on the existing 5 statuses:
-- "cancellation requested" = `cancel_requested_at is not null and
-- booking_status <> 'CANCELLED'`; "transferred" =
-- `transferred_to_booking_id is not null`; "archived" = `archived_at is not
-- null`. `lib/bookings/status.ts` (application code, not this migration)
-- is where that derivation lives. TRAVELLED is left as a display-only
-- derivation (CONFIRMED + the group's own departure date has passed) —
-- nothing to store.

alter table public.departure_group_bookings
  add column if not exists cancel_requested_at     timestamptz,
  add column if not exists cancel_request_reason    text,
  add column if not exists archived_at                timestamptz,
  add column if not exists transferred_to_booking_id uuid references public.departure_group_bookings (id) on delete set null,
  add column if not exists sales_owner_id            uuid,
  add column if not exists operations_owner_id       uuid;

create index if not exists departure_group_bookings_cancel_requested_idx
  on public.departure_group_bookings (cancel_requested_at) where cancel_requested_at is not null;

-- ── booking_events ───────────────────────────────────────────────────────────
-- Structured audit for cancellation/transfer request → policy calc →
-- approval → execution (plan §4.5 gap 5) — separate from
-- `departure_group_activity_logs`'s free-text feed, same split as
-- `milestone_change_events` vs `finance_activity_events` in Phase 1 (P1.2).
create table if not exists public.booking_events (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null default public.current_agency_id() references public.agencies (id),
  booking_id       uuid not null references public.departure_group_bookings (id) on delete cascade,
  event_type       text not null check (event_type in (
                     'CANCELLATION_REQUESTED', 'CANCELLATION_APPROVED', 'CANCELLATION_EXECUTED', 'CANCELLATION_DECLINED',
                     'TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_EXECUTED',
                     'ARCHIVED', 'RESTORED'
                   )),
  from_value       text,
  to_value         text,
  reason           text,
  actor_id         uuid,
  actor_name       text not null,
  created_at       timestamptz not null default now()
);

create index if not exists booking_events_booking_idx on public.booking_events (booking_id, created_at desc);

alter table public.booking_events enable row level security;

drop policy if exists booking_events_select on public.booking_events;
create policy booking_events_select on public.booking_events
  for select to authenticated using (agency_id = public.current_agency_id());

drop policy if exists booking_events_write on public.booking_events;
create policy booking_events_write on public.booking_events
  for insert to authenticated with check (agency_id = public.current_agency_id());

-- ── booking_financial_snapshots ─────────────────────────────────────────────
-- One immutable row per confirmation (plan §4.5 gap 6) — captures the
-- figures that mattered at the moment a booking became CONFIRMED, so a
-- later price or milestone edit never rewrites what was true then.
create table if not exists public.booking_financial_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null default public.current_agency_id() references public.agencies (id),
  booking_id          uuid not null references public.departure_group_bookings (id) on delete cascade,
  taken_at            timestamptz not null default now(),
  reason              text not null default 'CONFIRMATION' check (reason in ('CONFIRMATION', 'MANUAL', 'TRANSFER')),
  package_price_per_person numeric(14, 2) not null,
  total_booking_value numeric(14, 2) not null,
  amount_paid         numeric(14, 2) not null,
  outstanding_balance numeric(14, 2) not null,
  traveller_count     integer not null,
  currency            text not null default 'LKR'
);

create index if not exists booking_financial_snapshots_booking_idx on public.booking_financial_snapshots (booking_id, taken_at desc);

alter table public.booking_financial_snapshots enable row level security;

drop policy if exists booking_financial_snapshots_select on public.booking_financial_snapshots;
create policy booking_financial_snapshots_select on public.booking_financial_snapshots
  for select to authenticated using (agency_id = public.current_agency_id());

drop policy if exists booking_financial_snapshots_write on public.booking_financial_snapshots;
create policy booking_financial_snapshots_write on public.booking_financial_snapshots
  for insert to authenticated with check (agency_id = public.current_agency_id());
