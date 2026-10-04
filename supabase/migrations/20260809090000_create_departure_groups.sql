-- Departure Groups — the live execution instance of a Package Template.
--
-- A Package Template (public.packages) is a reusable commercial promise. A
-- Departure Group is one real journey: real dates, real PNRs, real hotel
-- vouchers, real people. The two are deliberately decoupled:
--
--   * `departure_group_package_snapshots` freezes the template configuration at
--     creation time, so editing a template can never rewrite history for a
--     group that is already selling or flying.
--   * Every operational default (readiness items, transport routes,
--     accommodation blocks) is COPIED into its own editable row, not read
--     through to the template.
--
-- Shape follows the packages migration: scalars are real columns so they can be
-- filtered and indexed, ordered nested lists are JSONB.
--
-- Multi-tenancy: `agency_id` / `branch_id` are reserved uuid columns with no FK
-- yet — the agencies/branches tables do not exist in this schema. `branch` is
-- the text value actually used for filtering today, mirroring `packages.branch`.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. departure_groups
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_groups (
  id                        uuid primary key default gen_random_uuid(),
  agency_id                 uuid,
  branch_id                 uuid,
  branch                    text not null default '',
  package_template_id       uuid not null
                              references public.packages (id) on delete restrict,

  group_name                text not null,
  group_code                text not null,
  journey_type              text not null default 'UMRAH'
                              check (journey_type in ('UMRAH', 'HAJJ', 'EARLY_REGISTRATION')),
  group_status              text not null default 'PLANNING'
                              check (group_status in ('PLANNING', 'PREPARING', 'READY_TO_DEPART',
                                                      'DEPARTED', 'COMPLETED', 'CLOSED', 'CANCELLED')),
  sales_status              text not null default 'SELLING'
                              check (sales_status in ('SELLING', 'LIMITED_AVAILABILITY', 'WAITLIST',
                                                      'SALES_CLOSED', 'CANCELLED')),

  departure_date            date not null,
  return_date               date not null,
  duration_days             integer not null default 0 check (duration_days   >= 0),
  duration_nights           integer not null default 0 check (duration_nights >= 0),

  capacity                  integer not null check (capacity > 0),
  minimum_group_size        integer not null default 0 check (minimum_group_size >= 0),
  booked_seats              integer not null default 0 check (booked_seats >= 0),
  held_seats                integer not null default 0 check (held_seats   >= 0),
  -- Derived so "seats left" can never drift from the booking rows.
  available_seats           integer generated always as
                              (greatest(capacity - booked_seats - held_seats, 0)) stored,
  waitlist_enabled          boolean not null default true,
  seat_hold_expiry_hours    integer not null default 24 check (seat_hold_expiry_hours > 0),

  primary_guide_id          uuid references auth.users (id) on delete set null,
  primary_guide_name        text,
  backup_guide_name         text,
  operations_owner_id       uuid references auth.users (id) on delete set null,
  operations_owner_name     text,
  visa_owner_id             uuid references auth.users (id) on delete set null,
  visa_owner_name           text,
  finance_owner_id          uuid references auth.users (id) on delete set null,
  finance_owner_name        text,
  local_coordinator_name    text,
  local_coordinator_phone   text,
  emergency_phone           text,
  guide_whatsapp_link       text,
  pilgrim_broadcast_link    text,

  readiness_score           integer not null default 0
                              check (readiness_score between 0 and 100),
  readiness_status          text not null default 'NOT_STARTED'
                              check (readiness_status in ('READY', 'AT_RISK', 'BLOCKED', 'NOT_STARTED')),

  archived                  boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references auth.users (id) on delete set null,
  updated_by                uuid references auth.users (id) on delete set null,

  constraint departure_groups_return_after_departure
    check (return_date >= departure_date),
  constraint departure_groups_capacity_covers_minimum
    check (capacity >= minimum_group_size),
  constraint departure_groups_code_unique unique (group_code)
);

comment on table public.departure_groups is
  'Live execution instance of a Package Template: real dates, seats, suppliers and readiness.';

create index if not exists departure_groups_departure_date_idx on public.departure_groups (departure_date);
create index if not exists departure_groups_package_idx        on public.departure_groups (package_template_id);
create index if not exists departure_groups_status_idx         on public.departure_groups (group_status);
create index if not exists departure_groups_sales_status_idx   on public.departure_groups (sales_status);
create index if not exists departure_groups_readiness_idx      on public.departure_groups (readiness_status);
create index if not exists departure_groups_guide_idx          on public.departure_groups (primary_guide_id);
create index if not exists departure_groups_branch_idx         on public.departure_groups (branch);
-- The AI sales agent's eligibility probe: sellable groups, soonest first.
create index if not exists departure_groups_sellable_idx
  on public.departure_groups (departure_date)
  where sales_status in ('SELLING', 'LIMITED_AVAILABILITY')
    and group_status not in ('CANCELLED', 'COMPLETED', 'CLOSED')
    and archived = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. departure_group_package_snapshots  (one row per group, immutable)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_package_snapshots (
  departure_group_id                uuid primary key
                                      references public.departure_groups (id) on delete cascade,
  package_template_id               uuid not null
                                      references public.packages (id) on delete restrict,
  package_name_snapshot             text  not null default '',
  package_code_snapshot             text  not null default '',
  overview_snapshot                 text  not null default '',
  pricing_snapshot                  jsonb not null default '{}'::jsonb,
  payment_schedule_snapshot         jsonb not null default '[]'::jsonb,
  itinerary_snapshot                jsonb not null default '[]'::jsonb,
  inclusions_snapshot               jsonb not null default '[]'::jsonb,
  exclusions_snapshot               jsonb not null default '[]'::jsonb,
  accommodation_standards_snapshot  jsonb not null default '[]'::jsonb,
  transport_requirements_snapshot   jsonb not null default '[]'::jsonb,
  traveller_requirements_snapshot   jsonb not null default '[]'::jsonb,
  readiness_requirements_snapshot   jsonb not null default '[]'::jsonb,
  copied_at                         timestamptz not null default now()
);

comment on table public.departure_group_package_snapshots is
  'Immutable copy of the Package Template as it stood when the group was created. Never updated by template edits.';

create index if not exists departure_group_snapshots_template_idx
  on public.departure_group_package_snapshots (package_template_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. departure_group_flights
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_flights (
  id                        uuid primary key default gen_random_uuid(),
  departure_group_id        uuid not null
                              references public.departure_groups (id) on delete cascade,
  direction                 text not null check (direction in ('OUTBOUND', 'RETURN')),
  status                    text not null default 'DRAFT'
                              check (status in ('DRAFT', 'HELD', 'CONFIRMED', 'TICKETED', 'CANCELLED')),
  airline                   text not null default '',
  flight_number             text,
  pnr                       text,
  booking_reference         text,
  origin_airport_code       text not null default '',
  origin_airport_name       text not null default '',
  destination_airport_code  text not null default '',
  destination_airport_name  text not null default '',
  departure_at              timestamptz not null,
  arrival_at                timestamptz not null,
  cabin_class               text not null default 'Economy',
  seat_capacity             integer not null default 0 check (seat_capacity  >= 0),
  seats_held                integer not null default 0 check (seats_held     >= 0),
  seats_ticketed            integer not null default 0 check (seats_ticketed >= 0),
  ticketing_deadline        timestamptz,
  supplier_name             text,
  notes                     text,

  constraint departure_group_flights_arrival_after_departure
    check (arrival_at >= departure_at)
);

create index if not exists departure_group_flights_group_idx
  on public.departure_group_flights (departure_group_id, direction);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. departure_group_flight_legs
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_flight_legs (
  id                        uuid primary key default gen_random_uuid(),
  flight_id                 uuid not null
                              references public.departure_group_flights (id) on delete cascade,
  leg_order                 integer not null check (leg_order > 0),
  airline                   text not null default '',
  flight_number             text not null default '',
  origin_airport_code       text not null default '',
  destination_airport_code  text not null default '',
  departure_at              timestamptz not null,
  arrival_at                timestamptz not null,
  transit_duration_minutes  integer check (transit_duration_minutes is null or transit_duration_minutes >= 0),

  constraint departure_group_flight_legs_order_unique unique (flight_id, leg_order)
);

create index if not exists departure_group_flight_legs_flight_idx
  on public.departure_group_flight_legs (flight_id, leg_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. departure_group_accommodations
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_accommodations (
  id                    uuid primary key default gen_random_uuid(),
  departure_group_id    uuid not null
                          references public.departure_groups (id) on delete cascade,
  city                  text not null check (city in ('MAKKAH', 'MADINAH', 'MINA', 'ARAFAT', 'OTHER')),
  hotel_name            text not null default '',
  supplier_name         text,
  booking_reference     text,
  status                text not null default 'NOT_REQUESTED'
                          check (status in ('NOT_REQUESTED', 'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  check_in_date         date not null,
  check_out_date        date not null,
  nights                integer not null default 0 check (nights          >= 0),
  room_capacity         integer not null default 0 check (room_capacity   >= 0),
  rooms_reserved        integer not null default 0 check (rooms_reserved  >= 0),
  rooms_allocated       integer not null default 0 check (rooms_allocated >= 0),
  meal_plan             text,
  distance_description  text,
  voucher_url           text,
  -- Supplier cost. Exposed only to Admin / CEO / Finance in the application layer.
  internal_cost         numeric(14, 2) check (internal_cost is null or internal_cost >= 0),
  notes                 text,

  constraint departure_group_accommodations_checkout_after_checkin
    check (check_out_date >= check_in_date)
);

create index if not exists departure_group_accommodations_group_idx
  on public.departure_group_accommodations (departure_group_id, city);
create index if not exists departure_group_accommodations_status_idx
  on public.departure_group_accommodations (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. departure_group_rooms
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_rooms (
  id                      uuid primary key default gen_random_uuid(),
  accommodation_id        uuid not null
                            references public.departure_group_accommodations (id) on delete cascade,
  room_number             text,
  room_type               text not null default 'QUAD'
                            check (room_type in ('QUAD', 'TRIPLE', 'DOUBLE', 'SINGLE', 'OTHER')),
  occupancy_capacity      integer not null check (occupancy_capacity > 0),
  assigned_pilgrim_count  integer not null default 0 check (assigned_pilgrim_count >= 0),
  status                  text not null default 'AVAILABLE'
                            check (status in ('AVAILABLE', 'PARTIAL', 'COMPLETE', 'BLOCKED')),
  notes                   text
);

create index if not exists departure_group_rooms_accommodation_idx
  on public.departure_group_rooms (accommodation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- H. departure_group_transports
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_transports (
  id                                 uuid primary key default gen_random_uuid(),
  departure_group_id                 uuid not null
                                       references public.departure_groups (id) on delete cascade,
  -- Points back into the snapshot's transport_requirements array, not a table.
  template_transport_requirement_id  text,
  route_label                        text not null default '',
  origin                             text not null default '',
  destination                        text not null default '',
  status                             text not null default 'NOT_REQUESTED'
                                       check (status in ('NOT_REQUESTED', 'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  supplier_name                      text,
  booking_reference                  text,
  vehicle_type                       text not null default 'COACH'
                                       check (vehicle_type in ('COACH', 'VAN', 'PRIVATE_CAR', 'TRAIN', 'OTHER')),
  vehicle_capacity                   integer check (vehicle_capacity is null or vehicle_capacity >= 0),
  passenger_count                    integer check (passenger_count  is null or passenger_count  >= 0),
  pickup_at                          timestamptz,
  pickup_location                    text,
  driver_name                        text,
  driver_phone                       text,
  coordinator_name                   text,
  coordinator_phone                  text,
  internal_cost                      numeric(14, 2) check (internal_cost is null or internal_cost >= 0),
  notes                              text
);

create index if not exists departure_group_transports_group_idx
  on public.departure_group_transports (departure_group_id);
create index if not exists departure_group_transports_status_idx
  on public.departure_group_transports (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- I. departure_group_bookings
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_bookings (
  id                        uuid primary key default gen_random_uuid(),
  departure_group_id        uuid not null
                              references public.departure_groups (id) on delete cascade,
  -- No leads table yet; kept nullable and unconstrained until it lands.
  lead_id                   uuid,
  booking_reference         text not null,
  booking_status            text not null default 'HELD'
                              check (booking_status in ('HELD', 'DEPOSIT_PENDING', 'CONFIRMED', 'CANCELLED', 'WAITLIST')),
  primary_contact_name      text not null default '',
  primary_contact_phone     text not null default '',
  traveller_count           integer not null default 1 check (traveller_count > 0),
  room_occupancy_preference text not null default 'QUAD'
                              check (room_occupancy_preference in ('QUAD', 'TRIPLE', 'DOUBLE', 'SINGLE', 'OTHER')),
  package_price_per_person  numeric(14, 2) not null default 0 check (package_price_per_person >= 0),
  total_booking_value       numeric(14, 2) not null default 0 check (total_booking_value      >= 0),
  amount_paid               numeric(14, 2) not null default 0 check (amount_paid              >= 0),
  outstanding_balance       numeric(14, 2) not null default 0,
  next_due_at               timestamptz,
  seat_hold_expires_at      timestamptz,
  booked_at                 timestamptz,
  created_at                timestamptz not null default now(),

  constraint departure_group_bookings_reference_unique unique (booking_reference)
);

create index if not exists departure_group_bookings_group_idx
  on public.departure_group_bookings (departure_group_id, booking_status);
create index if not exists departure_group_bookings_lead_idx
  on public.departure_group_bookings (lead_id);
-- Sweeping expired seat holds.
create index if not exists departure_group_bookings_hold_expiry_idx
  on public.departure_group_bookings (seat_hold_expires_at)
  where booking_status = 'HELD';

-- ─────────────────────────────────────────────────────────────────────────────
-- J. departure_group_pilgrims
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_pilgrims (
  id                          uuid primary key default gen_random_uuid(),
  departure_group_id          uuid not null
                                references public.departure_groups (id) on delete cascade,
  booking_id                  uuid not null
                                references public.departure_group_bookings (id) on delete cascade,
  -- FK added once the shared pilgrims table exists; the *_snapshot columns keep
  -- the manifest printable in the meantime.
  pilgrim_id                  uuid,
  full_name_snapshot          text not null default '',
  phone_snapshot              text,
  passport_number_snapshot    text,
  seat_status                 text not null default 'HELD'
                                check (seat_status in ('HELD', 'CONFIRMED', 'TICKETED', 'CANCELLED', 'WAITLIST')),
  flight_status               text not null default 'PENDING'
                                check (flight_status in ('TICKETED', 'PENDING', 'NAME_MISMATCH', 'CANCELLED', 'CHANGE_REQUESTED')),
  room_assignment_status      text not null default 'UNASSIGNED'
                                check (room_assignment_status in ('UNASSIGNED', 'ASSIGNED', 'LOCKED')),
  room_id                     uuid references public.departure_group_rooms (id) on delete set null,
  documents_completed         integer not null default 0 check (documents_completed >= 0),
  documents_required          integer not null default 0 check (documents_required  >= 0),
  document_completion_percent integer not null default 0
                                check (document_completion_percent between 0 and 100),
  visa_status                 text not null default 'NOT_STARTED'
                                check (visa_status in ('NOT_STARTED', 'DOCUMENTS_PENDING', 'READY_TO_SUBMIT',
                                                       'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REWORK_REQUIRED')),
  visa_submitted_at           timestamptz,
  visa_id                     text,
  visa_issue_note             text,
  payment_status              text not null default 'NOT_STARTED'
                                check (payment_status in ('NOT_STARTED', 'DEPOSIT_PAID', 'PARTIAL',
                                                          'PAID_IN_FULL', 'OVERDUE', 'REFUND_PENDING')),
  emergency_contact_status    text not null default 'MISSING'
                                check (emergency_contact_status in ('COMPLETE', 'INCOMPLETE', 'MISSING'))
);

create index if not exists departure_group_pilgrims_group_idx    on public.departure_group_pilgrims (departure_group_id);
create index if not exists departure_group_pilgrims_booking_idx  on public.departure_group_pilgrims (booking_id);
create index if not exists departure_group_pilgrims_pilgrim_idx  on public.departure_group_pilgrims (pilgrim_id);
create index if not exists departure_group_pilgrims_visa_idx     on public.departure_group_pilgrims (departure_group_id, visa_status);
create index if not exists departure_group_pilgrims_room_idx     on public.departure_group_pilgrims (room_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- G. departure_group_room_assignments
--
-- Declared after J because it references the pilgrim rows it allocates beds to.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_room_assignments (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.departure_group_rooms (id) on delete cascade,
  pilgrim_id   uuid not null
                 references public.departure_group_pilgrims (id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid references auth.users (id) on delete set null,

  -- One bed per pilgrim.
  constraint departure_group_room_assignments_pilgrim_unique unique (pilgrim_id)
);

create index if not exists departure_group_room_assignments_room_idx
  on public.departure_group_room_assignments (room_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- L. departure_group_readiness_items
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_readiness_items (
  id                              uuid primary key default gen_random_uuid(),
  departure_group_id              uuid not null
                                    references public.departure_groups (id) on delete cascade,
  -- Points into the snapshot's readiness_requirements array, not a table.
  source_template_requirement_id  text,
  label                           text not null default '',
  category                        text not null default 'OTHER'
                                    check (category in ('FLIGHT', 'HOTEL', 'TRANSPORT', 'PAYMENT', 'DOCUMENT',
                                                        'VISA', 'ROOMING', 'GUIDE', 'MANIFEST', 'CATERING', 'OTHER')),
  responsible_role                text not null default 'OPERATIONS'
                                    check (responsible_role in ('ADMIN', 'OPERATIONS', 'VISA', 'FINANCE', 'GUIDE', 'MARKETING')),
  assigned_to_user_id             uuid references auth.users (id) on delete set null,
  assigned_to_name                text,
  due_type                        text not null default 'BEFORE_DEPARTURE'
                                    check (due_type in ('BEFORE_GROUP_OPENS', 'BEFORE_FIRST_BOOKING', 'BEFORE_VISA_SUBMISSION',
                                                        'BEFORE_FINAL_PAYMENT', 'DAYS_BEFORE_DEPARTURE', 'BEFORE_DEPARTURE')),
  due_days_before_departure       integer check (due_days_before_departure is null or due_days_before_departure >= 0),
  due_at                          timestamptz,
  required                        boolean not null default true,
  status                          text not null default 'NOT_STARTED'
                                    check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'AT_RISK', 'BLOCKED', 'NOT_REQUIRED')),
  evidence_url                    text,
  notes                           text,
  completed_at                    timestamptz,
  completed_by                    uuid references auth.users (id) on delete set null
);

create index if not exists departure_group_readiness_group_idx
  on public.departure_group_readiness_items (departure_group_id, category);
create index if not exists departure_group_readiness_status_idx
  on public.departure_group_readiness_items (departure_group_id, status);
create index if not exists departure_group_readiness_due_idx
  on public.departure_group_readiness_items (due_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- M. departure_group_tasks
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_tasks (
  id                        uuid primary key default gen_random_uuid(),
  departure_group_id        uuid not null
                              references public.departure_groups (id) on delete cascade,
  title                     text not null default '',
  description               text,
  owner_id                  uuid references auth.users (id) on delete set null,
  owner_name                text not null default '',
  due_at                    timestamptz not null,
  status                    text not null default 'OPEN'
                              check (status in ('OPEN', 'IN_PROGRESS', 'COMPLETE', 'OVERDUE')),
  category                  text not null default 'OPERATIONS'
                              check (category in ('OPERATIONS', 'VISA', 'FINANCE', 'GUIDE', 'MARKETING', 'OTHER')),
  linked_readiness_item_id  uuid references public.departure_group_readiness_items (id) on delete set null
);

create index if not exists departure_group_tasks_group_idx on public.departure_group_tasks (departure_group_id, status);
create index if not exists departure_group_tasks_owner_idx on public.departure_group_tasks (owner_id);
create index if not exists departure_group_tasks_due_idx   on public.departure_group_tasks (due_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- N. departure_group_activity_logs
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.departure_group_activity_logs (
  id                   uuid primary key default gen_random_uuid(),
  departure_group_id   uuid not null
                         references public.departure_groups (id) on delete cascade,
  actor_id             uuid references auth.users (id) on delete set null,
  actor_name_snapshot  text not null default 'System',
  action_type          text not null default '',
  entity_type          text not null default 'GROUP'
                         check (entity_type in ('GROUP', 'FLIGHT', 'ACCOMMODATION', 'ROOM', 'TRANSPORT', 'BOOKING',
                                                'PILGRIM', 'PAYMENT', 'READINESS_ITEM', 'TASK', 'DOCUMENT', 'VISA')),
  entity_id            uuid,
  before_value         jsonb,
  after_value          jsonb,
  message              text not null default '',
  is_system            boolean not null default false,
  is_high_impact       boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists departure_group_activity_group_idx
  on public.departure_group_activity_logs (departure_group_id, created_at desc);
-- The Overview tab's "recent high-impact activity" feed.
create index if not exists departure_group_activity_high_impact_idx
  on public.departure_group_activity_logs (departure_group_id, created_at desc)
  where is_high_impact = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- K. departure_group_payment_summaries — derived, so a view rather than a table
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.departure_group_payment_summaries as
select
  g.id as departure_group_id,
  coalesce(b.expected_revenue,      0) as expected_revenue,
  coalesce(b.collected_amount,      0) as collected_amount,
  coalesce(b.outstanding_amount,    0) as outstanding_amount,
  coalesce(b.overdue_amount,        0) as overdue_amount,
  coalesce(p.refund_pending_amount, 0) as refund_pending_amount,
  coalesce(a.hotel_cost, 0) + coalesce(t.transport_cost, 0) as supplier_payables_due
from public.departure_groups g
left join lateral (
  select
    sum(total_booking_value)                                                    as expected_revenue,
    sum(amount_paid)                                                            as collected_amount,
    sum(outstanding_balance)                                                    as outstanding_amount,
    sum(case when next_due_at < now() then outstanding_balance else 0 end)      as overdue_amount
  from public.departure_group_bookings
  where departure_group_id = g.id and booking_status <> 'CANCELLED'
) b on true
left join lateral (
  select sum(bk.outstanding_balance) as refund_pending_amount
  from public.departure_group_pilgrims pg
  join public.departure_group_bookings bk on bk.id = pg.booking_id
  where pg.departure_group_id = g.id and pg.payment_status = 'REFUND_PENDING'
) p on true
left join lateral (
  select sum(internal_cost) as hotel_cost
  from public.departure_group_accommodations
  where departure_group_id = g.id and status in ('REQUESTED', 'CONFIRMED')
) a on true
left join lateral (
  select sum(internal_cost) as transport_cost
  from public.departure_group_transports
  where departure_group_id = g.id and status in ('REQUESTED', 'CONFIRMED')
) t on true;

comment on view public.departure_group_payment_summaries is
  'Group-level money rollup for the Payments tab and Overview collection KPI.';

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at maintenance — reuses the trigger function from the packages migration
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists departure_groups_set_updated_at on public.departure_groups;
create trigger departure_groups_set_updated_at
  before update on public.departure_groups
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Shared agency workspace, same posture as public.packages: any signed-in staff
-- member may read and write. Column-level visibility (supplier `internal_cost`,
-- the finance ledger, guide scoping) is enforced in the application layer by
-- `lib/access/departure-groups-access.ts`; tighten to real role claims here once
-- staff roles exist in the database.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  tbl text;
  tables text[] := array[
    'departure_groups',
    'departure_group_package_snapshots',
    'departure_group_flights',
    'departure_group_flight_legs',
    'departure_group_accommodations',
    'departure_group_rooms',
    'departure_group_room_assignments',
    'departure_group_transports',
    'departure_group_bookings',
    'departure_group_pilgrims',
    'departure_group_readiness_items',
    'departure_group_tasks',
    'departure_group_activity_logs'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists "staff read %s"   on public.%I', tbl, tbl);
    execute format('drop policy if exists "staff write %s"  on public.%I', tbl, tbl);
    execute format(
      'create policy "staff read %s" on public.%I for select to authenticated using (true)',
      tbl, tbl
    );
    execute format(
      'create policy "staff write %s" on public.%I for all to authenticated using (true) with check (true)',
      tbl, tbl
    );
  end loop;
end;
$$;
