# Departure Groups — Complete Feature Reference

A Departure Group is the **live execution instance of a Package Template**. The
template (`public.packages`) is a reusable commercial promise; a group is one
real journey — real dates, real PNRs, real hotel vouchers, real people. The two
are deliberately decoupled: the template is frozen into an immutable snapshot at
creation, and every operational default is *copied* into its own editable row
rather than read through.

This document is a complete inventory of what the module does, derived from the
code as it stands on branch `Updating-UI`.

---

## 1. Where the code lives

### Routes & UI — `app/(main)/departure-groups/`

| Path | Purpose |
| --- | --- |
| `page.tsx` | List route (server): role gate, group fetch, guide filtering |
| `loading.tsx` / `error.tsx` | Route-level skeleton and error boundary |
| `[groupId]/page.tsx` | Detail route (server): role gate, deep-link handling |
| `[groupId]/components/departure-group-detail.tsx` | Tabbed control-center shell |
| `[groupId]/components/tabs/*.tsx` | The 10 detail tabs |
| `[groupId]/components/*.tsx` | ~40 operational dialogs, sheets and drawers |
| `[groupId]/components/customisation/` | Per-traveller deviation registry + 18 typed dialogs |
| `components/` | List: table, KPI cards, create sheet, import dialog, archived sheet, status badges |
| `create-departure-group/page.tsx` | Standalone create route |
| `actions.ts` (2,639 lines) | 59 server actions — the entire write surface |
| `types.ts` (772 lines) | View models the components consume |
| `utils.ts` (904 lines) | Labels, tones, formatting, sorting, saved views, list KPIs |
| `manifest.ts` | Manifest export + pilgrim import column contracts |
| `csv.ts` / `xlsx.ts` | List import/export file formats |
| `invoice-pdf.ts` / `booking-invoice.ts` / `billing-description.ts` | Invoice composition |
| `document-storage.ts` | Signed URLs for the private `pilgrim-documents` bucket |

### Domain layer — `lib/`

| File | Responsibility |
| --- | --- |
| `lib/types/departure-groups.ts` | Row types + every enum, mirroring the SQL schema |
| `lib/validations/departure-groups.ts` | 65 Zod schemas, one per action input |
| `lib/access/departure-groups-access.ts` | 24-capability matrix across 7 staff roles |
| `lib/data/departure-groups.ts` (3,169) | Read/write facade — components get view models, never rows |
| `lib/data/departure-groups-repository.ts` | Supabase unit-of-work: `loadStore` → mutate → `persistStore` diff |
| `lib/data/departure-groups-copy.ts` | Template → group snapshot & copy engine |
| `-bookings` `-charges` `-deviations` `-documents` `-flights` `-lifecycle` `-money` `-readiness` `-rooming` `-tasks` `-transport` | Pure, store-passing `*InStore` mutators (unit-testable without the Next runtime) |
| `lib/data/departure-groups-ai.ts` | Customer-safe read model for the WhatsApp AI agent |
| `lib/agent/tools/departures.ts` | Agent tool schemas over that read model |
| `app/api/cron/release-seat-holds/route.ts` | Scheduled expired-seat-hold sweeper |

### Database — `supabase/migrations/`

`20260809090000_create_departure_groups.sql` is the base schema;
`…0810` (fixes), `…0811` (documents lifecycle), `…0823` / `…0826` (per-pilgrim
customisation), `…0901` (activity entity types), `…0902` (room capacity),
`…0903` / `…0905` (GUIDE RLS scoping), `…0904` (booking row_version) extend it.

---

## 2. Data model

**Tables** (all `agency_id` / `branch_id` tenant-scoped, all RLS-enabled):

- `departure_groups` — the group row: identity, journey type, dual status
  (operations + sales), dates, capacity/held/booked with a **generated**
  `available_seats`, five owner roles, readiness score/status, archive flag.
- `departure_group_package_snapshots` — one immutable row per group; pricing,
  payment schedule, itinerary, inclusions/exclusions, accommodation standards,
  transport requirements, traveller requirements, readiness requirements.
- `departure_group_flights` + `…_flight_legs` — one sector per direction, with
  transit legs, PNR, ticketing deadline, seat capacity/held/ticketed.
- `departure_group_accommodations` + `…_rooms` + `…_room_assignments` — hotel
  blocks per city, rooms with occupancy capacity, one bed per pilgrim.
- `departure_group_transports` — routes copied from the template's requirements.
- `departure_group_bookings` — booking reference, status, traveller count, money
  columns, seat-hold expiry, `row_version` for optimistic concurrency.
- `departure_group_pilgrims` — one traveller: seat/flight/room/visa/payment
  status, document counters, emergency-contact status.
- `departure_group_pilgrim_documents` — one row per template requirement, with
  stage, verifier role and rejection reason.
- `departure_group_pilgrim_charges` — per-traveller priced lines.
- `departure_group_pilgrim_deviations` — per-traveller operational departures
  from the group standard, with typed jsonb detail.
- `departure_group_readiness_items` — the checklist, with auto-derivation source.
- `departure_group_tasks` — group-level to-dos, optionally linked to a readiness item.
- `departure_group_activity_logs` — full before/after audit trail.

**Views:** `departure_group_payment_summaries` (money rollup),
`pilgrim_price_rows`, `booking_price_rows`.

### Invariants enforced in code

1. **`available_seats` is generated** — seats left can never drift from bookings.
2. **Readiness score is derived on every read** (`scoreReadiness()`), never
   trusted from the stored column.
3. **A booking's total is the sum of its pilgrims' live charge lines** —
   `recomputeBookingTotalsInStore` runs on every change, so per-traveller
   pricing and the booking total can never disagree.
4. **Template edits never rewrite a live group** — snapshot is write-once.
5. **Supplier `internal_cost` is nulled at fetch time** for roles without
   `viewSupplierCosts` — not merely hidden in the UI.
6. **`row_version` on bookings** blocks the lost-update race on `amount_paid`.
7. **Room over-fill has a DB-level backstop** beyond the application check.

---

## 3. Access control

Seven roles — `ADMIN`, `CEO`, `FINANCE`, `MARKETING`, `OPERATIONS`, `VISA`,
`GUIDE` — against 24 capabilities:

`viewModule`, `createGroup`, `editGroupDetails`, `cancelOrArchiveGroup`,
`overrideCapacityAndPrice`, `manageFlights`, `manageAccommodation`,
`manageTransport`, `manageRooming`, `unlockRoomAssignments`, `manageReadiness`,
`manageTasks`, `manageDocumentsAndVisa`, `addBookings`, `viewFinance`,
`recordPayments`, `viewSupplierCosts`, `viewSensitiveTravellerData`,
`sendGroupCommunications`, `exportReports`, `restrictedToAssignedGroups`,
`manageTravellerCustomisations`, `approveDiscounts`, `viewPilgrimPricing`.

Notable rules:

- **CEO** — full visibility, read-only day to day; escalates through tasks.
- **MARKETING** — sells only; no supplier cost, no visa data, no documents. Can
  *request* a discount but never approve one. Can only open groups whose sales
  status is SELLING / LIMITED_AVAILABILITY / WAITLIST.
- **GUIDE** — restricted to groups named in `staff_group_assignments`, enforced
  both in the Next layer (`filterGroupsForRole`, `canRoleOpenGroup`) **and** in
  RLS, so a direct PostgREST call cannot bypass it.
- **VISA** — can raise a `DOCUMENT_REQUIREMENT` deviation (mahram letter, minor's
  consent) because it carries no price.
- **No hard delete exists.** A group is archived or cancelled — both reversible,
  both auditable.
- Tabs a role may not use are **never rendered**, not merely disabled.

---

## 4. List screen features

- **KPI cards**, recomputed client-side against the filtered set: upcoming
  departures, at-risk groups, seats available, groups preparing, departing
  within 14 days.
- **Filters**: operations status, sales status, journey type, package template,
  departure month, readiness risk, branch, guide, plus free-text search.
- **Saved views**: All Groups, Open for Sale, Preparing, At Risk, Departing in
  14 Days, Ready to Depart, Completed, My Assigned Groups.
- **Sorting** on 9 fields, each with a sensible default direction (departure
  date soonest-first, readiness most-at-risk-first, occupancy fullest-first…).
- **Table columns**: group identity, dates + countdown, journey, capacity /
  occupancy, readiness, top blocker, guide, row actions.
- **Row actions** deep-link into the detail route (`?tab=pilgrims&add=1`,
  `?edit=1`, `?compare=1`) and cover lifecycle transitions.
- **Create group sheet** (~880 lines): template pick, dates, capacity, minimum
  group size, sales status, branch, owners, waitlist toggle, seat-hold window,
  and per-section copy toggles (pricing & schedule, itinerary,
  inclusions/exclusions, traveller requirements, readiness checklist,
  accommodation & transport).
- **Group code generation** with uniqueness check.
- **Bulk import** of groups from CSV/XLSX with a downloadable template and a
  candidate-validation preview.
- **Export** to CSV and XLSX with timestamped filenames.
- **Archived groups sheet** — archive and restore, served from the same fetch.
- Heavy components (create sheet, import dialog, archived sheet) are
  **code-split** and mounted only on first open.

---

## 5. Detail screen — the ten tabs

### Overview
Departure readiness gauge, departure countdown, bookings, collection status,
**critical blockers** (each one clickable, routing to the right tab *and*
pre-filtering it — e.g. "N pilgrims have visa applications pending" → Documents
tab, visa queue filter), readiness by category, supplier summary, recent
high-impact activity, package snapshot. Cancelled travellers are excluded from
every blocker count.

### Pilgrims & Bookings
Manifest and booking list; add booking sheet; booking detail dialog; cancel
booking (reason required, refund capped at what was actually collected); move
booking to another group; change room preference; record payment; send reminder;
per-traveller customisation drawer; bulk pilgrim import from CSV/XLSX with a
template and candidate builder; manifest export.

### Flights
Outbound/return sectors with transit legs, flight status, PNR, booking
reference, ticketing deadline, supplier. Add/edit flight dialog (the largest
dialog in the module, 1,285 lines), flight itinerary dialog, ticketing dialog,
mark-tickets-issued, per-pilgrim ticketing grid, flight-issue flagging
(name mismatch, change requested) and a **flight deviations** panel.

### Hotels & Rooms
Accommodation blocks per city with status, dates, nights, room capacity,
reserved/allocated counts, meal plan, distance, voucher URL and (cost-gated)
internal cost. Edit accommodation, set voucher, set booking reference, mark
confirmed. Rooming: generate rooms, edit/delete room, assign pilgrim,
**auto-assign** (with a "why this pilgrim was skipped" explanation), unlock a
LOCKED assignment (restricted capability), plus an **accommodation deviations**
panel.

### Transport
Routes copied from the template. Add/edit transport, set confirmation, set
reference, mark confirmed, vehicle type/capacity, pickup time and location,
driver and coordinator contacts, internal cost, plus **transport deviations**.

### Payments
Expected revenue, collected, outstanding, overdue, refund pending, supplier
payables due; payment readiness; the payment ledger; record payment and reverse
payment; invoice preview and **PDF generation** (agency letterhead + logo, with
per-charge billing descriptions joined to the deviation that explains them).

### Documents & Visa
One row per traveller per template requirement. Submit (via short-lived signed
upload URL to a private bucket), verify, reject with reason, waive as
not-applicable. Passport-validity checking and emergency-contact derivation.
Visa stage machine: mark applications submitted → under review → upload visa /
reject with reason. Open document checklist and an actionable visa queue.

### Readiness
The checklist with score, status, category breakdown, due dates, owner role and
assignee, evidence URL and notes. Items backed by a `ReadinessAutoSource`
(flight confirmed/ticketed, Makkah/Madinah hotel confirmed, three transport
sources, payments collected in full, documents all verified, visas all approved,
rooming complete, guide assigned, manifest ready) are **derived, never ticked by
hand** — so the tab can no longer claim a hotel is confirmed while the
accommodation row says otherwise. Purely manual items keep their old behaviour.
Scoring is category-weighted; "blocked" means two or more critical items stuck
or the score below half, so a single stalled supplier reads as "at risk".

### Guide & Operations
Assignments, communication links (guide WhatsApp, pilgrim broadcast, emergency
phone, local coordinator), day-of-departure run sheet, and group tasks
(create, status change, reassign, bulk update).

### Activity
The full audit trail with before/after diffs rendered as "x → y", filterable by
All / High impact / System, paginated 200 rows at a time with "Load more".

---

## 6. Per-traveller customisation

The module models a family of four sharing one booking where one member takes a
single room, one takes a discount, and one skips the group flight — without
touching the immutable snapshot or any group-level operational row.

**Charges** (`ChargeType`): base fare, room upgrade, extra nights, flight
variation, transport variation, add-on, discount, surcharge, price correction,
cancellation fee. Sourced from `SNAPSHOT`, `MANUAL`, `ADDON_CATALOGUE` or
`SYSTEM`. Discounts and price corrections require approval; charges can be
voided and approved, and the booking total re-derives on every change.

**Deviations** — 18 typed kinds with a validated jsonb payload and a dedicated
dialog each, grouped into four families:

| Family | Kinds |
| --- | --- |
| Accommodation | Extra nights, different hotel, meal plan, roommate request, room type |
| Flight | Own flight, land only, cabin upgrade, seat preference, extended stay |
| Itinerary & Services | Itinerary opt-out, itinerary addition, service add-on, private transfer, pickup point |
| Other | Document requirement, assistance, other |

Lifecycle: `REQUESTED → APPROVED → ARRANGED`, or `DECLINED` / `CANCELLED`.
Deviations that block departure are flagged as such and surface in the group's
blockers. A deviation with a money side links to its paired charge row so the
two can never say different things. `OWN_FLIGHT` and `LAND_ONLY` set the
traveller's exclusion from the group flight, which flows into ticketing counts.
Guides see the deviation, never the amount.

---

## 7. Seats, bookings and money

- Booking statuses: `HELD`, `DEPOSIT_PENDING`, `CONFIRMED`, `CANCELLED`,
  `WAITLIST`; only some consume seats.
- **Seat holds** expire after the group's `seat_hold_expiry_hours`. Released
  both by an on-screen action and by the `/api/cron/release-seat-holds` sweeper
  (bearer-token authenticated, hourly is sufficient), which flips bookings to
  cancelled and frees rooms.
- **Waitlist promotion** when seats free up.
- First booking **auto-advances the group from PLANNING to PREPARING**.
- Booking references are generated sequentially per group.
- Payment status is derived from the money columns by one shared rule
  (`derivePaymentStatus`), rounded to the `numeric(14,2)` the columns store — so
  a payment of exactly the remaining 1,250.50 is no longer refused as 1,251.
- Payments can be **reversed**; reminders go out over WhatsApp / SMS / Email in
  `PAYMENT` or `DOCUMENT` flavours.
- Moving a booking between groups reconciles seat counts on both sides.

---

## 8. Group lifecycle

Operations status: `PLANNING → PREPARING → READY_TO_DEPART → DEPARTED →
COMPLETED → CLOSED`, or `CANCELLED`.
Sales status: `SELLING`, `LIMITED_AVAILABILITY`, `WAITLIST`, `SALES_CLOSED`,
`CANCELLED`.

Lifecycle actions: `CLOSE_SALES`, `REOPEN_SALES`, `MARK_READY`, `CANCEL`
(cascades into every booking on the group, reason required), plus archive and
restore. Editing capacity reflows seat availability; editing the departure date
reflows every date-bound readiness item.

**Template comparison dialog** shows how the live group has drifted from the
snapshot it was created from.

---

## 9. Integration surface

Departure Groups is the spine of the CRM — roughly 180 files outside the module
reference it:

- **Packages** — a package's Groups tab lists its departures.
- **Leads** — "find available groups" sheet books a lead into a group.
- **Pilgrims** — travel, documents, visa and payments tabs read group rows.
- **Operations** — upcoming-groups board, supplier confirmations, flights,
  accommodation/rooming, guides & briefings, readiness, alerts.
- **Finance / Payments** — receivables and overview read group bookings;
  invoices are built from group charge lines.
- **Visa** and **Documents** modules share the pilgrim document rows.
- **Team** — assigned-groups tab, guide assignment, tasks & workload.
- **Reports** — group health table and groups tab.
- **Suppliers** — commitments derive from group accommodations and transports.
- **Dashboard** — upcoming departures widget.
- **WhatsApp AI agent** — `departure-groups-ai.ts` is the *only* surface the
  agent reads. Non-sellable groups never appear; hotel names, flight numbers and
  PNRs are withheld unless the supplier booking is CONFIRMED (reported instead
  as a standard, e.g. "4-star within 500m"); seat counts are the live
  `available_seats`, so the agent structurally cannot over-promise.

---

## 10. Architectural notes

- **Store-as-unit-of-work.** Business rules live in pure `*InStore` mutators
  operating on plain arrays. `loadStore()` hydrates exactly the slice a mutation
  needs, the mutator runs unchanged, and `persistStore()` diffs against a
  pre-mutation snapshot and writes only what changed. Roughly 4,000 lines of
  tested logic stay free of the Next server runtime.
- **Server Actions only.** Every write goes through `actions.ts`, each input
  parsed by its own Zod schema before touching the data layer.
- **View models, never rows.** Components receive finished shapes from
  `lib/data/departure-groups.ts`; role stripping happens at fetch time.
- **Defence in depth on RLS.** Application-layer role checks are mirrored in
  database policies, including the parent- and grandparent-keyed GUIDE scoping
  for `flight_legs`, `rooms` and `room_assignments`.
- **Traveller PII is never public.** The `pilgrim-documents` bucket is private;
  the client gets one-shot, short-lived signed upload and download URLs and
  every entry point re-authenticates and re-checks the role.
