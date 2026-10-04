# Departure groups: calculation audit and implementation plan

## Scope and evidence

Reviewed the current working tree, including existing uncommitted changes. This document is the only change made by this audit. No application fixes or database changes were implemented.

This is a source-code audit of departure-group routes, their shared data/mutation layer, finance and reporting calculations, related SQL migrations, and downstream consumers. It is not a claim that every line of the repository or every production record has been verified. The deployed migration state, live data, browser workflows, concurrency behavior, and database access policies still need integration verification. Migration filenames extend beyond the environment date; their presence does not prove they are deployed.

Evidence:

- Existing focused tests: **27 passed across 3 files** (`departure-groups-bookings.test.ts`, `departure-groups-copy.test.ts`, `finance.test.ts`). The booking tests cover payer/relationships; the finance tests mainly cover payment-plan status. They do not establish correctness of end-to-end money flows.
- A temporary in-memory Node/TypeScript harness executed the actual money, finance, and report helper functions without adding source/test files. It reproduced unpaid overdue bookings labelled `NOT_STARTED`, a zero-value booking labelled `NOT_STARTED`, a zero-value milestone labelled `OVERDUE`, a one-cent-short milestone skipped, aging balances disappearing between bucket boundaries, and USD/LKR values added into one LKR KPI.
- Other findings below are confirmed source-path defects or explicitly identified database/policy risks, with integration tests specified before implementation is accepted.

Priority: **P1** = money integrity, operational correctness, or access control; **P2** = reporting/display correctness. Ordering within P1 matters: establish reliable writes before repairing projections.

## 1. Dependency and impact map

| Surface | Departure-group dependency / impact |
|---|---|
| `/departure-groups`, creation/import/archive | Group seats, status, pricing, dates, list KPIs, template copies |
| `/departure-groups/[groupId]` | Overview, bookings/pilgrims, payments, hotels/rooms, flights, transport, documents/visa, guide operations, readiness, activity and agent tabs |
| `/departure-groups/[groupId]/bookings/[bookingId]`, `/bookings/[bookingId]` | Share `loadBookingDetailData`; charges, payer, relationships, invoices, cancellation, movement and outstanding balances |
| `/departure-groups/[groupId]/pilgrim/[pilgrimId]/id-card` | Manifest identity, group dates and actual room assignments; direct route has group and sensitive-data checks |
| Invoice preview and exported PDF | Approved traveller charges, booking payment amount, currency and due date |
| Finance overview/payments/receivables | Booking balances plus a separate payments ledger and booking milestone schedule |
| Finance payment plans and reminders | `booking_payment_milestones`, allocations, due-date changes and risk context |
| Finance invoices and invoice detail | Invoice headers/lines, issue snapshots, milestone allocations, credits and lifecycle |
| Finance refunds/credits and reconciliation | Refund requests, payment reversals/payouts, receipts and ledger matching |
| Finance departure profitability and suppliers/payables | Group costing view, live booking revenue, supplier commitments/payments |
| Dashboard and Reports | Finance loaders, reporting SQL facts, group summaries, aging, collections, margin and operational readiness |
| Pilgrims and pilgrim portal | Journey enrollment/status; Pilgrims additionally has a third schedule, `pilgrim_payment_milestones` |
| Operations, flights/tickets, hotels/rooming, transport movements | Same stored group entities, seat/ticket counters, room assignments and readiness/blockers |
| Documents and Visa | Traveller document/visa state and group eligibility/readiness |
| Itinerary/services, guides/field team, team assignments | Group dates, services, assignments and tasks |
| Packages, leads, quotes and WhatsApp booking tools | Group availability/current pricing, booking creation and conversion |
| Campaigns, audiences, announcements, feedback, loyalty, support | Group/booking attribution, membership and journey context; cancellation/movement changes their population |
| Departure-operations agent and finance proposal context | Stored/live readiness and money projections; incorrect inputs can produce incorrect tasks or proposals |

The last two rows are dependency inventory, not a claim of a separate defect in every listed module. Regression coverage should follow these links when changing group membership or financial facts.

## 2. Findings and required fixes

### DG-01 — P1: Group payments and initial deposits bypass the finance ledger

**Evidence:** `app/(main)/departure-groups/actions.ts:759` calls `recordBookingPayment`; `lib/data/departure-groups.ts:2927` updates the group store and pilgrim schedule only. `lib/data/departure-groups-bookings.ts:333` stores initial `amount_paid` directly. Neither path inserts a `payments` record. Finance uses a different entry point, `lib/data/finance-repository.ts:600`.

**Impact:** A group payment raises collected money on the group and reduces its balance while Finance collections, receipts, payment history, reconciliation and reporting cannot see the payment. Initial deposits have the same gap. The group flow also bypasses Finance's pending-verification rule.

**Fix:** One authoritative payment command for group, booking, finance and deposit entry. Record ledger event, verification state, allocations, booking projection and receipt atomically. Keep lower-level booking projection changes internal to that command. Decide the evidence rule consistently for cash and other methods.

**Acceptance:** The same payment entered from each supported route produces one equivalent ledger record and identical balances. Retrying produces no second payment. Imported/opening balances are explicitly distinguished from newly received cash.

### DG-02 — P1: New bookings do not get Finance's payment milestones

**Evidence:** `lib/data/departure-groups.ts:2748` calls only `seedPilgrimPaymentMilestones`. Runtime references to `booking_payment_milestones` read/update it; the insert/backfill exists in `supabase/migrations/20260818090000_finance_payments.sql:107`, without a new-booking trigger.

**Impact:** Bookings created after that migration can have a balance but no Finance payment plan, aging entry, overdue milestone or reminder. Allocating a payment to an empty schedule silently allocates nothing.

**Fix:** Create the agreed booking schedule in the booking transaction. Make the schedule authoritative at booking grain and version it. Validate its total against billable booking value. Add an idempotent repair for existing bookings missing schedules.

**Acceptance:** A newly created booking appears immediately in payment plans. Percentage/fixed/remainder schedules sum exactly to booking value, including cent residuals. No balance is silently left without a due-date policy.

### DG-03 — P1: Pilgrim schedules miscalculate percentages and remaining balances

**Evidence:** `lib/data/departure-groups.ts:2800` maps percentage amounts to `null` and drops relative due rules. `lib/data/pilgrims.ts:923` replaces every null amount with the whole per-person booking price. The seed reads the original package schedule, while booking due dates read group pricing.

**Example:** A 30% / 70% schedule on a traveller priced at 1,000 becomes two 1,000 milestones. Relative due dates become null. Different traveller fares are replaced with a blended booking rate.

**Fix:** Derive pilgrim displays from the authoritative booking schedule. If traveller allocations are required, define their ownership and allocate cents and fare differences explicitly; do not fabricate equal personal debts from a family balance.

**Acceptance:** For a two-traveller booking with unequal fares, all displayed personal amounts reconcile to the booking schedule and paid amount, with correct relative dates.

### DG-04 — P1: Due dates, overdue amounts and payment statuses disagree

**Evidence:** `departure-groups-bookings.ts:641` clears `next_due_at` only on full payment; partial settlement does not advance it. Reversal at `:795` reopens a balance without restoring the date. Charge recomputation in `departure-groups-charges.ts:99` only recalculates a missing date. Finance rescheduling (`finance-repository.ts:1103`) does not update the booking projection. Group date edits shift readiness dates (`departure-groups-lifecycle.ts:350`) but not the payment schedules.

Group summary (`departure-groups.ts:1140`) counts the entire remaining booking balance as overdue when one date passes; Finance SQL counts only unpaid, overdue installments. `derivePaymentStatus` (`departure-groups-money.ts:164`) checks zero paid before overdue. The milestone resolver allows a whole cent of underpayment to pass (`:143`).

**Example:** 1,000 total, 300 overdue deposit, 700 due later: the group can report 1,000 overdue while Finance reports 300. After paying 300, the group can keep the old overdue date.

**Fix:** Derive next due date and overdue amount from unpaid authoritative milestones after each payment, reversal, charge adjustment or schedule change. Derive status at read time with an explicit clock. Resolve money in integer minor units; do not waive a cent implicitly. Preserve original booking date for on-booking rules.

**Acceptance:** Partial settlement advances the due date; reversal restores the correct date; rescheduling agrees everywhere; unpaid past-due debt is overdue; a free booking is settled; one cent short remains unpaid.

### DG-05 — P1: Financial writes and group seat writes are not atomic

**Evidence:** `departure-groups-repository.ts:614` persists collections in separate requests. Groups have no version guard (`:162`), while bookings do (`:219`). Finance records and allocates a completed payment before updating the booking (`finance-repository.ts:600`); if the booking rejects it, the completed ledger entry remains. Refunds and reversals update booking money before completing their ledger writes.

**Impact:** Partial failures can leave money/allocations/seats inconsistent. Concurrent bookings can both read the same availability and overwrite the group counter; a constraint on that counter alone cannot detect the sum of separately inserted bookings. A retry can duplicate money movement.

**Fix:** Transactional database commands with booking/group locks, balance and capacity checks inside the transaction, explicit idempotency keys and conditional lifecycle transitions. Preserve tenant and role authorization in these commands. Use an outbox for post-commit projections/notifications.

**Acceptance:** Two concurrent bookings for one seat yield one success. Two payment/refund retries yield one event. Inject failures at every step and verify all-or-nothing changes. Treat the current partial-write error handler as reporting, not recovery.

### DG-06 — P1: Payment allocations are insufficiently validated

**Evidence:** `lib/validations/finance.ts:30` validates individual positive amounts, without checking their sum. The completed-payment path inserts supplied milestone IDs directly (`finance-repository.ts:650`). The pending verification helper checks ownership but not the allocation total or current milestone balance (`:539`). SQL allocation foreign keys do not enforce matching booking ownership or total allocated against payment amount.

**Impact:** A payment of 100 can settle 200 of milestones, or allocations can target another booking within the same accessible tenant.

**Fix:** Validate parent group/booking/currency, milestone ownership, unique IDs, allocation totals and available milestone balances within the payment transaction. Model any unapplied credit explicitly.

**Acceptance:** Reject mismatched group/booking and cross-booking allocation; reject excessive totals and duplicate IDs; handle a concurrent settlement safely.

### DG-07 — P1: Reversing an unverified payment subtracts unrelated real money

**Evidence:** `finance-repository.ts:813` rejects only already reversed/voided records and negative rows, then always calls `reverseBookingPayment`. `PENDING_VERIFICATION` payments have never increased booking paid amount.

**Example:** A booking has 500 genuinely paid and a pending 100 entry. Reversing the pending entry can reduce genuinely paid money to 400.

**Fix:** Separate voiding an unapplied entry from reversing an applied payment. Reverse only original posted allocations and allow each original posting to be reversed once. Keep overdue/status projections in step.

**Acceptance:** Voiding pending/failed entries never changes paid amount. Reversing a posted payment reverses exactly its contribution once.

### DG-08 — P1: Cancellation refund liability is not a reliable financial record

**Evidence:** Cancellation (`departure-groups-bookings.ts:1360`) accepts a partial refund but stores it in activity/outcome, marks travellers `REFUND_PENDING`, and zeros the booking balance. It creates no refund request. Group summary (`departure-groups.ts:1162`) substitutes the whole amount paid for refund liability. SQL summary (`20261003090000_supplier_numbers_reconciliation.sql:42`) sums outstanding balance once per refund-pending traveller.

**Example:** 1,000 collected, 200 cancellation refund: group summary shows 1,000 pending, SQL can show zero, and Finance has no request unless separately created. On other states the SQL join can multiply a booking balance by traveller count.

**Fix:** Persist an explicit cancellation settlement/refund request in the cancellation transaction. Sum open refund liabilities once per request. Record retained fees/credits explicitly. Reconcile all refund flags from open requests.

**Acceptance:** Two-traveller cancellation with a 200 refund shows 200 everywhere, not 0, 400 or 1,000. Zero-refund cancellation retains the agreed financial history.

### DG-09 — P1: Refund payout reopens cancelled debt and does not reconcile all schedules

**Evidence:** `finance-repository.ts:1030` uses `reverseBookingPayment`; `departure-groups-bookings.ts:795` always calculates `total_booking_value - amount_paid`, even for cancelled bookings. Payout creates an unallocated negative `REFUNDED` payment. Clearing traveller refund flags happens without considering other open refund requests.

**Impact:** A cancelled booking can regain receivables after its refund is paid. Finance's KPI sums all receivable balances. Finance milestones remain inconsistent with the refund, and another pending refund can disappear from the traveller status.

**Fix:** Apply refund against the explicit settlement/credit liability, with cancellation-aware outstanding calculations and ledger allocations. Derive refund state from all outstanding requests; close only the paid request.

**Acceptance:** Payout does not recreate cancelled debt; multiple partial requests remain visible until all are settled; booking, ledger, schedules and refund liability reconcile.

### DG-10 — P1: Moving a booking leaves financial group links behind

**Evidence:** `departure-groups-bookings.ts:1630` moves group booking/traveller/charge/deviation data, but its store does not contain payments, Finance milestones, invoices or refund requests. `recordPayment`/`reversePayment` depend on matching group IDs. No cross-currency guard exists in the move. The reprice precheck uses uniform rate × travellers (`:1698`), although retained manual fares/add-ons/discounts determine the actual new total; `:1751` then clamps paid amount down to that total.

**Impact:** Old payments can no longer reverse against the moved booking, reports can split attribution between groups, and pending refund payout can target the wrong group. Repricing can silently reduce recorded paid money in a mixed-fare/discount case.

**Fix:** Transactional transfer command with explicit historical attribution versus current ownership. Preserve issued documents. Rebind active schedules and pending workflows as appropriate. Freeze booking currency and reject cross-currency transfer until a deliberate conversion/settlement flow exists. Calculate proposed billable charges first; never reduce paid amount to make a price change fit.

**Acceptance:** Move a partially paid, customized booking with an issued invoice and pending refund; reversal, payout, reminders and both group reports remain coherent. A manual fare/discount case must not discard money.

### DG-11 — P1: Currency is inconsistent at storage, display and aggregate levels

**Evidence:** Group price currency is editable (`departure-groups-lifecycle.ts:390`), but group payments use the old snapshot (`departure-groups.ts:1671`); Finance receivables and profitability also read snapshot currency. Payment/refund inserts omit currency and take SQL's LKR default (`finance-repository.ts:617`, `:941`). `finance.ts:212` sums currencies and labels the result from the first receivable. Profitability's total margin (`profitability-view.tsx:71`) is also a mixed sum displayed with the default currency. Dashboard formats LKR.

**Fix:** Persist agreed currency on each booking and carry it through ledger, schedules, refunds and invoices. Separate totals by currency until a real FX policy exists. Current group catalogue pricing must not relabel old contracts. Either prohibit changing currency with existing obligations or implement an explicit migration workflow.

**Acceptance:** USD 100 plus LKR 100 displays as two totals, never LKR 200. Price edits do not change the currency of previously recorded money.

### DG-12 — P1: Group-generated invoices have no payment-settlement path

**Evidence:** `invoice-preview-dialog.tsx:154` creates a `BOOKING` invoice without a milestone. The settlement trigger (`20260818090000_finance_payments.sql:405`) only marks invoices linked to a milestone paid, only from `ISSUED`, and never reopens paid invoices. Invoice detail allocations are loaded solely through `milestone_id`.

**Impact:** A fully paid group invoice can remain issued indefinitely. Reversal does not reopen a paid milestone invoice. An invoice issued after its milestone was settled misses the earlier trigger event.

**Fix:** Define invoice-level allocation/balance semantics for booking and installment invoices, including credits. Derive paid/partial/overdue display from invoice settlement without mutating issued commercial content. Recompute at issue and at every settlement event.

**Acceptance:** Full/partial settlement, pre-paid issuance, reversal and credit note all produce the correct invoice balance/status. Multiple invoices must not each independently claim the entire booking payment.

### DG-13 — P1: Invoice header totals and customer PDFs are not guaranteed to agree

**Evidence:** `finance-repository.ts:1280` accepts header `amount` and `lineItems` independently; issue does not reconcile them. `invoice-preview-dialog.tsx:165` continues PDF generation and a success toast after issue fails. The PDF uses client preview data rather than the persisted issued snapshot.

**Fix:** Derive and validate invoice totals on the server using authoritative approved charges/version checks. Issue atomically; only generate an issued document after successful issue. Render/download from the saved issued snapshot and reuse the existing draft on retry.

**Acceptance:** Reject header/line mismatch and stale preview. Issue failure yields no issued-looking PDF. Downloaded line totals, header, currency and issue date match persisted content exactly.

### DG-14 — P2: Exact amounts are rounded to whole currency units

**Evidence:** `app/(main)/departure-groups/utils.ts`, `formatExactCurrency`, uses `Math.round`. `invoice-pdf.ts:230` uses it for subtotal, payment and balance; `booking-invoice.ts:84` sums without money rounding.

**Impact:** A 1,250.50 debt prints as 1,251 even though storage and payment validation use two decimals. Displayed component amounts can fail to reconcile.

**Fix:** Exact formatting with the supported currency precision; reserve abbreviations for labelled summary cards. Define one line-rounding policy shared by charges, invoice header, persisted lines and PDF.

**Acceptance:** Fractional prices, quantities and discounts reconcile to the cent in preview, issued invoice and PDF.

### DG-15 — P1: Supplier payables have two conflicting sources

**Evidence:** `departure-groups.ts:1170` sums full hotel/transport internal costs. Later SQL summary (`20261003090000_supplier_numbers_reconciliation.sql:48`) sums commitment balance after payments. Group supplier synchronization is best-effort (`actions.ts:1578`). Group closure (`departure-groups-lifecycle.ts:817`) checks booking debt and traveller refund flags, not supplier commitment debt.

**Impact:** A fully paid hotel can still appear owed on the group page. Flights/other commitments can be omitted there. A group can close despite supplier money owed, although its closure message says the ledger is settled.

**Fix:** Source payables from eligible commitments minus payments/credits by currency. Separate booked cost, remaining payable and due payable. Make supplier synchronization reliable/idempotent and incorporate actual supplier/open-refund obligations in closure checks.

**Acceptance:** Supplier payment reduces payable everywhere. Unlinked estimates are labelled estimates. Open obligations block financial closure or require an explicit supported settlement policy.

### DG-16 — P2: Finance collections can be truncated or use incompatible cash definitions

**Evidence:** `finance-repository.ts:148` loads only the latest 500 payments; the workspace KPI calculates monthly totals from that list. `finance.ts:212` has no upper date bound. Report payment facts (`20260819090000_reports.sql:69`) select only `COMPLETED`, excluding refund payouts stored as `REFUNDED`. Reversal changes the original record's status, altering past-period collections.

**Fix:** Database aggregate queries independent of ledger pagination, with explicit period bounds and currency. Define gross receipts, refunds and net cash as distinct measures. Preserve dated accounting events so later corrections do not erase historical receipt activity accidentally.

**Acceptance:** 501+ payments in a month are all counted; future-dated payments are excluded from current collections; receipt then next-month refund/reversal produces a coherent two-period cash report.

### DG-17 — P2: Cancelled obligations and zero amounts contaminate finance counts

**Evidence:** `finance.ts:216` sums all receivables rather than applying cancellation/status semantics. Supplier due KPI also does not filter cancelled/disputed rows and includes rows with no due date. `report_milestone_facts` does not exclude cancelled bookings. `derivePlanStatus` requires amount > 0 for completion (`finance.ts:77`).

**Fix:** Shared status/population filters for each KPI; show undated supplier balances separately from due balances. Treat zero obligations as settled/non-actionable. Exclude cancelled collection obligations unless a specific cancellation fee remains legally/modelled as payable.

**Acceptance:** Cancelled booking milestones do not generate aging/reminders; zero-value installments are not overdue; disputed/undated payables have explicit separate treatment.

### DG-18 — P2: Aging buckets lose balances at fractional day boundaries

**Evidence:** `reports-finance.ts:133` returns fractional elapsed days; bucket ranges in `reports-copy.ts:35` use 0, 1–7, 8–30, 31+. A balance 0.5, 7.5 or 30.5 days overdue matches no bucket.

**Fix:** Adopt an agency-timezone calendar-day policy or contiguous timestamp boundaries. Use one explicit reporting clock.

**Acceptance:** Every eligible amount belongs to exactly one bucket; bucket totals equal total eligible outstanding at every boundary, including no due date.

### DG-19 — P2: Profitability figures represent incompatible models

**Evidence:** `20260909090000_departure_group_costing.sql:104` calculates margin using current quad list price × booked-plus-held seats minus estimated variable/fixed cost. It does not use agreed traveller fares, discounts, child rates or add-ons. Reports use actual booked revenue minus mixed-currency supplier commitments (`reports-finance.ts:169`, `reports-groups.ts:103`), while the departure view's actual supplier cost includes hotel/transport internal costs only.

**Assessment:** A list-price scenario is a valid estimate, but it is not the same measure as agreed-booking margin or actual profit. These values cannot safely be compared under generic margin/cost labels. Held seats labelled “confirmed” are misleading.

**Fix:** Separate catalogue scenario, booked contribution, forecast cost and actual recognized cost. Label held vs confirmed headcount. Use agreed billable revenue for booked margin; make unknown costs explicit instead of treating all missing estimates as zero. Define scope and currency of actual supplier cost.

**Acceptance:** Mixed room tiers and discounts affect booked margin; changing catalogue price does not change agreed revenue. Missing costs do not imply a fully profitable trip. Held seats are separately visible.

### DG-20 — P1: Rooming readiness can complete before all stays are assigned

**Evidence:** `departure-groups-rooming.ts:38` sets `ASSIGNED` when any room assignment exists. `departure-groups-readiness.ts:221` uses that scalar for `ROOMING_COMPLETE` and manifest readiness. Hotel/transport readiness also uses the first matching row (`:155`, `:108`).

**Example:** Every traveller has a Makkah room, none has a Madinah room: rooming can read complete. Two required hotel blocks in one city can read complete from the first confirmed block.

**Fix:** Evaluate each traveller against every applicable stay/service, including approved hotel deviations. Aggregate all required relevant service rows rather than selecting the first. Preserve explicit exemptions.

**Acceptance:** Makkah-only room assignments do not complete a two-city trip. All mandatory blocks must be confirmed. Cancelled/replaced services and own-arranged services have explicit treatment.

### DG-21 — P1: Flight ticket counts can be fabricated or remain stale

**Evidence:** `departure-groups-flights.ts:938` uses `outbound?.seats_ticketed || returnFlight.seats_held`; zero therefore becomes all return seats held. Recompute counts traveller-wide `TICKETED` state rather than per-sector evidence. Cancellation/movement do not invoke this counter recomputation. Manifest readiness requires `flight_status === 'TICKETED'` without considering the established `excluded_from_group_flight` flag.

**Fix:** Preserve legitimate zero counts and derive each flight/sector from assignments and ticket evidence. Recompute after cancellation, movement and ticket/deviation changes. Distinguish own-flight evidence from group-flight inventory and handle approved land-only exemptions.

**Acceptance:** Zero outbound tickets never implies a full return manifest. Cancelling/moving a ticketed traveller updates both affected groups. Own-flight/land-only travellers neither consume group inventory incorrectly nor remain permanently blocked by an inapplicable ticket requirement.

### DG-22 — P2: KPI labels and populations differ

**Evidence:** `departure-groups/utils.ts`, `computeListKpis`, excludes terminal groups for upcoming counts but not for at-risk counts. `departure-groups.ts:771` counts every past-due unfinished readiness item as “due today.” Dashboard `buildKpis` (`dashboard-repository.ts:196`) labels readiness “Next 30 days departures” while counting all active groups. Readiness payment derivation excludes cancelled bookings but still includes waitlist debt (`departure-groups-readiness.ts:59`).

**Fix:** Define live/sellable/travelling/financial populations once, separately where needed. Match date windows to labels. Split overdue from due-today. Establish whether waitlists represent committed debt; do not let unsold waitlist passengers silently block readiness.

**Acceptance:** Closed/cancelled groups, departures outside 30 days, yesterday's tasks and waitlists have consistent, documented handling in list, dashboard, operations and reports.

### DG-23 — P1, database verification required: Costing view misses tenant-safe view configuration

**Evidence:** `20260909090000_departure_group_costing.sql:104` creates the view without `security_invoker`. Earlier hardening migrations set that property on other views but predate this one; no later setter for this view was found. `profitability-repository.ts:65` selects the entire view without an explicit agency filter.

**Risk:** With typical privileged view ownership and authenticated grants, direct view access can bypass underlying tenant RLS. The ordinary profitability page subsequently maps rows through visible groups, so this is not a claim that its rendered table necessarily exposes another tenant. Direct view/API access must be checked.

**Fix:** Verify deployed owner/grants/options with two tenant identities. Apply invoker semantics and appropriate underlying table policies, including intended finance-role cost access; do not rely only on page capability checks.

**Acceptance:** Tenant A cannot read tenant B's costing rows through the API, and non-finance roles cannot obtain protected costs by bypassing the page.

## 3. Intended calculation contract

Define these before replacing existing helpers:

1. **Billable booking value:** sum rounded live approved charge lines; pending customizations are quoted value, not owed money. Existing `sumBillableChargeLines` and invoice charge filtering already agree on this exclusion—preserve it.
2. **Net posted payments:** posted receipts less applicable reversal/refund events, in the booking currency. Pending verification contributes zero. Historical events remain auditable.
3. **Outstanding and credit:** outstanding = max(effective obligation − settled amount, 0); customer credit/refund liability is a separate positive balance. Cancellation changes the effective obligation through an explicit settlement, not by erasing history.
4. **Schedule:** sum active collectible milestones equals effective collectible obligation under the chosen credit/adjustment model. Percentage/fixed/remainder semantics and cent residuals are explicit.
5. **Overdue:** sum positive unpaid amounts of active milestones whose due date is past the agreed cutoff. Next due = earliest eligible unsettled milestone. Future balance is not all overdue because one installment is late.
6. **Invoice:** invoice amount equals saved rounded lines/adjustments. Invoice paid balance comes from explicit settlement links. Issued commercial content is immutable.
7. **Supplier debt:** eligible commitment balance after posted payments/credits, grouped by currency. Estimated expense is not debt due.
8. **Seats:** capacity consumption derives from the documented booking states; aggregate counters reconcile to bookings under a transaction lock. Waitlist does not consume capacity.
9. **Rooming/ticket readiness:** coverage of every applicable stay/sector for every travelling person, with explicit approved exemptions.
10. **Aggregates:** defined population + defined period + defined currency + defined financial measure. Paginated UI rows are never the source for whole-business totals.

## 4. Implementation sequence

### Phase A — Regression fixtures and deployment inventory

- Add integration fixtures for two tenants; multiple currencies; individual/family and mixed-fare bookings; held/waitlist/cancelled states; full/partial payment; multi-city stays; own-flight/land-only; and all milestone types.
- Inspect applied migrations, view options/grants, numeric precisions, defaults, constraints and tenant policy behavior.
- Capture read-only reconciliation counts: missing milestones; schedule/value mismatches; booking-paid/ledger mismatches; group/child ID mismatches; refund discrepancies; seat/ticket/room counter discrepancies; header/line mismatches.
- Preserve existing uncommitted work. Add tests around current code paths before replacing them.

**Exit:** Each confirmed defect has a failing regression or explicit reproducible database scenario, and the deployed schema is known.

### Phase B — Reliable payment and booking commands

- Address DG-01, 05–07 first: atomic booking/deposit/payment/verification/reversal commands, locking, ownership validation and idempotency.
- Handle DG-23 alongside this work; check authorization for every new RPC.
- Keep current UI contracts where possible, routing all entry points through the same commands.

**Exit:** No supported path changes recorded paid money without a durable event; concurrent requests cannot oversell or double-apply money.

### Phase C — One schedule and settlement model

- Address DG-02–04 and DG-08–10: versioned booking schedule, canonical due/status projections, cancellation/refund settlement and group-transfer orchestration.
- Replace independently seeded pilgrim debts with a consistent projection.
- Coordinate charge edits, refunds, moves and departure rescheduling; preserve negotiated dates and issued documents.

**Exit:** Booking value, schedule, payments, refund liability and attribution reconcile through every lifecycle transition.

### Phase D — Invoice and currency correctness

- Address DG-11–14: freeze booking currency, propagate it, group totals by currency, validate invoice totals, allocate settlements, render saved snapshots and preserve cents.
- Add idempotent issue/retry behavior and clear draft/issued distinction.

**Exit:** Customer documents match stored invoices and their payment balances; multi-currency money is never silently added or relabelled.

### Phase E — Reporting, supplier obligations and operational readiness

- Address DG-15–22: canonical supplier payables, complete aggregate queries, contiguous aging, explicit profit measures, room/stay and flight/sector coverage, consistent populations and date windows.
- Refresh downstream readers in Dashboard, Reports, Operations, Pilgrims, portal and agent context.
- Audit route/data invalidation for both booking route aliases and cross-module consumers against the installed Next.js 16.2.12 docs. Do not assume a cache defect merely because a mutation revalidates only its local route; verify actual caching and navigation behavior.

**Exit:** A single fixture produces agreeing numbers across departure detail, booking detail, Finance, Reports and Dashboard; relevant operational totals agree with their underlying assignments.

### Phase F — Data repair and staged release

- Run reconciliation in report-only mode before any repair. Back up affected records and retain before/after audit entries.
- Backfill missing schedules using historically agreed prices and recoverable schedule policy, not today's catalogue price.
- Reconcile unledgered historical payments through explicit opening/adjustment entries after evidence review. Do not invent receipt dates, payment methods, currency conversions or refund approvals from ambiguous activity text.
- Rebuild derived counters/projections only after authoritative records reconcile. Never rewrite issued invoices to match today's charges.
- Stage release, compare old/new aggregates by booking/group/currency, investigate differences, then switch consumers. Monitor invariant failures and pending outbox work.

**Exit:** Reconciliation reports have no unexplained differences; rollback preserves authoritative financial events and immutable documents.

## 5. Required acceptance matrix

| Scenario | Required cross-page assertion |
|---|---|
| New booking with deposit | Ledger/receipt, booking balance, both schedule displays and monthly collections agree |
| 30% now / 70% later | Only unpaid due installment is overdue; partial payment advances next due |
| Mixed adult/child/manual fares + discount | Billable charges, booking, schedule and invoice reconcile exactly |
| Payment without evidence; later verify/void | Unverified amount never counts as paid; verification applies once; void has no balance effect |
| Excessive or wrong-booking allocation | Server/database rejects it without partial records |
| Full payment then charge/reversal | Correct reopened amount, due date, readiness, invoice balance and reminders |
| Partial cancellation refund and two open refunds | Exact liability once per request; payout does not reopen cancelled debt or clear another request |
| Move booking after payment/invoice/refund request | Historical attribution retained intentionally; active operations, reversal and payout remain valid |
| Currency edit / cross-currency move | Existing obligations retain original currency or operation is explicitly rejected |
| Issue failure / repeated click / stale preview | No false issued PDF, mismatched totals or duplicate issue |
| 501+ monthly payments / period boundary | Complete, bounded, per-currency aggregates independent of displayed ledger page |
| Aging at 0, 0.5, 1, 7, 7.5, 8, 30, 30.5, 31 days | Every outstanding amount appears exactly once |
| Two hotels / missing second-city rooms | No false complete rooming or manifest readiness |
| Zero tickets / own-flight / cancellation / move | Sector counters and readiness match actual applicable ticket assignments |
| Concurrent final seat / duplicate payment / failed write | One valid result, no lost updates, duplicates or partial persisted state |
| Two tenants and restricted finance role | No cross-tenant or unauthorized cost reads via direct database API |

## 6. Policy decisions to settle during implementation design

These are not excuses to postpone the confirmed defects; use explicit documented defaults until agreed:

- Do held/waitlisted bookings create contractual receivables, or only quoted/reserved value? Separate operational population from financial recognition.
- Does changing group departure date rebase agreed payment dates, or require approval? Fixed/rescheduled dates must not be silently overwritten.
- Is profitability a catalogue scenario, booked forecast or actual accounting result? Show distinct measures until recognition rules are defined.
- How are family payments attributed to individual travellers, if at all?
- How should cancellation fees, retained deposits, customer credits and refunds affect obligation and reporting?
- Which agency timezone/cutoff governs due-today, overdue and reporting periods?

## 7. Areas with no separate defect established in this audit

- The two booking-detail route variants share a loader and validate booking membership in the selected group.
- The direct ID-card route checks module access, sensitive traveller access, group access and selected manifest membership. No separate calculation defect was established there.
- Billable charge helpers exclude voided and unapproved charges consistently with invoice line selection. Preserve this while consolidating totals.
- Basic copy/date helpers and payer/relationship tests pass. This does not replace integration checks for rooming, flights, booking creation or money persistence.
- Document/visa, transport, itinerary, team and customer-relationship consumers need regression verification for changes to membership, dates and readiness; no claim is made that each contains an independently proven defect.

**Recommended starting point:** DG-01/DG-02 and transactional integrity (DG-05/DG-06), with the costing-view access check (DG-23) in parallel at the implementation-planning level. Correcting KPI presentation alone would leave the underlying money inconsistencies intact.
