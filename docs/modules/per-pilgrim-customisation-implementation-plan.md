# Per-Pilgrim Customisation — Implementation Plan

Status: **plan only. Nothing in here is implemented.**

The problem this plan solves:

```text
A Package Template is a promise made to a market.
A Departure Group is that promise made to one flight-load of people.
An individual pilgrim is the only level at which the promise is actually delivered —
and it is the only level the system currently has no way to vary.
```

Today the copy chain is `packages` → `departure_group_package_snapshots` → group-level
operational rows. Every one of those layers is **group grain**. The moment one traveller
in a group of forty wants a single room, an extra two nights in Madinah, a discount
because they are the group organiser's brother, or to skip the group flight and meet
everyone in Jeddah, there is nowhere to put that fact.

This plan does **not** propose making the package template per-pilgrim. It proposes a
thin, auditable **deviation layer** that sits between the frozen group snapshot and the
individual, so the group stays the unit of operations and the pilgrim becomes the unit
of delivery and price.

---

## 1. What exists today

### 1.1 The copy chain

| Stage | Code | Grain |
| --- | --- | --- |
| Template authored | `packages` table, [create-package wizard](<app/(main)/packages/create-package/components/create-package-wizard.tsx>) | Catalogue |
| Frozen at group creation | [`buildPackageSnapshot()`](lib/data/departure-groups-copy.ts:309) → `departure_group_package_snapshots` | Group, immutable |
| Copied to live editable rows | [`buildReadinessItems()`](lib/data/departure-groups-copy.ts:369), [`buildAccommodations()`](lib/data/departure-groups-copy.ts:486), [`buildTransports()`](lib/data/departure-groups-copy.ts:524) | Group, editable |
| Expanded per traveller | [`buildPilgrimDocuments()`](lib/data/departure-groups-copy.ts:437) → `departure_group_pilgrim_documents` | **Pilgrim** |
| Expanded per traveller | [`seedPilgrimPaymentMilestones()`](lib/data/departure-groups.ts:1899) → `pilgrim_payment_milestones` | **Pilgrim, but a derived even split** |

Only two things already reach pilgrim grain, and only one of them is authoritative.

### 1.2 The three grains, and the mismatch

```text
GROUP GRAIN          departure_group_package_snapshots   pricing, itinerary, inclusions,
                                                         accommodation standards, transport
                     departure_group_flights             one outbound + one return, for everyone
                     departure_group_accommodations      one block per city, for everyone
                     departure_group_transports          one card per route, for everyone

BOOKING GRAIN        departure_group_bookings            package_price_per_person,
                                                         total_booking_value, amount_paid,
                                                         outstanding_balance,
                                                         room_occupancy_preference
                     booking_payment_milestones          the real schedule

PILGRIM GRAIN        departure_group_pilgrims            statuses only — no money, no services
                     departure_group_pilgrim_documents   the one genuinely per-person artefact
                     pilgrim_payment_milestones          a projection, split evenly
```

**The mismatch is the whole problem.** Price is a `numeric` on the booking
([migration](supabase/migrations/20260809090000_create_departure_groups.sql:301)) and is
computed as a flat multiplication in
[`createGroupBookingInStore()`](lib/data/departure-groups-bookings.ts:181):

```ts
const pricePerPerson = money(Math.max(input.packagePricePerPerson, 0));
const totalValue = money(pricePerPerson * input.travellerCount);
```

A family of four on one booking is therefore four *identical* travellers by construction.
There is no representation for "the father takes a single room, the three children share a
triple", let alone "the mother stays nine extra nights".

### 1.3 The specific gaps found in the code

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | **No per-pilgrim price.** `departure_group_pilgrims` has zero money columns. | [migration](supabase/migrations/20260809090000_create_departure_groups.sql:325) |
| G2 | **Room type is a booking-level *preference*, and nothing enforces it.** [`autoAssignRoomsInStore()`](lib/data/departure-groups-rooming.ts:404) fills the first room with a free bed and never reads `room_occupancy_preference`. A pilgrim billed QUAD can silently land in a DOUBLE. | [rooming](lib/data/departure-groups-rooming.ts:452) |
| G3 | **Repricing is booking-wide.** `changeBookingRoomPreference` and `moveBookingToGroup` both take a single `pricePerPerson` and multiply it across every traveller. | [bookings](lib/data/departure-groups-bookings.ts:637), [bookings](lib/data/departure-groups-bookings.ts:1267) |
| G4 | **`pilgrim_payment_milestones` is fiction for a mixed booking.** It divides the schedule evenly per head, so the single-room upgrade never appears on the upgrader's schedule. | [`seedPilgrimPaymentMilestones()`](lib/data/departure-groups.ts:1899) |
| G5 | **Itinerary is read-only and group-wide.** `itinerary_snapshot` is rendered by [`departure-groups.ts:1429`](lib/data/departure-groups.ts:1429) and never written after creation, at any grain. | — |
| G6 | **Inclusions / exclusions are group-wide strings.** No way to record "this traveller declined the Ziyarah tour" or "add airport meet-and-greet". | [copy](lib/data/departure-groups-copy.ts:333) |
| G7 | **Flights are group-wide.** `departure_group_pilgrims.flight_status` tracks a state, not a *different itinerary*. Land-only, self-ticketing and open-jaw travellers are unrepresentable. | [migration](supabase/migrations/20260809090000_create_departure_groups.sql:339) |
| G8 | **Accommodation nights are group-wide.** Check-in/out dates live on `departure_group_accommodations`; extra or fewer nights per person cannot be recorded. | [copy](lib/data/departure-groups-copy.ts:486) |
| G9 | **Documents are per-pilgrim but not per-pilgrim-*customisable*.** Every traveller gets the identical snapshot list. There is a `waiveDocumentAction` and a `NOT_APPLICABLE` status, but no way to *add* a requirement for one person (e.g. a mahram letter, a minor's consent form). | [actions](<app/(main)/departure-groups/actions.ts:1593>) |
| G10 | **`finance_adjustments` exists and is booking grain.** It already has `DISCOUNT`, `ROOM_UPGRADE_CHARGE`, approval columns — but nothing writes it, and it cannot name *which traveller*. | [migration](supabase/migrations/20260818090000_finance_payments.sql:466) |
| G11 | **Medical / accessibility needs already live at person grain and are disconnected from operations.** `pilgrim_medical_records` (wheelchair, dietary, special assistance) and `pilgrim_support_requests` exist, but nothing links them to a room, a seat, a transport card or a cost. | [migration](supabase/migrations/20260813090000_create_pilgrims.sql:70) |

---

## 2. What should be customisable per pilgrim

Not everything should be. The design rule this plan applies:

> **Customise at pilgrim grain only what is delivered to one person.
> Keep at group grain anything a supplier is contracted for.**

A hotel block is contracted for the group. *Which bed a person sleeps in, for how many
nights, at what price* is delivered to the person.

### 2.1 The catalogue

| # | Thing | Customise? | Grain | Mechanism |
| --- | --- | --- | --- | --- |
| **Pricing** | | | | |
| P1 | Base fare (occupancy tier rate) | ✅ Yes | Pilgrim | Priced line, seeded from snapshot tier |
| P2 | Discount (loyalty, family, organiser, hardship) | ✅ Yes | Pilgrim | Priced line, negative, approval-gated |
| P3 | Surcharge (single supplement, peak date, late booking) | ✅ Yes | Pilgrim | Priced line, positive |
| P4 | Price correction / goodwill credit | ✅ Yes | Pilgrim | Priced line, approval-gated |
| P5 | Currency | ❌ No | Group | One currency per group; multi-currency is a separate project |
| **Payment terms** | | | | |
| P6 | Instalment schedule (dates + amounts) | ✅ Yes | Pilgrim | Already booking grain; regenerate per pilgrim from their own total |
| P7 | Deposit amount | ✅ Yes | Pilgrim | Falls out of P6 |
| P8 | Cancellation / refund policy text | ⚠️ Override only | Pilgrim | Free-text override on the deviation record, snapshot default |
| **Accommodation** | | | | |
| A1 | Room occupancy type | ✅ Yes | Pilgrim | Move `room_occupancy_preference` to pilgrim grain (booking keeps a default) |
| A2 | Extra / fewer nights (pre- or post-tour) | ✅ Yes | Pilgrim | Deviation record + priced line; does **not** move the group block |
| A3 | Specific hotel upgrade | ✅ Yes | Pilgrim | Deviation record naming the hotel + priced line |
| A4 | Meal plan | ✅ Yes | Pilgrim | Deviation record + priced line |
| A5 | Roommate request / must-share-with | ✅ Yes | Pilgrim | Rooming hint, feeds auto-assign |
| A6 | The group's hotel contract itself | ❌ No | Group | Supplier commitment |
| **Flights** | | | | |
| F1 | Land-only (no group ticket) | ✅ Yes | Pilgrim | Deviation record + negative priced line |
| F2 | Different flight / own ticketing | ✅ Yes | Pilgrim | Deviation record carrying its own PNR + dates |
| F3 | Extended stay / different return date | ✅ Yes | Pilgrim | Deviation record + priced line |
| F4 | Cabin upgrade | ✅ Yes | Pilgrim | Deviation record + priced line |
| F5 | Seat / meal preference | ✅ Yes | Pilgrim | Preference field, no price |
| F6 | The group PNR and seat block | ❌ No | Group | `departure_group_flights` |
| **Itinerary & services** | | | | |
| I1 | Opt out of an itinerary day / excursion | ✅ Yes | Pilgrim | Deviation record referencing `itinerary_snapshot[].id` |
| I2 | Add a private excursion / Ziyarah | ✅ Yes | Pilgrim | Deviation record + priced line |
| I3 | Add-on services (Qurbani, laundry, SIM, wheelchair, meet-and-greet, extra baggage) | ✅ Yes | Pilgrim | **Catalogued add-on** + priced line |
| I4 | Inclusion / exclusion wording for this person | ⚠️ Derived | Pilgrim | Render snapshot list ± this pilgrim's deviations; never store a second list |
| I5 | The group itinerary itself | ❌ No | Group | Snapshot, immutable |
| **Transport** | | | | |
| T1 | Private transfer instead of coach | ✅ Yes | Pilgrim | Deviation record + priced line |
| T2 | Different pickup point / self-arrival | ✅ Yes | Pilgrim | Deviation record |
| T3 | Wheelchair / mobility assistance on transfers | ✅ Yes | Pilgrim | Sourced from `pilgrim_medical_records`, surfaced as a requirement |
| **Documents & visa** | | | | |
| D1 | Waive a requirement for this person | ✅ Already | Pilgrim | `waiveDocumentAction`, `NOT_APPLICABLE` |
| D2 | **Add** a requirement for this person only | ✅ Yes | Pilgrim | Add `source` to `departure_group_pilgrim_documents`, allow manual rows |
| D3 | Different due stage for this person | ✅ Yes | Pilgrim | Make `required_by_stage` editable with an audit reason |
| D4 | Visa type / nationality-specific route | ✅ Yes | Pilgrim | Already per-pilgrim; needs the requirement set to follow nationality |
| **Group-level, explicitly not per-pilgrim** | | | | |
| X1 | Departure / return date of the group | ❌ | Group | F3 records the *individual's* deviation instead |
| X2 | Capacity, minimum group size, seat holds | ❌ | Group | — |
| X3 | Guide, coordinator, emergency contacts | ❌ | Group | — |
| X4 | Readiness checklist | ❌ | Group | Group readiness may *depend* on pilgrim deviations, not be one |
| X5 | Supplier commitments and internal costs | ❌ | Group | Deviations may create a *new* supplier commitment, not edit the group's |

### 2.2 The two mechanisms

Everything above collapses into exactly two new concepts, which is what keeps this
tractable:

1. **A priced line** (`departure_group_pilgrim_charges`) — the money. One row per
   chargeable thing on one traveller. The pilgrim's total is the sum of their lines; the
   booking's total is the sum of its pilgrims' lines. This replaces
   `package_price_per_person × traveller_count` as the source of truth.

2. **A deviation** (`departure_group_pilgrim_deviations`) — the operational fact. "This
   traveller is land-only." "This traveller has three extra nights in Madinah, 21–24 Mar."
   It has a status so Operations must actually action it, and it optionally points at a
   priced line so the money and the operation can never drift apart.

An add-on catalogue (`agency_service_addons`) makes I3 selectable rather than free-text,
so reporting can answer "how much Qurbani revenue did we take this season".

---

## 3. Data model

### 3.1 New migration: `20260823090000_pilgrim_customisation.sql`

Additive only. Safe on a database with `20260808090000` … `20260822090000` applied.

#### A. `agency_service_addons` — the catalogue

```sql
create table if not exists public.agency_service_addons (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,                 -- QURBANI, MEET_GREET, WHEELCHAIR…
  name                text not null,
  description         text not null default '',
  category            text not null default 'OTHER'
                        check (category in ('ACCOMMODATION','FLIGHT','TRANSPORT','RITUAL',
                                            'ASSISTANCE','INSURANCE','MERCHANDISE','OTHER')),
  default_amount      numeric(14,2) check (default_amount is null or default_amount >= 0),
  currency            text not null default 'LKR',
  -- Some add-ons are per-night / per-day rather than a flat fee.
  unit                text not null default 'FLAT'
                        check (unit in ('FLAT','PER_NIGHT','PER_DAY','PER_KG')),
  -- Whether taking this add-on requires an ops deviation record too.
  creates_deviation   boolean not null default false,
  journey_types       text[] not null default '{}',  -- empty = all
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint agency_service_addons_code_unique unique (code)
);
```

Lives beside the other agency settings tables from
[`20260821090000_agency_settings.sql`](supabase/migrations/20260821090000_agency_settings.sql)
and is managed from Settings, not from a group.

#### B. `departure_group_pilgrim_charges` — the money, at last at the right grain

```sql
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
  -- Signed: discounts are negative. BASE_FARE must be >= 0 (below).
  amount                numeric(14,2) not null,
  quantity              numeric(10,2) not null default 1,
  currency              text not null default 'LKR',

  -- Provenance: what this line came from, so a regenerated base fare can be
  -- told apart from a hand-typed one and safely replaced.
  source                text not null default 'MANUAL'
                          check (source in ('SNAPSHOT','MANUAL','ADDON_CATALOGUE','SYSTEM')),
  -- The occupancy tier this BASE_FARE was priced at. Null for other types.
  priced_room_type      text check (priced_room_type is null or
                                    priced_room_type in ('QUAD','TRIPLE','DOUBLE','SINGLE','OTHER')),

  reason                text,
  -- Mirrors finance_adjustments: negative money above a threshold needs a second pair of eyes.
  requires_approval     boolean not null default false,
  approved_by           uuid references auth.users (id) on delete set null,
  approved_by_name      text,
  approved_at           timestamptz,
  voided_at             timestamptz,
  void_reason           text,

  created_by            uuid references auth.users (id) on delete set null,
  created_by_name       text not null default 'Staff',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Exactly one live BASE_FARE per traveller.
  constraint pilgrim_charges_base_fare_sign
    check (charge_type <> 'BASE_FARE' or amount >= 0),
  constraint pilgrim_charges_discount_sign
    check (charge_type <> 'DISCOUNT' or amount <= 0),
  constraint pilgrim_charges_approval_reason
    check (not requires_approval or coalesce(btrim(reason), '') <> ''),
  constraint pilgrim_charges_void_reason
    check (voided_at is null or coalesce(btrim(void_reason), '') <> '')
);

create unique index if not exists pilgrim_charges_one_base_fare
  on public.departure_group_pilgrim_charges (group_pilgrim_id)
  where charge_type = 'BASE_FARE' and voided_at is null;

create index if not exists pilgrim_charges_pilgrim_idx on public.departure_group_pilgrim_charges (group_pilgrim_id);
create index if not exists pilgrim_charges_booking_idx on public.departure_group_pilgrim_charges (booking_id);
create index if not exists pilgrim_charges_group_idx   on public.departure_group_pilgrim_charges (departure_group_id, charge_type);
create index if not exists pilgrim_charges_approval_idx
  on public.departure_group_pilgrim_charges (departure_group_id)
  where requires_approval and approved_at is null and voided_at is null;
```

Rationale for the shape:

- **Signed amounts, one table.** A separate discounts table would double every rollup
  query and every UI list. `finance_adjustments` already proved signed-amount modelling is
  the house style ([`amount numeric not null check (amount <> 0)`](supabase/migrations/20260818090000_finance_payments.sql:471)).
- **`voided_at` not `delete`.** The finance module's hardest constraint is "a payment is
  never deleted". A charge line that has been invoiced is in the same category.
- **`source`** is what lets a reprice safely regenerate `SNAPSHOT`-sourced base fares
  while leaving hand-entered lines untouched — the failure mode that would otherwise wipe
  a negotiated discount every time someone changes a room type.

#### C. `departure_group_pilgrim_deviations` — the operational fact

```sql
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

  -- Free-form but typed payload: the fields a given deviation type needs.
  -- e.g. EXTRA_NIGHTS -> { city, nights, check_out_date }
  --      OWN_FLIGHT   -> { airline, flight_number, pnr, departure_at, arrival_at }
  --      ITINERARY_OPT_OUT -> { itinerary_item_id }
  detail                jsonb not null default '{}'::jsonb,
  summary               text not null default '',      -- one line, printable on the manifest

  status                text not null default 'REQUESTED'
                          check (status in ('REQUESTED','APPROVED','ARRANGED','DECLINED','CANCELLED')),
  -- Who has to do something about it. Drives the Operations queue.
  responsible_role      text not null default 'OPERATIONS'
                          check (responsible_role in ('ADMIN','OPERATIONS','VISA','FINANCE','GUIDE','MARKETING')),
  -- Whether this must be resolved before the group can depart.
  blocks_departure      boolean not null default false,

  -- The money side, if any. One deviation, at most one charge line.
  charge_id             uuid references public.departure_group_pilgrim_charges (id) on delete set null,
  -- If arranging it created a supplier booking of its own.
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
    check (status in ('REQUESTED') or decided_by_name is not null)
);

create index if not exists pilgrim_deviations_pilgrim_idx on public.departure_group_pilgrim_deviations (group_pilgrim_id);
create index if not exists pilgrim_deviations_group_idx   on public.departure_group_pilgrim_deviations (departure_group_id, status);
create index if not exists pilgrim_deviations_open_idx
  on public.departure_group_pilgrim_deviations (departure_group_id)
  where status in ('REQUESTED','APPROVED');
create index if not exists pilgrim_deviations_blocking_idx
  on public.departure_group_pilgrim_deviations (departure_group_id)
  where blocks_departure and status not in ('ARRANGED','DECLINED','CANCELLED');
```

`detail jsonb` rather than eighteen nullable columns is the same trade-off the packages
table already makes for its ordered nested lists — validated by Zod in
`lib/validations/departure-groups.ts` per `deviation_type`, so the shape is enforced in
the application even though the column is loose.

#### D. Column additions

```sql
-- Room type becomes a per-person fact; the booking keeps a default for the
-- "add a booking" form and for bookings with no deviations.
alter table public.departure_group_pilgrims
  add column if not exists room_occupancy_type text
    check (room_occupancy_type is null or
           room_occupancy_type in ('QUAD','TRIPLE','DOUBLE','SINGLE','OTHER')),
  -- Derived caches, maintained by the application alongside the charge lines,
  -- so the manifest and the pilgrims table do not need a rollup per row.
  add column if not exists total_price      numeric(14,2) not null default 0,
  add column if not exists amount_paid      numeric(14,2) not null default 0,
  add column if not exists has_customisations boolean not null default false;

-- Documents: distinguish template-copied requirements from ones added for one person.
alter table public.departure_group_pilgrim_documents
  add column if not exists source text not null default 'SNAPSHOT'
    check (source in ('SNAPSHOT','MANUAL')),
  add column if not exists stage_changed_reason text;
```

#### E. Rollup views

```sql
create or replace view public.pilgrim_price_rows as
select
  p.id                                              as group_pilgrim_id,
  p.departure_group_id,
  p.booking_id,
  coalesce(sum(c.amount * c.quantity) filter (where c.voided_at is null), 0)          as total_price,
  coalesce(sum(c.amount * c.quantity) filter (where c.voided_at is null
                                                and c.charge_type = 'BASE_FARE'), 0)  as base_fare,
  coalesce(sum(c.amount * c.quantity) filter (where c.voided_at is null
                                                and c.charge_type = 'DISCOUNT'), 0)   as discount_total,
  count(c.id) filter (where c.voided_at is null
                        and c.charge_type not in ('BASE_FARE'))                       as customisation_count
from public.departure_group_pilgrims p
left join public.departure_group_pilgrim_charges c on c.group_pilgrim_id = p.id
group by p.id, p.departure_group_id, p.booking_id;

create or replace view public.booking_price_rows as
select booking_id,
       sum(total_price)         as total_booking_value,
       sum(base_fare)           as base_fare_total,
       sum(discount_total)      as discount_total,
       sum(customisation_count) as customisation_count
from public.pilgrim_price_rows
group by booking_id;
```

#### F. Backfill

Every existing traveller gets one `BASE_FARE` line at
`booking.package_price_per_person`, `source = 'SNAPSHOT'`,
`priced_room_type = booking.room_occupancy_preference`, and
`departure_group_pilgrims.room_occupancy_type` is set from the booking preference.
After the backfill, `booking_price_rows.total_booking_value` equals the existing
`departure_group_bookings.total_booking_value` for every booking — **this equality is the
migration's acceptance test** and should be asserted in the migration body, raising a
notice on any mismatch rather than failing.

---

## 4. Application layer

### 4.1 New / changed data modules

| File | Change |
| --- | --- |
| `lib/data/departure-groups-charges.ts` | **New.** Pure, store-passing, testable — same posture as [`departure-groups-bookings.ts`](lib/data/departure-groups-bookings.ts). `addChargeInStore`, `voidChargeInStore`, `approveChargeInStore`, `rebuildBaseFareInStore`, `recomputePilgrimTotalsInStore`, `recomputeBookingTotalsInStore`. |
| `lib/data/departure-groups-deviations.ts` | **New.** `requestDeviationInStore`, `decideDeviationInStore`, `markDeviationArrangedInStore`. Each type has a handler that knows what a `SERVICE_ADDON` or an `EXTRA_NIGHTS` does when approved (create the paired charge, flag the accommodation). |
| [`lib/data/departure-groups-copy.ts`](lib/data/departure-groups-copy.ts) | Add `buildPilgrimBaseFare()` beside `buildPilgrimDocuments()` — the seat's tier rate from `pricing_snapshot`, chosen by the pilgrim's room type. |
| [`lib/data/departure-groups-bookings.ts`](lib/data/departure-groups-bookings.ts:181) | `createGroupBookingInStore` stops computing `pricePerPerson × travellerCount`. It creates one `BASE_FARE` line per traveller — honouring a per-traveller room type if the caller supplied one — then derives the booking totals from the lines. `changeBookingRoomPreference` and `moveBookingToGroup` regenerate only `source='SNAPSHOT'` base fares. |
| [`lib/data/departure-groups-money.ts`](lib/data/departure-groups-money.ts) | Add `sumChargeLines()` so every caller rounds identically. `derivePaymentStatus` is unchanged but now runs at pilgrim grain too. |
| [`lib/data/departure-groups.ts`](lib/data/departure-groups.ts:1899) | `seedPilgrimPaymentMilestones` stops dividing evenly. Each pilgrim's schedule is expanded from `payment_schedule_snapshot` against **their own** `total_price`. Percentage milestones finally resolve correctly. |
| [`lib/data/departure-groups-rooming.ts`](lib/data/departure-groups-rooming.ts:404) | `autoAssignRoomsInStore` must respect `departure_group_pilgrims.room_occupancy_type` — match room type first, keep booking-mates together second, and report a skip rather than silently downgrading someone (fixes **G2**). |
| `lib/data/departure-groups-repository.ts` | Selects and writers for the two new tables; add to `DepartureGroupStore`. |
| `lib/data/settings-repository.ts` | CRUD for `agency_service_addons`. |

### 4.2 Types

- `lib/types/departure-groups.ts` — `DepartureGroupPilgrimChargeRow`, `DepartureGroupPilgrimDeviationRow`, `ChargeType`, `DeviationType`, `DeviationStatus`, `ChargeSource`; extend `DepartureGroupStore`.
- `app/(main)/departure-groups/types.ts` — `PilgrimCharge`, `PilgrimDeviation`, `PilgrimPriceBreakdown`; extend `DepartureGroupPilgrim` with `roomOccupancyType`, `totalPrice`, `charges`, `deviations`, `hasCustomisations`; extend `DepartureGroupManifestRow` the same way.
- `lib/types/settings.ts` — `ServiceAddon`.

### 4.3 Validation

`lib/validations/departure-groups.ts` gains a **discriminated union on `deviationType`**,
so `EXTRA_NIGHTS` requires `{ city, nights }` and `OWN_FLIGHT` requires
`{ airline, flightNumber, departureAt, arrivalAt }`. This is what makes the `detail jsonb`
column safe.

### 4.4 Access control

[`lib/access/departure-groups-access.ts`](lib/access/departure-groups-access.ts:33) gains:

| Capability | Who |
| --- | --- |
| `manageTravellerCustomisations` | Admin, Operations, Sales — request deviations and add non-negative charges |
| `approveDiscounts` | Admin, CEO, Finance — approve any negative line, and any line over the settings threshold |
| `viewPilgrimPricing` | Anyone with `viewFinance`; Guide sees the *deviation*, never the *amount* |

The existing `overrideCapacityAndPrice` becomes the gate for editing a `BASE_FARE`
directly. The discount approval threshold is a new agency setting, defaulting to "any
negative amount requires approval" — safer than a number picked here.

### 4.5 Server actions

New, in [`app/(main)/departure-groups/actions.ts`](<app/(main)/departure-groups/actions.ts>),
following the exact shape of the existing ones (Zod parse → capability check → data-layer
call → `revalidatePath` → discriminated result):

```text
addPilgrimChargeAction          voidPilgrimChargeAction        approvePilgrimChargeAction
setPilgrimRoomTypeAction        requestPilgrimDeviationAction  decidePilgrimDeviationAction
markDeviationArrangedAction     addPilgrimDocumentRequirementAction
```

Every one writes a `departure_group_activity_logs` row (`entity_type` gains
`'CHARGE'` and `'DEVIATION'`), and anything touching money also writes
`finance_activity_events` — the finance module's rule that the group Activity tab keeps
telling the whole story.

---

## 5. UI

### 5.1 Departure group — Pilgrims & Bookings tab

[`pilgrims-bookings-tab.tsx`](<app/(main)/departure-groups/[groupId]/components/tabs/pilgrims-bookings-tab.tsx>):

- New **Customised** column — a badge showing the deviation count, or "—". Sortable and
  filterable, because "show me everyone who is not on the standard package" is the
  question Operations will actually ask.
- Row action → **Customise traveller** opens a new drawer.

### 5.2 New: `pilgrim-customisation-drawer.tsx`

Modelled on the existing
[`pilgrim-documents-drawer.tsx`](<app/(main)/departure-groups/[groupId]/components/pilgrim-documents-drawer.tsx>).
Three sections:

1. **Price breakdown** — base fare (with the tier it was priced at), then every line with
   its type, amount, who added it and whether it is awaiting approval. Running total at
   the bottom against the amount paid. Hidden entirely without `viewPilgrimPricing`.
2. **Deviations** — grouped by category (Stay / Flight / Transport / Services), each with
   its status chip and the role responsible. "Request deviation" opens a type-driven form.
3. **Documents** — the existing checklist, plus "Add requirement for this traveller".

### 5.3 New: `add-pilgrim-charge-dialog.tsx` / `request-deviation-dialog.tsx`

The deviation dialog is **type-first**: pick the type, then render only that type's fields
(the discriminated union from §4.3), and show the paired charge inline with the catalogue
default pre-filled when the add-on has one.

### 5.4 Elsewhere

| Screen | Change |
| --- | --- |
| [`add-booking-sheet.tsx`](<app/(main)/departure-groups/components/add-booking-sheet.tsx>) | Per-traveller room type selector, so a mixed-occupancy family is representable at the moment of sale rather than fixed up afterwards. |
| [Overview tab](<app/(main)/departure-groups/[groupId]/components/tabs/overview-tab.tsx>) | New blocker line: "N traveller customisations unarranged", "N discounts awaiting approval". |
| [Readiness tab](<app/(main)/departure-groups/[groupId]/components/tabs/readiness-tab.tsx>) | A group with `blocks_departure` deviations outstanding cannot reach `READY_TO_DEPART`. |
| [Payments tab](<app/(main)/departure-groups/[groupId]/components/tabs/payments-tab.tsx>) | Expected revenue reads the rollup view. Add a "customisation revenue" line. |
| [`manifest.ts`](<app/(main)/departure-groups/manifest.ts>) / [`csv.ts`](<app/(main)/departure-groups/csv.ts>) / [`xlsx.ts`](<app/(main)/departure-groups/xlsx.ts>) | Manifest gains room type (actual, not booking preference) and a deviations summary column. **The guide's manifest must show the deviation, never the amount.** |
| Pilgrim profile | A "This journey" price breakdown replacing the evenly-split fiction. |
| Finance receivables | `finance_receivable_rows` reads the booking rollup; a per-traveller drill-down. |
| Settings | New "Service add-ons" section managing `agency_service_addons`. |
| Reports | New: customisation revenue by add-on, discount total by approver, deviation volume per group. |

---

## 6. Invariants

These are the things that must be true after every mutation, and they belong in unit
tests against the pure store modules:

1. `booking.total_booking_value == Σ(live charge lines of its pilgrims)`.
2. `Σ(booking_payment_milestones.amount) == booking.total_booking_value` — a charge added
   after the schedule exists must create an `ADJUSTMENT` milestone, not silently
   desynchronise. This is the trickiest consequence of the whole plan.
3. Exactly one live `BASE_FARE` per traveller (DB-enforced by the partial unique index).
4. `amount_paid` never exceeds `total_price` at either grain — a discount applied *after*
   full payment must produce a refund request, not a negative balance.
5. A voided charge is never deleted, and its void reason is mandatory.
6. Cancelling a booking voids its live charges with reason `BOOKING_CANCELLED`; it does
   not delete them.
7. `pilgrim.room_occupancy_type` and the room they are assigned to must agree, or the
   rooming tab shows a mismatch warning.
8. A deviation with a `charge_id` cannot be `DECLINED` while its charge is live.

---

## 7. Phasing

Each phase is independently shippable and leaves the system consistent.

| Phase | Scope | Ships |
| --- | --- | --- |
| **1** | Migration §3 + backfill + repository + types. No behaviour change; both totals computed and compared in logs. | Nothing user-visible |
| **2** | `departure-groups-charges.ts`, booking creation writes charge lines, totals derived from the rollup. `overrideCapacityAndPrice`-gated per-traveller base fare edit. | Per-pilgrim base fare, mixed-occupancy bookings |
| **3** | Per-pilgrim room type + rooming respects it (**G2**). Auto-assign match-by-type. | The single most commonly requested adjustment |
| **4** | Discounts and surcharges with the approval flow. Activity + finance events. | P2, P3, P4 |
| **5** | `agency_service_addons` + Settings CRUD + `SERVICE_ADDON` deviations. | I3 |
| **6** | `departure_group_pilgrim_deviations` and the full drawer: stay, flight, transport, itinerary. Readiness gate. | A2–A5, F1–F5, T1–T3, I1–I2 |
| **7** | Per-pilgrim payment schedules from their own total (**G4**), `ADJUSTMENT` milestones. | P6, P7 |
| **8** | Per-pilgrim document requirements (**G9**, D2, D3), nationality-driven visa requirement sets (D4). | D2–D4 |
| **9** | Manifest / CSV / XLSX columns, reports, finance drill-down. | Reporting |

Phases 1–3 are the load-bearing ones; if the project stops after Phase 3 it has still
fixed the two real correctness bugs (G2 and the mixed-occupancy impossibility).

---

## 8. Risks and decisions to confirm

| # | Risk | Mitigation / question for the business |
| --- | --- | --- |
| R1 | **Migrating price to a derived value touches the finance module's core.** `booking_payment_milestones` and `payment_allocations` assume a stable booking total. | Phase 1 runs both computations side by side and logs divergence before anything switches over. Invariant 2 is the acceptance criterion. |
| R2 | **A discount after full payment.** | Route to `refund_requests`, which already exists. Never let a balance go negative. |
| R3 | **Deviations that the group cannot honour** (a traveller wants a hotel the group has no contract with). | `status = 'DECLINED'` with a reason is a first-class outcome, and `supplier_commitment_id` records when arranging one created a genuinely new supplier booking. |
| R4 | **Guides seeing prices.** | `viewPilgrimPricing` gates amounts everywhere including exports; the guide manifest shows deviations only. |
| R5 | **Snapshot immutability.** Nothing in this plan writes to `departure_group_package_snapshots`, and nothing should. | Deviations reference snapshot ids (`itinerary_item_id`, `requirement_id`) exactly as transport and readiness already do. |
| R6 | **Scope creep into a full product configurator.** | The add-on catalogue is deliberately flat — no bundles, no dependencies, no per-group pricing overrides. Revisit only with evidence. |

**Open questions for the business before Phase 4:**

1. Does a discount always require approval, or only above a threshold — and is the
   threshold per-role?
2. When a traveller takes extra nights, does the agency book them into the group's hotel
   block (consuming a room) or as a separate supplier booking? This changes whether
   `EXTRA_NIGHTS` touches `departure_group_accommodations`.
3. Is a land-only traveller still counted against the group's flight seat block?
4. Should the pilgrim portal (once it exists) be able to *request* a deviation, or only
   view one? `pilgrim_support_requests.raised_by_portal` suggests the former is intended.
