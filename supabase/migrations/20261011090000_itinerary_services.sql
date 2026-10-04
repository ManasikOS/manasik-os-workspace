-- Itinerary & Services (docs/architecture/remaining-modules-master-plan.md, Phase B4).
--
-- A departure group's package snapshot already freezes a day-by-day
-- itinerary at the moment the group was created
-- (departure_group_package_snapshots.itinerary_snapshot, jsonb, immutable —
-- see lib/data/departure-groups.ts's DepartureGroupPackageSnapshot). That is
-- the commercial promise, not an operational plan: it has no supplier
-- confirmation, no guide assignment, no distinction between an internal
-- instruction and what a pilgrim is told, and it never changes even when
-- reality does (a Ziyarah moved a day, a supplier fell through).
--
-- This migration adds the group's actual, live operational itinerary as a
-- new, additive set of tables. It does not touch itinerary_snapshot or any
-- existing table.
--
-- Scoped narrowly on purpose: itineraries -> itinerary_days ->
-- itinerary_events, with per-event supplier/guide confirmation and a
-- pilgrim-visible flag. Per-pilgrim attendance and voucher generation are
-- deferred — see the module's implementation notes.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. itineraries — one per departure group. Draft until explicitly published;
--    a pilgrim (portal, future work) must only ever see a published one.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.itineraries (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null default public.current_agency_id()
                        references public.agencies (id),
  departure_group_id  uuid not null unique
                        references public.departure_groups (id) on delete cascade,
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT', 'PUBLISHED')),
  published_at        timestamptz,
  published_by        uuid references auth.users (id) on delete set null,
  published_by_name   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.itineraries is
  'One live operational itinerary per departure group — separate from the frozen itinerary_snapshot on departure_group_package_snapshots. Draft until published; only a published itinerary is meant to ever be pilgrim-visible.';

create index if not exists itineraries_agency_idx on public.itineraries (agency_id);

drop trigger if exists itineraries_set_updated_at on public.itineraries;
create trigger itineraries_set_updated_at
  before update on public.itineraries
  for each row execute function public.set_updated_at();

alter table public.itineraries enable row level security;

drop policy if exists "staff read itineraries" on public.itineraries;
create policy "staff read itineraries" on public.itineraries
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write itineraries" on public.itineraries;
create policy "staff write itineraries" on public.itineraries
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- B. itinerary_days — one row per day of the trip.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.itinerary_days (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_agency_id()
                   references public.agencies (id),
  itinerary_id   uuid not null references public.itineraries (id) on delete cascade,
  day_number     integer not null check (day_number > 0),
  date           date,
  city           text not null default 'OTHER'
                   check (city in ('MAKKAH', 'MADINAH', 'MINA', 'ARAFAT', 'OTHER')),
  title          text not null default '',
  created_at     timestamptz not null default now(),

  constraint itinerary_days_number_unique unique (itinerary_id, day_number)
);

comment on table public.itinerary_days is
  'One day of a departure group''s live itinerary. day_number is the display order; date is filled in once the group''s actual departure date is confirmed.';

create index if not exists itinerary_days_itinerary_idx on public.itinerary_days (itinerary_id, day_number);
create index if not exists itinerary_days_agency_idx on public.itinerary_days (agency_id);

alter table public.itinerary_days enable row level security;

drop policy if exists "staff read itinerary_days" on public.itinerary_days;
create policy "staff read itinerary_days" on public.itinerary_days
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write itinerary_days" on public.itinerary_days;
create policy "staff write itinerary_days" on public.itinerary_days
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. itinerary_events — the actual activity/service line. departure_group_id
--    is denormalized from the parent day/itinerary so cross-group queries
--    (this module's list screen) and RLS never need to walk the join.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.itinerary_events (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null default public.current_agency_id()
                         references public.agencies (id),
  itinerary_day_id     uuid not null references public.itinerary_days (id) on delete cascade,
  departure_group_id   uuid not null references public.departure_groups (id) on delete cascade,
  sort_order           integer not null default 0,
  start_time           time,
  title                text not null default '',
  event_type           text not null default 'OTHER'
                         check (event_type in ('ZIYARAH', 'MEAL', 'TRANSPORT', 'HOTEL_CHECK_IN',
                                                'HOTEL_CHECK_OUT', 'FLIGHT', 'FREE_TIME', 'BRIEFING', 'OTHER')),
  location             text,
  guide_name           text,
  supplier_name        text,
  -- Optional links into the group's own confirmed transport/accommodation,
  -- so a Ziyarah's transport line can point at the real movement instead of
  -- a free-text duplicate of it.
  transport_id         uuid references public.departure_group_transports (id) on delete set null,
  accommodation_id     uuid references public.departure_group_accommodations (id) on delete set null,
  confirmed            boolean not null default false,
  capacity             integer check (capacity is null or capacity >= 0),
  internal_notes       text,
  -- What a pilgrim is told, if this event is visible to them at all. Kept
  -- separate from internal_notes on purpose — an internal instruction must
  -- never leak into a pilgrim-facing view by accident.
  pilgrim_facing_notes text,
  visible_to_pilgrims  boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.itinerary_events is
  'One activity/service line within an itinerary day. visible_to_pilgrims + pilgrim_facing_notes are the only fields a future pilgrim portal may ever read from this table; internal_notes and guide/supplier detail are staff-only.';

create index if not exists itinerary_events_day_idx on public.itinerary_events (itinerary_day_id, sort_order);
create index if not exists itinerary_events_group_idx on public.itinerary_events (departure_group_id);
create index if not exists itinerary_events_agency_idx on public.itinerary_events (agency_id);
create index if not exists itinerary_events_unconfirmed_idx on public.itinerary_events (departure_group_id)
  where not confirmed;

drop trigger if exists itinerary_events_set_updated_at on public.itinerary_events;
create trigger itinerary_events_set_updated_at
  before update on public.itinerary_events
  for each row execute function public.set_updated_at();

alter table public.itinerary_events enable row level security;

drop policy if exists "staff read itinerary_events" on public.itinerary_events;
create policy "staff read itinerary_events" on public.itinerary_events
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write itinerary_events" on public.itinerary_events;
create policy "staff write itinerary_events" on public.itinerary_events
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

notify pgrst, 'reload schema';
