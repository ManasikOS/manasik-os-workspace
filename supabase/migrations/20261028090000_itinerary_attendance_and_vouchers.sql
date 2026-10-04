-- ─────────────────────────────────────────────────────────────────────────────
-- Itinerary & Services — per-pilgrim attendance and service vouchers, the
-- two things 20261011090000_itinerary_services.sql deliberately deferred:
-- "Per-pilgrim attendance and voucher generation are deferred — see the
-- module's implementation notes."
--
-- Both are additive, scoped to one itinerary_events row (attendance) or one
-- departure_group_pilgrims row (a voucher, optionally tied to the event it
-- was issued for). Neither touches the existing itinerary tables.
--
-- Now that Pilgrim Portal has real auth
-- (20261026090000_pilgrim_portal_auth.sql), both get a portal-facing read
-- policy too, mirroring that migration's `current_portal_pilgrim_id()` /
-- `current_portal_group_ids()` helpers — a pilgrim can see their own
-- attendance record and their own vouchers, never anyone else's.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.itinerary_event_pilgrims (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  itinerary_event_id uuid not null references public.itinerary_events (id) on delete cascade,
  departure_group_pilgrim_id uuid not null references public.departure_group_pilgrims (id) on delete cascade,

  status text not null default 'REGISTERED' check (status in ('REGISTERED', 'ATTENDED', 'NO_SHOW', 'CANCELLED')),

  marked_by_name text,
  marked_at timestamptz not null default now(),

  unique (itinerary_event_id, departure_group_pilgrim_id)
);

comment on table public.itinerary_event_pilgrims is
  'Which travellers are registered/attended for one itinerary event — most useful for a capacity-limited event (itinerary_events.capacity).';

create index if not exists itinerary_event_pilgrims_event_idx on public.itinerary_event_pilgrims (itinerary_event_id);
create index if not exists itinerary_event_pilgrims_pilgrim_idx on public.itinerary_event_pilgrims (departure_group_pilgrim_id);
create index if not exists itinerary_event_pilgrims_agency_idx on public.itinerary_event_pilgrims (agency_id);

alter table public.itinerary_event_pilgrims enable row level security;

drop policy if exists "staff read itinerary_event_pilgrims" on public.itinerary_event_pilgrims;
create policy "staff read itinerary_event_pilgrims" on public.itinerary_event_pilgrims
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write itinerary_event_pilgrims" on public.itinerary_event_pilgrims;
create policy "staff write itinerary_event_pilgrims" on public.itinerary_event_pilgrims
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

drop policy if exists "pilgrim read own itinerary attendance" on public.itinerary_event_pilgrims;
create policy "pilgrim read own itinerary attendance" on public.itinerary_event_pilgrims
  for select to authenticated
  using (
    departure_group_pilgrim_id in (
      select id from public.departure_group_pilgrims where pilgrim_id = public.current_portal_pilgrim_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- service_vouchers — one voucher issued to one traveller, optionally for a
-- specific itinerary event (a Ziyarah pass, a meal voucher). service_name is
-- a snapshot at issue time so a later itinerary edit can never rewrite what
-- was actually handed out. voucher_code is short and human-typeable — a
-- guide checking it at the door reads it off a phone screen, not a QR
-- scanner (no such hardware assumed here).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.service_vouchers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  departure_group_pilgrim_id uuid not null references public.departure_group_pilgrims (id) on delete cascade,
  itinerary_event_id uuid references public.itinerary_events (id) on delete set null,

  voucher_code text not null,
  service_name text not null,
  status text not null default 'ISSUED' check (status in ('ISSUED', 'REDEEMED', 'CANCELLED')),
  notes text,

  issued_by_name text not null,
  issued_at timestamptz not null default now(),
  redeemed_by_name text,
  redeemed_at timestamptz,

  unique (agency_id, voucher_code)
);

comment on table public.service_vouchers is
  'One voucher issued to one traveller for one service — service_name is a snapshot, not a live join, so a later itinerary edit can''t rewrite what was actually handed out.';

create index if not exists service_vouchers_pilgrim_idx on public.service_vouchers (departure_group_pilgrim_id);
create index if not exists service_vouchers_event_idx on public.service_vouchers (itinerary_event_id);
create index if not exists service_vouchers_agency_idx on public.service_vouchers (agency_id);

alter table public.service_vouchers enable row level security;

drop policy if exists "staff read service_vouchers" on public.service_vouchers;
create policy "staff read service_vouchers" on public.service_vouchers
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write service_vouchers" on public.service_vouchers;
create policy "staff write service_vouchers" on public.service_vouchers
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

drop policy if exists "pilgrim read own service_vouchers" on public.service_vouchers;
create policy "pilgrim read own service_vouchers" on public.service_vouchers
  for select to authenticated
  using (
    departure_group_pilgrim_id in (
      select id from public.departure_group_pilgrims where pilgrim_id = public.current_portal_pilgrim_id()
    )
  );

notify pgrst, 'reload schema';
