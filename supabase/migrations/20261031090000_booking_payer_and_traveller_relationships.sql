-- ─────────────────────────────────────────────────────────────────────────────
-- Booking promotion, slice 1 of the two genuinely-missing entities called out
-- in docs/architecture/remaining-modules-master-plan.md §3: a booking's payer (who is
-- paying, not necessarily a traveller) and traveller relationships (mahram /
-- spouse / family edges between travellers on the same booking).
--
-- Deliberately scoped down from the plan's full M1: no `booking_events` table
-- (that would duplicate `departure_group_activity_logs`, which already
-- records BOOKING_CREATED / BOOKING_CANCELLED / etc. — see §2's own
-- "do not create one generic audit table" rule), no status additions, no
-- nullable `departure_group_id` (the plan itself flags that as the highest
-- blast-radius change and defers it to "a later slice"). `departure_group_id`
-- stays not-null; a booking transfer moves it to a different group, it never
-- goes to no group.
--
-- `departure_group_bookings` is one of the 13 core `departure_group_*` tables
-- the RLS hardening migration deliberately left at `using (true)` (see
-- 20260822090000_rls_hardening.sql's header comment) — every role can already
-- read/write it, gated by `capabilitiesFor(role).addBookings` at the
-- application layer, so the new payer columns inherit that same posture
-- rather than getting a stricter policy no sibling column has.
--
-- `booking_traveller_relationships` is a new table, so it follows the current
-- convention (see 20261028090000_itinerary_attendance_and_vouchers.sql):
-- real agency-scoped RLS, `staff_role_in('ADMIN','CEO','OPERATIONS','MARKETING')`
-- for writes — the same role set that has `addBookings: true` in
-- `lib/access/departure-groups-access.ts`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.departure_group_bookings
  add column if not exists payer_pilgrim_id uuid references public.pilgrims (id) on delete set null,
  add column if not exists payer_lead_id uuid references public.leads (id) on delete set null,
  add column if not exists payer_name text,
  add column if not exists payer_email text,
  add column if not exists booking_type text not null default 'GROUP'
    check (booking_type in ('GROUP', 'CUSTOM'));

comment on column public.departure_group_bookings.payer_pilgrim_id is
  'Who is actually paying, when that is an existing pilgrim who need not be a traveller on this booking. Distinct from primary_contact_name/phone, which is the on-the-ground contact.';
comment on column public.departure_group_bookings.payer_lead_id is
  'Who is actually paying, when that is a lead rather than an onboarded pilgrim. At most one of payer_pilgrim_id/payer_lead_id is set; both null with payer_name/payer_email filled covers a payer who is neither.';
comment on column public.departure_group_bookings.booking_type is
  'GROUP: standard seat on a departure group''s package. CUSTOM: a bespoke arrangement priced outside the group''s package sheet. Informational today — does not change how the booking is processed.';

create index if not exists departure_group_bookings_payer_pilgrim_idx
  on public.departure_group_bookings (payer_pilgrim_id) where payer_pilgrim_id is not null;
create index if not exists departure_group_bookings_payer_lead_idx
  on public.departure_group_bookings (payer_lead_id) where payer_lead_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.booking_traveller_relationships (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  booking_id uuid not null references public.departure_group_bookings (id) on delete cascade,
  from_pilgrim_id uuid not null references public.departure_group_pilgrims (id) on delete cascade,
  to_pilgrim_id uuid not null references public.departure_group_pilgrims (id) on delete cascade,
  relationship text not null
    check (relationship in ('MAHRAM', 'SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'COMPANION', 'OTHER')),
  is_mahram boolean not null default false,
  note text,
  created_by_name text,
  created_at timestamptz not null default now(),

  constraint booking_traveller_relationships_not_self check (from_pilgrim_id <> to_pilgrim_id),
  constraint booking_traveller_relationships_unique_pair unique (booking_id, from_pilgrim_id, to_pilgrim_id)
);

comment on table public.booking_traveller_relationships is
  'Directed relationship edges between two travellers on the same booking — a mahram accompanying a female pilgrim, a spouse, a minor''s parent. is_mahram is called out as its own column (rather than derived from relationship) because a COMPANION or OTHER relationship can still satisfy a mahram requirement in practice.';

create index if not exists booking_traveller_relationships_booking_idx
  on public.booking_traveller_relationships (booking_id);
create index if not exists booking_traveller_relationships_group_idx
  on public.booking_traveller_relationships (departure_group_id);
create index if not exists booking_traveller_relationships_agency_idx
  on public.booking_traveller_relationships (agency_id);

alter table public.booking_traveller_relationships enable row level security;

drop policy if exists "staff read booking_traveller_relationships" on public.booking_traveller_relationships;
create policy "staff read booking_traveller_relationships" on public.booking_traveller_relationships
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write booking_traveller_relationships" on public.booking_traveller_relationships;
create policy "staff write booking_traveller_relationships" on public.booking_traveller_relationships
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS', 'MARKETING'));
