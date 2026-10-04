# Per-Pilgrim Service Customisation (Flight · Hotel · Itinerary) — Implementation Plan

Status: **plan only. Nothing in here is implemented.**

Companion to [per-pilgrim-customisation-implementation-plan.md](docs/per-pilgrim-customisation-implementation-plan.md),
which built the *storage* layer (charges + deviations). This plan builds the **capture and
delivery** layer on top of it: the part that lets a staff member actually say *which* flight,
*which* hotel, *which* itinerary days — and lets Operations see it where they work.

---

## 1. The actual problem

Opening **Departure Groups → a group → Pilgrims & Bookings → ⋯ → Customise Traveller** today
gives a dialog with three sections:

| Section | Control | Grain of what you can express |
| --- | --- | --- |
| Room occupancy | 5 buttons — QUAD / TRIPLE / DOUBLE / SINGLE / OTHER | **Structured.** Writes `departure_group_pilgrims.room_occupancy_type`. |
| Price breakdown | type dropdown + amount + free-text label | Money only. No link to any service. |
| Deviations | type dropdown + **one free-text textarea** + a checkbox | **Prose.** Nothing machine-readable. |

So the observation is exactly right: **the occupancy grid is the only thing on that screen you
can genuinely *change*.** Everything else is a sentence somebody types.

The root cause is one line — [pilgrim-customisation-drawer.tsx:230](<app/(main)/departure-groups/[groupId]/components/pilgrim-customisation-drawer.tsx>:230):

```ts
requestPilgrimDeviationAction({
  departureGroupId,
  groupPilgrimId: row.id,
  deviationType,
  summary: deviationSummary,
  blocksDeparture: deviationBlocks,
  detail: {},          // ← always empty. Every deviation type, every time.
})
```

The database column `departure_group_pilgrim_deviations.detail jsonb` exists. The Zod schemas
`ownFlightDetail`, `extraNightsDetail`, `itineraryDetail` exist in
[lib/validations/departure-groups.ts:1005](lib/validations/departure-groups.ts:1005). The
deviation types `OWN_FLIGHT`, `HOTEL_UPGRADE`, `CABIN_UPGRADE`, `SEAT_PREFERENCE`,
`EXTENDED_STAY`, `ITINERARY_OPT_OUT`, `ITINERARY_ADDITION` all exist and are enforced by a
CHECK constraint in `20260823090000_pilgrim_customisation.sql`. **None of it is ever
populated.** The backend was built for this; the form was not.

### 1.1 What is missing, precisely

1. **No structured capture.** One textarea serves eighteen deviation types.
2. **No entity linkage.** "Own flight" cannot point at a `departure_group_flights` row;
   "hotel upgrade" cannot point at a `departure_group_accommodations` row; "itinerary
   opt-out" cannot point at a `snapshot.itinerary[].id`. The drawer never receives those
   collections as props — see
   [pilgrim-customisation-drawer.tsx:120](<app/(main)/departure-groups/[groupId]/components/pilgrim-customisation-drawer.tsx>:120).
3. **No detail rendering.** The deviation list renders `summary` and nothing else, so even a
   populated `detail` would be invisible.
4. **Money and operation are captured separately.** `requestDeviationSchema` accepts
   `chargeId`, and `decideDeviationInStore` already voids the paired charge on a decline
   ([lib/data/departure-groups-deviations.ts](lib/data/departure-groups-deviations.ts)) — but
   the UI never passes one, so the link is always null. A single-room upgrade is two unrelated
   records typed by two hands.
5. **Operations never sees it.** Nothing on the Flights, Hotels & Rooms, Transport or
   Readiness tabs surfaces per-pilgrim deviations. An approved `OWN_FLIGHT` does not remove
   the traveller from the group seat count; an approved `EXTRA_NIGHTS` does not appear beside
   the hotel block whose nights it extends.
6. **`agency_service_addons` has zero code references.** The catalogue table was created and
   never wired to anything — no Settings screen, no picker. Every add-on is a hand-typed label.
7. **Itinerary is invisible in the group UI.** `snapshot.itinerary[]` is loaded
   ([lib/data/departure-groups.ts:1541](lib/data/departure-groups.ts:1541)) and rendered
   nowhere, so there is no list to opt out *of*.

### 1.2 A validation hole to fix in passing

`requestDeviationSchema.detail` is a `z.union([extraNightsDetail, ownFlightDetail,
itineraryDetail, genericDetail])` where `genericDetail = z.record(z.string(), z.unknown())`.
Because the generic branch accepts any object, the union **never rejects anything** — a
malformed `OWN_FLIGHT` detail silently falls through to the permissive branch. This must
become a discriminated union keyed on `deviationType` before structured capture is trusted.

---

## 2. Design decisions

**D1 — Keep the deviation table. Do not add per-pilgrim flight/hotel/itinerary tables.**
The existing model is correct: a deviation is *a delta from the group standard*, not a
parallel copy of the group's operational rows. Three new tables would double every read path
and let the pilgrim's hotel drift from the group's hotel. Populate `detail` instead.

**D2 — `detail` becomes a typed discriminated union, validated at the action boundary.**
The jsonb column stays loose (as the migration intends); the *contract* tightens in Zod. One
`DeviationDetail` TypeScript union in `lib/types/departure-groups.ts` is the single source of
truth for what each type carries.

**D3 — Deviations reference group entities by id, and those ids are validated to belong to
this group.** `flightId` must exist in `data.flights` for this `departure_group_id`;
`accommodationId` in `data.accommodations`; `itineraryItemId` in the snapshot. This is what
turns prose into something Operations can act on and Readiness can count.

**D4 — One flow creates both the operational fact and the money line.** The customise form
gets an optional "charge for this" block; on submit the action creates the charge first, then
the deviation with `chargeId` set, in one server round-trip. The existing decline→void cascade
then does the right thing for free.

**D5 — Replace the single generic form with a type-driven form.** Pick the deviation type
first; the form body is a component chosen from a registry keyed on the type. The `summary`
field remains but is **auto-composed** from the structured detail (editable, pre-filled) so
the human-readable line and the machine-readable detail cannot disagree at creation time.

**D6 — Group the eighteen deviation types into four families** — Accommodation, Flight,
Itinerary & Services, Other — matching how staff think and how the request was framed.
`ROOM_TYPE` stays where it is (the occupancy grid), and the grid gains a line saying it writes
the same layer.

**D7 — Phase the work.** Phases 1–3 deliver the actual ask. Phases 4–6 are the follow-through
that makes it operationally real. Ship 1–3 first.

---

## 3. Data model

### 3.1 The `detail` union (new — `lib/types/departure-groups.ts`)

```ts
export type DeviationDetail =
  // ── Accommodation ──────────────────────────────────────────────────────────
  | { kind: "ROOM_TYPE";        roomType: RoomType; roommatePilgrimIds?: string[] }
  | { kind: "EXTRA_NIGHTS";     accommodationId: string | null; city: AccommodationCity;
                                nights: number; side: "BEFORE" | "AFTER";
                                checkInDate?: string; checkOutDate?: string }
  | { kind: "HOTEL_UPGRADE";    fromAccommodationId: string | null; city: AccommodationCity;
                                hotelName: string; supplierName?: string;
                                distanceDescription?: string; bookingReference?: string;
                                checkInDate?: string; checkOutDate?: string }
  | { kind: "MEAL_PLAN";        accommodationId: string | null; mealPlan: string }
  | { kind: "ROOMMATE_REQUEST"; withPilgrimIds: string[]; note?: string }
  // ── Flight ─────────────────────────────────────────────────────────────────
  | { kind: "OWN_FLIGHT";       replacesFlightIds: string[]; direction: FlightDirection | "BOTH";
                                airline: string; flightNumber?: string; pnr?: string;
                                originAirportCode?: string; destinationAirportCode?: string;
                                departureAt?: string; arrivalAt?: string;
                                arrivesWithGroup: boolean }
  | { kind: "LAND_ONLY";        replacesFlightIds: string[]; note?: string }
  | { kind: "CABIN_UPGRADE";    flightId: string; fromCabin: string; toCabin: string;
                                pnr?: string }
  | { kind: "SEAT_PREFERENCE";  flightId: string;
                                preference: "WINDOW"|"AISLE"|"EXTRA_LEGROOM"|"BULKHEAD"|"TOGETHER"|"OTHER";
                                note?: string }
  | { kind: "EXTENDED_STAY";    returnFlightId: string | null; newReturnDate: string;
                                onwardArrangement: string }
  // ── Itinerary & services ───────────────────────────────────────────────────
  | { kind: "ITINERARY_OPT_OUT";  itineraryItemIds: string[]; reason?: string }
  | { kind: "ITINERARY_ADDITION"; title: string; dayNumber: number | null; location: string;
                                  description: string; scheduledAt?: string;
                                  supplierName?: string }
  | { kind: "SERVICE_ADDON";      addonId: string | null; addonCode?: string;
                                  quantity: number; note?: string }
  // ── Transport / other ──────────────────────────────────────────────────────
  | { kind: "PRIVATE_TRANSFER";   transportId: string | null; route: string;
                                  vehicleType: VehicleType; pickupAt?: string }
  | { kind: "PICKUP_POINT";       transportId: string | null; pickupLocation: string;
                                  pickupAt?: string }
  | { kind: "DOCUMENT_REQUIREMENT"; documentName: string; requiredByStage: DocumentStage }
  | { kind: "ASSISTANCE";         assistanceType: "WHEELCHAIR"|"MEDICAL"|"DIETARY"|"MOBILITY"|"OTHER";
                                  details: string }
  | { kind: "OTHER";              note: string };
```

`kind` duplicates `deviation_type` deliberately — it is what makes the union discriminable in
TypeScript when read back out of an untyped jsonb column.

### 3.2 Migration — `supabase/migrations/<ts>_pilgrim_service_customisation.sql`

Additive only. No changes to the three tables from the previous plan.

```sql
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
--    does not consume a group seat. Cached on the pilgrim so the flights tab
--    does not join deviations to count seats.
alter table public.departure_group_pilgrims
  add column if not exists excluded_from_group_flight boolean not null default false;

-- 3. Seed the add-on catalogue that has existed empty since 20260823090000.
insert into public.agency_service_addons
  (code, name, category, default_amount, unit, creates_deviation, journey_types)
values
  ('QURBANI',         'Qurbani / Hadi',             'RITUAL',      28000, 'FLAT',    false, '{HAJJ,UMRAH}'),
  ('WHEELCHAIR',      'Wheelchair assistance',      'ASSISTANCE',      0, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('EXTRA_BAGGAGE',   'Extra baggage allowance',    'FLIGHT',       4500, 'PER_KG',  true,  '{HAJJ,UMRAH}'),
  ('MEET_GREET',      'Airport meet & greet',       'ASSISTANCE',   9000, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('ZIYARAT_MAKKAH',  'Additional Makkah ziyarat',  'OTHER',        6500, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('ZIYARAT_MADINAH', 'Additional Madinah ziyarat', 'OTHER',        6500, 'FLAT',    true,  '{HAJJ,UMRAH}'),
  ('LAUNDRY',         'Laundry service',            'OTHER',        2500, 'PER_DAY', false, '{HAJJ,UMRAH}'),
  ('TRAVEL_INSURANCE','Travel insurance',           'INSURANCE',    7500, 'FLAT',    false, '{HAJJ,UMRAH}'),
  ('IHRAM_KIT',       'Ihram & travel kit',         'MERCHANDISE',  5500, 'FLAT',    false, '{HAJJ,UMRAH}'),
  ('PRIVATE_TRANSFER','Private airport transfer',   'TRANSPORT',   18000, 'FLAT',    true,  '{HAJJ,UMRAH}')
on conflict (code) do nothing;
```

**Backfill: deliberately none.** Existing deviations are prose; the detail renderer must fall
back to `summary` when `detail.kind` is absent. Do not attempt to parse old summaries.

---

## 4. Implementation phases

### Phase 1 — Typed detail, end to end (no visible UI change yet)

Makes the contract real before any form is built against it.

| # | File | Change |
| --- | --- | --- |
| 1.1 | `lib/types/departure-groups.ts` | Add the `DeviationDetail` union (§3.1). Add `linkedFlightId`, `linkedAccommodationId`, `linkedTransportId`, `linkedItineraryItemIds` to `DepartureGroupPilgrimDeviationRow`, and `excludedFromGroupFlight` to `DepartureGroupPilgrimRow`. |
| 1.2 | `lib/validations/departure-groups.ts` | Replace the permissive `z.union` at :1017 with `z.discriminatedUnion("kind", […])` covering all 18 types. Make `requestDeviationSchema` a `z.discriminatedUnion("deviationType", …)` so `deviationType` and `detail.kind` are cross-checked at parse time. Delete `genericDetail`. |
| 1.3 | `lib/data/departure-groups-deviations.ts` | In `requestDeviationInStore`, resolve the link columns from `detail` (`flightId` → `linked_flight_id`, etc.) and **validate each referenced id belongs to this `departure_group_id`**, returning a friendly error otherwise. |
| 1.4 | `lib/data/departure-groups-deviations.ts` | New `applyDeviationSideEffectsInStore()` called from `decideDeviationInStore` on approve: `OWN_FLIGHT`/`LAND_ONLY` → set `pilgrim.excluded_from_group_flight` and adjust the flight's `seats_held`; `ROOM_TYPE` → write `pilgrim.room_occupancy_type`. Reversed on cancel. |
| 1.5 | `app/(main)/departure-groups/types.ts` | Widen `PilgrimDeviation.detail` from `Record<string, unknown>` to `DeviationDetail \| Record<string, never>`. Add the linked ids. |
| 1.6 | `lib/data/departure-groups.ts` (:1455) | Map the new columns into the manifest's `deviations[]`. |
| 1.7 | `app/(main)/departure-groups/actions.ts` (:2306) | `requestPilgrimDeviationAction` — parse against the new discriminated schema; surface field errors rather than a single string. |

**Acceptance:** `npx tsc --noEmit` clean; a hand-crafted `OWN_FLIGHT` payload carrying a
`flightId` from another group is rejected with "That flight is not part of this group."

---

### Phase 2 — The customise form staff actually asked for

The visible deliverable. Replaces the single textarea.

| # | File | Change |
| --- | --- | --- |
| 2.1 | **new** `…/[groupId]/components/customisation/deviation-forms/` | One small component per family: `accommodation-deviation-form.tsx`, `flight-deviation-form.tsx`, `itinerary-deviation-form.tsx`, `service-deviation-form.tsx`, `other-deviation-form.tsx`. Each owns its fields and returns a typed `DeviationDetail`. |
| 2.2 | **new** `…/customisation/deviation-registry.ts` | `Record<DeviationType, { family, label, icon, Form, buildSummary(detail), defaultBlocksDeparture, suggestsCharge }>`. The one place the drawer reads. |
| 2.3 | **new** `…/customisation/request-deviation-dialog.tsx` | Two-step: pick family → pick type → type-specific form → optional charge block → review with auto-composed `summary` (editable). Submits once. |
| 2.4 | `pilgrim-customisation-drawer.tsx` | Accept new props: `flights`, `accommodations`, `transports`, `itinerary`, `groupTravellers`, `addons`. Replace the inline deviation form (:550–595) with the new dialog. Add a "Customisations" summary strip at the top — *Flight · Hotel · Itinerary · Services*, each showing count + status colour. |
| 2.5 | `pilgrim-customisation-drawer.tsx` | New `<DeviationDetailView detail={…} />` under each deviation row rendering the structured fields as a definition list, falling back to `summary` when `detail.kind` is absent. |
| 2.6 | `tabs/pilgrims-bookings-tab.tsx` (:926) | Pass the new props through. The tab already receives `snapshot`; `flights`, `accommodations`, `transports` must be added to `PilgrimsBookingsTabProps` (:108). |
| 2.7 | `departure-group-detail.tsx` | Forward `detail.flights`, `detail.accommodations`, `detail.transports` to the pilgrims tab. |
| 2.8 | `lib/data/departure-groups.ts` | Load the `agency_service_addons` catalogue into `DepartureGroupDetail` as `serviceAddons: ServiceAddon[]`. |

**Form contents, concretely:**

- **Custom flight** — radio: *Own flight* / *Land only* / *Cabin upgrade* / *Seat preference* /
  *Extended stay*. For "own flight": multi-select of the group flights this replaces (rendered
  as `PK-892 · CMB→JED · 14 Mar 02:40`), then airline, flight no., PNR, dep/arr datetimes, and
  an "arrives with the group" toggle that decides whether group transport still applies.
- **Custom hotel** — radio: *Different hotel* / *Extra nights* / *Meal plan* / *Roommate
  request*. For "different hotel": pick the group accommodation block being replaced (shows
  city, hotel, dates), then new hotel name, supplier, distance, check-in/out — with a live
  night-count delta against the group block.
- **Custom itinerary** — the group's `snapshot.itinerary[]` rendered as a day-by-day checklist
  for opt-outs, plus an "Add an activity" form (day, title, location, description, supplier).
- **Services** — a picker over `agency_service_addons` filtered by the group's journey type,
  with quantity, and the catalogue's `default_amount` pre-filling the charge block.

**Acceptance:** every deviation type reachable in ≤3 clicks; submitting a "custom hotel"
produces a row whose `detail.hotelName` is queryable and whose `linked_accommodation_id` is set.

---

### Phase 3 — Money and operation captured together

| # | File | Change |
| --- | --- | --- |
| 3.1 | `lib/validations/departure-groups.ts` | New `requestDeviationWithChargeSchema` = deviation schema + optional `charge: { chargeType, label, amount, quantity, requiresApproval, reason }`. |
| 3.2 | **new action** `actions.ts` → `requestPilgrimCustomisationAction` | Creates the charge, then the deviation with `chargeId`, in one store mutation. Rolls the charge back if the deviation fails. `requestPilgrimDeviationAction` stays for charge-less deviations. |
| 3.3 | `deviation-registry.ts` | `suggestsCharge` + `suggestChargeType(detail)` — `HOTEL_UPGRADE`→`ROOM_UPGRADE`, `EXTRA_NIGHTS`→`EXTRA_NIGHTS`, `OWN_FLIGHT`/`CABIN_UPGRADE`→`FLIGHT_VARIATION`, `PRIVATE_TRANSFER`→`TRANSPORT_VARIATION`, `SERVICE_ADDON`→`ADDON`. Pre-selects type and, for catalogue add-ons, amount. |
| 3.4 | `pilgrim-customisation-drawer.tsx` | Render the pairing: a charge created this way shows "↳ linked to *3 extra nights, Madinah*"; a deviation shows its charge amount inline. |
| 3.5 | `lib/access/departure-groups-access.ts` | Require `approveDiscounts` for `LAND_ONLY` / `EXTENDED_STAY` (they change what the agency owes a supplier), not just `manageTravellerCustomisations`. |

**Acceptance:** a single-room upgrade is one form submission producing one charge + one
deviation with `charge_id` set; declining the deviation voids the charge automatically via the
existing behaviour in `decideDeviationInStore`.

---

### Phase 4 — Operations sees deviations where it works

Without this, structured capture is a filing cabinet.

| # | File | Change |
| --- | --- | --- |
| 4.1 | `tabs/flights-tab.tsx` | Per flight card: "*2 travellers off this flight*" (from `linked_flight_id` + `excluded_from_group_flight`) and a seat reconciliation line — held vs. ticketed vs. group-flying pilgrims. |
| 4.2 | `tabs/hotels-rooms-tab.tsx` | Per accommodation block: extra-night and upgrade deviations listed with traveller name, status, night delta. |
| 4.3 | `tabs/transport-tab.tsx` | Per transport row: pickup-point and private-transfer deviations. |
| 4.4 | **new** `tabs/itinerary-tab.tsx` (or an Overview card) | The group itinerary finally rendered from `snapshot.itinerary[]`, with opt-out counts per day and per-pilgrim additions. This is the first UI that shows the itinerary at all. |
| 4.5 | `tabs/overview-tab.tsx` | New blocker: *"N traveller customisations are unarranged and block departure"* → deep-links to the pilgrims tab filtered by `hasCustomisations`. |
| 4.6 | `lib/data/departure-groups.ts` | Extend the readiness/blocker computation to count `blocks_departure && status not in ('ARRANGED','DECLINED','CANCELLED')`. |

---

### Phase 5 — Add-on catalogue management

| # | File | Change |
| --- | --- | --- |
| 5.1 | **new** `app/(main)/management/settings/service-addons/` | CRUD over `agency_service_addons`, mirroring the existing settings pages' structure. |
| 5.2 | **new** `lib/data/service-addons.ts` | Read/write layer + `listActiveAddons(journeyType)`. |
| 5.3 | `lib/validations/` | `serviceAddonSchema`. |

---

### Phase 6 — Downstream propagation

| # | File | Change |
| --- | --- | --- |
| 6.1 | `lib/data/departure-groups-copy.ts` | `SERVICE_ADDON` deviations whose addon has `creates_deviation` also seed a readiness item, so somebody is accountable for arranging it. |
| 6.2 | Documents | `DOCUMENT_REQUIREMENT` deviations insert a `source = 'MANUAL'` row into `departure_group_pilgrim_documents` — the column exists for exactly this. |
| 6.3 | `lib/agent/tools/booking.ts` | Expose read-only deviation lookup to the WhatsApp agent so "what's my hotel?" answers with the traveller's *actual* hotel. |
| 6.4 | `accommodation-voucher-dialog.tsx`, `flight-itinerary-dialog.tsx` | Per-traveller documents must reflect that traveller's deviations, not the group standard. **Highest-risk correctness item in this plan** — today a customised traveller receives a voucher for a hotel they are not staying in. |

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| jsonb `detail` drifts from the TS union as types are added | The discriminated union is the only writer; `assertNever(detail)` in the renderer so a new type fails the build, not runtime. |
| Existing prose deviations have no `detail` | Renderer falls back to `summary`. No backfill, no parsing. Explicitly tested. |
| Seat-count side effects double-apply | `excluded_from_group_flight` is recomputed idempotently from live deviations, never incremented — mirror `recomputeHasCustomisationsInStore`'s pattern. |
| Form sprawl — 18 types × fields | The registry keeps each form under ~80 lines and the drawer ignorant of every type. |
| Role gating | `manageTravellerCustomisations` already gates creation; 3.5 tightens the two supplier-cost types. Verify GUIDE and MARKETING get the read-only view only. |
| Scope | Phases 1–3 are the ask and ship independently. Phase 4 makes it useful; 5–6 can trail. |

---

## 6. Files touched — summary

**New (≈12):** the `customisation/` directory (registry + 5 forms + request dialog + detail
view), one migration, `lib/data/service-addons.ts`, the settings page, the itinerary tab.

**Modified (≈15):** `lib/types/departure-groups.ts`, `lib/validations/departure-groups.ts`,
`lib/data/departure-groups-deviations.ts`, `lib/data/departure-groups.ts`,
`lib/data/departure-groups-copy.ts`, `lib/access/departure-groups-access.ts`,
`app/(main)/departure-groups/types.ts`, `actions.ts`, `pilgrim-customisation-drawer.tsx`,
`tabs/pilgrims-bookings-tab.tsx`, `tabs/flights-tab.tsx`, `tabs/hotels-rooms-tab.tsx`,
`tabs/transport-tab.tsx`, `tabs/overview-tab.tsx`, `departure-group-detail.tsx`.

**Not touched:** the three tables from `20260823090000`, the package snapshot chain, the
charges/pricing rollup views. This plan adds capture and delivery on top of a storage layer
that is already correct.
