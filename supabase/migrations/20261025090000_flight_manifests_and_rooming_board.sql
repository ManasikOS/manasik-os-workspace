-- ─────────────────────────────────────────────────────────────────────────────
-- Flight manifests, baggage rules — the two things the Flights slice
-- (Phase B) deliberately deferred: "per-flight passenger manifests/baggage
-- rules are deferred — see implementation notes."
--
-- A passenger can't be pinned to "the group's flight" with one column,
-- because a group typically has at least two flights (OUTBOUND + RETURN)
-- and sometimes more (a rebooked leg kept for history). A junction table —
-- departure_group_pilgrim_flights — lets one traveller sit on several
-- flights cleanly, which a single flight_id column on
-- departure_group_pilgrims could not.
--
-- Rooming board: departure_group_rooms already exists per accommodation;
-- what's missing is a cross-group view of it (all rooms, especially
-- PARTIAL ones, across every hotel/group at once) — no new table, purely
-- additive on the read side (lib/data/hotels-repository.ts).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.departure_group_flights
  add column if not exists baggage_allowance_kg integer;
alter table public.departure_group_flights
  add column if not exists baggage_notes text;

create table if not exists public.departure_group_pilgrim_flights (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  departure_group_pilgrim_id uuid not null references public.departure_group_pilgrims (id) on delete cascade,
  flight_id uuid not null references public.departure_group_flights (id) on delete cascade,

  assigned_at timestamptz not null default now(),
  assigned_by_name text,

  unique (departure_group_pilgrim_id, flight_id)
);

comment on table public.departure_group_pilgrim_flights is
  'Which travellers are on which flight — a junction, not a column on departure_group_pilgrims, since one traveller sits on more than one flight (outbound, return, and any rebooked leg kept for history).';

create index if not exists departure_group_pilgrim_flights_flight_idx
  on public.departure_group_pilgrim_flights (flight_id);
create index if not exists departure_group_pilgrim_flights_pilgrim_idx
  on public.departure_group_pilgrim_flights (departure_group_pilgrim_id);
create index if not exists departure_group_pilgrim_flights_agency_idx
  on public.departure_group_pilgrim_flights (agency_id);

alter table public.departure_group_pilgrim_flights enable row level security;

drop policy if exists "staff read departure_group_pilgrim_flights" on public.departure_group_pilgrim_flights;
create policy "staff read departure_group_pilgrim_flights" on public.departure_group_pilgrim_flights
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write departure_group_pilgrim_flights" on public.departure_group_pilgrim_flights;
create policy "staff write departure_group_pilgrim_flights" on public.departure_group_pilgrim_flights
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'OPERATIONS', 'VISA'));

notify pgrst, 'reload schema';
