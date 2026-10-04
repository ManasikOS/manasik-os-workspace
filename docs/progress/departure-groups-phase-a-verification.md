# Departure groups — Phase A verification

## Status

**Local regression tooling and read-only API baseline implemented. Phase A's deployed-schema/tenant-isolation exit gate remains open.** No business logic fixes or database writes were made. The audit plan's later phases still contain known defects; passing the normal suite does not mean the application is bug-free.

Verified on 2026-09-16:

- Full suite: **259 tests across 28 files**, including **14 expected failures** asserting desired behavior for known application defects. Thus 245 ordinary checks pass; 14 bugs are reproduced, not fixed.
- New Phase A coverage: **35 cases** (12 existing-behavior/fixture checks, 14 known-defect cases, 9 reconciliation diagnostic cases).
- Strict regression mode: **14 failed / 12 passed**, with failures checked to be the intended calculation/status assertions, not setup/import exceptions.
- `npm run typecheck`: passed after correcting a fixture-only Nusuk status to `NOT_LINKED`.
- `npx eslint tests/departure-groups scripts/audits`: passed with no warnings or errors.
- Remote API inventory: **17/17 table/view count requests succeeded** using the existing server identity; only aggregates are retained in the report.
- API reconciliation: **18 checks**, with **1 missing active Finance milestone schedule** and **1 booking/posted-ledger paid-amount mismatch**. Other candidate counts were zero at capture time, not proof those code paths are correct.

The current API dataset has one booking, two pilgrim milestones, no booking-level Finance milestones and no payment ledger rows. No customer names, contacts, passport data or row-level financial amounts are retained in the report. Minimal IDs/state/amount projections are held temporarily in memory to calculate counts.

The API scans are sequential, not a repeatable-read database snapshot. Re-run the SQL reconciliation before deciding any repair. A mismatch identifies a candidate for investigation; it is not authorization to invent payment evidence or change balances.

## Deliverables

| File | Purpose |
|---|---|
| `tests/departure-groups/fixtures.ts` | Isolated tenant A/B fixtures, LKR/USD, individual/family/mixed fares, unpaid/partial/full payment, held/waitlist, fixed/percentage/remainder schedule, Makkah/Madinah stays, group/own-flight/land-only operational states |
| `tests/departure-groups/phase-a.test.ts` | Production pure-function/store-mutation tests, including cancellation and known-defect assertions |
| `tests/departure-groups/reconciliation.test.ts` | Clean/corrupt fixtures verifying the diagnostic engine, reversal/refund semantics, no mutation, and fail-closed incomplete inputs |
| `scripts/audits/departure-reconcile.mjs` | Pure count-only diagnostic engine, no persistence or corrections |
| `scripts/audits/departure-phase-a.mjs` | Bounded read-only API inventory/reconciliation and local migration checksums |
| `docs/departure-groups-phase-a-api-inventory.json` | Captured aggregate API counts and local migration hashes; explicitly lists unverified SQL metadata |
| `supabase/audits/departure-phase-a-inventory.sql` | Read-only transaction for actual applied migrations, columns, defaults, precision, constraints, policies, grants, triggers and view definitions/options |
| `supabase/audits/departure-phase-a-reconciliation.sql` | Repeatable-read, read-only counts for 19 financial/operational discrepancy categories, per tenant |

The operational fixtures model the resulting own-flight/land-only exclusion state; they do not claim to exercise approval side effects or ticket-document validation. Tenant fixtures are domain inputs, **not an RLS integration test**. They are never inserted into the live database. For database integration use the staging scenarios below with real authenticated identities.

## Commands

Normal regression suite:

```powershell
npm test
npm run typecheck
npx eslint tests/departure-groups scripts/audits
```

Expose known bugs as ordinary failing tests:

```powershell
$env:DEPARTURE_AUDIT_STRICT = '1'
npm test -- tests/departure-groups/phase-a.test.ts
Remove-Item Env:DEPARTURE_AUDIT_STRICT
```

The normal run uses Vitest `it.fails`: the test asserts the correct business result and must fail while the known bug exists. An unexpected pass makes CI fail so that, once the implementation is corrected, the case must be promoted to an ordinary `it` test. Keep strict-mode evidence in reviews so a different setup failure cannot silently masquerade as the known defect.

Refresh read-only API evidence:

```powershell
node scripts/audits/departure-phase-a.mjs
```

This reads the already configured `.env.local` through Next's environment loader, logs no secrets and does not authenticate new users or change records. It refuses redirecting credentials, requires HTTPS for remote endpoints, uses timeouts and caps paging at 100,000 rows per table. Missing/incomplete table reads are unknown and fail the command; they are never reported as clean zero counts. The bounded API scan is suitable for the current small dataset; prefer SQL aggregates for large agencies.

## Deployment verification still required

The linked CLI command `supabase migration list --linked` failed with PostgreSQL authentication error `28P01`. No database password is configured in the inspected local environment variable names. API server credentials cannot establish applied migration history, view ownership or real tenant-policy behavior.

After the authorized SQL connection is available:

1. Run `supabase/audits/departure-phase-a-inventory.sql` through the SQL editor or a PostgreSQL client that preserves one session for the entire transaction. Save the result securely. The script ends with `ROLLBACK` and has an explicit read-only transaction and statement timeout.
2. Compare the returned applied versions with the local filename/checksum inventory. Local presence/hash is source evidence only, not proof of deployment. Inspect missing versions and divergent view/trigger definitions.
3. Check `departure_group_costing` owner, grants and `security_invoker` option. Check underlying cost table role policies as well as agency policies.
4. Confirm all columns referenced by the reconciliation script exist, including agency IDs, room assignments and flight exclusions. Run the SQL reconciliation in one repeatable-read read-only transaction using an authorized audit role. Ordinary RLS-limited reads can undercount issues.
5. Execute the staging identity tests below. Service/admin-key success is never evidence of tenant isolation.
6. Record SQL execution results, deployed version list and identity-test results here. Only then mark the remaining Phase A gate complete.

The SQL files were reviewed against repository migrations but **have not been executed against PostgreSQL**. API diagnostic unit tests do not validate SQL syntax, grants or deployed columns. On a schema/permission error, stop and report the inventory gap rather than patching live data to make an audit run.

### Interpreting count differences

- `invoice_group_or_tenant_candidate`: a historical issued invoice may intentionally retain the old group; review attribution policy before changing anything.
- `outbound_ticket_counter_candidate`: compares traveller-level ticket status to the flight counter; multiple outbound flights and per-sector evidence require manual review. It is not proof of ticket issuance.
- `booking_ledger_mismatch`: excludes reversed originals and their contra rows, includes posted receipts/refund payouts, and ignores pending verification. Multiple payment currencies are flagged separately rather than added into one amount.
- SQL includes one additional billable-charge reconciliation. Both reports are diagnostic baselines, not formal accounting statements.
- Zero eligible rows do not exercise a workflow. The live dataset contains no invoices, refunds or supplier commitments, so their zero mismatch counts cannot validate those paths.

## Reproducible staging scenarios for every audit finding

Use an isolated staging database with the current schema. Create synthetic agencies A and B, an admin and restricted non-finance staff identity in each, one A group in LKR and one B group in USD. Also create a second A group for transfers. Use only synthetic people and the fixed reference clock `2026-09-15T12:00:00Z`. Never seed production to reproduce these cases.

Default booking: 1,000 fare, 30% due on booking, 100 fixed due September 20, remainder due October 1 (14 days before October 15 departure). For family cases use fares 1,000 / 600 / 100. For operational cases use Makkah and Madinah stays, a room per stay, and outbound/return flights. Unless specified otherwise, expected monetary differences must be zero in the booking currency. Record route, identity, IDs, before/after values and observed versus expected result in the test evidence.

| ID | Reproduction steps and expected result | Current automated evidence |
|---|---|---|
| DG-01 | Create a booking with 300 deposit through group UI; record another 100 there. Reload Finance ledger and booking. Expect posted events/receipts and a paid total of 400 exactly once. Repeat request to check idempotency. | Live API reports one paid/ledger mismatch; end-to-end write test pending staging |
| DG-02 | Create an unpaid 1,000 booking after migrations. Query Finance milestones and payment plans. Expect a real agreed schedule totaling 1,000. | Live API reports one missing Finance schedule |
| DG-03 | Create 30%/70% plan at 1,000 per traveller. Open pilgrim Payments tab. Expect 300/700, not 1,000/1,000, with resolved dates. | Desired total fails at actual builder; server projection needs staging |
| DG-04 | Pay 300 of default booking, then settle fully and reverse 100. Expect next due September 20 then October 1 after reversal. Also test zero obligation, unpaid overdue and 299.99 deposit. | Five expected failures |
| DG-05 | Two simultaneous requests buy the final seat. Expect exactly one booking. Duplicate the same payment request; inject a failure after ledger/allocations but before booking persistence. Expect one event or complete rollback. | Explicit staging concurrency/fault-injection scenario; not executed |
| DG-06 | For A bookings X and Y, send a payment of 100 for X with allocation 200, then with Y's milestone. Expect rejection with no ledger/allocation changes. Repeat as staff in B. | Diagnostic detects excess and ownership drift; mutation/security integration pending |
| DG-07 | Record real 500 then pending-verification 100; reverse/void the pending entry. Expect paid to remain 500 and no applied reversal. | Explicit staging scenario |
| DG-08 | Cancel two-traveller booking with 1,000 paid and 200 refund. Compare group summary, SQL summary and refund requests. Expect one 200 liability. | Cancellation invariant and refund-flag diagnostic; liability integration pending |
| DG-09 | Cancel fully paid booking and pay 200 refund; expect zero cancelled debt. Add two requests and pay only one; other must remain pending. | Cancelled debt expected failure; multi-request staging pending |
| DG-10 | Partially pay booking, issue invoice and approve refund; move to second A group. Reverse original payment/pay refund. Expect valid ownership and intentional historic attribution. Test a manual 100 fare + snapshot 1,000 fare + discount and proposed lower rate; paid must never be clamped away. | Group ownership diagnostic; transfer integration pending |
| DG-11 | Book USD group and inspect base-fare charge/payment/refund currency. Mix USD 100 and LKR 100 across groups; expect separate KPI amounts. Change current group currency with existing debt; old debt must retain agreed currency. | Base-fare currency expected failure; aggregate/UI staging pending |
| DG-12 | Issue booking invoice and settle fully; expect paid. Issue after prior settlement; expect correct settled state. Reverse payment; expect reopened invoice balance without changing saved commercial lines. | Explicit staging scenario |
| DG-13 | Submit header amount 1,000 with lines 900; expect rejection. Force issue failure after creating draft; expect no issued PDF/success. Modify charges after opening preview; expect server conflict/recompute. | Header/line diagnostic; issue/PDF staging pending |
| DG-14 | Invoice 1,250.50 with fractional discount/payment. Expect exact cent reconciliation in stored lines, preview and PDF. | Exact-formatting expected failure |
| DG-15 | Link hotel commitment 1,000, pay it fully, compare group payable with Finance. Add unpaid flight commitment. Attempt group closure with supplier debt. Expect correct remaining debt and explicit closure policy. | Explicit staging scenario |
| DG-16 | Seed 501 completed same-month payments in staging; add future payment, next-month refund and reversal. Expect complete period-bounded per-currency receipts/refunds/net cash. | Explicit staging scenario; no production seeding |
| DG-17 | Cancel booking with unpaid milestones; add zero milestone, cancelled supplier commitment and undated payable. Expect no cancelled/zero overdue debt and separate undated treatment. | Cancellation diagnostic; KPI staging pending |
| DG-18 | Freeze clock; age a 100 unpaid milestone by 0.5, 7.5 and 30.5 days. Expect exactly one bucket and total 100. | Three expected failures |
| DG-19 | Add family/mixed fares and discount; compare catalogue scenario with booked margin. Change quad catalogue price; agreed revenue must stay unchanged. Remove cost estimates; missing costs must be explicit. | Explicit staging scenario; measure definitions still require policy agreement |
| DG-20 | Assign every traveller only to Makkah, not Madinah. Expect rooming incomplete. Add second required hotel in same city, leave it unconfirmed; hotel readiness must not read complete. | Two-city rooming expected failure; multiple service case staging pending |
| DG-21 | Ticket traveller, then cancel/move; expect counters reduced. Exercise zero outbound tickets with held return inventory. Approve own-flight/land-only and verify sector inventory/readiness exemption. | Cancellation counter expected failure; sector/approval integration pending |
| DG-22 | Show groups 10 and 90 days away, cancelled at-risk group, waitlist debt and yesterday's readiness task. Expect each KPI count to match its labelled population/window. | Explicit staging scenario |
| DG-23 | As A authenticated staff query B costing ID directly via REST; expect zero/denied. Repeat as B, and as non-finance staff against own protected cost rows. Check the underlying cost table too. | Pending SQL/real staff identities; admin API does not validate RLS |

## Finish criteria

Phase A is complete only when deployed schema inventory and two-tenant/role checks are recorded, and each finding has either a confirmed automated failure or the explicit reproducible scenario above reviewed against the deployed schema. Live money/counter repairs are deferred to later phases. Do not report "no bugs": this phase deliberately proves existing bugs and establishes a baseline for fixing them.
