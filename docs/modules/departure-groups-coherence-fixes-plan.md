# Departure Groups — Semantic Coherence Fixes

Implementation plan for a class of defects where **every function works as coded, but
the number a human reads does not mean what they think it means.** Nothing here is a
crash or a failed write. Every item is a place where the system is internally
consistent and externally misleading.

Grouped into four themes:

- **A. Seats vs. bookings vs. people** — the `4 / 40` problem.
- **B. Customisation money that exists but is never shown as itself.**
- **C. Lifecycle asymmetries** — a transition that fires one way and not the other.
- **D. Labels that overstate what they count.**

---

## A. Seats vs. bookings vs. people

The data layer has three distinct quantities and the UI uses one word for all of them:

| Quantity | Column / field | Meaning |
| --- | --- | --- |
| Bookings | `bookings.length` | Contracts. One per family/party. |
| Seats booked | `groups.booked_seats` | Travellers on *confirmed* bookings. |
| Seats held | `groups.held_seats` | Travellers on `HELD` bookings (unexpired holds). |
| Travellers on the manifest | `pilgrims` rows | Every non-cancelled traveller, **including waitlist**. |

`booked_seats` is incremented by `traveller_count`
(`lib/data/departure-groups-bookings.ts:379`), so 2 bookings of 2 travellers
correctly produces `booked_seats = 4`. The count is right. The word "Bookings"
on top of it is wrong.

### A1 — "Bookings" KPI is actually a seat count — **the reported bug**

`app/(main)/departure-groups/[groupId]/components/tabs/overview-tab.tsx:134-136`

```tsx
<KpiCard title="Bookings" value={`${group.bookedSeats} / ${group.capacity}`} />
```

Reads as "4 of 40 bookings". It is 4 of 40 **seats**, from 2 bookings.

**Fix.** Retitle to `Seats booked`, and put the booking count in the caption
next to the existing "seats available" link:

```tsx
title="Seats booked"
value={`${group.bookedSeats} / ${group.capacity}`}
caption={`${bookingCount} bookings · ${group.availableSeats} seats available`}
```

Thread `bookingCount` through from `departure-group-detail.tsx`, which already
holds the booking list.

### A2 — Held seats are invisible, so the header arithmetic does not close

`app/(main)/departure-groups/[groupId]/components/departure-group-detail.tsx:513-522`
renders `{bookedSeats} booked / {capacity} capacity` and then
`{availableSeats} seats available`. `available_seats` is a generated column
`capacity - booked_seats - held_seats`. With any live hold, the two numbers on
screen do not add to capacity and nothing explains the gap — a user sees
`4 booked / 40 capacity · 34 seats available` and concludes 2 seats vanished.

**Fix.** Render held seats whenever `group.heldSeats > 0`:
`4 booked · 2 on hold · 34 available of 40`. Same treatment in the
groups-table capacity cell (A3) and in `guide-operations-tab.tsx:163`.

### A3 — Capacity bar divides by zero and ignores holds

`app/(main)/departure-groups/components/groups-table/groups-columns.tsx:212`

```ts
const filled = Math.round((group.bookedSeats / group.capacity) * 100);
```

`capacity === 0` yields `NaN`, rendering as a broken bar. The bar also shows
only booked seats while the caption below it says `{availableSeats} seats left`,
which nets out holds — so a group with holds shows a bar that does not reach the
point the caption implies.

**Fix.** Guard the divide (`capacity === 0 ? 0 : …`, matching `utils.ts:745`
which already guards it) and render the bar as two stacked segments: booked
(solid) + held (muted).

### A4 — Waitlist travellers count as people but not as seats

`createGroupBookingInStore` inserts `pilgrims` rows for a `WAITLIST` booking
even though `consumesSeats` is false, so those travellers:

- appear in the Pilgrims & Bookings manifest count (`pilgrims-bookings-tab.tsx:370`),
- are counted by `deriveReadinessFromData` (`lib/data/departure-groups-readiness.ts:51`
  filters only on `seat_status !== "CANCELLED"`),
- generate blockers in `buildBlockers` (`lib/data/departure-groups.ts:1116`, same filter),
- are picked up by auto-room-assignment (`lib/data/departure-groups-rooming.ts:573`),

…while contributing zero to `booked_seats`. A group can therefore report
"4 booked of 40" beside a manifest of 8 people, a readiness score dragged down by
travellers with no seat, and rooms auto-assigned to people who are not travelling.

**Fix.** One shared predicate, used everywhere a "real traveller" is meant:

```ts
export function isTravellingPilgrim(
  p: DepartureGroupPilgrimRow,
  bookingStatusById: Map<string, BookingStatus>,
): boolean {
  if (p.seat_status === "CANCELLED") return false;
  const status = bookingStatusById.get(p.booking_id);
  return status !== "CANCELLED" && status !== "WAITLIST";
}
```

Apply at `departure-groups.ts:1116`, `departure-groups-readiness.ts:51`, and
`departure-groups-rooming.ts:573`. Keep waitlist travellers visible in the
manifest table (they should be), but badge them and exclude them from the
"N travellers" headline count.

---

## B. Customisation money exists but is never shown as itself

The money **is** recorded: `requestPilgrimCustomisation`
(`lib/data/departure-groups.ts:2557`) creates the charge first, then the
deviation pointing at it, and `addChargeInStore` calls
`recomputeBookingTotalsInStore`, which re-derives `total_booking_value` from
live charge lines. So the amount reaches the database and the booking total.

It then disappears at every point a person actually looks.

### B1 — The extra amount is absorbed into "Package price / person" — **the reported bug**

`lib/data/departure-groups-charges.ts:73-76`

```ts
if (pilgrims.length > 0) {
  booking.package_price_per_person = money(total / pilgrims.length);
}
```

The column is overwritten with a **blended average**, and two screens label it
as the package rate:

- `booking-detail-dialog.tsx:236` — `MoneyLine label="Package price / person"`
- `payments-tab.tsx:400` — the `Price / person` table column

Add a 20,000 hotel upgrade for one of two travellers and the "package price per
person" silently moves from 300,000 to 310,000 **for both** — a figure neither
traveller was quoted and no price list contains. The customisation never appears
as a line; it is laundered into the base rate. This is precisely the "the extra
amount is not showing anywhere" symptom: it *is* in the total, disguised as
something else.

**Fix, three parts.**

1. **Stop overwriting the meaning.** Keep the column (exports and the
   add-booking recap read it) but relabel every UI occurrence to
   `Average per traveller`, and add a `Base fare / person` line sourced from the
   traveller's live `BASE_FARE` charge — the actual quoted rate.
2. **Itemise on the booking.** `booking-detail-dialog.tsx` already renders a
   per-traveller charge breakdown via `describeCharge` (line 306). Promote it
   above the fold and add a `Customisations` subtotal line to the Finance card
   between base fare and `Total booking value`, so the three numbers visibly
   reconcile.
3. **Surface it on the manifest.** `totalPrice` is computed server-side
   (`departure-groups.ts:1602`) and currently rendered *only* inside
   `pilgrim-customisation-drawer.tsx`. Add a `Total price` column to the
   Pilgrims & Bookings table (gated on `viewPilgrimPricing`, matching the
   existing null contract), plus a `Customisations` column showing the
   non-`BASE_FARE` subtotal.

### B2 — Invoice total and outstanding balance disagree, silently

`app/(main)/departure-groups/booking-invoice.ts:44`

```ts
const billable = traveller.charges.filter(
  (c) => c.voidedAt === null && !(c.requiresApproval && !c.approvedAt),
);
```

The invoice **excludes** charges pending approval. `sumChargeLines`
(`departure-groups-money.ts`) **includes** them. So `total_booking_value` and
the invoice subtotal diverge by exactly the pending amount, and the invoice
preview shows a number that does not match the balance on the payments tab.
Nothing on either screen says why.

**Fix.** Keep the invoice rule (billing unsettled money is worse), but make the
divergence explicit:

- In `invoice-preview-dialog.tsx`, when `subtotal !== booking.totalBookingValue`,
  render a banner naming the excluded lines and the difference.
- In `booking-detail-dialog.tsx`, split the Finance card into
  `Billable total` / `Pending approval` / `Total booking value`.
- Decide the invariant deliberately (B3) rather than leaving two sums.

### B3 — A customisation is billed before it is approved

`requestDeviationInStore` creates the deviation as `REQUESTED`, but
`requestPilgrimCustomisation` has already inserted the charge and reconciled the
booking. The traveller's outstanding balance rises the instant a customer *asks*
for extra nights. Only a **decline** voids it
(`departure-groups-deviations.ts:430-437`); approval does nothing to the charge
because it is already live. To an operator this reads backwards: a request is a
quote, not a debt.

Compounding it, `useDeviationSubmit` hardcodes `requiresApproval: false`
(`customisation/dialogs/common.tsx:287`), so the paired charge is not even
flagged as pending.

**Fix.** Make the paired charge follow the deviation's state machine:

- In `requestPilgrimCustomisation`, set `requiresApproval: true` for a charge
  paired with a deviation that is not auto-approved, so `buildInvoiceLineItems`
  already excludes it and B2's divergence becomes meaningful rather than
  accidental.
- In `decideDeviationInStore`, on `approve === true` with a `charge_id`, stamp
  `approved_at` / `approved_by_name` on the charge and call
  `recomputeBookingTotalsInStore`.
- Exclude `requires_approval && !approved_at` lines from the booking total —
  either in `sumChargeLines` or via a parallel `sumBillableChargeLines` used for
  `total_booking_value` / `outstanding_balance`.

**This is the one behavioural change that needs a product decision.** It moves
money out of the current outstanding balance for any pending customisation.
Recommended, because the alternative is invoicing less than the balance forever.

### B4 — Quantity is hardcoded to 1, so multi-unit customisations under-bill

`app/(main)/departure-groups/[groupId]/components/customisation/dialogs/common.tsx:286`

```ts
quantity: 1,
```

Every customisation dialog routes through `useDeviationSubmit`. `EXTRA_NIGHTS`
carries a night count in its `detail`; `SERVICE_ADDON` can be per-person. All of
them bill exactly one unit. A three-night extension priced per night bills one
night, and the charge line reads "× 1" beside a deviation that says three nights.

**Fix.** Add an optional `chargeQuantity` to `DeviationCommonFields` and let each
dialog supply it from its own `detail` (nights for `EXTRA_NIGHTS`, pax for
per-person add-ons), defaulting to 1. Surface it in the charge block of
`DeviationCommonSection` as a read-only `× N nights — total X` line so the
operator sees the multiplication before submitting.

### B5 — A charge added after full payment creates an invisible balance

`recordPaymentInStore` nulls `next_due_at` on paid-in-full
(`departure-groups-bookings.ts:~504`). `recomputeBookingTotalsInStore` never
restores it. So adding a customisation to a settled booking:

- raises `outstanding_balance` above zero,
- with `next_due_at === null`,
- so `derivePaymentStatus` returns `PARTIAL`, never `OVERDUE`,
- so `buildPaymentSummary`'s overdue filter (`departure-groups.ts:1025-1031`,
  which requires `next_due_at !== null`) never picks it up,
- so it appears in no overdue KPI, no `overdueBookingIds`, and no reminder.

Money owed, with no due date and no chase.

**Fix.** In `recomputeBookingTotalsInStore`, when
`outstanding_balance > 0 && next_due_at === null`, set a due date. The group is
not currently in scope there — either thread it in (the store holds it) and reuse
the existing `departure_date - 14 days` rule from
`departure-groups-bookings.ts:1922`, or set it in `addChargeInStore`. Log a
`PAYMENT_DUE_REOPENED` activity entry so the change is traceable.

### B6 — Deviation cards show no money at all

`types.ts:336` states the intent: *"Always visible — amounts live only in
`charges`."* The consequence is that the customisation drawer's deviation list
and `deviation-detail-view.tsx` describe what was requested and never what it
costs, even when `charge_id` is set.

**Fix.** In `deviation-detail-view.tsx` and the drawer's deviation rows, resolve
`deviation.chargeId` against `traveller.charges` and render the amount (or
"No charge") plus its approval state. Gate on `viewPilgrimPricing`, which already
controls whether `charges` is populated at all.

---

## C. Lifecycle asymmetries

### C1 — Filling a group does not close its sales

`sales_status` is only ever assigned in:

- `departure-groups-lifecycle.ts:164, 364, 392, 497, 651` (explicit status changes),
- `departure-groups-bookings.ts:1821` (hold-expiry sweeper, `WAITLIST` → open),
- `departure-groups-bookings.ts:1938` (waitlist promotion, → `WAITLIST`/`SALES_CLOSED`).

`createGroupBookingInStore` never touches it. Book the last seats through the
normal path and the group sits at `SELLING` with `available_seats === 0` — the
list still advertises it, `computeListKpis`' `seatsAvailable` (`utils.ts:582`)
still filters on `SELLING`/`LIMITED_AVAILABILITY` and adds a zero, and the next
booking attempt is refused by the capacity gate with no prior warning.

### C2 — Freeing seats does not reopen sales

The mirror. `cancelGroupBookingInStore` (`~:1230-1240`) decrements the seat
counters and recomputes `available_seats`, but never moves `sales_status` off
`SALES_CLOSED`/`WAITLIST`. Only the sweeper reopens, and only from `WAITLIST`.
Cancel a booking on a sold-out group and it stays closed forever.

**Fix for C1 + C2 together.** One helper, called from every site that changes a
seat counter:

```ts
// lib/data/departure-groups-bookings.ts
export function syncSalesStatusToSeats(group: DepartureGroupRow): void {
  // Never override a cancelled group.
  if (group.sales_status === "CANCELLED") return;

  if (group.available_seats === 0) {
    if (group.sales_status === "SELLING" || group.sales_status === "LIMITED_AVAILABILITY") {
      group.sales_status = group.waitlist_enabled ? "WAITLIST" : "SALES_CLOSED";
    }
    return;
  }

  if (group.sales_status === "WAITLIST" || group.sales_status === "SALES_CLOSED") {
    group.sales_status =
      group.available_seats <= Math.ceil(group.capacity * 0.1)
        ? "LIMITED_AVAILABILITY"
        : "SELLING";
  }
}
```

Call sites: `createGroupBookingInStore` (after the counter block at :381), the
hold→booked transition in `recordPaymentInStore` (:533),
`cancelGroupBookingInStore` (:1238), `moveBookingToGroupInStore` for **both**
groups (:1488 and :1492), the expiry sweeper (:1814, replacing the inline
`WAITLIST` branch), and waitlist promotion (:1937, replacing the inline block).

**Caveat to decide:** C2 reopens a group an operator may have closed by hand. The
guard above only reopens from `WAITLIST`/`SALES_CLOSED`, which are also the
auto-set values — so a manual close is indistinguishable from an automatic one.
If that matters, add a `sales_status_is_manual boolean` set by
`updateGroupLifecycle` and respected by the helper; otherwise accept the reopen.

Either way, emit a `SALES_STATUS_CHANGED` activity entry whenever the helper
changes the value, so "why did this group close?" is answerable.

---

## D. Labels that overstate what they count

### D1 — "Critical blockers" counts warnings too

`overview-tab.tsx:176-182` heads the section "Critical blockers" and captions it
`${blockers.length} needing attention`, but `buildBlockers` emits both `CRITICAL`
and `WARNING` severities, and the list below styles them differently (destructive
vs. amber). "3 critical blockers" can mean one critical and two warnings.

**Fix.** Count by severity — `2 critical · 1 warning` — or retitle the section
"Blockers" and keep the per-severity counts in the caption.

### D2 — "Pilgrims booked" vs. "Bookings" use opposite meanings

`guide-operations-tab.tsx:163` prints `Pilgrims booked: 4 of 40` from
`bookedSeats` — here the label is right. `overview-tab.tsx:135` prints
`Bookings: 4 / 40` from the same field — here it is wrong. Once A1 lands, align
both on the same wording.

---

## Sequencing

| Phase | Scope | Risk |
| --- | --- | --- |
| 1 | A1, A2, A3, D1, D2 — label and presentation only | None. No data changes. |
| 2 | B1, B6 — itemise and surface money that already exists | Low. Read-side only. |
| 3 | C1, C2 — `syncSalesStatusToSeats` | Medium. Changes when groups open/close. Needs the manual-close decision. |
| 4 | B4, B5 — quantity and due-date reopen | Medium. Changes amounts and due dates on new records. |
| 5 | A4 — waitlist traveller predicate | Medium. Moves readiness scores and blocker counts. |
| 6 | B2, B3 — approval gating of paired charges | Highest. Changes `total_booking_value` for existing pending customisations; needs a backfill decision for rows created under the old rule. |

Phases 1–2 are safe to ship together and resolve both reported symptoms.
Phase 6 is the one that needs an explicit product call before implementation.

## Verification

The `*InStore` mutators are pure and take an explicit `now`, so each fix is
directly exercisable against a hand-built `DepartureGroupStore`. Cover at minimum:

- 2 bookings × 2 travellers → header reads `4 seats · 2 bookings`, and
  `bookedSeats + heldSeats + availableSeats === capacity`.
- Booking the last seat flips `SELLING` → `SALES_CLOSED`; cancelling it flips back.
- A customisation charge on a paid-in-full booking produces a non-null `next_due_at`.
- `buildInvoiceLineItems` subtotal equals `total_booking_value` once B3 lands.
- A 3-night `EXTRA_NIGHTS` deviation bills `amount × 3`.
