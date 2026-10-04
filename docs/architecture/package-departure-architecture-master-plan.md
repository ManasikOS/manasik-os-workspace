# Packages ↔ Departure Groups — Architecture Master Plan

Status: **plan only. Nothing in here is implemented.**

The premise the product was built on is correct: a Package is a reusable template, a Departure
Group is one real journey, and most departures repeat the same configuration. What is wrong is
*where the line between them is drawn* and *whether the copy actually happens*. Today the line is
drawn in the wrong place (per-departure facts live on the template) and the copy is fake (a real
package's content never reaches the group it creates).

This document is in four parts:

1. How Hajj & Umrah agencies actually work — researched, then reduced to the rules that matter.
2. The correct three-layer model, and where our current two-layer model breaks.
3. Findings — the concrete defects in this codebase, with evidence.
4. The implementation plan — phased, with schema, data layer, and UI work per phase.

---

## 1. How the industry actually works

### 1.1 The canonical operating sequence

Every serious Umrah/Hajj operator runs the same pipeline, and the software category is built around
it: **Inquiry → Quotation → Package → Pilgrim registration → Documents → Visa → Hotel & transport →
Payments → Departure → Reporting**. Two things in that list are load-bearing for us:

- **Package sits *after* quotation and *before* registration.** The package is a sales artifact
  first and an operations artifact second. It must be publishable and priceable on its own.
- **Group management is the feature that separates a real Umrah system from generic booking
  software** — group manifests and rooming lists generated in one click, because Saudi ground
  handling requires them.

### 1.2 The two commercial shapes

| Shape | What it is | How it prices |
|---|---|---|
| **Fixed / series departure** | The agency publishes a set of dated departures off one program. Seats are blocked on a flight, hotel allotments are contracted per departure. | One price *per departure*, because airfare and Haram-adjacent hotel rates move seasonally. |
| **Land-only / custom** | Pilgrim brings their own flights, or the party is private. | Priced from the same land components, minus air. |

Our product is squarely the first shape, with the second appearing as per-pilgrim deviations
(`land-only-dialog.tsx`, `own-flight-dialog.tsx` already exist).

### 1.3 The costing rule that drives the data model

Package cost is **not** one number. It decomposes into:

- **Per-pax variable**: airfare, visa + insurance, catering, per-bed hotel cost.
- **Fixed-per-departure**: coach hire, guide/mutawwif, ground handling. These do **not** shrink with
  the group — a coach costs the same at 38 pax as at 45, so every empty seat raises the true
  per-pilgrim cost of the fixed lines.

Therefore: **a departure has a break-even headcount, and margin is only knowable per departure.**
A template can hold a *cost estimate*; only a group can hold a *cost*. Our
`packages.finance_estimate` is the estimate; there is no group-level counterpart.

### 1.4 The regulatory layer (Saudi, current)

Since the Nusuk/Masar rollout, the external agent's workflow is: qualify and contract with a Saudi
Umrah company on **Masar Nusuk** → **add pilgrims into a group** → **link the group to an Umrah
program** → **submit the group for visa issuance** → pay the invoice → visas issue. Saudi companies
also contract accommodation, transport, catering and "package/program design" through the same
platform.

Two consequences for us:

1. The regulator's own object graph is **program → group → pilgrims**, with visa issued at the
   *group* level. Our `Package → Departure Group → Pilgrims` maps onto it one-to-one. That is
   strong validation of the shape — and an argument for making the group the visa batch unit, which
   it currently is only partially.
2. There is an external identifier per group (the Umrah company, the program link, the visa batch /
   invoice number). We store none of them.

### 1.5 The rules extracted

| # | Rule | Consequence for the schema |
|---|---|---|
| R1 | Price is a property of the **departure**, not the program. | Group needs its own editable price set; the template price is a *default*. |
| R2 | Flights, hotels, transport and guide are contracted **per departure**. | These must be group-owned rows, seeded from template *requirements*, never read through. |
| R3 | The template holds **standards and requirements**; the group holds **bookings and references**. | "5★ within 300m of Haram" is template; "Swissôtel Al Maqam, ref 8842" is group. |
| R4 | Fixed costs make margin a per-departure question. | Group needs a costing sheet; template needs a costing *model*. |
| R5 | Editing a template must never rewrite a selling or flown departure. | Snapshot on create — already correct in principle. |
| R6 | The same program runs many seasons at different prices. | Needs template versioning, or at minimum a season-scoped price book. |

---

## 2. The model we should have

### 2.1 Three layers, not two

Today: `packages` → `departure_groups`.

The industry shape is three:

```
  PACKAGE / PROGRAM  (reusable, timeless)
      ↓  what we promise: standards, inclusions, itinerary shape, requirements, cost model
  DEPARTURE  (one dated instance)
      ↓  what we sell: dates, seats, THIS departure's price, THIS departure's contracts
  GROUP OPERATIONS  (execution)
         flights, hotel blocks, rooming, transport, guide, manifest, visa batch
```

We do not need a third table. **We need the second layer's fields to exist on
`departure_groups` instead of being frozen inside the immutable snapshot.** The snapshot stays —
it is the audit record of "what the template said when we sold this" — but it stops being the
source of truth for anything operational or commercial.

### 2.2 The three-way field classification

Every field currently on `packages` must be sorted into exactly one bucket. This is the core of the
plan; everything else follows.

**Bucket A — Template-only (stays on `packages`, copied as a *standard*)**

`title`, `internal_code`, `description`, `journey_type`, `category`, `package_category`,
`visibility`, `days`/`nights` (nominal), `itinerary`, `inclusions`, `exclusions`,
`included_services`, `*_accommodation_standard`, `*_customer_wording`, `*_nights`,
`*_target_distance`, `*_meal_plan`, `*_occupancies`, `transport_requirements`,
`document_requirements`, `group_readiness_checklist`, `payment_terms`, `cancellation_policy`,
`late_payment_policy`, `price_change_disclaimer`, `seat_reservation_rule`,
`selected_communication_templates`.

**Bucket B — Template default → group override (must exist on BOTH, group wins)**

`quad_price` … `infant_price`, `early_bird_price`, `advance_deposit`, `payment_milestones`,
`currency`, `default_capacity`/`max_pilgrims`, `min_group_size`, `waitlist_enabled`,
`seat_hold_expiry`, `suggested_guide_ratio`, `finance_estimate`, `preferred_airlines`,
`routing_preference`, `cabin_class`, `departure_origin`, `arrival_gateway`, `return_gateway`,
`flights_included`.

**Bucket C — Does not belong on a template at all (delete from `packages`, move to the group)**

`airline`, `flight_number`-shaped fields, `departure_airport`, `arrival_airport`,
`departure_time`, `arrival_time`, `transit_airport`, `transit_arrival_time`,
`transit_departure_time`, `flight_legs`, `flight_routes`, `flight_options`,
`makkah_hotel`, `makkah_hotel_rating`, `makkah_distance`, `makkah_exact_display_name`,
`makkah_exact_notes`, `makkah_exact_hotel_guarantee` (and the Madinah equivalents),
`season`, `early_bird_valid_until`, `price_valid_until`.

> Bucket C is why the current design hurts. A named hotel and a departure time on a *reusable
> template* is a category error: the moment you reuse it, both are wrong. Today the wizard collects
> them (Step 3 / Step 4), stores them, renders them on the package detail page — and no departure
> group ever reads one of them.

**The one exception worth keeping:** `*_exact_hotel_guarantee` is a genuine *commercial promise*
("we guarantee the exact hotel, not just the standard"), so the boolean stays in Bucket A; only the
hotel name/rating/distance move out.

### 2.3 Season / price-book (rule R6)

The same program sells at different prices in Ramadan, school holidays, and shoulder season.
Two options:

- **Option 1 — package versioning.** `packages` gets `version`, `parent_package_id`,
  `effective_from`/`effective_to`. Duplicating for a new season is already half-built
  (`duplicated_from`).
- **Option 2 — price book.** A `package_price_periods` child table: one row per season window with
  its own occupancy prices and deposit; group creation picks the row matching its departure date.

**Recommendation: Option 2.** It solves the actual pain (price varies, everything else doesn't)
without forcing a template fork per season, and it keeps `package_usage` meaningful. Option 1 can
follow later for genuine program redesigns.

---

## 3. Findings — what is broken today

Ordered by severity. Every one is verifiable in the current tree.

### F1 — **A real package's content never reaches the group it creates.** *(Critical)*

`lib/data/departure-groups.ts:3173`

```ts
function resolveTemplate(templateId: string): PackageTemplateDefinition {
  const seeded = findTemplate(templateId);
  if (seeded) return seeded;
  const fallback = TEMPLATE_LIBRARY[0];
  return { ...fallback, id: templateId };
}
```

`findTemplate` only searches the hardcoded `TEMPLATE_LIBRARY` in
`lib/data/departure-groups-copy.ts:834`. A package authored in the wizard has a UUID id, is never
in that library, and so **falls through to `TEMPLATE_LIBRARY[0]` — the demo "Standard Umrah"
fixture**. Only the `id` is swapped in.

The result: every departure group created from a real package is seeded with the demo template's
pricing (`quad_price: 485_000`, hardcoded at `departure-groups-copy.ts:673`), the demo itinerary,
the demo accommodation standards, the demo transport routes, the demo readiness checklist and the
demo document requirements. The picker at `listPackageTemplateOptions`
(`lib/data/departure-groups.ts:1773`) correctly lists the user's real packages — so the UI shows
the right name while the copy engine uses the wrong body. This is almost certainly the root of the
"packages don't really work as templates" symptom.

`resolveTemplate` is also **synchronous** — it cannot be fixed in place; it has to become an async
DB read, which changes `createDepartureGroup`'s shape.

### F2 — **A departure group has no price of its own.** *(Critical — this is the user's stated core need)*

Price is read only from the frozen snapshot: `lib/data/departure-groups.ts:1694`
(`quadPrice: snapshotRow?.pricing_snapshot.quad_price ?? null`). Downstream, the booking sheet
(`add-booking-sheet.tsx:138`), the room-preference change dialog
(`change-room-preference-dialog.tsx:108`) and the manifest (`manifest.ts:204`, `:374`) all price
from `snapshot.*Price`. `manifest.ts:204` even hardcodes a fallback of `485000`.

`UpdateGroupDetailsInput` (`lib/data/departure-groups-lifecycle.ts:41-59`) has **no price field**.
The only way to change a price is per-booking, after the fact
(`departure-groups-bookings.ts:997`). So: two departures of the same package one month apart cannot
be sold at different prices, which contradicts R1 and is the single most common real-world need.

### F3 — **Flights are never seeded from the template, at all.**

There is no `buildFlights()`. `createDepartureGroup` seeds readiness items, accommodations and
transports; flights are absent. Meanwhile the package carries `flight_legs`, `flight_routes`,
`flight_options`, `preferred_airlines`, `routing_preference`, `cabin_class`,
`departure_origin`, `arrival_gateway`, `return_gateway` — of which **only `preferred_airlines` is
read anywhere outside the wizard**, and only to render it back on the package's own Journey tab.
Every group therefore starts with an empty Flights tab and zero routing intent.

### F4 — **Step 6 of the wizard ("Group creation defaults") is authored and then ignored.**

`default_group_capacity`, `default_group_status`, `group_readiness_checklist`, `min_group_size` are
persisted, rendered on the package's own `group-defaults-tab.tsx`, and **never read by the
departure-groups module.** `listPackageTemplateOptions` (`lib/data/departure-groups.ts:1795-1808`)
hardcodes instead:

```ts
defaultCapacity: row.max_pilgrims ?? 40,
minGroupSize: 15,
durationDays: 0,
durationNights: 0,
waitlistEnabled: true,
seatHoldExpiryHours: 24,
```

`suggested_guide_ratio` and `flight_options` are read by **nothing** — they appear only in
`lib/types/database.ts`.

### F5 — **The snapshot is doing two incompatible jobs.**

`buildPackageSnapshot` (`departure-groups-copy.ts:309`) is documented as the immutable audit freeze
— correct and good. But because F2 leaves the group with no price of its own, the snapshot is *also*
the live pricing source. So the one table that must never be written is the one table that has to
change when a departure reprices. The copy toggles make this worse: unticking
"Pricing and payment schedule" writes `emptyPricing()` (`departure-groups-copy.ts:355`), producing a
group that can take bookings at a price of `null`.

### F6 — **Group-level costing and margin do not exist.**

`packages.finance_estimate` holds a clean per-pilgrim cost model (flight / accommodation /
transport / visa+insurance / catering / guide-ops / contingency) and is read only by the package's
own Pricing tab. On the group side there is `internal_cost` on each accommodation and transport row,
summed into `supplier_payables_due` by the `departure_group_payment_summaries` view — but nothing
computes cost per pilgrim, break-even headcount, or realised margin against the estimate. Given R4,
this is the number the CEO actually wants.

### F7 — **Guide, supplier and coordinator are free text, not references.**

`primary_guide_name`, `backup_guide_name`, `local_coordinator_name`, `supplier_name` on
accommodations and transports are all `text`. A `suppliers` module exists
(`lib/access/suppliers-access.ts`, `20260817090000_supplier_directory.sql`) and is not linked. So
supplier performance, guide load, and rate history cannot be reported on. `suggested_guide_ratio`
on the template exists precisely to drive a "this group needs 2 guides" check that nothing runs.

### F8 — **Accommodation seeding assumes Makkah-then-Madinah, contiguously.**

`buildAccommodations` (`departure-groups-copy.ts:486`) walks a `cursor` from the departure date and
gives each standard `nights` consecutive nights. It ignores flight arrival time, ignores the
Madinah-first routing that is common when arriving at MED, and cannot express a split stay
(Makkah → Madinah → Makkah). Check-in dates are therefore plausible but frequently wrong, and
they are what the hotel voucher and the readiness due dates are built from.

### F9 — **No regulatory identifiers.**

No field anywhere for: the contracted Saudi Umrah company, the Masar Nusuk program/group link, the
visa batch or invoice number, or the group's Nusuk status. Per §1.4 these are the identifiers the
visa team works with daily; today they live outside the system.

### F10 — **Template drift is visible but not actionable.**

`template-comparison-dialog.tsx` compares the snapshot to the live template — good. But there is no
"re-sync this section from the template" action, and no signal on the packages list that N live
groups were created from a version of the template that has since changed.

---

## 4. Implementation plan

Five phases. Phases 1 and 2 are the ones that fix the reported problem; 3–5 are the build-out.

---

### Phase 1 — Make the template real *(fixes F1, F4; unblocks everything else)*

**Goal:** a departure group created from package X is seeded from package X.

**4.1.1 New: `lib/data/packages-template.ts`**

```ts
export async function loadTemplateDefinition(
  packageId: string,
  client?: Db,
): Promise<PackageTemplateDefinition | null>
```

Reads one `packages` row and maps it to the existing `PackageTemplateDefinition` interface
(`departure-groups-copy.ts:73`). This is a pure mapping — the target interface already has every
field it needs (`pricing`, `paymentSchedule`, `itinerary`, `inclusions`, `exclusions`,
`accommodationStandards`, `transportRequirements`, `travellerRequirements`,
`readinessRequirements`, `defaultCapacity`, `minGroupSize`, `durationDays/Nights`,
`waitlistEnabled`, `seatHoldExpiryHours`).

Mapping notes:
- `accommodationStandards` ← the flat `makkah_*` / `madinah_*` column pairs, emitted as two
  `AccommodationStandardSnapshot` entries. Skip a city whose `nights` is 0.
- `transportRequirements` ← `transport_requirements` JSONB, reusing the camel→snake shape at
  `departure-groups-copy.ts:640`.
- `travellerRequirements` ← `document_requirements`.
- `readinessRequirements` ← `group_readiness_checklist` via the existing
  `toReadinessRequirementSnapshot`.
- `defaultCapacity` ← `default_group_capacity ?? max_pilgrims ?? default_capacity ?? 40`
  (this is F4's fix).
- `seatHoldExpiryHours` ← parse `seat_hold_expiry` (`"24 hours"` → `24`).

**4.1.2 `resolveTemplate` becomes async and DB-first**

```ts
async function resolveTemplate(id: string): Promise<PackageTemplateDefinition> {
  if (isUuid(id)) {
    const live = await loadTemplateDefinition(id);
    if (live) return live;
  }
  const seeded = findTemplate(id);
  if (seeded) return seeded;
  throw new TemplateNotFoundError(id);   // no silent fallback
}
```

**The silent fallback to `TEMPLATE_LIBRARY[0]` must be deleted.** Creating a group from a package
that cannot be loaded should fail loudly, not succeed with someone else's data. `createDepartureGroup`
already returns `{ ok: false, error }`, so surface it there.

**4.1.3 Fix `listPackageTemplateOptions`**

Select the Step-6 columns and stop hardcoding: `default_group_capacity`, `min_group_size`,
`waitlist_enabled`, `seat_hold_expiry`, `days`, `nights`, `default_group_status`. Also drop the
`TEMPLATE_LIBRARY` fallback once packages exist in every environment — showing demo fixtures in a
production picker is how F1 stayed hidden.

**4.1.4 Scope the seeded library to seeds**

`TEMPLATE_LIBRARY` should be reachable only from the seed script and tests, not from a request path.
Move it to `lib/data/__seed__/` or gate it behind an explicit `allowSeededTemplates` flag.

**Tests:** create a package via the wizard mapper → create a group from it → assert the snapshot's
pricing, itinerary, accommodation standards and readiness labels are the package's, not the demo's.
This test would fail today and is the regression guard for F1.

---

### Phase 2 — Give the departure its own commercials *(fixes F2, F5; the user's stated need)*

**4.2.1 Migration `..._departure_group_pricing.sql`**

```sql
create table public.departure_group_pricing (
  departure_group_id uuid primary key
    references public.departure_groups (id) on delete cascade,
  agency_id          uuid not null,
  currency           text not null default 'LKR',
  quad_price         numeric(14,2) check (quad_price   is null or quad_price   >= 0),
  triple_price       numeric(14,2),
  double_price       numeric(14,2),
  single_price       numeric(14,2),
  child_price        numeric(14,2),
  infant_price       numeric(14,2),
  early_bird_price   numeric(14,2),
  early_bird_valid_until date,
  advance_deposit    numeric(14,2),
  payment_milestones jsonb not null default '[]'::jsonb,
  price_source       text not null default 'TEMPLATE'
    check (price_source in ('TEMPLATE', 'OVERRIDDEN')),
  priced_by          uuid references auth.users (id) on delete set null,
  priced_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

Seeded at group creation from the template's pricing (`price_source = 'TEMPLATE'`); flips to
`OVERRIDDEN` on first edit. One row per group, so it is a cheap join everywhere the snapshot is
joined today.

**4.2.2 Read-path switch**

Introduce one accessor and route every price read through it:

```ts
// lib/data/departure-groups-money.ts
export function groupPrice(pricing: GroupPricingRow, snapshot: SnapshotRow): PricingSnapshot
```

Then change, in order:
`lib/data/departure-groups.ts:1694-1700` (the detail read model) →
`add-booking-sheet.tsx:138` → `change-room-preference-dialog.tsx:108` →
`manifest.ts:204,:374` (and **delete the `?? 485000` fallback**) →
`overview-tab.tsx:395` → `departure-groups-ai.ts:150` → `lib/agent/tools/booking.ts:324`.

The snapshot keeps its `pricing_snapshot` untouched — it becomes what it was always documented to
be: the audit record of the template's price at sale time, and the input to the
template-comparison dialog.

**4.2.3 Repricing UX**

New "Pricing" section in `edit-group-details-sheet.tsx`, capability-gated on `viewFinance` +
a new `repriceGroup` capability (Admin / CEO / Finance only). Extend
`UpdateGroupDetailsInput` (`departure-groups-lifecycle.ts:41`) with an optional `pricing` object.

Rules to enforce in `updateGroupDetailsInStore`:
- Repricing **never** rewrites existing bookings. Existing rows keep their agreed
  `package_price_per_person`.
- Show "N existing bookings keep their agreed price" in the confirm dialog before writing.
- Log `GROUP_REPRICED` to `departure_group_activity_logs` with before/after, `is_high_impact = true`.
- Refuse repricing on `DEPARTED` / `COMPLETED` / `CLOSED` groups.

**4.2.4 Kill the pricing copy toggle**

Remove `pricingAndPaymentSchedule` from `TemplateCopyOptions`
(`create-departure-group-sheet.tsx:70-79`). A group with no price is not a valid state (F5).
Pricing is always copied; it is then editable, which is what the toggle was really reaching for.

**4.2.5 Season price book (R6)**

`package_price_periods (id, package_id, label, starts_on, ends_on, <occupancy prices>,
advance_deposit)`. At group creation, pick the period containing `departure_date`; fall back to the
package's base prices. This is what makes one template genuinely reusable across a year — and it is
the cheap version of template versioning.

---

### Phase 3 — Move Bucket C off the template *(fixes F3, F8)*

**4.3.1 Reshape the package's journey step**

Step 3 stops collecting a specific flight. It collects **routing intent**: `departure_origin`,
`arrival_gateway`, `return_gateway`, `preferred_airlines`, `routing_preference`, `cabin_class`,
`flights_included`, and a new `flight_pattern` JSONB describing the *shape* of the journey
(outbound → arrival city; return ← departure city; expected number of legs).

Deprecate, then drop after a read-only grace period: `airline`, `departure_airport`,
`arrival_airport`, `departure_time`, `arrival_time`, `transit_*`, `flight_legs`, `flight_routes`,
`flight_options`. Migration keeps the columns nullable for one release, stops writing them, then
removes them.

Same for accommodation: `makkah_hotel`, `makkah_hotel_rating`, `makkah_distance`,
`makkah_exact_display_name`, `makkah_exact_notes` (+ Madinah) move out. `*_exact_hotel_guarantee`
stays (it is a promise, not a fact).

**4.3.2 New: `buildFlights()` in `departure-groups-copy.ts`**

Seeds two `departure_group_flights` rows per group — `OUTBOUND` and `RETURN` — in status `DRAFT`,
with airline/route prefilled from the template's routing intent, `departure_at`/`arrival_at`
defaulted to the group's departure/return dates, `seat_capacity = 0`, and
`ticketing_deadline = departure_date - 21 days`. Call it from `createDepartureGroup` unconditionally
when `flights_included` is true, and add a `flights` entry to `TemplateCopyOptions`.

This is what makes the Flights tab non-empty on day one, and what lets the readiness item
"Flight tickets issued" have something to auto-source from.

**4.3.3 Fix `buildAccommodations` city ordering (F8)**

Order the standards by the template's arrival gateway: `MED` → Madinah first, `JED` → Makkah first.
Derive `check_in_date` from the seeded outbound flight's `arrival_at` rather than
`departure_date`, and allow a standard to declare `sequence` so a split stay can be expressed.

---

### Phase 4 — Costing, margin and suppliers *(fixes F6, F7)*

**4.4.1 Copy the cost model into the group**

Seed `departure_group_cost_estimates` from `packages.finance_estimate` at creation (per-pilgrim
lines), plus a new fixed-cost section (coach, guide, ground handling) that the template expresses as
*per departure*, not per pilgrim.

**4.4.2 `departure_group_costing` view**

Per group: estimated cost/pax, actual cost/pax (from `internal_cost` on accommodation + transport +
flight + charges ÷ confirmed pax), **break-even headcount** (fixed ÷ (price − variable)), gross
margin, and margin %. Extend the existing `departure_group_payment_summaries` pattern rather than
inventing a new one. Surface as a Finance-gated KPI row on the group Overview and a column on the
groups list.

Break-even is the number §1.3 says operators actually manage to, and we currently cannot show it.

**4.4.3 Supplier references (F7)**

Add nullable `supplier_id` FKs on `departure_group_accommodations` and
`departure_group_transports`; keep `supplier_name` as the printable snapshot. Add
`primary_guide_supplier_id` / staff FK on the group. Then implement the
`suggested_guide_ratio` check as a readiness item: "1 guide per N pilgrims — this group needs X."

---

### Phase 5 — Lifecycle, drift and compliance *(fixes F9, F10)*

**4.5.1 Nusuk / regulatory fields (F9)**

On `departure_groups`: `umrah_company_name`, `nusuk_program_ref`, `nusuk_group_ref`,
`visa_batch_ref`, `visa_invoice_ref`, `nusuk_status`. Wire `nusuk_status` into the Visa tab as the
group-level gate the individual pilgrim visa statuses roll up to — which matches how the regulator
issues visas (per group, not per person).

**4.5.2 Template drift (F10)**

- On the packages list: "N live groups on an older version of this template."
- In `template-comparison-dialog.tsx`: a per-section **"Re-sync from template"** action, allowed
  only while the group is `PLANNING` and has zero bookings, always logged as high-impact.
- Add `template_version` (or `template_updated_at`) to the snapshot so drift is detectable without
  a deep diff.

**4.5.3 Package lifecycle guards**

`packages.status → 'Archived'` must refuse if `package_usage.live_group_count > 0` (the view at
`20260812090000_packages_module_v2.sql` already computes it; the guard is only wired into delete,
not archive). Editing a package with live groups should warn, naming them.

---

## 5. Sequencing, risk and migration

| Phase | Blast radius | Risk | Backfill needed |
|---|---|---|---|
| 1 | `createDepartureGroup` becomes async-deep | **Low** — new code path, old groups untouched | None. Existing groups keep their (wrong) snapshots; optionally offer a one-off re-seed for `PLANNING` groups with zero bookings. |
| 2 | Every price read in the module | **Medium** — many call sites, all mechanical | Yes: one `departure_group_pricing` row per existing group, copied from its snapshot, `price_source = 'TEMPLATE'`. Idempotent, safe to re-run. |
| 3 | Package wizard Step 3/4 + new flight seeding | **Medium** — user-visible form change | Drop columns only after one release of read-only deprecation. |
| 4 | Additive | Low | Seed cost estimates for existing groups from their package. |
| 5 | Additive | Low | None. |

**Do Phase 1 before Phase 2.** Repricing a group that was seeded from the wrong template just makes
the wrong data editable. F1 is the foundation.

**One order-of-operations warning:** Phase 1 changes what *new* groups contain but not what existing
ones contain, so for a period the same package will have produced two materially different
generations of group. The template-comparison dialog (F10) is the honest way to expose that; a
silent re-seed of live groups is not.

---

## 6. What "done" looks like

- Creating a group from package X produces a group whose price, itinerary, hotels standards,
  transport routes, documents and readiness checklist are **X's** — provable by a test that fails
  today.
- Two groups off the same package, three months apart, sell at different prices, and neither
  can change the other or the template.
- The Flights tab is pre-populated with two draft flights and a ticketing deadline.
- A finance user can see, per departure: price, cost/pax, break-even headcount, and current margin.
- Editing a package never silently changes a group that is selling, and where it *should* change
  one, the operator is shown exactly what differs and chooses.

---

## Sources

- [Hajj & Umrah Travel Agency Workflow Automation — AgencyAuto](https://www.agencyauto.net/blog/travel-tech/hajj-umrah-agency-workflow-automation/)
- [Best Umrah Booking Software for Travel Agencies — PHPTravels](https://phptravels.com/blog/how-to-choose-the-best-umrah-booking-software)
- [Hajj & Umrah Management Software — Techies Technologies](https://www.techiestechnologies.com/umrah-management)
- [Umrah Package Cost — a Full Pricing Breakdown for Agencies — Ziyara.io](https://ziyara.io/guides/umrah-package-cost)
- [Umrah Budget Guide 2026: Real Costs by Country of Departure — VisaWise](https://www.visawisetravel.com/blog/umrah-budget-guide-2026-real-costs-by-country-of-departure)
- [Ministry launches External Agents Qualification & Final Contracting via Masar Nusuk — SPA](https://www.spa.gov.sa/en/N2583281)
- [Masar Nusuk](https://masar.nusuk.sa/)
- [Nusuk Umrah Platform](https://umrah.nusuk.sa/)
