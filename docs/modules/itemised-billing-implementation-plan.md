# Itemised Billing & Customer Invoice PDF — Implementation Plan

Status: **plan only. Nothing in here is implemented.**

The problem this plan solves:

```text
A charge line already knows it is worth LKR 45,000.
The deviation next to it already knows it is "Different hotel in MAKKAH: Swissotel Al Maqam,
  3 nights, 2026-05-01 → 2026-05-04, 200m from Haram".
Nothing in the application ever puts those two facts on the same line —
so the customer sees a booking total that moved, and no reason why.
```

This is **not** a data-modelling gap. The money is already itemised at pilgrim grain and the
booking total is already derived from those items. It is a **rendering** gap, plus one real
data bug in the add-on path, plus a customer-facing document that was scaffolded in the
database and never built.

---

## 1. What exists today

### 1.1 The money is already itemised

| Fact | Where | Grain |
| --- | --- | --- |
| One priced line per chargeable thing | `departure_group_pilgrim_charges` ([migration](supabase/migrations/20260823090000_pilgrim_customisation.sql):72) | **Pilgrim** |
| Booking total = sum of live charge lines | [`recomputeBookingTotalsInStore()`](lib/data/departure-groups-charges.ts:52) | Booking, derived |
| Rollup views | `pilgrim_price_rows`, `booking_price_rows` ([migration](supabase/migrations/20260823090000_pilgrim_customisation.sql):248) | Pilgrim / Booking |
| Lines reach the client | `DepartureGroupManifestRow.charges` ([types](<app/(main)/departure-groups/types.ts>):335) | Pilgrim |

`booking.total_booking_value` is **already** `sum(amount × quantity)` over every non-voided
charge line ([charges](lib/data/departure-groups-charges.ts:61-68)). So when the user says
"it shows in booking value as an amount" — that is the system working as designed. The
number is correct. What is missing is everything *around* the number.

### 1.2 Where the itemisation is lost

[`BookingDetailDialog`](<app/(main)/departure-groups/[groupId]/components/booking-detail-dialog.tsx>:188-222)
renders exactly four aggregate lines:

```
Package price / person     LKR 250,000
Total booking value        LKR 1,045,000
Amount paid                LKR   400,000
Outstanding balance        LKR   645,000
```

It receives `travellers: DepartureGroupManifestRow[]` — which **already carries every
charge line** — and never reads `.charges`. The itemised breakdown exists in exactly one
place in the whole app: the price-breakdown card inside
[`PilgrimCustomisationDrawer`](<app/(main)/departure-groups/[groupId]/components/pilgrim-customisation-drawer.tsx>:453-529),
which is per-pilgrim, staff-facing, and buried three clicks deep.

### 1.3 The description lives on the wrong record

A charge row carries only `label` — free text, `min(2)`
([schema](lib/validations/departure-groups.ts):998). The *rich* description lives on the
paired deviation:

| Deviation type | `detail` fields available | Charge line shows today |
| --- | --- | --- |
| `HOTEL_UPGRADE` | `city`, `hotelName`, `supplierName`, `distanceDescription`, `checkInDate`, `checkOutDate` | whatever was typed |
| `EXTRA_NIGHTS` | `city`, `nights`, `side`, `checkInDate`, `checkOutDate`, `accommodationId` | whatever was typed |
| `CABIN_UPGRADE` | `flightId`, `fromCabin`, `toCabin`, `pnr` | whatever was typed |
| `SERVICE_ADDON` | `addonId`, `addonCode`, `quantity`, `note` | whatever was typed |
| `PRIVATE_TRANSFER` | `transportId`, `route`, `vehicleType` | whatever was typed |

The link is `departure_group_pilgrim_deviations.charge_id → departure_group_pilgrim_charges.id`
— one-way, already present, already used by the decline→void cascade
([deviations](lib/data/departure-groups-deviations.ts):430,548). **No schema change is
needed to join a charge back to its description.**

### 1.4 Bug: the add-on catalogue link is dropped

`departure_group_pilgrim_charges` has `addon_id` (FK → `agency_service_addons`) and
`source in ('SNAPSHOT','MANUAL','ADDON_CATALOGUE','SYSTEM')`. `addChargeInStore()` sets
both correctly ([charges](lib/data/departure-groups-charges.ts:379,384)):

```ts
addon_id: input.addonId ?? null,
source:   input.addonId ? "ADDON_CATALOGUE" : "MANUAL",
```

But **`requestDeviationWithChargeSchema` has no `addonId` field**
([validations](lib/validations/departure-groups.ts):1255-1267). The charge sub-object accepts
only `chargeType, label, amount, quantity, requiresApproval, reason`. So the entire
customisation path — including the `SERVICE_ADDON` dialog, whose whole purpose is selling a
catalogue add-on — writes `addon_id = null, source = 'MANUAL'`.

Consequence: an add-on sold through the UI is indistinguishable from a hand-typed line. It
cannot be reported on, priced against the catalogue, or reconciled. `addChargeSchema` *does*
accept `addonId` ([validations](lib/validations/departure-groups.ts):997), but the standalone
[Add Charge dialog](<app/(main)/departure-groups/[groupId]/components/add-charge-dialog.tsx>)
offers no catalogue picker either, so nothing ever passes it.

### 1.5 The invoice tables exist and are unwired

Already in the database ([migration](supabase/migrations/20260818090000_finance_payments.sql):325,381):

```sql
invoices           (invoice_number, invoice_type, booking_id, party_name, amount,
                    currency, issued_at, due_at, status, sent_channel, sent_at, …)
invoice_line_items (invoice_id, sequence, description, quantity, unit_amount, line_total)
```

`invoice_line_items` is *exactly* the shape this feature needs. And the full server-side
lifecycle already works:

| Function | File |
| --- | --- |
| `createInvoice()` — inserts invoice **+ line items** | [finance-repository.ts:586-598](lib/data/finance-repository.ts) |
| `issueInvoice()` — DRAFT → ISSUED | [finance-repository.ts:614](lib/data/finance-repository.ts) |
| `createInvoiceAction()` — role-gated by `can.createInvoices` | [actions.ts:156](<app/(main)/finance/payments/actions.ts>) |
| `sendInvoiceSchema` — records channel WHATSAPP/EMAIL/PORTAL/MANUAL | [validations/finance.ts:80](lib/validations/finance.ts) |

**Nothing calls it.** [`invoices-tab.tsx`](<app/(main)/finance/payments/components/tabs/invoices-tab.tsx>)
has no create path — grep for `createInvoiceAction` returns only the action's own definition.
No code anywhere builds `lineItems` from a booking's charges.

### 1.6 There is no PDF capability, and two constraints on adding one

- **No PDF dependency.** `package.json` has none, and the codebase deliberately hand-rolls
  format writers: [`lib/xlsx.ts`](lib/xlsx.ts) is 423 dependency-free lines with an explicit
  rationale — *"That keeps a heavyweight spreadsheet dependency out of the bundle."*
- **`window.print()` is already rejected**, on the record, in
  [guide-operations-tab.tsx:127](<app/(main)/departure-groups/[groupId]/components/tabs/guide-operations-tab.tsx>):
  *"`window.print()` would print the whole application chrome, so the sheet is exported as
  its own document instead."*

Letterhead data is available — `agency_settings` carries `agency_name`, `legal_name`,
`registration_number`, `office_address`, `primary_email`, `logo_path`, `tax_config`
([settings types](lib/types/settings.ts):81-135).

---

## 2. What changes

Five phases. Phases 1–2 are the user's immediate complaint. Phases 3–5 are the PDF.

```text
Phase 1  describeCharge()        — one charge + its deviation → a human line
Phase 2  Booking detail dialog   — render the itemisation
Phase 3  Charges → invoice       — bridge to the existing invoice tables
Phase 4  lib/pdf.ts              — dependency-free PDF writer
Phase 5  Delivery                — download, WhatsApp, email; record sent_channel
```

---

## Phase 1 — Make a charge self-describing

**New file: `app/(main)/departure-groups/billing-description.ts`**

The keystone of the whole plan. One pure function that turns a charge — plus the deviation
that explains it, if there is one — into a display line. Every surface (booking dialog,
invoice line item, PDF) calls this, so the screen and the customer's document can never
word the same charge differently.

```ts
export interface ChargeDescription {
  /** One-line title. Never empty. */
  title: string;
  /** Supporting facts, already formatted. May be empty. */
  details: string[];
  /** Traveller this line belongs to. */
  travellerName: string;
}

export function describeCharge(
  charge: PilgrimCharge,
  deviation: PilgrimDeviation | undefined,
  travellerName: string,
  context: { accommodations, flights, transports, addons, itinerary },
): ChargeDescription
```

Resolution order for `title`:

1. `charge.label` when it is meaningfully specific (present, and not a bare echo of the
   charge type).
2. Otherwise `deviation.summary` — already auto-generated and human-readable.
3. Otherwise the `CHARGE_TYPE_LABELS` fallback.

`details[]` is built from `deviation.detail` by `kind`, resolving foreign keys against
`context`. Worked example for the user's case:

```text
Different hotel — Makkah                          LKR 45,000
  Swissotel Al Maqam (replaces Hilton Suites)
  Check-in 01 May 2026 · Check-out 04 May 2026
  200m from Haram
  For: Ahmed Rizvi
```

versus today's:

```text
(nothing — only the booking total moved)
```

Base fare gets a description too, from `charge.pricedRoomType`:
`"Package base fare — Double occupancy"`.

**Tests** (`__tests__/billing-description.test.ts`): one case per `DeviationDetail.kind`,
plus charge-without-deviation, plus a voided charge, plus missing FK targets (a deleted
accommodation must degrade to the stored `hotelName`, never crash).

---

## Phase 2 — Show the itemisation in the booking

### 2.1 `BookingDetailDialog`

Insert a **Charges** section between the Finance card and the travellers table
([booking-detail-dialog.tsx:222](<app/(main)/departure-groups/[groupId]/components/booking-detail-dialog.tsx>)).

- Group live (`voidedAt === null`) charges by traveller; render `describeCharge()` output.
- Sort within a traveller: `BASE_FARE` first, then by `createdAt`.
- Subtotal per traveller; booking total as the footer — and it must equal the existing
  `booking.totalBookingValue`. **That equality is this phase's acceptance test.**
- Discounts render negative and in emerald, matching
  [the drawer](<app/(main)/departure-groups/[groupId]/components/pilgrim-customisation-drawer.tsx>:483).
- A line awaiting approval renders a muted "awaiting approval" flag and is **excluded from
  the customer-facing total** (see §3.3).
- Voided lines collapse into a `<details>` disclosure, as the drawer already does.

New props: `accommodations`, `flights`, `transports`, `serviceAddons`, `itinerary` — all
already held by [`pilgrims-bookings-tab.tsx`](<app/(main)/departure-groups/[groupId]/components/tabs/pilgrims-bookings-tab.tsx>)
and passed to the customisation dialogs, so this is prop-drilling only, no new fetch.

Gate the whole section behind `can.viewFinance`, consistent with the existing Finance card.

### 2.2 Fix the add-on catalogue link (the §1.4 bug)

| File | Change |
| --- | --- |
| [validations/departure-groups.ts:1255](lib/validations/departure-groups.ts) | Add `addonId: z.string().trim().min(1).optional()` to the `charge` sub-object of `requestDeviationWithChargeSchema` |
| [departure-groups.ts:2371](lib/data/departure-groups.ts) | Add `addonId?: string` to `requestPilgrimCustomisation`'s `charge` param; forward it into the `addChargeInStore()` call at :2384 |
| `customisation/dialogs/common.tsx` | `useDeviationSubmit` accepts and forwards `addonId` |
| `customisation/dialogs/service-addon-dialog.tsx` | Pass the selected `addonId` into the charge, not just into `detail` |
| [add-charge-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/add-charge-dialog.tsx>) | Add an optional "From catalogue" picker that seeds `label`/`amount` and sets `addonId` |

Backfill is **not** required — existing MANUAL lines stay MANUAL, which is accurate: nobody
recorded a catalogue link at the time.

---

## Phase 3 — Bridge charges into an invoice

### 3.1 New: `buildInvoiceLineItems()`

**`lib/data/booking-invoice.ts`** — server-side, mirrors `describeCharge()` output into the
existing `invoice_line_items` shape:

```ts
{ description: `${title}${details.length ? " — " + details.join("; ") : ""}`,
  quantity:    charge.quantity,
  unitAmount:  charge.amount }
```

`sequence` = traveller order, then the Phase-2 sort. Description is flattened to one string
because that is the column the table already has; the PDF re-splits on `" — "` for layout.

### 3.2 New action: `generateBookingInvoiceAction()`

Lives in the departure-groups module (that is where the operator is) but calls the existing
finance repository — **no new invoice machinery**:

```
generateBookingInvoiceAction({ bookingId, invoiceType, dueAt })
  → collect live charges for every pilgrim on the booking
  → buildInvoiceLineItems()
  → createInvoice({ bookingId, invoiceType, amount, currency, dueAt, lineItems })
  → issueInvoice()          // optional, per the caller
```

Gate on `financeCapabilitiesFor(role).createInvoices`
([finance-access.ts:27](lib/access/finance-access.ts)) — **not** the departure-groups
capability set. Issuing a customer invoice is a finance act.

### 3.3 Business rules to settle before coding

These are decisions, not implementation details:

| Question | Recommended default |
| --- | --- |
| Do unapproved charges (`requires_approval && !approved_at`) appear on a customer invoice? | **No.** Bill only approved money; show them in-app flagged. |
| Do voided charges appear? | No — excluded from `line_items` entirely. |
| Invoice grain — booking or pilgrim? | **Booking.** `invoices.booking_id` is the existing FK and the primary contact is who pays. Line items name the traveller. |
| Re-issuing after a charge changes | New invoice; supersede the old via the existing `credit_note_of` column. Never mutate an ISSUED invoice. |
| Tax / VAT | **Open.** `agency_settings.tax_config` exists but is unmodelled. Recommend v1 ships with no tax line and a documented assumption. |

---

## Phase 4 — `lib/pdf.ts`

### 4.1 Approach

Hand-rolled, dependency-free, in the exact idiom of [`lib/xlsx.ts`](lib/xlsx.ts).

Rationale — this is far more tractable than it sounds for an invoice:

- A PDF is a flat list of numbered objects, a page tree, a content stream, and an xref
  table. For text + rules + a table, the content stream is `BT/Tf/Td/Tj/ET` and `re f`.
- The **14 standard Type1 fonts require no embedding** — `/Helvetica` and `/Helvetica-Bold`
  are guaranteed present in every conformant reader. No font subsetting, the hard part of
  PDF generation, is needed at all.
- No compression required; `FlateDecode` is optional and the platform ships
  `CompressionStream` anyway, exactly as `lib/xlsx.ts` uses `DecompressionStream`.

Estimated ~350–450 lines. Scope is deliberately small, as `lib/xlsx.ts` says of itself:
single-column text, rules, and a table. **It is not a general PDF library.**

```ts
export const PDF_MIME = "application/pdf";
export function renderPdf(doc: PdfDocument): Blob;

interface PdfDocument {
  title: string;
  pageSize?: "A4";           // 595.28 × 841.89 pt
  blocks: PdfBlock[];        // heading | keyValue | table | rule | spacer | note
}
```

Text width measurement needs Helvetica AFM widths — a ~200-entry lookup table, checked in
as data, needed for right-aligning the money column and wrapping descriptions.

**Alternative considered and rejected:** a dedicated `/invoice/[id]/print` route with print
CSS. It sidesteps the chrome problem from §1.6 and needs no new code, but it cannot produce
a file to *attach* to WhatsApp or email — it depends on the operator driving a browser print
dialog. Phase 5 requires a real file. (This route is still worth adding later as a
human-readable preview; it would share the Phase-1 descriptions.)

### 4.2 `invoice-pdf.ts`

**`app/(main)/departure-groups/invoice-pdf.ts`** — composes the document. Client-side, like
the existing exporters, reusing
[`downloadBinaryFile()` / `timestampedFilename()`](<app/(main)/departure-groups/csv.ts>).

```text
┌──────────────────────────────────────────────────────┐
│ ROYAL AL-FATHIMA TRAVELS              INVOICE         │
│ <office_address>                      INV-2026-0043   │
│ <registration_number>                 Issued 19 Aug   │
│                                       Due    02 Sep   │
├──────────────────────────────────────────────────────┤
│ Bill to   Ahmed Rizvi · +94 77 123 4567               │
│ Booking   BK-2026-0117 · Umrah Ramadan 2026 (UMR-04)  │
│ Departure 01 May 2026 · 3 travellers                  │
├──────────────────────────────────────────────────────┤
│ Description                     Qty  Unit      Amount │
│ ─────────────────────────────────────────────────────│
│ AHMED RIZVI                                           │
│   Package base fare — Double      1  250,000  250,000 │
│   Different hotel — Makkah        1   45,000   45,000 │
│     Swissotel Al Maqam · 01–04 May 2026               │
│     200m from Haram                                   │
│   Qurbani (ADDON-QRB)             1   28,000   28,000 │
│ FATIMA RIZVI                                          │
│   Package base fare — Double      1  250,000  250,000 │
│ ─────────────────────────────────────────────────────│
│                                  Subtotal     573,000 │
│                                  Paid        -400,000 │
│                                  Balance due  173,000 │
└──────────────────────────────────────────────────────┘
```

Logo (`agency_settings.logo_path`) is **deferred to v2** — image XObjects need JPEG/PNG
handling and the letterhead reads fine as bold text. Called out so it is a decision, not an
omission.

---

## Phase 5 — Deliver it

New `InvoicePreviewDialog`, opened from the booking row context menu ("Generate Invoice")
and from `BookingDetailDialog`'s footer:

1. Preview the resolved line items **before** anything is written — the operator sees exactly
   what the customer will.
2. **Generate** → `generateBookingInvoiceAction()` → download the PDF.
3. **Send** → reuse `sendInvoiceAction` to stamp `sent_channel` / `sent_at`. WhatsApp opens
   `whatsappLink()` with the invoice number and balance prefilled, matching
   [`send-quote-sheet.tsx`](<app/(main)/leads/components/send-quote-sheet.tsx>):95-104. The
   PDF itself is attached by the operator — WhatsApp deep links cannot carry a file.

Honest constraint worth stating up front: **there is no email transport in this codebase.**
`send-quote-sheet.tsx` already fakes it — its "Send by Email" only records that it happened.
Real email attachment is out of scope here and needs its own decision (Resend/SES + a queue).

---

## 5. Files touched

| Phase | File | New? |
| --- | --- | --- |
| 1 | `app/(main)/departure-groups/billing-description.ts` | **new** |
| 1 | `app/(main)/departure-groups/__tests__/billing-description.test.ts` | **new** |
| 2 | `[groupId]/components/booking-detail-dialog.tsx` | edit |
| 2 | `[groupId]/components/tabs/pilgrims-bookings-tab.tsx` | edit (props) |
| 2 | `lib/validations/departure-groups.ts` | edit (`addonId`) |
| 2 | `lib/data/departure-groups.ts` | edit (forward `addonId`) |
| 2 | `[groupId]/components/customisation/dialogs/common.tsx` | edit |
| 2 | `[groupId]/components/customisation/dialogs/service-addon-dialog.tsx` | edit |
| 2 | `[groupId]/components/add-charge-dialog.tsx` | edit (catalogue picker) |
| 3 | `lib/data/booking-invoice.ts` | **new** |
| 3 | `app/(main)/departure-groups/actions.ts` | edit (one action) |
| 4 | `lib/pdf.ts` | **new** |
| 4 | `lib/pdf-fonts.ts` (Helvetica AFM widths) | **new** |
| 4 | `app/(main)/departure-groups/invoice-pdf.ts` | **new** |
| 5 | `[groupId]/components/invoice-preview-dialog.tsx` | **new** |

**No migration is required.** Every table, column and FK this plan needs already exists.

---

## 6. Sequencing

Phases 1–2 are independently shippable and answer the original complaint on their own.
Phase 2's add-on fix is a genuine bug and could be pulled forward ahead of everything else.
Phase 4 is the only substantial engineering risk and is isolated behind `renderPdf()` — if
it slips, Phases 1–3 still deliver a correct itemised invoice record and an on-screen
breakdown, and the print-route fallback from §4.1 remains available.

## 7. Open questions

1. Tax/VAT — ship v1 with none? (§3.3)
2. Unapproved charges on a customer invoice — confirm "exclude". (§3.3)
3. Logo on the PDF — v1 or v2? (§4.2)
4. Is a real email transport in scope this quarter, or is WhatsApp + download enough? (§5)
