# Departure Groups — Phase B progress

## Implemented in increment 1

- Booking creation now idempotently creates Finance `booking_payment_milestones` from the group payment schedule. It uses the current pricing schedule, then the booking package snapshot, and falls back to one full-balance milestone.
- Amounts are calculated in integer cents and the final milestone absorbs rounding so the schedule equals `total_booking_value` exactly.
- Due dates support On Booking, Fixed Date, and Days Before Departure rules.
- A migration adds database guards that reject Finance milestones whose booking, departure group, or agency does not match, and rejects payment allocations that cross bookings. It also adds an agency/booking/sequence index.
- The invoice register view is now safely dropped/recreated when invoice columns change, preserving `security_invoker` instead of relying on `CREATE OR REPLACE` column order.
- Existing bookings without Finance milestones are backfilled conservatively. Exact saved schedules are expanded; non-reconciling schedules receive one full-balance milestone, with historical `amount_paid` allocated oldest-due-first.
- Receivables aging now floors elapsed calendar days so fractional boundaries cannot fall between buckets.
- Finance payment allocation writes reject duplicate milestones, cross-booking milestones, waived milestones, allocations above remaining balance, and allocation totals above the payment amount.
- Reversing a `PENDING_VERIFICATION` payment now voids that unapplied entry without changing booking or milestone balances; only posted payments can create a reversal.
- Invoice creation now rejects a non-empty line-item set whose rounded total differs from the invoice header amount.
- Rooming readiness now requires each travelling pilgrim to have an assignment for every non-cancelled accommodation block, rather than treating one room assignment as complete.
- Flight ticket counters now exclude approved own-flight/land-only travellers and never infer return tickets from held seats when outbound evidence is absent.
- Booking contract currency is now persisted, payment rows inherit it, and booking invoices cannot be created in a different currency.
- Payment status derivation now treats zero-value obligations as settled and unpaid past-due balances as overdue before checking the not-started state.
- Finance payment loading now paginates through the full ledger by default; dashboards no longer calculate collections from an arbitrary 500-row slice.
- Finance collections now exclude future-dated payments and expose per-currency totals instead of treating mixed currencies as one amount.
- Reports collections now count only posted completed/refunded ledger events and expose collection totals by currency, excluding pending, voided, and reversed rows.
- Finance KPI snapshots now expose outstanding and overdue receivables by currency, preventing mixed-currency totals from being mistaken for one amount.
- Supplier payable KPIs now exclude undated commitments from “due within window” totals and expose them separately by currency.
- Readiness excludes waitlist bookings from payment debt and the group summary's due-today count no longer includes already-overdue items.
- Cancellation-aware refund reversals no longer recreate the original booking receivable after a cancelled booking is paid out.
- Pilgrim payment schedules now calculate percentage milestones and absorb rounding into the final instalment instead of charging the full fare for each percentage row.
- Invoice issuance now checks the linked milestone or booking balance and records a pre-settled invoice as `PAID` immediately.
- `departure_group_costing` now uses `security_invoker`, so direct reads evaluate the caller's tenant RLS policies.
- Repeating a payment submission with the same booking reference number now returns the existing pending/completed ledger entry instead of creating a duplicate.
- Bookings created with an initial paid amount now receive an idempotent Finance opening-balance payment and oldest-first milestone allocations, explicitly labelled as a mirrored opening balance.
- Cross-group booking moves now reject source/target currency mismatches before changing seats, rooming, or booking ownership.
- Refund requests now validate booking/group ownership and inherit the booking's contract currency instead of the database default.
- Booking inserts and seat-consuming status changes now take a per-group advisory lock and enforce aggregate capacity in the database, closing the concurrent overbooking race.
- Cancellation refund amounts are persisted on the booking and an idempotent database trigger creates the Finance refund request in the same transaction as cancellation.
- Profitability now displays internal cost separately from committed supplier cost and outstanding supplier payable, both sourced from the Finance supplier-payables view.
- Reports now expose group contract currency and supplier cost buckets; package profitability and report KPI cards split totals by currency instead of labelling mixed amounts as LKR.
- Evidenced Finance payments now call `record_departure_booking_payment_atomic`, which locks the group and booking and commits the ledger row, milestone allocations, booking balance, and held-seat promotion as one transaction. Pending-verification payments remain unapplied until verification.
- Booking creation now uses `apply_departure_store_changes_atomic`, a tenant-checked parent/child diff RPC that applies the departure store, booking Finance schedule, and opening-balance mirror in one Postgres transaction. Per-traveller Pilgrim schedule projection remains an independent read-model write.
- Both atomic RPCs run as security-invoker functions, so normal Supabase RLS and tenant policies still apply to direct RPC calls.
- Per-traveller Pilgrim payment schedules now have an idempotent post-commit repair entry point; retries preserve existing paid amounts and metadata, and reconciliation reports bookings with a missing projection.
- Group closure now checks the authoritative supplier-payables view and reports open balances by currency before allowing a completed group to become closed.

## Verification

- `npm test`: 259 tests passed (28 files; the Phase A regression suite now passes without `it.fails` placeholders).
- `npm run typecheck`: passed.
- Targeted ESLint for the changed TypeScript files: passed.
- `git diff --check`: passed.
- Read-only Supabase REST inventory: 17/17 table/view probes succeeded. The inventory is a baseline snapshot; run the reconciliation SQL after any production booking/payment import to detect legacy rows that need repair.
- Supabase migration history is now synchronized through `20261123090002`; the cancellation/refund, capacity, atomic payment/store RPC, and currency-aware report view changes are live remotely.

## Deployment note

Run the reconciliation SQL in `supabase/audits/departure-phase-a-reconciliation.sql` after any production booking/payment import. Use `repairPilgrimPaymentMilestonesForBooking` for any booking reported with a missing traveller-level projection.

## Policy applied

- Cross-currency portfolio totals use an explicit **no implicit conversion** policy. Finance and Reports expose separate currency buckets; collection-rate and margin percentages are only shown when the numerator and denominator share one currency. A future FX feature must provide dated rates and an auditable conversion basis before introducing converted totals.
