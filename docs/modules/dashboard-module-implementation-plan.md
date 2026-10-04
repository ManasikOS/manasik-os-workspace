# Dashboard Module — Implementation Plan

Rebuild `/dashboard` — the app's landing route — into a **role-aware operational
command surface** built on the same data, access and derivation architecture already used by
**Packages**, **Departure Groups**, **Leads**, **Pilgrims**, **Documents**, **Visa**,
**Operations**, **Suppliers**, **Payments & Invoices**, **Reports** and the **Departure
Operations Agent**.

Status: **plan only. Nothing in here is implemented.**

The product rule this plan enforces (already written down in
[docs/reports-module-implementation-plan.md](docs/reports-module-implementation-plan.md) and
never yet honoured by the dashboard itself):

```text
Dashboard   →  What is happening now? What requires MY action today?
Reports     →  What happened over a period? Why? Export and share it.
Module page →  The live working queue. Rows you act on. Writes happen here.
```

Three rules carried into every section below:

- **The dashboard never derives a number.** It is an *assembler*. Every figure comes from a
  derivation function the owning module already exports (`computeExecutiveSummary`,
  `buildOperationsSnapshot`, `buildCollectionsSummary`, `scoreReadiness`). A second definition
  of "overdue" or "at risk" is the failure mode.
- **The dashboard never shows a number it cannot source.** Any panel that cannot be backed by a
  real query is deleted, not stubbed. See §1.3 — this is currently the module's biggest defect.
- **Every tile is a door.** No tile is terminal. Every count, bar and row links into the module
  that owns it, pre-filtered to exactly the rows the tile counted.

---

## 1. What exists today

### 1.1 The route

| File | Lines | State |
|---|---|---|
| [app/(main)/dashboard/page.tsx](app/(main)/dashboard/page.tsx) | 69 | Server Component, `force-dynamic`. Single-column stack of 7 sections. No role branching, no period filter. |
| [lib/data/dashboard-repository.ts](lib/data/dashboard-repository.ts) | 396 | Assembles from `buildOperationsSnapshot()`, `loadLeadStore()`, `loadFinanceReceivables()`, `loadFinancePayments()`, `loadRefundsPendingSummary()`. Capability-gated correctly. |
| [lib/types/dashboard.ts](lib/types/dashboard.ts) | 137 | View models. Already carries a comment admitting three interfaces are rendered by nothing. |
| `app/(main)/dashboard/components/` | 18 files | 6 wired, 4 orphaned, **3 render fabricated data**. |

### 1.2 Component inventory — the honest audit

| Component | Data source | Verdict |
|---|---|---|
| [metrics.tsx](app/(main)/dashboard/components/metrics.tsx) | `data.kpis` — real | **Keep**, extend (no trend/delta rendered today; `AdminKpi.trend` is declared and never populated) |
| [todays-operation.tsx](app/(main)/dashboard/components/todays-operation.tsx) | `snapshot.tasks` — real | **Keep**, re-scope to "my work" |
| [upcoming-departures.tsx](app/(main)/dashboard/components/upcoming-departures.tsx) | `snapshot.groups` — real | **Keep**, best panel in the module |
| [document-visa-exceptions.tsx](app/(main)/dashboard/components/document-visa-exceptions.tsx) | `snapshot.groups` — real | **Keep**, merge into a unified exceptions rail |
| [collections-attention.tsx](app/(main)/dashboard/components/collections-attention.tsx) | `loadFinanceReceivables` — real | **Keep** |
| [recent-activity.tsx](app/(main)/dashboard/components/recent-activity.tsx) | `snapshot.activity` — real | **Keep**, widen beyond Operations-only |
| [onboarding-checklist.tsx](app/(main)/dashboard/components/onboarding-checklist.tsx) | `getOnboardingChecklist()` — real | **Keep** as-is |
| [charts/leads/new-leads-chart.tsx](app/(main)/dashboard/components/charts/leads/new-leads-chart.tsx) | **Fabricated** | **Rewrite** — see §1.3 |
| [business-health/revenue-chart.tsx](app/(main)/dashboard/components/business-health/revenue-chart.tsx) | **Fabricated** | **Rewrite** |
| [business-health/booking-chart.tsx](app/(main)/dashboard/components/business-health/booking-chart.tsx) | **Fabricated** | **Rewrite** |
| [business-health/business-health.tsx](app/(main)/dashboard/components/business-health/business-health.tsx) | none | **Rewrite** — 5 tabs, 3 render nothing |
| [team-performance-chart.tsx](app/(main)/dashboard/components/team-performance-chart.tsx) | **Fabricated** (`chrome/safari/firefox`) | **Delete**, rebuild from `buildSalesTeamPerformance()` |
| [team-performance.tsx](app/(main)/dashboard/components/team-performance.tsx) | wrapper for the above | **Delete** |
| [lead-attention.tsx](app/(main)/dashboard/components/lead-attention.tsx) | orphaned | **Delete** — content folds into §5.4 |
| [operational-alerts.tsx](app/(main)/dashboard/components/operational-alerts.tsx) | orphaned, no producer | **Delete** |
| [system-health.tsx](app/(main)/dashboard/components/system-health.tsx) | orphaned, no producer | **Delete** |
| [admin-header-filters.tsx](app/(main)/dashboard/components/admin-header-filters.tsx) | orphaned, hardcoded `"Colombo Branch"`, `"Umrah 2026"` | **Delete**, replace with a URL-driven filter (§6) |
| [payment-reminder-dialog.tsx](app/(main)/dashboard/components/payment-reminder-dialog.tsx) | used by collections | **Keep** |

### 1.3 The defect that must be fixed first

Three panels on the agency's landing page render **invented numbers styled as real data**.

`new-leads-chart.tsx` is the worst case, because it is *not* obviously fake — it accepts a real
`data` prop (`{ items, funnel, topSourceInsight }`) built from `loadLeadStore()`, then **ignores
it entirely** and synthesises every bar:

```ts
// app/(main)/dashboard/components/charts/leads/new-leads-chart.tsx
function getStageMultiplier(stageName: string): number {
  switch (stageName) { case "New": return 1.0; case "Contacted": return 0.75; /* … */ }
}
// "7d" range:
const base = [4, 3, 5, 4, 6, 3, 2];
return days.map((period, i) => ({ period, count: Math.round(base[i] * multiplier) }));
```

`revenue-chart.tsx` and `booking-chart.tsx` still ship the shadcn demo dataset — `desktop` /
`mobile` series over June 2024 — under the headings **"Revenue"** and **"Booking"**.
`team-performance-chart.tsx` renders browser-share pie data as staff performance.

An owner will read a fabricated revenue curve and make a decision on it. **Phase 0 of this plan
deletes these before anything else is built** — a blank "no data yet" card is strictly better
than a confident lie.

### 1.4 What the codebase already gives us for free

This is the reason the rebuild is cheap. Everything the fabricated charts pretend to show
**already exists as a tested derivation**:

| Need | Already exists | File |
|---|---|---|
| Revenue, bookings, margin, collection rate, readiness avg, at-risk count — **with period-over-period deltas** | `computeExecutiveSummary()` | [lib/data/reports.ts:50](lib/data/reports.ts) |
| Revenue / cash-collected time series, bucketed by month or week | `buildRevenueTrend()` | [lib/data/reports.ts:104](lib/data/reports.ts) |
| Period + comparison-window resolution, `percentDelta()` | `resolvePeriod()`, `resolveComparison()`, `percentDelta()` | [lib/data/reports-period.ts](lib/data/reports-period.ts) |
| Lead funnel with stage-to-stage conversion | `buildLeadFunnel()` | [lib/data/reports-sales.ts:33](lib/data/reports-sales.ts) |
| Lead source performance, real sales-team performance | `buildLeadSourcePerformance()`, `buildSalesTeamPerformance()` | [lib/data/reports-sales.ts](lib/data/reports-sales.ts) |
| Receivables aging buckets | `buildReceivablesAging()` | [lib/data/reports-finance.ts](lib/data/reports-finance.ts) |
| Package profitability / margin | `buildPackageProfitability()` | [lib/data/reports-finance.ts](lib/data/reports-finance.ts) |
| Groups, blockers, tasks, flights, suppliers, activity, readiness | `buildOperationsSnapshot()` | [lib/data/operations-repository.ts:239](lib/data/operations-repository.ts) |
| Agent proposals awaiting a human decision | `listAgencyOpenProposals()` | [lib/data/departure-groups-agent.ts:210](lib/data/departure-groups-agent.ts) |
| Per-staff task list, merged activity feed | `loadTasksForStaff()`, `loadMergedActivityFeed()` | [lib/data/team-repository.ts](lib/data/team-repository.ts) |
| Shared status colour vocabulary | `Tone`, `TONE_CLASS`, `percentTone()` | [lib/ui/tone.ts](lib/ui/tone.ts) |
| Postgres-side aggregation surface | 8 `report_*_facts` views | [supabase/migrations/20260819090000_reports.sql](supabase/migrations/20260819090000_reports.sql) |

**No new migration is required for this plan.** Every figure below is reachable from existing
views, existing loaders and existing pure derivations.

---

## 2. External research — what a dashboard is supposed to be

Findings from current dashboard-design practice, and the specific decision each one forces here.

| Principle | Source | Decision for this module |
|---|---|---|
| **Five-second rule** — the most important answer must be readable in ~5s | [Luzmo](https://www.luzmo.com/blog/dashboard-design), [DataCamp](https://www.datacamp.com/tutorial/dashboard-design-tutorial) | One **Status Line** at the very top answers "is everything okay?" before any chart renders (§5.1) |
| **Inverted pyramid** — status → trends → detail, top to bottom | [Domo](https://www.domo.com/learn/article/dashboard-design-examples-best-practices), [IGC](https://www.intelligentgraphicandcode.com/design/dashboard-design/dashboard-layout) | Three fixed layers: **Answer / Act / Understand** (§4). Charts never appear above the action queue |
| **5–9 metrics per screen**; too many metrics is the #1 failure | [Improvado](https://improvado.io/blog/dashboard-design-guide) | Hard cap: **6 KPI tiles**, role-selected. Today's page can render 6; the cap becomes a contract, and the tile set changes by role rather than growing |
| **One dashboard for all roles is an anti-pattern** | [Improvado](https://improvado.io/blog/dashboard-design-guide), [Orbix](https://www.orbix.studio/blogs/saas-dashboard-design-complete-guide) | A **role-keyed layout registry** (§4.2). CEO, Operations, Finance, Visa, Marketing and Guide each get a different composition of the same panels — not a different codebase |
| **Progressive disclosure** — headline first, drill on demand | [925 Studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) | Every panel shows its top N rows plus an exact "View all 47 →" link. No panel scrolls internally |
| **Colour functionally, never decoratively** | [Improvado](https://improvado.io/blog/dashboard-design-guide) | Reuse `TONE_CLASS` only. Colour always paired with a text label — the rule [lib/ui/tone.ts](lib/ui/tone.ts) already states |
| **Action-oriented, not a static report**; replace vanity metrics | [Improvado](https://improvado.io/blog/dashboard-design-guide), [Domo](https://www.domo.com/learn/article/dashboard-design-examples-best-practices) | Every attention row carries a **verb** and a destination. "Documents missing: 47" becomes "Chase 47 missing documents →" |
| **Personal work queue / "my day"** is the retention driver | [HubSpot patterns](https://rondesignlab.com/cases/hubspot-crm-saas-ux-ui-design), [Salesforce](https://improvado.io/blog/salesforce-dashboard) | **"My Day"** is the single highest panel below the status line for every non-executive role (§5.3) — today's `todays-operation.tsx` shows *everyone's* tasks, which is not a work queue |
| **Forward-looking indicators beat trailing ones** — booking pace, pipeline by expected close, lead time | [Softrip](https://www.softrip.com/resources/blog/travel-kpi-tour-operator/), [Rework](https://resources.rework.com/libraries/travel-tour-growth/travel-data-analytics) | The **Seat Fill Pace** panel (§5.6) — seats sold vs days-to-departure — is the one genuinely new derivation in this plan, and the metric a tour operator actually runs on |
| **Lead time drives cash flow**; short lead time compresses everything | [Softrip](https://www.softrip.com/resources/blog/travel-kpi-tour-operator/) | Days-to-departure is the **universal sort key** for every operational panel. Nothing sorts by `created_at` |
| **AI-native dashboards summarise and prioritise** | [925 Studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026) | The Departure Ops Agent already produces ranked proposals. Surface its **approval queue** as a first-class panel (§5.7) rather than leaving it buried at `/operations/approvals` |
| **Validate with real users before launch** | [Improvado](https://improvado.io/blog/dashboard-design-guide) | §11 ships Phase 1 behind the existing role gate and defines what to watch before Phase 3 |

---

## 3. The boundary this module must not cross

```text
                    Dashboard              Reports                Module page
Question            "what now?"            "what happened?"       "act on this row"
Window              live / today / T-30    any period + compare   live
Mutations           at most 1-click        none                   full CRUD
Export              none                   CSV / Excel / PDF      per-module
Depth               top N + link out       full tables            full tables
```

Concretely, the dashboard **must not** grow: a date-range picker beyond a single
period selector, CSV export, drill-down tables, or any panel with more than ~6 rows. Every one
of those is a Reports feature, and Reports already ships it.

The dashboard **may** carry narrow one-click actions that do not require context to be safe —
mark a task complete, send a payment reminder (the existing
[payment-reminder-dialog.tsx](app/(main)/dashboard/components/payment-reminder-dialog.tsx)),
approve or reject an agent proposal. Anything else navigates.

---

## 4. Information architecture

### 4.1 The three layers

```text
┌──────────────────────────────────────────────────────────────────────┐
│  ONBOARDING CHECKLIST            (new agencies only, auto-hides)     │
├──────────────────────────────────────────────────────────────────────┤
│ L1  ANSWER   Status Line  ·  6 KPI tiles                             │  ← 5s
│              "is everything okay?" + the six numbers for MY role     │
├──────────────────────────────────────────────────────────────────────┤
│ L2  ACT      My Day  ·  Attention Rail  ·  Approvals  ·  Departures  │  ← work
│              every row has a verb, an owner and a destination        │
├──────────────────────────────────────────────────────────────────────┤
│ L3  UNDERSTAND  Business Health  ·  Seat Fill Pace  ·  Pipeline      │  ← trend
│                 Team Performance  ·  Recent Activity                 │
└──────────────────────────────────────────────────────────────────────┘
```

The current page inverts this: a fabricated leads chart sits at L2 height, `BusinessHealth`
(also fabricated) sits above the real collections and exceptions panels. Trends outrank work.

### 4.2 Role-keyed layouts

One page, one repository, one component set. What changes per role is **which panels appear and
in what order**, expressed as data:

```ts
// lib/data/dashboard-layout.ts  (new, client-safe, pure)
export type DashboardPanelId =
  | "status-line" | "kpis" | "my-day" | "attention-rail" | "approvals"
  | "upcoming-departures" | "business-health" | "seat-fill-pace"
  | "pipeline" | "collections" | "team-performance" | "recent-activity";

export const DASHBOARD_LAYOUTS: Record<StaffRole, DashboardPanelId[]> = { /* … */ };
```

| Role | Ordered panels (after status line + KPIs) |
|---|---|
| `CEO` | business-health · seat-fill-pace · upcoming-departures · attention-rail · pipeline · team-performance |
| `ADMIN` | my-day · attention-rail · approvals · upcoming-departures · business-health · seat-fill-pace · pipeline · collections · team-performance · recent-activity |
| `OPERATIONS` | my-day · attention-rail · approvals · upcoming-departures · seat-fill-pace · recent-activity |
| `FINANCE` | my-day · collections · attention-rail (finance rows only) · business-health · upcoming-departures |
| `VISA` | my-day · attention-rail (visa + documents rows only) · upcoming-departures · recent-activity |
| `MARKETING` | my-day · pipeline · seat-fill-pace · team-performance (sales) · attention-rail (lead rows only) |
| `GUIDE` | my-day · my assigned groups only · recent-activity |

Two rules make this safe rather than a second access system:

1. The layout registry decides **order and presence**, never permission. Whether a panel *may*
   render is decided exclusively by the existing `capabilitiesFor*()` functions, server-side,
   before data is fetched — the posture `dashboard-repository.ts` already takes.
2. A panel absent from a role's layout is **not fetched**. The repository takes the resolved
   panel list as input and skips the loaders no panel needs.

### 4.3 Responsive grid

12-column at `lg`, 6 at `md`, 1 at `sm` — matching the existing `lg:grid-cols-12` idiom in
[page.tsx](app/(main)/dashboard/page.tsx). Panels declare a span (`4`, `6`, `8`, `12`); the
renderer flows them. `max-w-[1600px]` container is kept.

---

## 5. What to show — panel specification

Every panel below names its data source. Nothing here needs a query that does not exist.

### 5.1 Status Line — L1

One sentence plus a tone dot. The five-second answer.

> **3 groups need attention.** 2 departing within 7 days are not visa-ready ·
> LKR 1.4M overdue · 6 proposals awaiting approval

Derived from counts already in `OperationsSnapshot.kpis` (`groupsAtRisk`, `tasksDueToday`,
`unassignedWork`), the receivables overdue sum, and `listAgencyOpenProposals().length`.
Renders `All clear` in `success` tone when every input is zero — an explicit healthy state, not
an empty div.

**Rule:** the status line only ever states facts the panels below can be opened to verify. It is
a summary, never an independent computation.

### 5.2 KPI tiles — L1, capped at 6

Today's tiles are sound but flat — `AdminKpi.trend` and `trendType` are declared in
[lib/types/dashboard.ts](lib/types/dashboard.ts) and never populated, so every tile is a number
with no direction. Fix by resolving a comparison window with the Reports helpers.

| Tile | Value | Delta source | Roles |
|---|---|---|---|
| New Inquiries | leads created in period | `percentDelta` vs previous period | ADMIN, CEO, MARKETING |
| Active Pilgrims | `sum(pilgrimCount)` over active groups | vs previous period | all |
| Departing in 30 Days | pilgrims + group count | none (forward-looking) | all |
| Revenue (period) | `computeExecutiveSummary().revenue` | `revenueDeltaPercent` — **already computed** | CEO, ADMIN, FINANCE |
| Collections This Month | completed payments MTD | vs previous month | FINANCE, ADMIN, CEO |
| Outstanding Balance | `sum(outstanding_balance)` | vs previous period, inverted tone | FINANCE, ADMIN, CEO |
| Group Readiness | `avgGroupReadinessPercent` | vs previous period | OPERATIONS, ADMIN, CEO |
| Gross Margin | `projectedGrossMarginPercent` | `marginBelowTarget()` flag | CEO, ADMIN (gated on `viewCostAndMargin`) |
| My Open Tasks | `loadTasksForStaff()` count | none | GUIDE, VISA, OPERATIONS |

Each role's layout selects at most 6. `null` margin renders `—`, never `0%` — the discipline
`computeExecutiveSummary` already enforces.

### 5.3 My Day — L2, the panel that earns daily return visits

Today's [todays-operation.tsx](app/(main)/dashboard/components/todays-operation.tsx) shows the
first 6 incomplete tasks **across the whole agency**. For anyone but an admin that is someone
else's work.

Rebuild as a personal queue, three tabs, counts on each:

- **Due today** — `loadTasksForStaff(staffId)` filtered to `dueAt <= endOfDay`
- **Overdue** — `status === "OVERDUE" || dueAt < now`, sorted by days-to-departure **ascending**
  (a task on a group departing in 3 days outranks one on a group departing in 60)
- **Assigned to me** — everything else open

Rows: severity dot · title · group · due · one-click **Complete** (the Operations module already
owns this mutation). Admin/CEO get an extra **Unassigned** tab from
`loadUnassignedTaskCount()` — unowned work is an executive problem, not a personal one.

Empty state: `Nothing due today.` plus a link to the module. Not a spinner, not a zero.

### 5.4 Attention Rail — L2, replaces three panels

Merges today's `document-visa-exceptions`, the orphaned `lead-attention` and the orphaned
`operational-alerts` into **one ranked list of exceptions**, filtered by role.

| Row | Source | Verb | Destination |
|---|---|---|---|
| N pilgrims missing documents | `sum(documentsMissingCount)` | Chase | `/documents?status=missing` |
| N visa applications pending | `sum(visaPendingCount)` | Submit | `/visa?status=pending` |
| N pilgrims with overdue payments | `sum(paymentsOverdueCount)` | Collect | `/finance/payments?status=overdue` |
| N flights past ticketing deadline | `OperationsFlightItem.riskState === "OVERDUE"` | Ticket | `/operations?tab=flights` |
| N supplier confirmations pending | `kpis.supplierConfirmationsPending` | Confirm | `/operations?tab=suppliers` |
| N passenger name mismatches | `sum(nameMismatchCount)` | Fix | `/operations?tab=flights` |
| N new inquiries unassigned | `!assigned_to_id` | Assign | `/leads?status=unassigned` |
| N leads not contacted in 24h | existing derivation | Call | `/leads?status=overdue_contact` |
| N rooming assignments incomplete | `roomingAssignedCount < pilgrimCount` | Assign | `/departure-groups?tab=rooming` |
| N refunds awaiting approval | `loadRefundsPendingSummary()` | Approve | `/finance/payments?tab=refunds` |

**Ranking**, not source order — this is the one place the dashboard is allowed a derivation of
its own, and it must be a *pure ordering function over existing severities*, never a new
severity:

```
score = severityWeight(row)          // critical 3 · warning 2 · info 1
      × proximityWeight(minDaysToDeparture)   // ≤7d ×3 · ≤14d ×2 · ≤30d ×1.5 · else ×1
```

Top 6 rows shown. Rows scoring zero are dropped entirely — the panel shrinks in a healthy
agency rather than displaying six green zeros. Role filters the candidate set (VISA never sees
lead rows; MARKETING never sees supplier rows).

### 5.5 Upcoming Departures — L2, keep and extend

[upcoming-departures.tsx](app/(main)/dashboard/components/upcoming-departures.tsx) is the
strongest thing in the module already: countdown, readiness bars for documents/visas/payments,
guide, capacity, blocker reason. Three changes only:

- Show **3** cards, not 4 (`lg:grid-cols-3` reads better and respects the metric cap)
- Add a **seat-fill bar** (`bookedSeats / capacity`) beside the readiness bar — the commercial
  half of the story is currently missing
- `GUIDE` role sees only `loadAssignedGroupIds()` groups, which
  [dashboard-repository.ts:317](lib/data/dashboard-repository.ts) already resolves but only uses
  to scope the snapshot

### 5.6 Seat Fill Pace — L3, the one new derivation

The forward-looking metric a tour operator actually runs on, and the gap the research pass
identified. Not currently computed anywhere in the codebase.

For each active group, plot **seats sold as a percentage of capacity** against **days until
departure**. Groups below the pace line are the ones that will either under-fill or need a
discount decision — while there is still time to make it.

```ts
// lib/data/dashboard-pace.ts (new, pure, client-safe)
export interface SeatPacePoint {
  groupId: string; groupName: string; groupCode: string;
  daysUntilDeparture: number;
  fillPercent: number;          // bookedSeats / capacity
  expectedFillPercent: number;  // from the pace curve below
  paceTone: Tone;               // success | warning | danger
}
```

The expected-fill curve is a **configurable straight line by default** (`T-180 → 0%`,
`T-0 → 100%`), stored per agency in settings and overridable per journey type. Deliberately not
inferred from history: there is no completed-season dataset in this schema yet, and inventing a
seasonality model would repeat exactly the mistake §1.3 is fixing. The line is an explicit,
editable target, labelled as such.

Rendered as a scatter of groups against the target line (Recharts, already a dependency), with
under-pace groups labelled and linked.

### 5.7 Agent Approvals — L2

The Departure Operations Agent produces ranked, risk-tiered proposals and they currently live
only at `/operations/approvals`. Surface the top 3 by risk on the dashboard with inline
**Approve / Reject**, plus a count link to the full queue. Source: `listAgencyOpenProposals()`.
Gated on `capabilitiesForOperations(role).viewModule` exactly as the approvals route is.

This is the "AI-native dashboard" pattern the research pass named, and it is the one place in
the app where an unread queue silently accumulates.

### 5.8 Business Health — L3, rebuilt on real data

Replaces the fabricated card. Same tab affordance, but every tab now renders and every series is
real:

| Tab | Series | Source |
|---|---|---|
| Revenue | booked value + cash collected, monthly | `buildRevenueTrend(bookings, payments, from, to, "MONTH")` |
| Bookings | live booking count per bucket | same fact rows |
| Collections | collected vs expected, + collection rate | `buildCollectionsSummary()` |
| Receivables | aging buckets | `buildReceivablesAging()` |
| Margin | revenue vs supplier cost by package | `buildPackageProfitability()`, gated on `viewCostAndMargin` |

Period comes from the dashboard's single period selector (§6), default `THIS_QUARTER` so the
trend has enough buckets to read. Comparison fixed to `PREVIOUS_PERIOD`.

### 5.9 Pipeline — L3, replaces the fabricated leads chart

`buildLeadFunnel()` gives a monotonic funnel with stage-to-stage conversion percentages, and
`buildLeadSourcePerformance()` gives conversion and revenue by source. Render the funnel as
horizontal bars with conversion labels between stages, plus the top 3 sources beneath.

Note the documented limitation on `buildLeadFunnel` — there is no `lead_stage_events` history
table, so the funnel is derived from current stage. Carry that caveat into a tooltip rather than
silently presenting it as historical flow.

### 5.10 Team Performance — L3, real data

Delete the browser-share pie. Rebuild from `buildSalesTeamPerformance()`: per owner, leads
handled, contact rate, bookings, booking value. Table, not a pie — five staff members with
comparable values is a bar/table problem, never a pie problem. Gated to ADMIN, CEO, MARKETING.

### 5.11 Recent Activity — L3, widened

Today it slices `snapshot.activity` (Operations only). `loadMergedActivityFeed()` already merges
across modules — switch to it so a finance or visa event is visible. Cap 8 rows, "View all →" to
the owning module.

---

## 6. The period selector

One control in the page header, URL-driven (`?period=THIS_QUARTER`), reusing
`ReportPeriod` / `resolvePeriod()` / `resolveComparison()` verbatim. It affects **L1 KPI deltas
and L3 trends only** — L2 is always live, because "what needs action" has no period.

Deliberately narrower than Reports': `THIS_WEEK · THIS_MONTH · THIS_QUARTER · THIS_YEAR`.
No custom range, no comparison-mode picker (fixed to `PREVIOUS_PERIOD`). Anyone who needs a
custom window needs Reports, and the panel footer says so.

The orphaned `admin-header-filters.tsx` with its hardcoded `"Colombo Branch"` /
`"Umrah 2026"` lists is deleted. A branch filter is deferred to §12 — it needs real branch
options from settings, and `ReportFilters` already models branch scoping when we want it.

---

## 7. Data layer

### 7.1 Shape

```
lib/data/dashboard-repository.ts   server-only. Assembles. One entry point.
lib/data/dashboard.ts              NEW. Pure, client-safe derivations (ranking, tones).
lib/data/dashboard-layout.ts       NEW. Pure. Role → panel list. No I/O.
lib/data/dashboard-pace.ts         NEW. Pure. Seat-fill pace curve (§5.6).
lib/types/dashboard.ts             View models. Delete the three dead interfaces.
```

This mirrors the repository/derivation split every other module uses
(`operations-repository.ts` + `operations.ts`, `finance-repository.ts` + `finance.ts`).

### 7.2 The entry point

```ts
export async function loadDashboardData(input: {
  role: StaffRole;
  staffId: string | null;
  agencyId: string | null;
  filters: DashboardFilters;   // { period, customFrom: null, customTo: null, compare: "PREVIOUS_PERIOD" }
  nowIso: string;
}): Promise<DashboardData>
```

`nowIso` is passed in rather than read inside, so every panel is measured against one clock —
the discipline [page.tsx](app/(main)/dashboard/page.tsx) already documents and Reports already
enforces.

### 7.3 Fetch plan

Panels are resolved **before** fetching; each loader runs only if some panel in this role's
layout needs it.

| Loader | Needed by | Gate |
|---|---|---|
| `buildOperationsSnapshot()` | status-line, my-day, attention, departures, pace, activity | always |
| `loadReportsOverviewSnapshot()` | KPI deltas, business-health revenue/bookings | `capabilitiesForReports(role).viewOverview` |
| `loadReportsFinanceSnapshot()` | business-health collections/receivables/margin | `viewFinance` |
| `loadReportsSalesSnapshot()` | pipeline, team-performance | `viewSales` |
| `loadLeadStore({ only: ["leads"] })` | attention rail lead rows | `capabilitiesForLeads(role).viewModule` |
| `loadFinanceReceivables()` / `loadFinancePayments()` / `loadRefundsPendingSummary()` | collections, KPIs, attention | `capabilitiesForFinance(role).viewLedger` |
| `listAgencyOpenProposals()` | approvals | `capabilitiesForOperations(role).viewModule` && `agencyId` |
| `loadTasksForStaff()` | my-day | `staffId != null` |
| `loadUnassignedTaskCount()` | my-day (admin tab) | ADMIN, CEO |
| `loadMergedActivityFeed()` | recent-activity | `staffId != null` |

All in one `Promise.all`. Skipped loaders resolve to `null`, and the panel renders **absent**,
never zeroed — the distinction `dashboard-repository.ts` already draws with
`collections: null`.

### 7.4 Cost

Worst case (ADMIN, every panel) is roughly 10 parallel loaders. The Reports snapshots aggregate
in Postgres via the `report_*_facts` views; the Operations snapshot is the same one
`/operations` already pays for. The two heaviest existing calls —
`loadFinancePayments(db, 500)` and `loadLeadStore()` — load full stores into the server
component. Mitigations, in order of preference:

1. Push the two aggregate figures the dashboard needs (collected-this-month, outstanding total)
   into the `report_payment_facts` / `report_group_facts` reads it is already making, and stop
   calling `loadFinancePayments` from the dashboard at all.
2. Wrap each loader in React `cache()` so a panel and the status line that summarises it share
   one fetch within a render.
3. Measure before optimising further. Record server render time in Phase 1 and set a budget
   (§11) rather than guessing.

**Not** proposed: a materialised dashboard summary table. That is a second source of truth for
numbers the modules already own, and it would drift.

---

## 8. Access

No new access rules. The dashboard composes existing ones:

| Data | Gate |
|---|---|
| Revenue, margin, supplier cost | `capabilitiesForReports(role).viewCostAndMargin` |
| Collections, receivables, refunds | `capabilitiesForFinance(role).viewLedger` |
| Lead counts, funnel, sources | `capabilitiesForLeads(role).viewModule` |
| Agent proposals, approve/reject | `capabilitiesForOperations(role).viewModule` |
| Group scope for GUIDE | `loadAssignedGroupIds(staffId)` |
| Team performance rows | ADMIN, CEO, MARKETING |

Two invariants to test explicitly (§10):

- **Gating decides fetching, not rendering.** A FINANCE-less role must not have receivable rows
  in its serialised RSC payload at all.
- **A GUIDE sees only assigned groups** in every panel — including the status line summary and
  the attention rail counts, which are the easy places to leak an agency-wide total.

---

## 9. States

Every panel implements four states. This is where the current module is weakest — several panels
render an empty card with no explanation.

| State | Treatment |
|---|---|
| **Loading** | Per-panel skeleton via `<Suspense>` + the existing `route-loading-skeleton`. The status line and KPIs stream first; L3 charts stream last. Replaces today's whole-page `loading.tsx` blocking on the slowest loader |
| **Empty (healthy)** | Explicit success copy: `All groups on track.`, `Nothing due today.` Never a bare `0` |
| **Empty (new agency)** | Onboarding-aware: `No departure groups yet — create your first →`. The `OnboardingChecklist` already handles the workspace-setup half |
| **Denied** | Panel absent. No greyed-out teaser of data the role may not see |
| **Error** | Per-panel error boundary, so one failing loader does not blank the landing page. Today [error.tsx](app/(main)/dashboard/error.tsx) takes down the whole route |

---

## 10. Testing

| # | Assertion |
|---|---|
| 1 | No component under `app/(main)/dashboard/` contains a hardcoded data array. Enforce with a lint rule or a grep test in CI — this is the regression that matters most |
| 2 | Every dashboard figure equals the owning module's figure for the same window (KPI revenue === Reports overview revenue; attention-rail overdue count === Finance overdue count) |
| 3 | Each of the 7 roles renders its layout with no thrown error and no denied-panel leakage |
| 4 | A GUIDE's status line, attention counts and departures include only assigned groups |
| 5 | Attention-rail ranking: a critical row on a T-5 group outranks a critical row on a T-90 group |
| 6 | Zero-state: an agency with no groups, no leads and no payments renders every panel's empty copy, no `NaN`, no `0%` where the source is `null` |
| 7 | Period switch changes L1 deltas and L3 trends and leaves L2 unchanged |
| 8 | `projectedGrossMarginPercent === null` renders `—` |
| 9 | Server render time under the §11 budget with a seeded 20-group / 500-pilgrim agency |
| 10 | One loader throwing degrades to one error panel, not a blank route |

---

## 11. Phases

Each phase is independently shippable and leaves the dashboard in a better state than it found it.

| Phase | Scope | Why this order |
|---|---|---|
| **0 — Stop the bleeding** | Delete `business-health/*`, `team-performance*`, `charts/leads/new-leads-chart.tsx`, `operational-alerts.tsx`, `system-health.tsx`, `lead-attention.tsx`, `admin-header-filters.tsx`. Remove the three dead interfaces from `lib/types/dashboard.ts`. Page renders KPIs + real panels only | Fabricated numbers on the landing page are a correctness bug, not a design debt. Ships in one commit with no new data work |
| **1 — Spine** | `dashboard-layout.ts` registry · panel-gated fetch plan · status line · KPI deltas via `resolvePeriod`/`percentDelta` · period selector · per-panel `<Suspense>` and error boundaries | Establishes the architecture every later panel plugs into. Record the render-time baseline here and set the budget |
| **2 — Act layer** | My Day (3 tabs, personal scope) · Attention Rail with ranking · Agent Approvals panel · seat-fill bar on departures | The panels that make the dashboard worth opening daily. All data already exists |
| **3 — Understand layer** | Business Health on `buildRevenueTrend` / `buildCollectionsSummary` / `buildReceivablesAging` / `buildPackageProfitability` · Pipeline on `buildLeadFunnel` · Team Performance on `buildSalesTeamPerformance` · Recent Activity on `loadMergedActivityFeed` | Restores what Phase 0 deleted, on real data this time |
| **4 — Pace** | `dashboard-pace.ts` · agency-level pace-target setting · Seat Fill Pace panel | The only phase needing a settings addition. Deliberately last so the target curve can be tuned against real Phase 1–3 usage |

Validate between Phase 2 and Phase 3 with actual staff in each role — the research is explicit
that adoption failures trace to skipping this.

---

## 12. Explicitly out of scope

- **User-customisable layouts** (drag-and-drop panels, saved views). The role registry covers the
  real need at a fraction of the cost. Revisit only if roles prove too coarse in practice.
- **Branch / journey-type filtering.** `ReportFilters` already models it; adding it to the
  dashboard needs real branch options from settings and a decision about whether it persists.
  Deferred, not rejected.
- **Real-time push.** `force-dynamic` per navigation is sufficient for an operations desk.
  Supabase realtime subscriptions are a separate, larger decision.
- **Export.** That is Reports, by the boundary in §3.
- **A history-derived pace curve.** No completed-season data exists yet; §5.6 uses an explicit
  editable target instead. Revisit after one full season of data.
- **Notifications / digest email.** Different delivery surface, different plan.

---

## 13. Open questions

1. **Pace target ownership** — does the `T-180 → 0% / T-0 → 100%` curve belong in
   `agency_settings` (one per agency) or per package template? Per-template is more accurate;
   per-agency ships in Phase 4 without a migration.
2. **CEO and My Day** — the layout above omits it for CEO on the assumption executives do not
   work a task queue. Worth confirming with the actual user before Phase 2.
3. **Attention-rail proximity weights** — `≤7d ×3 / ≤14d ×2 / ≤30d ×1.5` is a first guess.
   It should be a named constant in `lib/data/dashboard.ts` and tuned against real ranking
   complaints, not fixed by argument.
4. **`loadFinancePayments(db, 500)`** — the 500-row cap silently truncates for a large agency,
   which would understate collected-this-month. §7.4 option 1 removes the dependency entirely;
   confirm that is acceptable before Phase 1.

---

## Sources

- [Improvado — Dashboard Design: Best Practices & How-Tos 2026](https://improvado.io/blog/dashboard-design-guide)
- [Domo — Dashboard Design Best Practices: Layouts & Examples](https://www.domo.com/learn/article/dashboard-design-examples-best-practices)
- [Luzmo — 10 Dashboard Design Principles](https://www.luzmo.com/blog/dashboard-design)
- [DataCamp — Effective Dashboard Design](https://www.datacamp.com/tutorial/dashboard-design-tutorial)
- [IGC — Dashboard Layout: Visual Hierarchy People Actually Use](https://www.intelligentgraphicandcode.com/design/dashboard-design/dashboard-layout)
- [Orbix — What is a SaaS Dashboard? Design Guide & Principles 2026](https://www.orbix.studio/blogs/saas-dashboard-design-complete-guide)
- [925 Studios — 35 SaaS Dashboard Design Examples, Trends and Patterns (2026)](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)
- [Softrip — Tour Operator Financial Health: 7 KPIs You Should Track](https://www.softrip.com/resources/blog/travel-kpi-tour-operator/)
- [Rework — Travel Data Analytics: Dashboards, Metrics & ROI Guide (2026)](https://resources.rework.com/libraries/travel-tour-growth/travel-data-analytics)
- [Zaui — Six KPIs Every Tour and Activity Company Should Measure](https://www.zaui.com/blog/key-performance-indicators-tour-operators/)
- [Improvado — Salesforce Dashboard Examples: 5 Complete Specs (2026)](https://improvado.io/blog/salesforce-dashboard)
- [Ron Design Lab — HubSpot CRM UI Patterns](https://rondesignlab.com/cases/hubspot-crm-saas-ux-ui-design)
