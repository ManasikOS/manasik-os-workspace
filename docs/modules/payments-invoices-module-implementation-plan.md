# Payments & Invoices Module — Implementation Plan

Build the agency's **finance control center** on the same data, access and action architecture
already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**, **Documents**,
**Visa**, **Operations** and **Suppliers**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

```text
Bookings define what customers owe.
Payments record what they paid.
Invoices request payment.
Departure Groups only see whether payment status creates travel risk.
```

And the boundary it must not cross:

```text
Booking / Pilgrim page   →  the money owed by ONE customer, as context for that customer
Departure Group page     →  whether payment risk blocks THIS group's departure
Suppliers page           →  what one partner owes us / we owe them, as partner history
Payments & Invoices      →  the ledger, the collection queue, the invoice register,
                            the payables queue — agency-wide, and the only writer of
                            finance records
```

Finance does not become a second place to manage a booking. It owns the **transaction**
(payment, invoice, refund, adjustment) and the **collection workflow**; the booking detail —
travellers, rooms, package, group — stays where it lives, and the finance record links to it.

Three supporting rules from the spec, carried into every section below:

- **A payment is never deleted.** Corrections are reversal / void records with a reason and an
  audit trail. This is the single hardest constraint on the schema, because today's booking
  totals are mutated in place with no transaction behind them.
- **Overdue is milestone-level, not booking-level.** A customer is overdue only after _their
  specific milestone due date_ passes. Calling every unpaid customer overdue is called out in the
  spec as the failure mode to avoid, and is exactly what the codebase does today.
- **Invoices are generated from Bookings**, never created as disconnected finance records.

---

## 1. What exists today

### 1.1 The route

| File                                                                                                                           | State                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [app/(main)/payment-invoices/page.tsx](<app/(main)/payment-invoices/page.tsx>)                                                 | **Stub.** Seven lines, returns `<div>PaymentsPage</div>`. Untracked in git (`?? app/(main)/payment-invoices/`) — the only uncommitted change on the `payments` branch. |
| [components/app-sidebar.tsx:114](components/app-sidebar.tsx:114)                                                               | Nav entry `Payments & Invoices → /payment-invoices`, icon `DollarSign`, `sideLinks[14]`, rendered as the sole link in the **Finance** group of `adminBar`.             |
| [components/app-sidebar.tsx:84](components/app-sidebar.tsx:84)                                                                 | Nav entry `Finance → /finance`, icon `WalletCards`, `sideLinks[8]`. **Not referenced by any `adminBar` group and no route serves it** — dead array entry.              |
| [app/(main)/dashboard/components/collections-attention.tsx:50](<app/(main)/dashboard/components/collections-attention.tsx:50>) | An **Open finance** button with no `href` and no handler. The dashboard already promises this page.                                                                    |

The spec asks for `/finance/payments`. Nothing in the codebase links to that path.

### 1.2 What already exists and is the real starting point

Unlike Suppliers, this is **not** greenfield. Money is already modelled — badly for a ledger, and
well for a booking. The module's job is to add the transaction layer underneath what exists, not
to replace it.

| Concern                     | Where it already lives                                                                                                                                                                                                                                                                        | Fitness for the spec                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a customer owes        | `departure_group_bookings`: `total_booking_value`, `amount_paid`, `outstanding_balance`, `next_due_at` ([20260809090000:287](supabase/migrations/20260809090000_create_departure_groups.sql:287))                                                                                             | **Correct and authoritative.** The booking is the debtor. Keep it                                                                                                                            |
| A payment                   | **Nowhere.** `recordBookingPaymentInStore()` ([departure-groups-bookings.ts:401](lib/data/departure-groups-bookings.ts:401)) adds to `amount_paid` and pushes one `departure_group_activity_logs` row                                                                                         | **The blocking defect.** See F1                                                                                                                                                              |
| Payment schedule            | `pilgrim_payment_milestones` ([20260813090000:158](supabase/migrations/20260813090000_create_pilgrims.sql:158)) — label, sequence, amount, `due_at`, `paid_amount`, `paid_at`, `proof_path`, `note`                                                                                           | **Right shape, wrong grain and only half-wired.** See F2, F3                                                                                                                                 |
| Schedule source             | `departure_group_package_snapshots.payment_schedule_snapshot` jsonb, frozen from the Package Template; expanded per traveller by `seedPilgrimPaymentMilestones()` ([departure-groups.ts:1864](lib/data/departure-groups.ts:1864))                                                             | **Reuse verbatim.** The spec's "every Booking inherits milestones from the Package Template" is already true                                                                                 |
| Payment status rule         | `derivePaymentStatus(total, paid, nextDueAt, now)` ([departure-groups-money.ts:30](lib/data/departure-groups-money.ts:30)) → `NOT_STARTED · DEPOSIT_PAID · PARTIAL · PAID_IN_FULL · OVERDUE · REFUND_PENDING`                                                                                 | Three states short of the spec, and keyed off the wrong date. See F4                                                                                                                         |
| Money rounding              | `money()` — `numeric(14,2)`-faithful rounding, with a comment explaining why whole-unit rounding broke exact-balance payments                                                                                                                                                                 | **Reuse verbatim.** Every new amount goes through it                                                                                                                                         |
| Group money rollup          | `buildPaymentSummary()` ([departure-groups.ts:781](lib/data/departure-groups.ts:781)) + the `departure_group_payment_summaries` view, deliberately kept in lockstep ([20260810090000:94](supabase/migrations/20260810090000_departure_groups_supabase_fixes.sql:94))                          | **The template for every Finance aggregate.** Expected / collected / outstanding / overdue / refund-pending, with `overdueBookingIds` returned so the count and the money can never disagree |
| Supplier payables           | `supplier_commitments` (`amount`, `amount_paid`, `payment_due_at`, `currency`) + `supplier_payments` ledger with an `amount_paid`-syncing trigger ([20260817090000:224](supabase/migrations/20260817090000_supplier_directory.sql:224))                                                       | **Already built, last week.** The Supplier Payables tab reads this — it must not build a second payable model. See F7                                                                        |
| Refund liability            | `cancelGroupBookingInStore()` takes a `refundAmount`; pilgrims get `payment_status = 'REFUND_PENDING'`; `refundPendingAmount` sums those bookings' `amount_paid`                                                                                                                              | A liability _figure_ exists. A refund **request, approval and payout** do not. See F6                                                                                                        |
| Group payment readiness     | Auto-source `PAYMENTS_COLLECTED_IN_FULL` ([departure-groups-readiness.ts:172](lib/data/departure-groups-readiness.ts:172)) reads booking balances + `next_due_at`; `syncPilgrimDerivedState()` runs inside the payment mutator                                                                | **Complete, and the reason payments must route through the existing mutator.** Recording a payment already moves group readiness                                                             |
| Reminders                   | `sendBookingReminderInStore()` logs an activity entry; [send-reminder-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/send-reminder-dialog.tsx>) and [payment-reminder-dialog.tsx](<app/(main)/dashboard/components/payment-reminder-dialog.tsx>) draft staff-approved messages | **The V1 posture the spec asks for**, already implemented. No scheduler, no send                                                                                                             |
| Activity trail              | `departure_group_activity_logs` with `entity_type = 'PAYMENT'` and `action_type = 'PAYMENT_RECORDED'`                                                                                                                                                                                         | Group-scoped and append-only. A finance event must land here **and** on a finance-scoped ledger, since finance spans groups                                                                  |
| Private file handling       | [document-storage.ts](<app/(main)/departure-groups/document-storage.ts>) — one-shot signed upload, 10 MB cap, MIME allowlist, server-composed object key, 120 s signed reads; copied once already as `supplier-storage.ts`                                                                    | **Copy this shape a third time** for payment proofs. Do not share the bucket                                                                                                                 |
| Cross-module read precedent | `pilgrim_journey_rows`, `visa_application_rows`, `supplier_directory_rows` — one flattening view, one server-only repository, one client-safe derivation file                                                                                                                                 | **Copy this shape exactly.** Four views here (§3.2 I)                                                                                                                                        |
| List + detail precedent     | [app/(main)/suppliers/](<app/(main)/suppliers/>) — the newest and closest twin: list page → repository → view models → Provider → List, plus a tabbed detail                                                                                                                                  | The structural model for the whole module                                                                                                                                                    |
| Tabbed workspace precedent  | [operations-control-center.tsx](<app/(main)/operations/components/operations-control-center.tsx>) — one route, seven tabs, each its own component under `components/tabs/`                                                                                                                    | **The right precedent for this page**, which is seven tabs on one route, not a list + detail                                                                                                 |
| Roles                       | `StaffRole` (`ADMIN·CEO·OPERATIONS·VISA·FINANCE·MARKETING·GUIDE`) + per-module capability files                                                                                                                                                                                               | Seven of the spec's eight rows. `Pilgrim` is not a staff role and has no portal — see D8                                                                                                     |
| CSV export                  | [lib/csv.ts](lib/csv.ts) (`toCsv`, `parseCsv`) + per-module `csv.ts`                                                                                                                                                                                                                          | Covers **Export Finance Report** with no new machinery                                                                                                                                       |
| Charts                      | [components/ui/chart.tsx](components/ui/chart.tsx) + `recharts`, used by four dashboard charts                                                                                                                                                                                                | Available for the Overview tab. Not required for V1                                                                                                                                          |
| Role resolution             | `getCurrentStaffRole()` ([departure-groups.ts:261](lib/data/departure-groups.ts:261))                                                                                                                                                                                                         | **Defaults everyone to ADMIN.** Known, shared limitation (visa F13, operations F19, suppliers risk 1). Not this module's to fix                                                              |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **This plan adds zero files under
`components/`, introduces no new colours, spacing or typography, and defines no new theme
tokens.** New work is composition only.

| Spec element                                                              | Existing component                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Breadcrumb + title + subtitle + header actions                            | [components/page-header.tsx](components/page-header.tsx)                                                                                                                                                                                                                                                                                   |
| Seven tabs                                                                | [components/animate-ui/components/animate/tabs.tsx](components/animate-ui/components/animate/tabs.tsx) with `className="flex-wrap h-auto"`, as [pilgrim-detail.tsx](<app/(main)/pilgrims/[pilgrimId]/components/pilgrim-detail.tsx>) and [operations-control-center.tsx](<app/(main)/operations/components/operations-control-center.tsx>) |
| KPI cards (5, clickable → filtered queue)                                 | [components/data-table/kpi-card.tsx](components/data-table/kpi-card.tsx) — `KpiCard`, `KpiRow`. Clickable variant: wrap in `<button className="text-left">`, exactly as [pilgrims-list.tsx](<app/(main)/pilgrims/components/pilgrims-list.tsx>). **`KpiRow` is a 4-column grid — the fifth card wraps; do not change the grid**            |
| Money stat tiles inside a tab                                             | The local `MoneyCard` shape in [payments-tab.tsx:60](<app/(main)/departure-groups/[groupId]/components/tabs/payments-tab.tsx:60>) — `Card` + muted label + `text-3xl font-number` + caption. Lift it into the module, do not re-style it                                                                                                   |
| Saved views (9 pills)                                                     | [components/data-table/saved-view-bar.tsx](components/data-table/saved-view-bar.tsx) — `SavedViewBar`                                                                                                                                                                                                                                      |
| Filter chips (7 + More Filters)                                           | [components/data-table/filter-select.tsx](components/data-table/filter-select.tsx) — `FilterSelect`, `ALL_FILTER_VALUE`, with the `More Filters` toggle pattern from `pilgrims-list.tsx`                                                                                                                                                   |
| Receivables / Payments / Invoices / Payables tables                       | [components/data-table/data-table.tsx](components/data-table/data-table.tsx) — search, pagination, `resetPageToken`, `aria-sort`                                                                                                                                                                                                           |
| Sortable headers                                                          | [components/data-table/sortable-header.tsx](components/data-table/sortable-header.tsx)                                                                                                                                                                                                                                                     |
| Status badges, progress, owner chips, empty / denied states               | [components/ui/tone-badge.tsx](components/ui/tone-badge.tsx) — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied`                                                                                                                                                                                                  |
| Colour vocabulary                                                         | [lib/ui/tone.ts](lib/ui/tone.ts) — `Tone`, `TONE_CLASS`, `TONE_BAR`. Every finance status maps onto existing tones with **no new palette** (§4.4)                                                                                                                                                                                          |
| Record Payment / Create Invoice / Refund Request / Void / Reverse dialogs | [components/ui/dialog.tsx](components/ui/dialog.tsx) + `dialog-footer.tsx`, `input.tsx`, `textarea.tsx`, `checkbox.tsx` (multi-milestone **Apply To**), `combobox.tsx` (booking picker), `calendar.tsx` + `popover.tsx` (payment date), [currency-input.tsx](components/ui/currency-input.tsx) (amounts)                                   |
| Invoice detail (a document, not a form)                                   | [components/ui/sheet.tsx](components/ui/sheet.tsx) — right-side sheet, as `batch-detail-sheet.tsx`                                                                                                                                                                                                                                         |
| Section headers inside tabs                                               | [components/section-heading.tsx](components/section-heading.tsx)                                                                                                                                                                                                                                                                           |
| Header overflow menus, row actions                                        | [components/ui/dropdown-menu.tsx](components/ui/dropdown-menu.tsx), `button-group.tsx`                                                                                                                                                                                                                                                     |
| Feedback                                                                  | [components/ui/toast.tsx](components/ui/toast.tsx) — `toast.add(...)`                                                                                                                                                                                                                                                                      |
| Proof upload                                                              | [document-storage.ts](<app/(main)/departure-groups/document-storage.ts>) — copy the signed one-shot upload flow against a **new private bucket**                                                                                                                                                                                           |
| Form reset on open                                                        | [hooks/use-reset-on-open.ts](hooks/use-reset-on-open.ts)                                                                                                                                                                                                                                                                                   |
| Booking picker when an action has several candidates                      | [select-booking-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/select-booking-dialog.tsx>) — already solves "record a payment against _which_ family"                                                                                                                                                                       |
| Reminder drafting                                                         | [send-reminder-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/send-reminder-dialog.tsx>) — staff-approved, never auto-sent                                                                                                                                                                                                  |

---

## 2. Findings — the gap between today and the specification

### F1 — There is no payment record. This is the blocking defect.

`recordBookingPaymentInStore()` does four things: adds to `amount_paid`, recomputes
`outstanding_balance`, promotes the booking status, and pushes one activity-log row whose
`message` is a sentence. The **only** persisted trace of a payment is that sentence plus
`before_value`/`after_value` JSON.

`RecordPaymentInput` is `{ bookingId, departureGroupId, amount, method?, note? }`
([departure-groups-bookings.ts:364](lib/data/departure-groups-bookings.ts:364)) — and `method` is
consumed solely to compose the message string ("` by bank transfer`"). It is never stored in a
queryable column.

Consequences the spec cannot tolerate:

- the **Payments tab** — "the immutable transaction ledger" — has nothing to render;
- there is no `PAY-2026-00918` identifier to reference, receipt, or reconcile against;
- there is no reference number, no proof file, no recorded-by column, no verification state;
- **"Never delete a payment. Use reversal/void records"** is unimplementable — there is no record
  to reverse, and the only correction available is mutating `amount_paid` back down, which
  destroys history;
- "Collected today" and "Collected this month" cannot be answered at all: `amount_paid` is a
  running total with no date attached to any part of it.

### F2 — The milestone table is at the wrong grain

`pilgrim_payment_milestones` is keyed `(pilgrim_id, booking_id, sequence)`. A family of four on
one booking therefore has **four** "Booking Deposit" rows.

The spec's schedule is booking-level:

```text
BK-2026-041 · Afras Family    Total: LKR 1,070,000
1. Booking Deposit    LKR 200,000   Paid · 10 July
```

So is the rest of the codebase: the group Payments tab's own comment says _"the ledger is
booking-level: money is owed by a booking, not a pilgrim"_
([payments-tab.tsx:50](<app/(main)/departure-groups/[groupId]/components/tabs/payments-tab.tsx:50>)),
and `buildPaymentSummary()` aggregates bookings. The per-person split exists only to render the
Pilgrim profile's Payments tab.

### F3 — Two payment paths already disagree with each other

| Path                                                                                                              | Writes booking totals | Writes milestones |
| ----------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------- |
| `recordBookingPaymentAction` → `recordBookingPaymentInStore` (group Payments tab, dashboard)                      | ✅                    | ❌                |
| `recordPilgrimPaymentAction` → `allocatePaymentToMilestonesInStore` ([pilgrims.ts:522](lib/data/pilgrims.ts:522)) | ✅                    | ✅                |

A payment taken from the Departure Group screen leaves every milestone showing unpaid. Worse,
`seedPilgrimPaymentMilestones()` is explicitly best-effort — its `catch {}` swallows failure so a
booking is never rolled back — which is correct for a booking, but means a booking can exist with
**no milestones at all**. The spec's Next Milestone column, milestone-level overdue rule, and
"Apply To" checkboxes all depend on that data being present and single-sourced.

### F4 — Payment status is three states short, and keyed off the wrong date

Existing: `NOT_STARTED · DEPOSIT_PAID · PARTIAL · PAID_IN_FULL · OVERDUE · REFUND_PENDING`.
Spec: `Paid in Full · On Track · Due Soon · Overdue · Deposit Pending · Partially Paid ·
Refund Pending · Cancelled`.

Missing: **On Track** vs **Due Soon** (the whole point of a _priority_ queue — a balance due in
three days is not the same as one due in three weeks), **Deposit Pending**, and **Cancelled**.

More seriously, `derivePaymentStatus()` decides overdue from `booking.next_due_at`, a single
scalar which is:

- set at booking creation from the schedule's first due date, then
- **reset heuristically to `departure_date - 14 days`**
  ([departure-groups-bookings.ts:753](lib/data/departure-groups-bookings.ts:753)) whenever the
  total changes and no due date is set, and
- **cleared to `null`** on full payment, on cancellation, and on repricing.

That cannot express "the deposit was due 10 July and is unpaid, while the final balance is not
due until 5 August". The spec's explicit warning — _"Avoid calling every unpaid customer
overdue"_ — is a description of what this column does today.

### F5 — There are no invoices, of any kind

Zero occurrences of `invoice` in the application outside one code comment
([departure-groups-access.ts:51](lib/access/departure-groups-access.ts:51)) and the Suppliers
module's own payment fields. No invoice number, no invoice status, no line items, no delivery
state, no credit note.

There is also **no PDF machinery in the project** — `package.json` carries no PDF dependency, and
the only precedent for producing a document is `window.print()` in
[guide-operations-tab.tsx:127](<app/(main)/departure-groups/[groupId]/components/tabs/guide-operations-tab.tsx:127>).
Invoice PDF is therefore a scope decision, not a line of work. See D5.

### F6 — Refunds and adjustments have a liability figure but no workflow

`cancelGroupBookingInStore()` accepts a `refundAmount`, refuses to exceed `amount_paid`, sets the
travellers to `REFUND_PENDING` and leaves the money on the booking as history. `buildPaymentSummary()`
then reports `refundPendingAmount`.

What the spec needs and none of this provides: a refund **request** (reason, policy eligibility,
amount), an **approval** by a named Finance Manager / Admin, a **payout** record, and the
adjustment types (discount, upgrade charge, transfer, cancellation fee, price correction, manual
credit) with before/after balance and who approved each one.

Note also that a refund becomes pending **only via cancellation** today. The spec's Overpayment
and Package-change reasons have no path at all.

### F7 — Supplier payables exist, and there are already two disagreeing definitions of them

The Suppliers module (merged in `e72bb4b`) owns the correct model: `supplier_commitments.amount` /
`.amount_paid` / `.payment_due_at`, with `supplier_payments` as the ledger and a trigger keeping
the two in step.

But `buildPaymentSummary()` computes `supplierPayablesDue` by summing `internal_cost` on
`departure_group_accommodations` and `departure_group_transports`
([departure-groups.ts:833](lib/data/departure-groups.ts:833)) — a completely different number,
covering two service kinds instead of thirteen and ignoring what has been paid.

The Finance page must read `supplier_commitments`, and the group summary should be migrated onto
the same source. Building a third payable model would be the worst available outcome.

### F8 — "Finance Owner" is a group attribute; the spec's queue needs it per booking

`departure_groups.finance_owner_name` is a single free-text name per group
([types/departure-groups.ts:371](lib/types/departure-groups.ts:371)), editable from the group
detail sheet. The spec puts **Finance Owner** as a receivables _column_, a _filter_, and a saved
view (`My Collection Queue`) — all of which are per-booking questions.

### F9 — Nothing can answer "what was collected today?"

Three of the five KPI cards are time-windowed (`Collected This Month`, `Supplier Payables Due —
next 14 days`, plus the collection-queue's overdue-by-N-days). Without a dated payment row (F1),
"collected this month" can only be reconstructed by parsing activity-log sentences. The dashboard
already shows these figures — from `lib/data/admin-dashboard-data.ts`, which is **hardcoded mock
data**.

### F10 — There is no verification or reconciliation state

The spec's V1 manual process is `record → upload proof → record reference → mark verified`, and
the payment status list includes `Pending Verification`. Nothing in the codebase distinguishes a
payment a clerk typed in from one whose bank slip a manager has checked.

### F11 — The route, the folder and the sidebar all disagree with the spec

Spec says `/finance/payments`. The stub is `app/(main)/payment-invoices/`, the sidebar links
`/payment-invoices`, and a second dead `Finance → /finance` entry sits unused in the same array.
Because the stub folder is untracked and only the sidebar links it, the cheapest correct move is
to **delete it** and fix the one nav entry.

### F12 — The KPI row mixes currencies

`Supplier Payables Due — LKR 1.2M` while commitments are priced in SAR, LKR, USD or AED, and
there is no FX rate anywhere in the codebase. This is the identical trap the Suppliers plan flagged
as D1, and it takes the identical answer. See D1.

### F13 — `amount_paid` has exactly one writer today, and that must not change

Booking totals are written only by the pure `*InStore` mutators, flushed by the
`loadStore → mutate → persistStore` diff in `departure-groups-repository.ts`. If a Finance-owned
Postgres trigger also maintained `amount_paid` from a new payments table, the diff writer and the
trigger would fight — the diff would write a value the trigger then overwrites, silently, on every
unrelated booking edit.

This is a constraint, not a defect, and it dictates §3.4.

---

## 3. Target architecture

### 3.1 Routes and files

```text
app/(main)/finance/payments/
  page.tsx                                 Server Component: role → capabilities → snapshot → tab from ?tab=
  finance-store.tsx                        Provider (snapshot, nowIso, currentStaffName, role, can, actions)
  types.ts                                 Re-exports lib/types/finance + saved views & filter unions
  utils.ts                                 Labels, tones, search/filter/sort predicates, formatters
  csv.ts                                   Export Finance Report (per tab)
  actions.ts                               Server Actions, capability-gated, zod-validated
  payment-proof-storage.ts                 Signed upload/download for payment proofs
  components/
    finance-workspace.tsx                  PageHeader + tabs shell (the operations-control-center shape)
    finance-metrics.tsx                    5 KPI cards, clickable → tab + saved view
    record-payment-dialog.tsx              THE record-payment flow; imported by 4 surfaces
    create-invoice-dialog.tsx
    invoice-detail-sheet.tsx               Document view + Send / Void / Credit Note actions
    send-reminder-dialog.tsx               Thin wrapper over the group's, targeted by booking
    verify-payment-dialog.tsx              Mark verified / pending / failed
    reverse-payment-dialog.tsx             Reversal & void, reason mandatory
    record-supplier-payment-dialog.tsx     Wrapper over the suppliers action
    refund-request-dialog.tsx              Phase 8
    adjustment-dialog.tsx                  Phase 8
    ai-finance-panel.tsx                   Phase 9, suggestion-only
    tabs/
      overview-tab.tsx                     KPIs + priority queue + group finance health
      receivables-tab.tsx                  The collection queue
      payments-tab.tsx                     The immutable ledger
      invoices-tab.tsx
      supplier-payables-tab.tsx
      refunds-tab.tsx                      Phase 8
      reconciliation-tab.tsx               Phase 8 — manual verification only in V1
  finance-table/
    receivables-columns.tsx
    payments-columns.tsx
    invoices-columns.tsx
    supplier-payables-columns.tsx
```

Deleted: `app/(main)/payment-invoices/` (untracked stub).

Changed: [components/app-sidebar.tsx](components/app-sidebar.tsx) — `sideLinks[14]` becomes
`Payments & Invoices → /finance/payments`, keeping the `DollarSign` icon and its position as the
sole link in the **Finance** group. The dead `sideLinks[8]` (`Finance → /finance`) is removed, and
the `adminBar` indices below it adjusted — note the group arrays are **index-based**
(`[sideLinks[5], sideLinks[6], sideLinks[7]]`), so removing an element shifts everything after it.
Safer alternative: leave `sideLinks[8]` in place and simply repoint `sideLinks[14]`. **Recommended:
repoint only** — a one-line change, with the dead entry cleaned up separately.

`NavItem` has no role awareness (`isLoggedIn` is hardcoded `true`). As every other module does,
the page itself `notFound()`s for roles without `viewModule`. Nav-level role hiding remains a
separate, cross-module change.

Also changed: [collections-attention.tsx:50](<app/(main)/dashboard/components/collections-attention.tsx:50>)
— the **Open finance** button gets `/finance/payments`, and each priority record's action links to
`/finance/payments?tab=receivables&view=Overdue`.

New server-only modules:

```text
lib/types/finance.ts              Flat, JSON-safe row + view-model types
lib/access/finance-access.ts      FinanceCapabilities + capabilitiesForFinance + visibleFinanceTabs
lib/data/finance-repository.ts    Server-only reads/writes (the only file touching Supabase)
lib/data/finance.ts               Client-safe derivations: KPIs, statuses, tones, filters, predicates
lib/data/finance-copy.ts          Every label, threshold and taxonomy — nothing else hardcodes one
lib/validations/finance.ts        zod schemas + toFinanceFieldErrors
```

### 3.2 Schema — `supabase/migrations/20260818090000_finance_payments.sql`

Additive only, safe on a database with `20260808090000 … 20260817090000` applied.

#### A. Booking payment milestones — the schedule, at the right grain (F2)

```sql
create table if not exists public.booking_payment_milestones (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.departure_group_bookings (id) on delete cascade,
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  sequence           integer not null default 0,
  label              text not null,
  milestone_type     text not null default 'INSTALMENT'
                       check (milestone_type in ('DEPOSIT','INSTALMENT','FINAL_BALANCE','ADJUSTMENT','OTHER')),
  amount             numeric(14,2) not null default 0 check (amount >= 0),
  due_at             timestamptz,
  -- Maintained by trigger from payment_allocations; never written by hand.
  paid_amount        numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_at            timestamptz,
  -- Due-date changes require a reason; the previous value stays for audit.
  due_at_changed_at  timestamptz,
  due_at_previous    timestamptz,
  due_at_change_reason text,
  waived             boolean not null default false,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint booking_payment_milestones_seq unique (booking_id, sequence)
);

create index if not exists booking_milestones_booking_idx on public.booking_payment_milestones (booking_id, sequence);
create index if not exists booking_milestones_due_idx     on public.booking_payment_milestones (due_at)
  where paid_amount < amount and not waived;
create index if not exists booking_milestones_group_idx   on public.booking_payment_milestones (departure_group_id);
```

Backfilled in the same migration from `departure_group_package_snapshots.payment_schedule_snapshot`
for every existing booking, using the same expansion `seedPilgrimPaymentMilestones()` already
performs — minus the per-traveller division. Bookings whose group has no schedule get a single
`FINAL_BALANCE` milestone for the full value, dated `next_due_at`, so no booking is left without a
schedule (F3).

`pilgrim_payment_milestones` is **kept and becomes a projection** — see D2.

#### B. The payment — the immutable ledger (F1)

```sql
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  payment_reference    text not null,                    -- PAY-2026-00918
  booking_id           uuid not null references public.departure_group_bookings (id) on delete restrict,
  departure_group_id   uuid not null references public.departure_groups (id) on delete restrict,
  amount               numeric(14,2) not null check (amount <> 0),
  currency             text not null default 'LKR',
  paid_at              timestamptz not null,             -- when the money moved
  method               text not null
                         check (method in ('CASH','BANK_TRANSFER','CARD','ONLINE','CHEQUE','OTHER')),
  reference_number     text,                             -- bank txn / cheque / gateway id
  proof_path           text,                             -- private bucket object path, never a public URL
  status               text not null default 'COMPLETED'
                         check (status in ('COMPLETED','PENDING_VERIFICATION','FAILED',
                                           'REVERSED','REFUNDED','VOIDED')),
  verified_at          timestamptz,
  verified_by          uuid references auth.users (id) on delete set null,
  verified_by_name     text,
  -- A correction is a new row pointing at the one it corrects. Never an update.
  reverses_payment_id  uuid references public.payments (id) on delete restrict,
  reversal_reason      text,
  receipt_number       text,                             -- RCT-2026-00918, issued on completion
  receipt_issued_at    timestamptz,
  internal_note        text,
  recorded_by          uuid references auth.users (id) on delete set null,
  recorded_by_name     text not null default 'Staff',
  created_at           timestamptz not null default now(),
  constraint payments_reference_unique unique (payment_reference),
  constraint payments_receipt_unique   unique (receipt_number),
  -- A reversal is negative and must name what it reverses; a receipt is positive.
  constraint payments_reversal_shape check (
    (reverses_payment_id is null and amount > 0)
    or (reverses_payment_id is not null and amount < 0 and reversal_reason is not null)
  )
);

create index if not exists payments_booking_idx  on public.payments (booking_id, paid_at desc);
create index if not exists payments_group_idx    on public.payments (departure_group_id, paid_at desc);
create index if not exists payments_paid_at_idx  on public.payments (paid_at desc);
create index if not exists payments_status_idx   on public.payments (status) where status <> 'COMPLETED';
```

`on delete restrict` on both FKs: a booking with payments is cancelled, never deleted.

**There is no `UPDATE` path for `amount`, `paid_at` or `method`.** A revoked `GRANT UPDATE` is not
available under the project's current RLS posture, so the constraint is enforced in the repository
(a single `recordPayment` / `reversePayment` / `verifyPayment` surface, with `verifyPayment` the
only mutator and only of the verification columns) and documented on the table.

#### C. Allocation — which milestone(s) a payment settles

```sql
create table if not exists public.payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments (id) on delete cascade,
  milestone_id  uuid not null references public.booking_payment_milestones (id) on delete cascade,
  amount        numeric(14,2) not null check (amount <> 0),
  created_at    timestamptz not null default now(),
  unique (payment_id, milestone_id)
);
create index if not exists payment_allocations_milestone_idx on public.payment_allocations (milestone_id);
```

This is what makes the spec's **Apply To** checkboxes (one payment across several milestones) and
the **Allocated To** ledger column real, and it is what the AI assistant's _"detect payments not
allocated to milestones"_ queries.

A trigger keeps `booking_payment_milestones.paid_amount` equal to
`sum(payment_allocations.amount)` for allocations whose payment is `COMPLETED` — the same shape as
`supplier_payments_sync_amount_paid` ([20260817090000:265](supabase/migrations/20260817090000_supplier_directory.sql:265)).
It touches **only** the milestone table, never `departure_group_bookings` (F13).

An unallocated payment is legal and visible: `sum(allocations) < payment.amount` surfaces as
_Unallocated_ in the ledger, rather than being refused at entry — a bank transfer that arrives
before anyone decides what it settles is a real event.

#### D. Invoices (F5)

```sql
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  invoice_number      text not null,                     -- INV-2026-0418
  invoice_type        text not null
                        check (invoice_type in ('BOOKING','DEPOSIT','INSTALMENT','FINAL_BALANCE',
                                                'ADJUSTMENT','REFUND_CREDIT_NOTE','SUPPLIER')),
  -- Exactly one party. A customer invoice names a booking; a supplier bill names a commitment.
  booking_id             uuid references public.departure_group_bookings (id) on delete restrict,
  departure_group_id     uuid references public.departure_groups (id) on delete set null,
  supplier_commitment_id uuid references public.supplier_commitments (id) on delete restrict,
  milestone_id           uuid references public.booking_payment_milestones (id) on delete set null,
  -- Snapshot: an issued invoice must keep printing what it said when it was issued.
  party_name          text not null default '',
  party_contact       text,
  amount              numeric(14,2) not null default 0 check (amount >= 0),
  currency            text not null default 'LKR',
  issued_at           timestamptz,
  due_at              timestamptz,
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','ISSUED','PAID','OVERDUE','VOID')),
  sent_channel        text check (sent_channel is null or sent_channel in ('WHATSAPP','EMAIL','PORTAL','MANUAL')),
  sent_at             timestamptz,
  void_reason         text,
  voided_at           timestamptz,
  credit_note_of      uuid references public.invoices (id) on delete set null,
  notes               text,
  created_by          uuid references auth.users (id) on delete set null,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint invoices_number_unique unique (invoice_number),
  constraint invoices_one_party check (
    (booking_id is not null and supplier_commitment_id is null)
    or (booking_id is null and supplier_commitment_id is not null)
  )
);

create index if not exists invoices_booking_idx on public.invoices (booking_id, issued_at desc);
create index if not exists invoices_status_idx  on public.invoices (status, due_at);
create index if not exists invoices_supplier_idx on public.invoices (supplier_commitment_id)
  where supplier_commitment_id is not null;

create table if not exists public.invoice_line_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  sequence     integer not null default 0,
  description  text not null,
  quantity     numeric(10,2) not null default 1,
  unit_amount  numeric(14,2) not null default 0,
  line_total   numeric(14,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, sequence);
```

`OVERDUE` is stored rather than derived here — deliberately, and it is the one exception in this
plan. An invoice's overdue-ness is a fact about a document that was sent, not a live computation,
and a nightly/on-read sweep sets it. `PAID` is set by the allocation trigger when the linked
milestone settles. See D6.

#### E. Refunds and adjustments (F6) — Phase 8

```sql
create table if not exists public.refund_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null,
  booking_id        uuid not null references public.departure_group_bookings (id) on delete restrict,
  departure_group_id uuid not null references public.departure_groups (id) on delete restrict,
  reason            text not null
                      check (reason in ('CANCELLATION','OVERPAYMENT','PACKAGE_CHANGE','OTHER')),
  reason_note       text,
  amount            numeric(14,2) not null check (amount > 0),
  currency          text not null default 'LKR',
  -- What the package's cancellation policy said at request time, frozen.
  policy_snapshot   text,
  status            text not null default 'PENDING_APPROVAL'
                      check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','PAID','CANCELLED')),
  requested_by      uuid references auth.users (id) on delete set null,
  requested_by_name text,
  requested_at      timestamptz not null default now(),
  decided_by        uuid references auth.users (id) on delete set null,
  decided_by_name   text,
  decided_at        timestamptz,
  decision_note     text,
  -- The negative ledger row that actually paid it out.
  payout_payment_id uuid references public.payments (id) on delete set null,
  constraint refund_requests_reference_unique unique (reference),
  constraint refund_requests_decision check (
    status in ('PENDING_APPROVAL','CANCELLED') or decided_by_name is not null
  )
);

create table if not exists public.finance_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null,
  booking_id         uuid not null references public.departure_group_bookings (id) on delete restrict,
  adjustment_type    text not null
                       check (adjustment_type in ('DISCOUNT','ROOM_UPGRADE_CHARGE','GROUP_TRANSFER',
                                                  'PARTIAL_REFUND','CANCELLATION_FEE','PRICE_CORRECTION',
                                                  'MANUAL_CREDIT')),
  -- Signed: a discount is negative, an upgrade charge positive.
  amount             numeric(14,2) not null check (amount <> 0),
  reason             text not null,
  balance_before     numeric(14,2) not null,
  balance_after      numeric(14,2) not null,
  created_by         uuid references auth.users (id) on delete set null,
  created_by_name    text not null default 'Staff',
  approved_by        uuid references auth.users (id) on delete set null,
  approved_by_name   text,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint finance_adjustments_reference_unique unique (reference)
);
```

Both tables carry every field the spec's _"every adjustment must show"_ list names — who created,
who approved, reason, linked booking/group, before/after balance, date/time — as columns rather
than as an activity-log sentence.

#### F. Finance timeline (append-only)

```sql
create table if not exists public.finance_activity_events (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references public.departure_group_bookings (id) on delete cascade,
  departure_group_id uuid references public.departure_groups (id) on delete cascade,
  payment_id     uuid references public.payments (id) on delete cascade,
  invoice_id     uuid references public.invoices (id) on delete cascade,
  supplier_commitment_id uuid references public.supplier_commitments (id) on delete cascade,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_name     text not null default 'System',
  actor_role     text,
  action         text not null
                   check (action in ('PAYMENT_RECORDED','PAYMENT_VERIFIED','PAYMENT_REVERSED','PAYMENT_VOIDED',
                                     'RECEIPT_ISSUED','INVOICE_CREATED','INVOICE_ISSUED','INVOICE_SENT',
                                     'INVOICE_VOIDED','CREDIT_NOTE_CREATED','MILESTONE_DUE_DATE_CHANGED',
                                     'ADJUSTMENT_APPLIED','ADJUSTMENT_APPROVED','REFUND_REQUESTED',
                                     'REFUND_APPROVED','REFUND_REJECTED','REFUND_PAID',
                                     'SUPPLIER_PAYMENT_RECORDED','REMINDER_SENT','FINANCE_OWNER_ASSIGNED',
                                     'NOTE_ADDED')),
  from_value     text,
  to_value       text,
  note           text,
  is_high_impact boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists finance_events_booking_idx on public.finance_activity_events (booking_id, created_at desc);
create index if not exists finance_events_created_idx on public.finance_activity_events (created_at desc);
```

Finance events write **here and** to `departure_group_activity_logs` (`entity_type = 'PAYMENT'`),
so the group's Activity tab keeps telling the whole story — the same dual-write the Suppliers
module already performs.

#### G. Per-booking finance owner (F8)

```sql
alter table public.departure_group_bookings
  add column if not exists finance_owner_id   uuid references auth.users (id) on delete set null,
  add column if not exists finance_owner_name text;

create index if not exists bookings_finance_owner_idx on public.departure_group_bookings (finance_owner_name)
  where finance_owner_name is not null;
```

Nullable and additive. The receivables view coalesces to the group's `finance_owner_name`, so the
column is an override, not a migration of the existing concept.

#### H. Deposit threshold, for `Deposit Pending` (F4)

The spec's `Deposit Pending` status and the group's _"2 bookings below deposit threshold"_ blocker
both need a threshold. `departure_group_package_snapshots.advance_deposit` already carries one
(rendered today as "Advance deposit (snapshot)" on the group Payments tab). No new column — the
receivables view reads it, and `FINANCE_COPY` documents that a booking with
`amount_paid < advance_deposit` and no overdue milestone is `DEPOSIT_PENDING`.

#### I. Read shapes (the house pattern)

```sql
-- One row per live booking: everything the Customer Receivables table renders.
create or replace view public.finance_receivable_rows as
select
  b.id                                as booking_id,
  b.booking_reference,
  b.primary_contact_name,
  b.primary_contact_phone,
  b.traveller_count,
  b.booking_status,
  b.total_booking_value,
  b.amount_paid,
  b.outstanding_balance,
  b.next_due_at,
  coalesce(b.finance_owner_name, g.finance_owner_name)  as finance_owner_name,
  g.id                                as departure_group_id,
  g.group_name,
  g.group_code,
  g.branch,
  g.departure_date,
  s.advance_deposit,
  s.currency,
  -- The *specific* milestone the queue is chasing (F4): earliest unsettled,
  -- unwaived milestone. Null once the booking is settled.
  m.id                                as next_milestone_id,
  m.label                             as next_milestone_label,
  m.milestone_type                    as next_milestone_type,
  m.amount                            as next_milestone_amount,
  m.paid_amount                       as next_milestone_paid,
  m.due_at                            as next_milestone_due_at,
  (select count(*) from public.booking_payment_milestones mm
     where mm.booking_id = b.id and not mm.waived
       and mm.paid_amount < mm.amount and mm.due_at < now())      as overdue_milestone_count,
  (select coalesce(sum(mm.amount - mm.paid_amount), 0) from public.booking_payment_milestones mm
     where mm.booking_id = b.id and not mm.waived
       and mm.paid_amount < mm.amount and mm.due_at < now())      as overdue_amount,
  (select count(*) from public.refund_requests r
     where r.booking_id = b.id and r.status in ('PENDING_APPROVAL','APPROVED')) as open_refund_count
from public.departure_group_bookings b
join public.departure_groups g on g.id = b.departure_group_id
left join public.departure_group_package_snapshots s on s.departure_group_id = g.id
left join lateral (
  select mm.* from public.booking_payment_milestones mm
  where mm.booking_id = b.id and not mm.waived and mm.paid_amount < mm.amount
  order by mm.due_at nulls last, mm.sequence
  limit 1
) m on true;
```

Three more, in the same shape:

- `finance_payment_rows` — payment joined to booking, group, allocation summary
  (`string_agg` of milestone labels) and reversal linkage, for the ledger.
- `finance_invoice_rows` — invoice joined to its party (booking **or** supplier commitment) and
  its live paid state.
- `finance_supplier_payable_rows` — **over `supplier_commitments`**, not a new table (F7):
  supplier name, group, service, reference, amount, amount_paid, outstanding, due date, owner —
  plus a derived payment status matching the spec's `Not Due · Due Soon · Overdue · Partially
Paid · Paid · Disputed · Cancelled`.

RLS on every new table: `enable row level security`, `select` + write policies for `authenticated`
(matching `supplier_payments`); real per-role enforcement stays in the application layer until a
staff-roles table exists. `set_updated_at()` triggers on `booking_payment_milestones` and
`invoices` (the function already exists).

Storage: a **new private bucket `payment-proofs`**, 10 MB cap, MIME allowlist
`pdf/jpeg/png/webp/heic`, object key composed server-side as
`{bookingId}/{paymentId}/{uuid}.{ext}` — copied from `document-storage.ts`, not shared with
`pilgrim-documents` or `supplier-evidence` (different retention, different audience).

### 3.3 Data layer

Mirror the Suppliers shape exactly.

| File                             | Responsibility                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/data/finance-repository.ts` | `"server-only"`. `loadFinanceSnapshot(db, can, { window })`, `loadReceivables`, `loadPaymentLedger`, `loadInvoices`, `loadSupplierPayables`, plus mutators. **Strips supplier costs, margins and internal notes before they leave the server, per capability** — the same posture `suppliers-repository.ts` documents            |
| `lib/data/finance.ts`            | Client-safe pure functions over flat rows: `derivePaymentStatusV2(row, nowIso)`, `computeFinanceKpis(rows, nowIso)`, `buildPriorityQueue(rows, nowIso)`, `buildGroupFinanceHealth(rows)`, `supplierPayableStatus(row, nowIso)`, `invoiceStatus(row, nowIso)`, `statusTone()`. Importable from Client Components                  |
| `lib/data/finance-copy.ts`       | `PAYMENT_STATUS_LABELS`, `PAYMENT_METHOD_LABELS`, `INVOICE_TYPE_LABELS`, `MILESTONE_TYPE_LABELS`, `ADJUSTMENT_TYPE_LABELS`, `DUE_SOON_WINDOW_DAYS = 7`, `SUPPLIER_PAYABLE_WINDOW_DAYS = 14`, `PRIORITY_QUEUE_CAP = 8`, `COLLECTION_TARGET_SOURCE`, plus the reminder message templates. **Nothing else hardcodes one of these.** |
| `lib/validations/finance.ts`     | `recordPaymentSchema`, `allocationSchema`, `verifyPaymentSchema`, `reversePaymentSchema`, `createInvoiceSchema`, `sendInvoiceSchema`, `voidInvoiceSchema`, `changeMilestoneDueDateSchema` (reason required), `refundRequestSchema`, `adjustmentSchema`, `toFinanceFieldErrors`                                                   |

Server Actions in `app/(main)/finance/payments/actions.ts`, each: resolve role → check capability →
zod parse → call repository → `revalidatePath("/finance/payments")` (plus `/departure-groups/[id]`,
`/pilgrims/[id]`, `/dashboard` when a booking's money changes) → return
`{ ok, error?, fieldErrors? }`. Same signature as `OperationsActionResult` / `SupplierActionResult`.

### 3.4 Recording a payment — the one flow the whole module hangs on

This is the Suppliers plan's §3.4 rule applied to money: **Finance never writes booking totals
directly.** It calls the existing mutator, exactly as the Suppliers module calls
`markGroupAccommodationConfirmed` rather than writing the accommodation row (F13).

`recordPaymentAction` is ordered:

1. Check `recordPayments`; zod-parse; refuse a zero/negative amount, a cancelled booking, and an
   amount exceeding the outstanding balance — reusing the guards
   `recordBookingPaymentInStore()` already implements rather than restating them.
2. Insert the `payments` row (`PENDING_VERIFICATION` if no proof and no reference number,
   `COMPLETED` otherwise — see D7), with a `payment_reference` from a `PAY-{YYYY}-{NNNNN}`
   sequence.
3. Insert `payment_allocations` for the milestones the operator ticked. If none were ticked,
   allocate oldest-unsettled-first — the rule `allocatePaymentToMilestonesInStore()`
   ([pilgrims.ts:522](lib/data/pilgrims.ts:522)) already encodes. The trigger updates
   `booking_payment_milestones.paid_amount`.
4. Call the **existing** `recordBookingPayment()`
   ([departure-groups.ts:1945](lib/data/departure-groups.ts:1945)) with the same amount, method
   and note. That is what updates `amount_paid` / `outstanding_balance`, promotes `HELD` /
   `DEPOSIT_PENDING` → `CONFIRMED`, moves the group's seat counts, re-derives every traveller's
   payment status, calls `syncPilgrimDerivedState()`, and writes the group activity log.
5. Group payment readiness recomputes as a consequence of step 4 — `PAYMENTS_COLLECTED_IN_FULL`
   is already an auto-source ([departure-groups-readiness.ts:172](lib/data/departure-groups-readiness.ts:172)).
   **Nothing new is wired here.**
6. Issue the receipt number if the payment is `COMPLETED`; mark any invoice whose milestone is now
   settled as `PAID`.
7. Append `finance_activity_events`. (Step 4 already appended `departure_group_activity_logs`.)
8. Revalidate `/finance/payments`, `/departure-groups/{groupId}`, `/pilgrims/*`, `/dashboard`.

Steps 2–3 and step 4 are not atomic across the two systems — Supabase gives no cross-call
transaction from a Server Action. **Order matters:** the ledger row is written first, so the
failure mode is a recorded payment whose booking total lags (visible, reconcilable, and surfaced
by the reconciliation tab's _unmatched_ count) rather than an increased balance with no
transaction behind it. See risks.

**Reversal** (`reversePaymentAction`) is the mirror: insert a negative `payments` row naming
`reverses_payment_id` with a mandatory reason, delete nothing, set the original to `REVERSED`, and
call `recordBookingPayment()`'s counterpart to reduce `amount_paid`. Note that no such counterpart
exists today — `recordBookingPaymentInStore()` refuses negative amounts — so **Phase 3 adds
`reverseBookingPaymentInStore()` beside it**, in the same file, sharing the same status
re-derivation. That is the only change this module makes to the Departure Groups mutators.

### 3.5 Capability matrix — `lib/access/finance-access.ts`

```ts
export interface FinanceCapabilities {
  viewModule: boolean;

  viewReceivables: boolean;
  viewLedger: boolean;
  viewInvoices: boolean;
  viewSupplierPayables: boolean;
  viewRefunds: boolean;
  viewReconciliation: boolean;

  recordPayments: boolean;
  verifyPayments: boolean;
  reversePayments: boolean;

  createInvoices: boolean;
  sendInvoices: boolean;
  voidInvoices: boolean;

  recordSupplierPayments: boolean;

  requestRefunds: boolean;
  approveRefunds: boolean;
  applyAdjustments: boolean;
  approveAdjustments: boolean;

  changeMilestoneDueDates: boolean;
  assignFinanceOwner: boolean;
  sendReminders: boolean;
  exportFinanceReport: boolean;

  /** Deposit / paid-in-full only — no amounts, no ledger, no supplier costs. */
  viewPaymentStatusOnly: boolean;
  /** CEO: every figure, no writes anywhere. */
  readOnly: boolean;
}
```

| Role           | Shape                                                                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADMIN**      | everything                                                                                                                                                                                         |
| **FINANCE**    | everything except `approveRefunds` and `approveAdjustments` — those need a Finance **Manager** or Admin, and there is no manager role (D4)                                                         |
| **CEO**        | every view including supplier payables and margins; `readOnly: true`; no dialog renders an action button                                                                                           |
| **OPERATIONS** | `viewModule: true`, `viewPaymentStatusOnly: true` — payment readiness and blockers only. No ledger, no amounts, no supplier costs                                                                  |
| **MARKETING**  | `viewModule: true`, `viewPaymentStatusOnly: true`, scoped to bookings they own. No ledger, no supplier costs. Realistically this renders a near-empty page — **consider `viewModule: false`** (D9) |
| **VISA**       | `viewModule: false`. The spec's "configured payment threshold status" is a field on the Visa screen, not a Finance page                                                                            |
| **GUIDE**      | `viewModule: false`                                                                                                                                                                                |

Plus `visibleFinanceTabs(role)` returning the subset of
`overview · receivables · payments · invoices · supplier-payables · refunds · reconciliation`.
A role with `viewPaymentStatusOnly` sees `overview` and `receivables` **with every money column
stripped in the repository**, not merely hidden — the same posture
[operations-access.ts:8](lib/access/operations-access.ts:8) documents.

---

## 4. Screens

### 4.0 Header

```text
Home > Finance > Payments & Invoices

Payments & Invoices
Track customer collections, invoices, refunds, and supplier payables.

[ + Record Payment ]  [ + Create Invoice ]  [ ••• → Export Finance Report ]
```

`PageHeader` with a three-entry breadcrumb. Following the Pilgrims/Suppliers precedent, the two
primary actions are visible buttons and Export lives in the overflow `DropdownMenu`.
`Record Payment` renders only with `recordPayments`, `Create Invoice` only with `createInvoices`,
Export only with `exportFinanceReport`.

Tabs below the header, `?tab=` in the URL so a KPI card, the dashboard and a group's
**Open Finance Queue** button can all deep-link.

### 4.1 Overview tab

**KPI cards** — five, clickable, each opening the tab + saved view it summarises:

| Card                    | Value                                                                    | Opens                                   |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| Collected This Month    | `sum(payments.amount)` where `status = COMPLETED` and `paid_at` in month | `?tab=payments&view=This Month`         |
| Outstanding Receivables | `sum(outstanding_balance)` + booking count                               | `?tab=receivables&view=All Receivables` |
| Overdue Amount          | `sum(overdue_amount)` from the view + booking count                      | `?tab=receivables&view=Overdue`         |
| Supplier Payables Due   | next 14 days, **per currency** (F12/D1)                                  | `?tab=supplier-payables&view=Due Soon`  |
| Refunds Pending         | request count + exposure                                                 | `?tab=refunds`                          |

"82% of target" needs a target that does not exist anywhere. `FINANCE_COPY.COLLECTION_TARGET_SOURCE`
documents the gap and the card renders _"% of expected revenue"_ instead until a target exists —
see D3.

**Priority collection queue** — `PRIORITY_QUEUE_CAP` cards, ranked by (overdue days desc, days to
departure asc, amount desc), each showing customer, group, milestone label + amount, the due
phrasing (_"Overdue by 2 days"_ / _"Due tomorrow"_ / _"Due today"_), Finance Owner as a
`PersonChip`, and `[Open Booking] [Send Reminder]`. Card shape reused from
[collections-attention.tsx](<app/(main)/dashboard/components/collections-attention.tsx>) — that
component already draws this exact list from mock data; Phase 5 repoints it at the real query.

**Group finance health** — one `Card` per active group: expected revenue, collected, outstanding,
overdue, supplier payables, a `ProgressBar`, a readiness-impact `ToneBadge`, and
`[Open Group Finance]` → `/departure-groups/{id}?tab=payments`. Figures come from the existing
`buildPaymentSummary()` shape so the two screens can never disagree.

### 4.2 Customer Receivables tab — the collection queue

`DataTable` over `finance_receivable_rows`. Columns exactly as the spec:

| Column             | Content                                           | Gating         |
| ------------------ | ------------------------------------------------- | -------------- |
| Customer / Booking | contact name, `booking_reference`, family name    | —              |
| Departure Group    | group name, departure date, _"Departs in 7 days"_ | —              |
| Total Value        | `total_booking_value`                             | money gate     |
| Paid               | `amount_paid`                                     | money gate     |
| Balance            | `outstanding_balance`                             | money gate     |
| Next Milestone     | label, amount, due phrasing                       | money gate     |
| Status             | `ToneBadge` (§4.4)                                | —              |
| Finance Owner      | `PersonChip`                                      | —              |
| Actions            | Record Payment · Send Reminder · Open Booking     | per capability |

Row click → `/departure-groups/{groupId}?tab=payments` (there is no standalone booking route;
see D10).

**Filters** (`FilterSelect`): Departure Group · Payment Status · Milestone Type · Due Date ·
Finance Owner · Branch · Payment Method, then **More Filters** revealing Booking Status ·
Traveller Count · Amount Band · Has Proof Missing. Search covers customer name, booking reference,
pilgrim name, invoice number and payment reference.

**Saved views** (`SavedViewBar`), each a pure predicate in `utils.ts`:
`All Receivables · Due Today · Overdue · Deposit Pending · Final Balance Due · Departing in 14
Days · My Collection Queue · Paid in Full · Cancelled Bookings`.

`My Collection Queue` matches `finance_owner_name` against `currentStaffName` — the same
string-name matching the rest of the app uses, since there is no staff table.

### 4.3 Booking payment schedule

Rendered inside the Record Payment dialog and on the group's Payments tab (Phase 6), never as its
own route:

```text
BK-2026-041 · Afras Family              Total: LKR 1,070,000
1. Booking Deposit     LKR 200,000   Paid · 10 July
2. First Instalment    LKR 670,000   Paid · 20 July
3. Final Balance       LKR 200,000   Due · 05 August    Overdue
```

Finance can record a payment, apply it across milestones, change a due date **with a mandatory
reason** (`changeMilestoneDueDates`, previous value retained on the row), apply an approved
adjustment, issue a receipt, send a reminder and add a note. Ordinary staff cannot edit the
schedule at all — the capability is absent from every non-Finance/Admin role, and every change
writes `MILESTONE_DUE_DATE_CHANGED` to `finance_activity_events`.

### 4.4 Payment status logic (F4) — no new palette

Computed by `derivePaymentStatusV2()` from the **milestone**, never from `booking.next_due_at`:

| Status          | Rule                                                 | Tone      |
| --------------- | ---------------------------------------------------- | --------- |
| Cancelled       | `booking_status = 'CANCELLED'`                       | `neutral` |
| Refund Pending  | open refund request, or traveller `REFUND_PENDING`   | `info`    |
| Paid in Full    | `outstanding_balance <= 0`                           | `success` |
| Overdue         | any unwaived milestone unsettled past `due_at`       | `danger`  |
| Due Soon        | next milestone due within `DUE_SOON_WINDOW_DAYS` (7) | `warning` |
| Deposit Pending | `amount_paid < advance_deposit` and nothing overdue  | `warning` |
| Partially Paid  | `amount_paid > 0`, next milestone beyond the window  | `info`    |
| On Track        | balance remains, nothing due soon, deposit met       | `neutral` |

Evaluated in that order — the first match wins, so a cancelled booking is never also "overdue" and
an overdue balance is never softened to "due soon".

### 4.5 Record Payment dialog

`Dialog` + `dialog-footer`, the spec's fields verbatim: Booking\* (`Combobox`, pre-filled from the
launch point) · Customer (read-only) · Amount Received\* (`CurrencyInput`) · Payment Date\*
(`Calendar` + `Popover`, defaulting to today) · Payment Method\* · Reference Number ·
**Apply To** (`Checkbox` per unsettled milestone, each showing label and amount due, defaulting to
oldest-first) · Payment Proof (signed upload) · Internal Note.

Footer: `[Cancel] [Record Payment & Issue Receipt]`.

One component, four launch points — the Suppliers plan's "one component, three launch points"
rule: the page header, the receivables row action, the priority queue card, and (Phase 6) the
group Payments tab, which today opens its own
[record-payment-dialog.tsx](<app/(main)/departure-groups/[groupId]/components/record-payment-dialog.tsx>).
That existing dialog is **replaced by an import**, not forked.

After recording, the toast names what happened, and the eight consequences of §3.4 follow.

### 4.6 Payments tab — the immutable ledger

`DataTable` over `finance_payment_rows`: Payment ID · Date · Customer / Booking · Departure Group ·
Amount · Method · Reference · Allocated To · Recorded By · Proof · Status · Actions.

Statuses `Completed · Pending Verification · Failed · Reversed · Refunded · Voided` map to
`success · warning · danger · neutral · info · neutral`.

Row actions are **View**, **Verify** (`verifyPayments`), **Download proof** (120 s signed URL) and
**Reverse / Void** (`reversePayments`, reason mandatory). There is no Edit and no Delete. A
reversal renders as its own negative row linked to the original, so the ledger reads as a history
rather than a state.

Saved views: `All · Today · This Month · Pending Verification · Unallocated · Reversed & Voided`.

### 4.7 Invoices tab

`DataTable` over `finance_invoice_rows`: Invoice Number · Customer / Supplier · Booking / Group ·
Invoice Type · Amount · Due Date · Status · Sent · Actions.

**Create Invoice** generates from a booking milestone (F5's rule): pick booking → pick milestone
(or "whole booking") → type is inferred from `milestone_type` → line items are seeded from the
package snapshot and payments already received, exactly as the spec's detail example shows
(`Triple Sharing Package × 2` … `Less payments received` … `Balance due`). A supplier invoice picks
a `supplier_commitment` instead.

**Invoice detail** is a right-side `Sheet` rendering the document, with
`Download PDF · Send WhatsApp · Send Email · Mark Sent · Void Invoice · Create Credit Note`.

In V1, **Send** does not send — it opens the existing `wa.me` / `mailto:` link with a drafted
message and records `INVOICE_SENT` with the channel, which is the same staff-approved posture the
reminder dialogs already take. **Download PDF** is `window.print()` against a print stylesheet
(D5).

Void never deletes; a credit note is a new invoice with `credit_note_of` set.

### 4.8 Supplier Payables tab

Reads `finance_supplier_payable_rows` — i.e. `supplier_commitments` (F7). Columns exactly as the
spec: Supplier · Departure Group · Service · Reference · Total Cost · Paid · Outstanding · Due
Date · Payment Status · Owner · Actions.

**Record Supplier Payment** calls the **existing** `recordSupplierPaymentAction`
([operations/suppliers/actions.ts](<app/(main)/suppliers/actions.ts>)) — the trigger on
`supplier_payments` already keeps `supplier_commitments.amount_paid` correct. This tab adds a
surface, not a model. The dialog is a thin wrapper over
[record-payment-dialog.tsx](<app/(main)/suppliers/[supplierId]/components/record-payment-dialog.tsx>),
whose in-file note _"recorded here until the Finance module lands"_ this module retires.

Totals render **per currency** with a "+N more" suffix, never summed (D1).

Phase 7 also fixes F7 upstream: `buildPaymentSummary()`'s `supplierPayablesDue` is repointed at
`supplier_commitments`, so the group Payments tab and the Finance page finally agree.

### 4.9 Refunds & Adjustments tab — Phase 8

Refund request form per the spec (booking, reason, amount, policy eligibility read from
`package_snapshot.cancellation_policy`, approver), a pending-approval queue with
`[Approve] [Reject]` for `approveRefunds`, and an adjustments register showing every field the
spec's list requires as a column.

An approved refund's payout writes a **negative `payments` row** (§3.4), so refunds land in the
same ledger as collections rather than in a parallel one.

### 4.10 Reconciliation tab — Phase 8

V1 is the spec's simple manual process, and is mostly already covered by the ledger's
`PENDING_VERIFICATION` status: a queue of unverified payments with proof preview, reference number
and `[Mark Verified]`, plus two derived counts — **unallocated payments** and **potential
duplicates** (same booking, same amount, same day, different payment id). Bank import and
auto-matching are explicitly out of scope; the tab states so.

### 4.11 Group readiness connection — Phase 6

Nothing new is computed. The group's Payments tab
([payments-tab.tsx](<app/(main)/departure-groups/[groupId]/components/tabs/payments-tab.tsx>)) gains:

- the real milestone-level payment status instead of the `next_due_at` heuristic,
- a _"28 / 32 pilgrims meet required threshold"_ line with its blockers, and
- an `[Open Finance Queue]` button → `/finance/payments?tab=receivables&group={id}`.

It loses nothing and shows no invoices — _"the group does not need to show every invoice. It shows
operationally relevant payment risk only."_

---

## 5. Finance AI assistant — Phase 9

Same posture as the existing AI panels (`ai-operations-panel.tsx`, `ai-visa-panel.tsx`,
`ai-agent-panel.tsx`, implemented via `lib/data/documents-ai.ts` and `@anthropic-ai/sdk`):
**suggestion-only, staff-approved, no autonomous writes.**

May: identify overdue bookings near departure; draft payment reminders; detect payments not
allocated to milestones (a direct query over `payment_allocations`); find duplicate bank-slip
uploads; identify group-level cash-collection risk; summarise supplier payments due before
departure; recommend a follow-up queue order.

Must never: record a payment; approve a refund; change an invoice amount; issue a supplier
payment; apply a discount; delete or reverse a finance record; send a reminder without staff
approval.

Every output is a draft with `[Record Payment]` / `[Send Reminder]` / `[Create Task]` buttons that
open the existing dialogs pre-filled — the write is always the staff member's click.

**Do not start before real payment history exists.**

---

## 6. Build phases

Matching the spec's own V1 order.

| Phase | Deliverable                                                                                                                                                      | Done when                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Delete `app/(main)/payment-invoices/`; sidebar → `/finance/payments`; page shell + tabs behind `capabilitiesForFinance`; dashboard's _Open finance_ button wired | No user can reach a stub; wrong-role users get 404                                                                                     |
| **1** | Migration A + backfill + `finance-access` + repository + `finance_receivable_rows` + Customer Receivables tab (filters, saved views, table)                      | Every booking has a real milestone schedule, and the collection queue is usable                                                        |
| **2** | Migration B + C + proof bucket + Record Payment dialog + §3.4 wiring + receipt numbers                                                                           | A payment is a record with an id, a method, a reference, a proof and an allocation — and the booking total still comes from one writer |
| **3** | Payments tab + verification + `reverseBookingPaymentInStore()` + reversal/void + `finance_activity_events`                                                       | Nothing is ever deleted; a correction is a record                                                                                      |
| **4** | Migration D + Invoices tab + generate-from-milestone + send/void/credit note                                                                                     | An invoice exists as a document generated from a booking                                                                               |
| **5** | Overview tab: KPIs, priority queue, group finance health; repoint `admin-dashboard-data.ts` collections at real queries                                          | The dashboard and the finance page report the same numbers                                                                             |
| **6** | Group Payments tab on milestone-level status + `[Open Finance Queue]`; replace the group's Record Payment dialog with the shared one                             | One record-payment implementation in the codebase                                                                                      |
| **7** | Supplier Payables tab over `supplier_commitments`; repoint `buildPaymentSummary().supplierPayablesDue` (F7)                                                      | One definition of supplier payables                                                                                                    |
| **8** | Migration E + Refunds & Adjustments + Reconciliation                                                                                                             | A refund has a request, an approver and a payout row                                                                                   |
| **9** | AI finance panel + reminder drafts                                                                                                                               | Suggestions only, every write behind a staff click                                                                                     |

Phases 1–3 are the module — without them there is no ledger and the page cannot honestly be
called finance. 4–9 each stand alone and can be reordered against business priority.

---

## 7. Decisions and risks

**D1 — No FX conversion.** Bookings are LKR; supplier commitments carry their own currency. Every
total is reported per currency and the Supplier Payables KPI shows the largest with "+N more".
Identical to the Suppliers plan's D1, for the identical reason: there is no rate source in the
codebase and a blended figure would be quietly wrong.

**D2 — `booking_payment_milestones` becomes authoritative; `pilgrim_payment_milestones` becomes a
projection.** Money is owed by a booking (F2), and the group Payments tab already says so. Rather
than migrate the Pilgrim profile's Payments tab in this module, the pilgrim table is kept and
written through from the booking allocation, so the pilgrim screen keeps working unchanged.
**Cost:** two tables briefly describing one schedule. **Alternative rejected:** reusing the pilgrim
table at booking grain, which would make a family of four's deposit either duplicated or
arbitrarily attributed to one traveller. A later migration can collapse the projection once no
screen reads it directly.

**D3 — There is no collection target, so the KPI does not claim one.** The spec's _"82% of
target"_ needs a monthly target that exists nowhere in the schema. The card reports % of expected
revenue and `finance-copy.ts` documents the gap. Adding a targets table is a small, separate
change — flagged, not smuggled in.

**D4 — There is no Finance Manager role, so Finance cannot self-approve.** The spec routes refund
and adjustment approval to "Finance Manager / Admin". `StaffRole` has `FINANCE` and `ADMIN` only.
Approval is therefore `ADMIN`-only in V1, with `FINANCE` able to request. **Recommendation:** add
`FINANCE_MANAGER` to `StaffRole` when the staff-roles table lands; do not fake it with a
per-module flag.

**D5 — No PDF library. Invoices print, they do not render server-side.** There is no PDF
dependency in `package.json` and the only document-production precedent is `window.print()`
(F5). Adding a PDF renderer is a real dependency decision with bundle and font implications (Tamil
and Sinhala names are already a known concern in `lib/csv.ts`). V1 ships a print stylesheet;
**Download PDF** is the browser's. Server-side PDF is a separate, deliberate choice.

**D6 — Invoice `OVERDUE` is stored; every other status is derived.** An invoice is a document that
was sent with a date on it, and its overdue-ness is a fact about that document. Everywhere else in
this plan — payment status, payable status, receivable status — status is derived, never stored,
for the reason the Suppliers plan's D6 gives.

**D7 — A payment without proof _or_ reference lands as `PENDING_VERIFICATION`.** The spec's V1
process ends in "marks verified", and the alternative — refusing the payment — would block a clerk
recording cash at the counter. The queue, not the form, is where evidence is chased.

**D8 — The `Pilgrim` role is out of scope.** The spec's role table gives pilgrims their own
invoices, schedule, receipts and proof upload. There is no customer portal, no pilgrim
authentication, and `StaffRole` has no pilgrim member. The schema does not block one (invoices and
milestones are booking-scoped), but no screen is built. Flagged, not silently dropped.

**D9 — Marketing's access is near-empty.** As with the Suppliers plan's D7, "basic deposit/payment
status for their bookings" is a column on the Leads/Bookings screens, not a finance page.
**Recommendation: `viewModule: false` for Marketing**, and surface deposit status where they
already work. This contradicts the spec's table, so it is flagged rather than decided.

**D10 — There is no standalone Booking route, and this module does not add one.** `[Open Booking]`
goes to `/departure-groups/{groupId}?tab=payments`, the same destination the group's own booking
detail dialog serves today. A `/bookings/{id}` route is a cross-module change.

### Risks

| Risk                                                                                                                                | Mitigation                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The ledger and `departure_group_bookings.amount_paid` drift**, because Supabase gives no transaction across the two writes (§3.4) | Ledger first, totals second, so the failure is a visible under-count rather than a phantom balance. The reconciliation tab's _unmatched_ count is exactly this check: `sum(completed payments) ≠ amount_paid`. Add it in Phase 3, not Phase 8 |
| A Postgres trigger maintaining `amount_paid` would fight the `persistStore` diff writer (F13)                                       | No trigger touches `departure_group_bookings`. The allocation trigger's blast radius is `booking_payment_milestones` only                                                                                                                     |
| **Backfilling milestones for existing bookings** could produce schedules that disagree with money already collected                 | The backfill allocates `amount_paid` across the new milestones oldest-first, reusing `allocatePaymentToMilestonesInStore()`'s rule, and is idempotent (`unique (booking_id, sequence)`). Verify on a copy before applying                     |
| `getCurrentStaffRole()` returns ADMIN for everyone, so **no role gate in this plan is observable in production today**              | Unchanged from Visa/suppliers. Build the matrix correctly; verify by setting `user_metadata.staff_role`                                                                                                                                       |
| Money figures leaking to `viewPaymentStatusOnly` roles                                                                              | Stripped in the repository, never merely hidden in the UI — the posture `operations-access.ts` and `suppliers-repository.ts` already document                                                                                                 |
| Three disagreeing supplier-payable numbers if Phase 7 is skipped                                                                    | Phase 7 is small and repoints `buildPaymentSummary()`. Do not ship the Supplier Payables tab without it                                                                                                                                       |
| `seedPilgrimPaymentMilestones()`'s swallowed failures leave bookings with no schedule (F3)                                          | Phase 1's backfill covers existing rows; new bookings get `booking_payment_milestones` written in the same path, and the receivables view's `left join lateral` degrades to "no next milestone" rather than erroring                          |
| Payment-proof bucket sprawl across three private buckets                                                                            | Separate `payment-proofs` bucket, server-composed keys, MIME allowlist, signed reads only — copied from `document-storage.ts`. Different retention and audience from documents and supplier evidence justify the split                        |
| Seven tabs is a lot of surface for one route                                                                                        | Phases 1–3 ship three tabs; the rest render `EmptyState` with a "coming in a later phase" line rather than half-working                                                                                                                       |

---

## 8. Suggested sequencing

1. **Phase 0 first, today** — the stub is publicly reachable from the sidebar and the dashboard
   already advertises the page.
2. **Phases 1–3 as one push.** A payments page without a payment record is not a finance module;
   a payment record without reversal is not a ledger. Do not stop between them.
3. **Phase 6 immediately after 3**, while the record-payment code is fresh — that is when the
   codebase drops from two record-payment implementations to one, which is the change that stops
   the drift getting worse.
4. **Phase 7 next**, because it is small and it retires an actively wrong number that two screens
   already display.
5. Phases 4, 5, 8, 9 by business priority. Phase 5 is the most visible and the least load-bearing;
   resist doing it first.
