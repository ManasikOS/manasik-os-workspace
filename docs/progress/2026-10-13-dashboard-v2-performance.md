# Dashboard v2 — performance baseline (2026-10-13)

Closes the measurement half of T17 in
[tasks/dashboard-todo.md](../../tasks/dashboard-todo.md). Spec:
[dashboard-role-blocks-spec.md](../modules/dashboard-role-blocks-spec.md).
Historical record — do not edit to match later reality; start a new dated file
for the next round.

## What could and could not be measured

| Item | Result |
|---|---|
| Reads per render, per role | **Measured** (below) and pinned by `lib/data/dashboard-read-budget.test.ts` |
| Server wall-clock `dashboard.loadData` (p50 / p95) | **Not measured.** Needs a signed-in session against a seeded 20-group / 500-pilgrim agency; the repo has no seed data and no environment I could point a load at. Same constraint the [2026-09-19 baseline](2026-09-19-performance-baseline.md) recorded for every page |
| Millisecond budget | **Deliberately not set.** The plan says to set it from a measured baseline, not to guess one |

Consequence: the first round taken with the procedure below becomes the
baseline, exactly as the 2026-09-19 note says of itself.

## Measured: reads per render

One render = the Operations snapshot (always) + every optional read a role's
visible blocks and KPI row ask for (`planDashboardFetch`). Counted by running
`loadDashboardData` for each built-in role with every loader stubbed and
counting calls; none is made twice.

| Role | Reads | Which |
|---|---:|---|
| ADMIN | **15** | snapshot, tasks, lead facts, quote facts, proposals, copilot summary, receivables, payments, refunds, finance report, sales report, supplier directory, campaigns, queue counts, entitlements |
| CEO | 10 | snapshot, lead facts, quote facts, receivables, payments, refunds, finance report, sales report, reports overview, supplier directory |
| FINANCE | 9 | snapshot, tasks, lead facts, quote facts, receivables, payments, refunds, finance report, supplier directory |
| MARKETING | 8 | snapshot, tasks, lead facts, quote facts, sales report, campaigns, queue counts, entitlements |
| OPERATIONS | 6 | snapshot, tasks, lead facts, proposals, copilot summary, visa queue |
| VISA | 5 | snapshot, tasks, lead facts, visa queue, document queue |
| GUIDE | 3 | snapshot, assigned group ids, tasks |

All of a render's reads start in one `Promise.all`, so **latency tracks the
slowest read, not the sum**. The count is a proxy for database load and
connection pressure, not for milliseconds — which is why it cannot stand in
for the timing round below.

## Findings worth acting on

1. **A real duplicate read.** For ADMIN, CEO and FINANCE the refunds-pending
   figure is queried twice: `loadRefundsPendingSummary` in
   `finance-repository.ts` (Collections, the refunds tile, the attention row)
   and a private copy of the same summary inside
   `loadReportsFinanceSnapshot` (`reports-repository.ts`). Two `refund_requests`
   selects per render. They may differ in which statuses they count — check
   before merging.
2. **Lead facts are read by 5 of 7 roles for two attention-rail rows.**
   OPERATIONS, VISA and FINANCE read `leads` only so the rail can show
   "inquiries unassigned" / "not contacted in 24h". Whether those roles should
   see lead rows at all is a product question (spec §5.4 said VISA never
   would; the capability table lets them).
3. **`listCampaignsWithMetrics` is the heaviest single read.** It issues up to
   seven queries (campaigns, spend, attributed leads, attributed bookings,
   quotes via leads, linked groups, costing). It runs only for ADMIN and
   MARKETING (asserted), but it scales with attributed leads. First candidate
   to narrow if the timing round says the Dashboard is slow for them.
4. **Counts understate the heavy loaders.** The Operations snapshot, the
   finance report (5 queries) and the overview (5 queries) each fan out
   internally; the supplier directory is a view with eight correlated
   sub-selects per supplier. "15 reads" is 15 loader calls, comfortably more
   than 15 queries.
5. **Carried over:** `loadFinancePayments` is still capped at 500 rows (plan
   risk R7), which understates collections for a large agency.

## Timing round — to fill in

Method: [performance-baseline-runbook.md](../runbooks/performance-baseline-runbook.md).
`dashboard.loadData` is already wrapped in `withTiming`.

1. Seed an agency with 20 departure groups and 500 pilgrims, plus leads,
   payments and a few campaigns, so every role's blocks have rows.
2. `PERF_TIMING=1`, a **production build** (`next build && next start`) —
   `next dev` compiles on demand and is several times slower.
3. For each role below, sign in and hard-reload `/dashboard` **20 times**
   (discard the first, which warms the connection).
4. Collect the server log and summarise:

```bash
node --experimental-strip-types scripts/perf/summarise-perf-log.ts dashboard.loadData < server.log
```

| Role (reads) | n | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| ADMIN (15) — worst case | | | | |
| MARKETING (8) — heaviest non-admin read | | | | |
| FINANCE (9) | | | | |
| GUIDE (3) — floor | | | | |

## Budget rule (proposed — needs your approval)

- **Structural (now, enforced in CI):** the table above, exact. A new read must
  change `READS_PER_RENDER` in the same PR, so it is reviewed on purpose.
- **Wall-clock (after the round above):** budget = **1.25 × the measured p95
  for ADMIN, rounded up to the next 50 ms**; GUIDE's p95 is the floor that
  shows how much of the cost is fixed overhead (auth, role lookup, snapshot).
  Record it here and in `tasks/dashboard-plan.md`, and re-measure whenever
  `READS_PER_RENDER` changes.
