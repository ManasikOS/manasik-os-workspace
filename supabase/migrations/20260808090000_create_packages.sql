-- Package templates for the create-package wizard.
--
-- Shape: every scalar the wizard edits is a real column so it can be filtered
-- and indexed; the five ordered nested lists (itinerary, payment milestones,
-- transport / document / readiness requirements) plus the small flight and
-- finance sub-objects are JSONB. A save is therefore a single-row upsert,
-- which keeps draft autosave atomic.
--
-- Deliberately NOT persisted: `year`, `startDate`, `endDate`, `guide` (dead
-- fields in the form type with no UI), and `customInclusionInput` /
-- `customExclusionInput` (transient text-input buffers). The mapper refills
-- them with defaults on read.

-- `gen_random_uuid()` is built into Postgres 13+, so no extension is required.

create table if not exists public.packages (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid()
                          references auth.users (id) on delete restrict,

  -- ── Step 1: Commercial identity ──────────────────────────────────────────
  title                     text    not null default '',
  internal_code             text    not null default '',
  description               text    not null default '',
  journey_type              text    not null default 'Umrah'
                              check (journey_type in ('Umrah', 'Hajj', 'Early Registration')),
  category                  text    not null default 'Umrah'
                              check (category in ('Umrah', 'Hajj')),
  season                    text    not null default '',
  package_category          text    not null default 'Standard'
                              check (package_category in ('Economy', 'Standard', 'Premium', 'VIP', 'Custom')),
  branch                    text    not null default '',
  visibility                text    not null default 'Internal Only'
                              check (visibility in ('Internal Only', 'Pilgrim Portal', 'Website & Portal')),
  status                    text    not null default 'Draft'
                              check (status in ('Draft', 'Open for Sale', 'Sales Closed', 'Archived')),
  featured                  boolean not null default false,
  default_capacity          integer check (default_capacity is null or default_capacity >= 0),
  min_group_size            integer check (min_group_size is null or min_group_size >= 0),
  waitlist_enabled          boolean not null default true,
  seat_hold_expiry          text    not null default '24 hours',
  suggested_guide_ratio     integer check (suggested_guide_ratio is null or suggested_guide_ratio >= 0),
  max_pilgrims              integer check (max_pilgrims is null or max_pilgrims >= 0),

  -- ── Step 2: Sales offer & pricing ────────────────────────────────────────
  currency                  text    not null default 'LKR',
  quad_price                numeric(14, 2) check (quad_price       is null or quad_price       >= 0),
  triple_price              numeric(14, 2) check (triple_price     is null or triple_price     >= 0),
  double_price              numeric(14, 2) check (double_price     is null or double_price     >= 0),
  single_price              numeric(14, 2) check (single_price     is null or single_price     >= 0),
  child_price               numeric(14, 2) check (child_price      is null or child_price      >= 0),
  infant_price              numeric(14, 2) check (infant_price     is null or infant_price     >= 0),
  early_bird_price          numeric(14, 2) check (early_bird_price is null or early_bird_price >= 0),
  early_bird_valid_until    date,
  price_valid_until         date,
  advance_deposit           numeric(14, 2) check (advance_deposit  is null or advance_deposit  >= 0),
  payment_milestones        jsonb   not null default '[]'::jsonb,
  payment_terms             text    not null default '',
  cancellation_policy       text    not null default '',
  late_payment_policy       text    not null default '',
  price_change_disclaimer   text    not null default '',
  finance_estimate          jsonb   not null default '{}'::jsonb,
  finance_role_view         text    not null default 'Admin'
                              check (finance_role_view in ('Admin', 'CEO', 'Finance', 'Marketing')),

  -- ── Step 3: Journey template ─────────────────────────────────────────────
  days                      integer not null default 1  check (days   >= 0),
  nights                    integer not null default 0  check (nights >= 0),
  duration                  text    not null default '',
  departure_origin          text    not null default '',
  arrival_gateway           text    not null default 'Jeddah',
  return_gateway            text    not null default 'Jeddah',
  flights_included          boolean not null default true,
  outbound_route            text    not null default '',
  return_route              text    not null default '',
  preferred_airlines        jsonb   not null default '[]'::jsonb,
  routing_preference        text    not null default 'Direct Preferred',
  cabin_class               text    not null default 'Economy',
  flight_type               text    not null default 'Direct'
                              check (flight_type in ('Direct', 'Transit')),
  airline                   text    not null default '',
  departure_airport         text    not null default '',
  arrival_airport           text    not null default '',
  departure_time            text    not null default '',
  arrival_time              text    not null default '',
  transit_airport           text    not null default '',
  transit_arrival_time      text    not null default '',
  transit_departure_time    text    not null default '',
  flight_legs               jsonb   not null default '[]'::jsonb,
  flight_routes             jsonb   not null default '[]'::jsonb,
  flight_options            jsonb   not null default '[]'::jsonb,
  itinerary                 jsonb   not null default '[]'::jsonb,

  -- ── Step 4: Service standards ────────────────────────────────────────────
  included_services             jsonb   not null default '[]'::jsonb,

  makkah_accommodation_standard text    not null default '',
  makkah_customer_wording       text    not null default '',
  makkah_nights                 integer not null default 0 check (makkah_nights >= 0),
  makkah_occupancies            jsonb   not null default '[]'::jsonb,
  makkah_target_distance        text    not null default '',
  makkah_meal_plan              text    not null default '',
  makkah_exact_hotel_guarantee  boolean not null default false,
  makkah_hotel                  text    not null default '',
  makkah_hotel_rating           text    not null default '',
  makkah_distance               text    not null default '',
  makkah_exact_display_name     text    not null default '',
  makkah_exact_notes            text    not null default '',

  madinah_accommodation_standard text   not null default '',
  madinah_customer_wording      text    not null default '',
  madinah_nights                integer not null default 0 check (madinah_nights >= 0),
  madinah_occupancies           jsonb   not null default '[]'::jsonb,
  madinah_target_distance       text    not null default '',
  madinah_meal_plan             text    not null default '',
  madinah_exact_hotel_guarantee boolean not null default false,
  madinah_hotel                 text    not null default '',
  madinah_hotel_rating          text    not null default '',
  madinah_distance              text    not null default '',
  madinah_exact_display_name    text    not null default '',
  madinah_exact_notes           text    not null default '',

  transport_type                text    not null default '',
  transport_requirements        jsonb   not null default '[]'::jsonb,
  inclusions                    jsonb   not null default '[]'::jsonb,
  exclusions                    jsonb   not null default '[]'::jsonb,

  -- ── Step 5: Traveller requirements ───────────────────────────────────────
  document_requirements             jsonb not null default '[]'::jsonb,
  seat_reservation_rule             text  not null default '',
  selected_communication_templates  jsonb not null default '[]'::jsonb,

  -- ── Step 6: Group creation defaults ──────────────────────────────────────
  default_group_capacity    integer check (default_group_capacity is null or default_group_capacity >= 0),
  default_group_status      text    not null default 'Planning',
  group_readiness_checklist jsonb   not null default '[]'::jsonb,

  -- ── Bookkeeping ──────────────────────────────────────────────────────────
  published_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.packages is
  'Package templates authored by the create-package wizard. Ordered nested lists are JSONB so a draft autosave is a single atomic row upsert.';

-- ── Indexes ────────────────────────────────────────────────────────────────
-- The list page filters by category/status and orders by recency.
create index if not exists packages_status_idx      on public.packages (status);
create index if not exists packages_category_idx    on public.packages (category);
create index if not exists packages_owner_idx       on public.packages (owner_id);
create index if not exists packages_updated_at_idx  on public.packages (updated_at desc);
-- Resuming "my most recent draft" from the wizard.
create index if not exists packages_owner_draft_idx on public.packages (owner_id, updated_at desc)
  where status = 'Draft';

-- ── updated_at maintenance ─────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists packages_set_updated_at on public.packages;
create trigger packages_set_updated_at
  before update on public.packages
  for each row execute function public.set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Shared agency catalogue: any signed-in staff member may read and edit every
-- package. Inserts must still stamp the creator so `owner_id` stays truthful.
alter table public.packages enable row level security;

drop policy if exists "staff read packages"   on public.packages;
drop policy if exists "staff insert packages" on public.packages;
drop policy if exists "staff update packages" on public.packages;
drop policy if exists "staff delete packages" on public.packages;

create policy "staff read packages"
  on public.packages for select
  to authenticated
  using (true);

create policy "staff insert packages"
  on public.packages for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "staff update packages"
  on public.packages for update
  to authenticated
  using (true)
  with check (true);

create policy "staff delete packages"
  on public.packages for delete
  to authenticated
  using (true);
