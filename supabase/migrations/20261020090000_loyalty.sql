-- ─────────────────────────────────────────────────────────────────────────────
-- Loyalty & Repeat Umrah (C9) — tiers, a points ledger, and redemptions.
--
-- "Repeat pilgrim" itself needs no new schema — it's computed live by
-- counting a pilgrim's distinct departure groups via the existing
-- departure_group_pilgrims join (lib/data/loyalty-repository.ts), never
-- stored, so it can't go stale as new bookings land.
--
-- A pilgrim's points balance and tier are likewise never stored — the
-- balance is the live sum of loyalty_point_entries, and the tier is
-- whichever loyalty_tiers row that balance currently qualifies for. Only
-- the ledger itself (an append-only record of why points moved) and
-- redemption requests are persisted.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  name text not null,
  min_points integer not null default 0,
  benefits text,
  sort_order integer not null default 0,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.loyalty_tiers is
  'A points threshold and its benefits. A pilgrim''s tier is computed live as the highest tier whose min_points does not exceed their ledger balance.';

create index if not exists loyalty_tiers_agency_idx on public.loyalty_tiers (agency_id);

alter table public.loyalty_tiers enable row level security;

drop policy if exists "staff read loyalty_tiers" on public.loyalty_tiers;
create policy "staff read loyalty_tiers" on public.loyalty_tiers
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write loyalty_tiers" on public.loyalty_tiers;
create policy "staff write loyalty_tiers" on public.loyalty_tiers
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO'));

-- ─────────────────────────────────────────────────────────────────────────────
-- loyalty_point_entries — append-only ledger. points is signed: positive for
-- an award, negative for a redemption or a manual deduction. Never edited in
-- place — a correction is a new offsetting entry, so the ledger stays an
-- honest history of what actually happened.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.loyalty_point_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,

  points integer not null,
  entry_type text not null check (entry_type in ('EARNED_BOOKING', 'MANUAL_ADJUSTMENT', 'REDEEMED')),
  reason text not null,
  reference_booking_id uuid references public.departure_group_bookings (id) on delete set null,

  created_by_name text not null,
  created_at timestamptz not null default now()
);

comment on table public.loyalty_point_entries is
  'Append-only loyalty points ledger. A pilgrim''s balance is the live sum of their entries — never a stored column.';

create index if not exists loyalty_point_entries_pilgrim_idx on public.loyalty_point_entries (pilgrim_id, created_at desc);
create index if not exists loyalty_point_entries_agency_idx on public.loyalty_point_entries (agency_id);

alter table public.loyalty_point_entries enable row level security;

drop policy if exists "staff read loyalty_point_entries" on public.loyalty_point_entries;
create policy "staff read loyalty_point_entries" on public.loyalty_point_entries
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write loyalty_point_entries" on public.loyalty_point_entries;
create policy "staff write loyalty_point_entries" on public.loyalty_point_entries
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

-- ─────────────────────────────────────────────────────────────────────────────
-- loyalty_redemptions — a request to spend points on a reward. Approving one
-- does not itself write a loyalty_point_entries row — staff record the
-- offsetting REDEEMED entry when they fulfill it, keeping the ledger and the
-- redemption workflow as two explicit steps rather than one implicit one.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  pilgrim_id uuid not null references public.pilgrims (id) on delete cascade,

  reward_description text not null,
  points_spent integer not null check (points_spent > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'FULFILLED', 'CANCELLED')),

  created_by_name text not null,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

comment on table public.loyalty_redemptions is
  'A request to redeem points for a reward. Fulfilling one should also record a matching REDEEMED loyalty_point_entries row.';

create index if not exists loyalty_redemptions_pilgrim_idx on public.loyalty_redemptions (pilgrim_id);
create index if not exists loyalty_redemptions_agency_idx on public.loyalty_redemptions (agency_id);

alter table public.loyalty_redemptions enable row level security;

drop policy if exists "staff read loyalty_redemptions" on public.loyalty_redemptions;
create policy "staff read loyalty_redemptions" on public.loyalty_redemptions
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write loyalty_redemptions" on public.loyalty_redemptions;
create policy "staff write loyalty_redemptions" on public.loyalty_redemptions
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'OPERATIONS'));

notify pgrst, 'reload schema';
