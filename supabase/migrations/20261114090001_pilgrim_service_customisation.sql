-- Per-pilgrim service customisation: link columns, seat exclusion flag,
-- and add-on catalogue seed data.
--
-- Additive only. Safe on a database with 20260823090000 applied.

-- 1. Denormalised link columns so Flights/Hotels/Transport tabs can join
--    deviations without parsing jsonb in SQL. Nullable; the jsonb stays truth.
alter table public.departure_group_pilgrim_deviations
  add column if not exists linked_flight_id uuid
    references public.departure_group_flights (id) on delete set null,
  add column if not exists linked_accommodation_id uuid
    references public.departure_group_accommodations (id) on delete set null,
  add column if not exists linked_transport_id uuid
    references public.departure_group_transports (id) on delete set null,
  add column if not exists linked_itinerary_item_ids text[] not null default '{}';

create index if not exists pilgrim_deviations_flight_idx
  on public.departure_group_pilgrim_deviations (linked_flight_id)
  where linked_flight_id is not null;
create index if not exists pilgrim_deviations_accommodation_idx
  on public.departure_group_pilgrim_deviations (linked_accommodation_id)
  where linked_accommodation_id is not null;
create index if not exists pilgrim_deviations_transport_idx
  on public.departure_group_pilgrim_deviations (linked_transport_id)
  where linked_transport_id is not null;

-- 2. Seat accounting: an approved OWN_FLIGHT / LAND_ONLY means this traveller
--    does not consume a group seat.
alter table public.departure_group_pilgrims
  add column if not exists excluded_from_group_flight boolean not null default false;

-- 3. Seed the add-on catalogue that has existed empty since 20260823090000.
--    agency_id has no authenticated session to default from while this runs
--    as a migration, so it's backfilled explicitly to the same "first agency"
--    every other table in 20260824090000_tenancy.sql was backfilled to.
insert into public.agency_service_addons
  (agency_id, code, name, category, default_amount, unit, creates_deviation, journey_types)
select (select id from public.agencies order by created_at asc limit 1),
       v.code, v.name, v.category, v.default_amount, v.unit, v.creates_deviation, v.journey_types::text[]
  from (values
  ('QURBANI',          'Qurbani / Hadi',             'RITUAL',      28000, 'FLAT',    false, '{HAJJ,UMRAH}'),
  ('WHEELCHAIR',       'Wheelchair assistance',       'ASSISTANCE',      0, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('EXTRA_BAGGAGE',    'Extra baggage allowance',     'FLIGHT',       4500, 'PER_KG',  true,  '{HAJJ,UMRAH}'),
  ('MEET_GREET',       'Airport meet & greet',        'ASSISTANCE',   9000, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('ZIYARAT_MAKKAH',   'Additional Makkah ziyarat',   'OTHER',        6500, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('ZIYARAT_MADINAH',  'Additional Madinah ziyarat',  'OTHER',        6500, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('LAUNDRY',          'Laundry service',             'OTHER',        2500, 'PER_DAY', false, '{HAJJ,UMRAH}'),
  ('TRAVEL_INSURANCE', 'Travel insurance',            'INSURANCE',    7500, 'FLAT',    false, '{HAJJ,UMRAH}'),
  ('IHRAM_KIT',        'Ihram & travel kit',          'MERCHANDISE',  5500, 'FLAT',    false, '{HAJJ,UMRAH}'),
  ('PRIVATE_TRANSFER', 'Private airport transfer',    'TRANSPORT',   18000, 'FLAT',    true,  '{HAJJ,UMRAH}')
  ) as v(code, name, category, default_amount, unit, creates_deviation, journey_types)
-- Clean-rebuild fix (TASK-032 S5): by this point 20260828090000 has made the add-on code unique per agency, (agency_id, code), so the old
-- `on conflict (code)` target matched no constraint and a fresh build failed here. Identical effect on a database that already applied this.
on conflict (agency_id, code) do nothing;
