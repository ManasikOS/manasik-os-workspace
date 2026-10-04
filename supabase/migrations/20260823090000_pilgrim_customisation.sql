-- Per-pilgrim customisation: pricing lines and operational deviations at the
-- one grain the codebase never modelled — the individual traveller.
--
-- Background: `departure_group_bookings.total_booking_value` is computed as
-- `package_price_per_person * traveller_count`, which makes every traveller on
-- a booking identical by construction. A family of four sharing a booking
-- cannot have one member in a single room and three in a triple, cannot have
-- one member take a discount, and cannot have one member skip the group
-- flight. This migration adds the two tables that make those things
-- representable without touching the immutable package snapshot or the
-- group-level operational rows.
--
-- Additive only. Safe on a database with 20260808090000 … 20260822090000
-- applied. See docs/modules/per-pilgrim-customisation-implementation-plan.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. agency_service_addons — the add-on catalogue (Qurbani, meet & greet,
--    wheelchair assistance, extra baggage…), managed from Settings.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agency_service_addons (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  name                text not null,
  description         text not null default '',
  category            text not null default 'OTHER'
                        check (category in ('ACCOMMODATION','FLIGHT','TRANSPORT','RITUAL',
                                            'ASSISTANCE','INSURANCE','MERCHANDISE','OTHER')),
  default_amount      numeric(14, 2) check (default_amount is null or default_amount >= 0),
  currency            text not null default 'LKR',
  unit                text not null default 'FLAT'
                        check (unit in ('FLAT','PER_NIGHT','PER_DAY','PER_KG')),
  -- Whether taking this add-on also needs an operations deviation record
  -- (e.g. wheelchair assistance needs someone to actually arrange it).
  creates_deviation   boolean not null default false,
  journey_types       text[] not null default '{}',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint agency_service_addons_code_unique unique (code)
);

comment on table public.agency_service_addons is
  'Flat catalogue of chargeable add-ons a traveller can be sold on top of the package base fare. No bundles, no dependencies — see the implementation plan for why.';

drop trigger if exists agency_service_addons_set_updated_at on public.agency_service_addons;
create trigger agency_service_addons_set_updated_at
  before update on public.agency_service_addons
  for each row execute function public.set_updated_at();

alter table public.agency_service_addons enable row level security;

drop policy if exists agency_service_addons_select on public.agency_service_addons;
create policy agency_service_addons_select on public.agency_service_addons
  for select to authenticated using (true);

drop policy if exists agency_service_addons_write on public.agency_service_addons;
create policy agency_service_addons_write on public.agency_service_addons
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. departure_group_pilgrim_charges — the money, at pilgrim grain.
--
-- Replaces `package_price_per_person * traveller_count` as the source of
-- truth for what a booking is worth: a booking's total is the sum of its
-- pilgrims' live charge lines. `source` distinguishes a line the system
-- generated from the frozen snapshot (regenerable on a reprice) from one a
-- human typed in (never touched by a reprice). `voided_at` — never a delete —
-- mirrors the same rule `finance_adjustments` and `payments` already carry:
-- a money record is corrected, not erased.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_pilgrim_charges (
  id                    uuid primary key default gen_random_uuid(),
  departure_group_id    uuid not null references public.departure_groups (id) on delete cascade,
  booking_id            uuid not null references public.departure_group_bookings (id) on delete cascade,
  group_pilgrim_id      uuid not null references public.departure_group_pilgrims (id) on delete cascade,

  charge_type           text not null
                          check (charge_type in ('BASE_FARE','ROOM_UPGRADE','EXTRA_NIGHTS',
                                                 'FLIGHT_VARIATION','TRANSPORT_VARIATION',
                                                 'ADDON','DISCOUNT','SURCHARGE',
                                                 'PRICE_CORRECTION','CANCELLATION_FEE')),
  addon_id              uuid references public.agency_service_addons (id) on delete set null,
  label                 text not null,
  -- Signed: discounts are negative, everything else non-negative (below).
  amount                numeric(14, 2) not null,
  quantity              numeric(10, 2) not null default 1 check (quantity > 0),
  currency              text not null default 'LKR',

  source                text not null default 'MANUAL'
                          check (source in ('SNAPSHOT','MANUAL','ADDON_CATALOGUE','SYSTEM')),
  -- The occupancy tier a BASE_FARE was priced at. Null for every other type.
  priced_room_type      text check (priced_room_type is null or
                                    priced_room_type in ('QUAD','TRIPLE','DOUBLE','SINGLE','OTHER')),

  reason                text,
  requires_approval     boolean not null default false,
  approved_by           uuid references auth.users (id) on delete set null,
  approved_by_name      text,
  approved_at           timestamptz,
  voided_at             timestamptz,
  voided_by_name        text,
  void_reason           text,

  created_by            uuid references auth.users (id) on delete set null,
  created_by_name       text not null default 'Staff',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint pilgrim_charges_base_fare_sign  check (charge_type <> 'BASE_FARE' or amount >= 0),
  constraint pilgrim_charges_discount_sign   check (charge_type <> 'DISCOUNT'  or amount <= 0),
  constraint pilgrim_charges_approval_reason check (not requires_approval or coalesce(btrim(reason), '') <> ''),
  constraint pilgrim_charges_void_reason     check (voided_at is null or coalesce(btrim(void_reason), '') <> '')
);

comment on table public.departure_group_pilgrim_charges is
  'One priced line per chargeable thing on one traveller. A booking''s total is the sum of its pilgrims'' live (non-voided) lines — see public.pilgrim_price_rows / public.booking_price_rows.';

-- Exactly one live base fare per traveller.
create unique index if not exists pilgrim_charges_one_base_fare
  on public.departure_group_pilgrim_charges (group_pilgrim_id)
  where charge_type = 'BASE_FARE' and voided_at is null;

create index if not exists pilgrim_charges_pilgrim_idx on public.departure_group_pilgrim_charges (group_pilgrim_id);
create index if not exists pilgrim_charges_booking_idx on public.departure_group_pilgrim_charges (booking_id);
create index if not exists pilgrim_charges_group_idx   on public.departure_group_pilgrim_charges (departure_group_id, charge_type);
create index if not exists pilgrim_charges_approval_idx
  on public.departure_group_pilgrim_charges (departure_group_id)
  where requires_approval and approved_at is null and voided_at is null;

drop trigger if exists pilgrim_charges_set_updated_at on public.departure_group_pilgrim_charges;
create trigger pilgrim_charges_set_updated_at
  before update on public.departure_group_pilgrim_charges
  for each row execute function public.set_updated_at();

alter table public.departure_group_pilgrim_charges enable row level security;

drop policy if exists pilgrim_charges_select on public.departure_group_pilgrim_charges;
create policy pilgrim_charges_select on public.departure_group_pilgrim_charges
  for select to authenticated using (true);

drop policy if exists pilgrim_charges_write on public.departure_group_pilgrim_charges;
create policy pilgrim_charges_write on public.departure_group_pilgrim_charges
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. departure_group_pilgrim_deviations — the operational fact behind a
--    customisation. Has a status so Operations must action it, and an optional
--    link to the charge line it is paired with, so the money and the
--    operation can never drift out of sync.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_pilgrim_deviations (
  id                    uuid primary key default gen_random_uuid(),
  departure_group_id    uuid not null references public.departure_groups (id) on delete cascade,
  group_pilgrim_id      uuid not null references public.departure_group_pilgrims (id) on delete cascade,

  deviation_type        text not null
                          check (deviation_type in (
                            'ROOM_TYPE','EXTRA_NIGHTS','HOTEL_UPGRADE','MEAL_PLAN','ROOMMATE_REQUEST',
                            'LAND_ONLY','OWN_FLIGHT','EXTENDED_STAY','CABIN_UPGRADE','SEAT_PREFERENCE',
                            'PRIVATE_TRANSFER','PICKUP_POINT',
                            'ITINERARY_OPT_OUT','ITINERARY_ADDITION','SERVICE_ADDON',
                            'DOCUMENT_REQUIREMENT','ASSISTANCE','OTHER')),

  -- The fields a given deviation_type needs. Validated by a discriminated
  -- union in lib/validations/departure-groups.ts before this column is ever
  -- written — loose here for the same reason the packages JSONB columns are.
  detail                jsonb not null default '{}'::jsonb,
  summary               text not null default '',

  status                text not null default 'REQUESTED'
                          check (status in ('REQUESTED','APPROVED','ARRANGED','DECLINED','CANCELLED')),
  responsible_role      text not null default 'OPERATIONS'
                          check (responsible_role in ('ADMIN','OPERATIONS','VISA','FINANCE','GUIDE','MARKETING')),
  blocks_departure      boolean not null default false,

  charge_id             uuid references public.departure_group_pilgrim_charges (id) on delete set null,
  supplier_commitment_id uuid references public.supplier_commitments (id) on delete set null,

  requested_at          timestamptz not null default now(),
  requested_by_name     text not null default 'Staff',
  decided_at            timestamptz,
  decided_by            uuid references auth.users (id) on delete set null,
  decided_by_name       text,
  decision_note         text,
  arranged_at           timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint pilgrim_deviations_decision
    check (status = 'REQUESTED' or decided_by_name is not null)
);

comment on table public.departure_group_pilgrim_deviations is
  'One row per per-traveller operational deviation from the group standard (extra nights, own flight, an opted-out itinerary day, an added service…). Never edits the group snapshot or the group-level operational rows.';

create index if not exists pilgrim_deviations_pilgrim_idx on public.departure_group_pilgrim_deviations (group_pilgrim_id);
create index if not exists pilgrim_deviations_group_idx   on public.departure_group_pilgrim_deviations (departure_group_id, status);
create index if not exists pilgrim_deviations_open_idx
  on public.departure_group_pilgrim_deviations (departure_group_id)
  where status in ('REQUESTED','APPROVED');
create index if not exists pilgrim_deviations_blocking_idx
  on public.departure_group_pilgrim_deviations (departure_group_id)
  where blocks_departure and status not in ('ARRANGED','DECLINED','CANCELLED');

drop trigger if exists pilgrim_deviations_set_updated_at on public.departure_group_pilgrim_deviations;
create trigger pilgrim_deviations_set_updated_at
  before update on public.departure_group_pilgrim_deviations
  for each row execute function public.set_updated_at();

alter table public.departure_group_pilgrim_deviations enable row level security;

drop policy if exists pilgrim_deviations_select on public.departure_group_pilgrim_deviations;
create policy pilgrim_deviations_select on public.departure_group_pilgrim_deviations
  for select to authenticated using (true);

drop policy if exists pilgrim_deviations_write on public.departure_group_pilgrim_deviations;
create policy pilgrim_deviations_write on public.departure_group_pilgrim_deviations
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Column additions
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_pilgrims
  -- Per-person occupancy fact. `departure_group_bookings.room_occupancy_preference`
  -- remains the default a new booking's travellers are seeded with; this is
  -- what the traveller is actually billed and rooomed against once it can vary.
  add column if not exists room_occupancy_type text
    check (room_occupancy_type is null or
           room_occupancy_type in ('QUAD','TRIPLE','DOUBLE','SINGLE','OTHER')),
  -- Set true by the application whenever a non-BASE_FARE charge or any
  -- deviation is added for this traveller, so list screens can filter/sort on
  -- "who is off the standard package" without joining the two new tables.
  add column if not exists has_customisations boolean not null default false;

alter table public.departure_group_pilgrim_documents
  -- SNAPSHOT rows came from buildPilgrimDocuments() at booking time; MANUAL
  -- rows were added for one traveller only (a mahram letter, a minor consent
  -- form) and must never be touched by a template re-copy.
  add column if not exists source text not null default 'SNAPSHOT'
    check (source in ('SNAPSHOT','MANUAL')),
  add column if not exists stage_changed_reason text;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Rollup views
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.pilgrim_price_rows as
select
  p.id                                                                                as group_pilgrim_id,
  p.departure_group_id,
  p.booking_id,
  coalesce(sum(c.amount * c.quantity) filter (where c.voided_at is null), 0)          as total_price,
  coalesce(sum(c.amount * c.quantity) filter (where c.voided_at is null
                                                and c.charge_type = 'BASE_FARE'), 0)   as base_fare,
  coalesce(sum(c.amount * c.quantity) filter (where c.voided_at is null
                                                and c.charge_type = 'DISCOUNT'), 0)    as discount_total,
  count(c.id) filter (where c.voided_at is null
                        and c.charge_type <> 'BASE_FARE')                             as customisation_count,
  count(c.id) filter (where c.requires_approval and c.approved_at is null
                        and c.voided_at is null)                                      as pending_approval_count
from public.departure_group_pilgrims p
left join public.departure_group_pilgrim_charges c on c.group_pilgrim_id = p.id
group by p.id, p.departure_group_id, p.booking_id;

comment on view public.pilgrim_price_rows is
  'One row per traveller: the sum of their live charge lines. The single source of truth for what one person owes.';

create or replace view public.booking_price_rows as
select booking_id,
       sum(total_price)              as total_booking_value,
       sum(base_fare)                as base_fare_total,
       sum(discount_total)           as discount_total,
       sum(customisation_count)      as customisation_count,
       sum(pending_approval_count)   as pending_approval_count
from public.pilgrim_price_rows
group by booking_id;

comment on view public.booking_price_rows is
  'Booking total derived from its travellers'' charge lines. After the backfill below, booking_price_rows.total_booking_value equals departure_group_bookings.total_booking_value for every existing booking — that equality is this migration''s acceptance test.';

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Backfill — every existing traveller gets one BASE_FARE line so the new
--    tables are the truth for old bookings too, not just new ones.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  pg record;
  mismatch_count integer;
begin
  for pg in
    select p.id as pilgrim_id, p.departure_group_id, p.booking_id,
           b.package_price_per_person, b.room_occupancy_preference
    from public.departure_group_pilgrims p
    join public.departure_group_bookings b on b.id = p.booking_id
    where not exists (
      select 1 from public.departure_group_pilgrim_charges c
      where c.group_pilgrim_id = p.id and c.charge_type = 'BASE_FARE'
    )
  loop
    insert into public.departure_group_pilgrim_charges (
      departure_group_id, booking_id, group_pilgrim_id,
      charge_type, label, amount, quantity, source, priced_room_type,
      created_by_name
    ) values (
      pg.departure_group_id, pg.booking_id, pg.pilgrim_id,
      'BASE_FARE', 'Package base fare', greatest(pg.package_price_per_person, 0), 1,
      'SNAPSHOT', pg.room_occupancy_preference,
      'System (backfill)'
    );

    update public.departure_group_pilgrims
      set room_occupancy_type = coalesce(room_occupancy_type, pg.room_occupancy_preference)
      where id = pg.pilgrim_id;
  end loop;

  select count(*) into mismatch_count
    from public.departure_group_bookings b
    join public.booking_price_rows r on r.booking_id = b.id
    where abs(coalesce(r.total_booking_value, 0) - b.total_booking_value) > 0.01;

  if mismatch_count > 0 then
    raise notice 'pilgrim_charges backfill: % booking(s) do not reconcile with booking_price_rows — investigate before Phase 2 switches booking totals over to the charge lines.', mismatch_count;
  end if;
end;
$$;
