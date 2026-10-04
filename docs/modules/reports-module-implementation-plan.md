# Reports Module — Implementation Plan

Build the agency's **decision and export center** on the same data, access and action
architecture already used by **Packages**, **Departure Groups**, **Leads**, **Pilgrims**,
**Documents**, **Visa**, **Operations**, **Suppliers** and **Payments & Invoices**.

Status: **plan only. Nothing in here is implemented.**

The product rule the whole plan enforces:

```text
Dashboard   →  What is happening now? What requires action?
Reports     →  What happened over a period? Why? Export and share it.
```

And the boundary it must not cross:

```text
Module pages (Leads, Finance, Operations, Visa …)
    →  the live working queue. Rows you act on. Writes happen here.

Reports
    →  aggregates over a chosen window, compared to a previous window,
       sliced by branch / package / group / owner / journey, exported.
       READ-ONLY. Zero mutations. Every row links back to its module.
```

Reports is the **only read-only module in the codebase**. That single constraint removes
Server Actions, validation-on-write, optimistic updates, audit trails and storage buckets from
the surface area — and replaces them with two problems no other module has solved yet:
**period comparison** and **cross-module aggregation**.

Three rules carried into every section below:

- **Reports never re-derives a number that a module already derives.** Collection rate comes from
  `lib/data/finance.ts`, readiness from `lib/data/departure-groups-readiness.ts`, task priority
  from `lib/data/operations.ts`. A second definition of "overdue" is the failure mode.
- **Aggregation happens in Postgres, not in the browser.** Every other module loads its whole
  store and diffs it. Reports spans nine modules and an unbounded date range; the same approach
  would load the entire database into a Server Component.
- **A report that cannot be exported is not finished.** Every table in this module ships with its
  CSV/Excel column mapping in the same commit.

---

## 1. What exists today

### 1.1 The route

| File | State |
|---|---|
| `app/(main)/reports/` | **Does not exist.** |
| [components/app-sidebar.tsx:95](components/app-sidebar.tsx:95) | Nav entry `Reports → /reports`, icon `ChartNoAxesCombined`, `sideLinks[10]`, rendered as the sole link in the **Insights** group of `adminBar`. **It 404s today.** |
| [components/app-sidebar.tsx:135](components/app-sidebar.tsx:135) | The `adminBar` group arrays are **index-based** (`[sideLinks[10]]`). Adding or removing a `sideLinks` entry shifts every group below it — do not reorder that array. |

So the nav promise already exists and is broken. Creating `app/(main)/reports/page.tsx` fixes the
only dead link in the Insights group with no sidebar change at all.

### 1.2 What already exists and is the real starting point

This is **not** greenfield in the data sense. Every number the spec asks for is already modelled
by one of the nine shipped modules; what is missing is the **aggregation layer** and the
**period/comparison** machinery.

| Report concern | Where the data already lives | Fitness |
|---|---|---|
| Booked revenue, collected, outstanding, overdue | `finance_receivable_rows` view + `computeFinanceKpis()` ([finance.ts:135](lib/data/finance.ts:135)) | **Correct, and the definitive definition.** Reports must call it, not restate it. See F14 for the one bug to route around |
| Dated cash collection | `payments` table (`paid_at`, `status`, `amount`, `method`) ([20260818090000:184](supabase/migrations/20260818090000_finance_payments.sql:184)) | **The reason a revenue *trend* is now possible at all.** Before this table there was no date on any money |
| Milestone-level overdue + aging | `booking_payment_milestones` (`due_at`, `amount`, `paid_amount`, `waived`) | **Exactly the grain the aging report needs.** Bucket by `due_at`, never `bookings.next_due_at` (finance plan F4) |
| Supplier payables | `finance_supplier_payable_rows` over `supplier_commitments` | Reuse verbatim. Multi-currency — see F7 |
| Supplier confirmation performance | `supplier_directory_rows` (`confirmed_count`, `pending_count`, `issue_count`, `active_group_count`) ([20260817090000:330](supabase/migrations/20260817090000_supplier_directory.sql:330)) | **Report #8 is nearly a `select *` from this view.** Only "confirmed on time" is missing (F12) |
| Group readiness | `departure_groups.readiness_score` / `readiness_status` + `departure_group_readiness_items` (category `FLIGHT·HOTEL·TRANSPORT·PAYMENT·DOCUMENT·VISA·ROOMING·GUIDE·MANIFEST·CATERING·OTHER`) | **The readiness matrix is already built** — `buildReadinessMatrixRows()` ([operations.ts:204](lib/data/operations.ts:204)) is the departure-readiness report's per-category grid. Reuse it |
| Capacity / occupancy | `departure_groups.capacity`, `booked_seats`, `held_seats`, generated `available_seats` | **Report #5 is a `select` with no derivation at all.** Waitlist needs the booking-status count (F9) |
| Lead funnel stages | `leads.stage` (11 values incl. `NEW_LEAD → CONTACTED → QUALIFIED → PROPOSAL_SENT → NEGOTIATION → DEPOSIT_PENDING → BOOKED`), `source` (11 values), `lost_reason` (10 values), `assigned_to_name`, `estimated_value_lkr` | **Every axis the spec's sales reports name is a real, indexed, check-constrained column.** What is missing is *history* — see F3 |
| Documents | `document_queue_rows` view — status, `required`, `expires_at`, `verified_at`, plus `documents_completed` / `documents_required` / `document_completion_percent` per enrolment | Report #6's document half is a group-by over this view |
| Visa | `visa_application_rows` view — `visa_status`, batch, group, `gating_outstanding`, `rejected_documents`, `enrolment_passport_expiry` | Report #6's visa half, and the passport-validity report, both group-by this view |
| Tasks | `departure_group_tasks` (`status OPEN·IN_PROGRESS·COMPLETE·OVERDUE`, `category OPERATIONS·VISA·FINANCE·GUIDE·MARKETING·OTHER`, `owner_name`, `due_at`) | **The operational-task-completion matrix is a two-axis count over one table** |
| Package cost estimate | `packages.finance_estimate` jsonb — seven per-pilgrim cost components, gated by `finance_role_view` ([validations/packages.ts:59](lib/validations/packages.ts:59)) | The only *estimated* cost in the system. **Not snapshotted onto groups** — see F6 |
| Actual supplier cost | `supplier_commitments.amount` + `departure_group_accommodations.internal_cost` + `departure_group_transports.internal_cost` | Three sources, two definitions, four currencies. See F6/F7 |
| Branch | `departure_groups.branch`, `packages.branch` (both text, both indexed) | Covers group/package/finance reports. **Not on `leads`** — see F4 |
| Roles | `StaffRole` (`ADMIN·CEO·OPERATIONS·VISA·FINANCE·MARKETING·GUIDE`) + `getCurrentStaffRole()` ([departure-groups.ts:264](lib/data/departure-groups.ts:264)) | All seven rows of the spec's visibility table. Still defaults everyone to ADMIN (shared limitation) |
| CSV export | [lib/csv.ts](lib/csv.ts) — `toCsv`, `downloadTextFile`, `timestampedFilename`, UTF-8 BOM for Sinhala/Tamil names | **Covers every CSV export in the spec with no new machinery** |
| Excel export | [app/(main)/departure-groups/xlsx.ts](app/(main)/departure-groups/xlsx.ts) — hand-rolled, dependency-free `.xlsx` writer, client-only | **Covers "Excel export" with no new dependency.** Single sheet of string cells — enough for a report table. See D6 |
| PDF | **Nothing.** No dependency; the only precedent is `window.print()` in [guide-operations-tab.tsx:127](app/(main)/departure-groups/[groupId]/components/tabs/guide-operations-tab.tsx:127) | PDF is a scope decision, not a line of work. See D6 |
| Charts | [components/ui/chart.tsx](components/ui/chart.tsx) + `recharts@3`, `ChartContainer`/`ChartTooltip`/`ChartConfig`, colours as `var(--primary)` / `var(--accent)` | **Available and theme-correct.** The four dashboard charts using it are all wired to mock arrays — see F2 |
| Tabbed workspace | [finance-workspace.tsx](app/(main)/finance/payments/components/finance-workspace.tsx) — one route, seven tabs, `components/tabs/*`, capability-filtered tab list | **The exact precedent for this page**, which is also seven tabs on one route |

### 1.3 The UI vocabulary to reuse — no new components

Everything the spec draws already has a component. **This plan adds zero files under
`components/`, introduces no new colours, spacing, typography or theme tokens, and defines no new
chart palette.** New work is composition only.

| Spec element | Existing component |
|---|---|
| `Home > Reports` + title + subtitle + header actions | [components/page-header.tsx](components/page-header.tsx) |
| Seven category tabs | [components/animate-ui/components/animate/tabs.tsx](components/animate-ui/components/animate/tabs.tsx) with `className="flex-wrap h-auto"`, as `finance-workspace.tsx` |
| Six global filter chips (Period, Compare With, Branch, Journey, Package, Departure Group) | [components/data-table/filter-select.tsx](components/data-table/filter-select.tsx) — `FilterSelect`, `ALL_FILTER_VALUE`. **Six chips in one `flex flex-wrap gap-2` row, exactly the `pilgrims-list.tsx` filter row** |
| Custom date range for `Period: Custom` | [components/ui/calendar.tsx](components/ui/calendar.tsx) + [popover.tsx](components/ui/popover.tsx) — the pattern in `record-payment-dialog.tsx` |
| Executive summary tiles (6) | [components/data-table/kpi-card.tsx](components/data-table/kpi-card.tsx) — `KpiCard`, `KpiRow`. `desc` carries the `+14% vs previous period` delta. **`KpiRow` is a 4-column grid — six tiles wrap 4+2; do not change the grid** (F13) |
| Every report table | [components/data-table/data-table.tsx](components/data-table/data-table.tsx) — search, pagination, `resetPageToken`, `aria-sort` |
| Sortable headers | [components/data-table/sortable-header.tsx](components/data-table/sortable-header.tsx) |
| Report-library cards inside a category tab | [components/ui/card.tsx](components/ui/card.tsx) + [section-heading.tsx](components/section-heading.tsx) |
| Revenue / collections trend, funnel bars | `ChartContainer` + `AreaChart` / `BarChart` / `LineChart`, config colours `var(--primary)` / `var(--accent)` only |
| Risk, status, conversion badges | [components/ui/tone-badge.tsx](components/ui/tone-badge.tsx) — `ToneBadge`, `ProgressBar`, `PersonChip`, `EmptyState`, `PermissionDenied` |
| Colour vocabulary | [lib/ui/tone.ts](lib/ui/tone.ts) — `Tone`, `TONE_CLASS`, `TONE_BAR`, `percentTone()`. **Every report status maps onto existing tones; no new palette** |
| Readiness / completion percentages | `ProgressBar` + `percentTone()` |
| Saved-report pills / quick views | [components/data-table/saved-view-bar.tsx](components/data-table/saved-view-bar.tsx) — `SavedViewBar` |
| Create Custom Report (a form, stepped) | [components/ui/sheet.tsx](components/ui/sheet.tsx) right-side sheet + [checkbox.tsx](components/ui/checkbox.tsx) (metrics), [combobox.tsx](components/ui/combobox.tsx) (group-by), [button-group.tsx](components/ui/button-group.tsx) (report type / format) |
| Schedule Report | [components/ui/dialog.tsx](components/ui/dialog.tsx) + `dialog-footer.tsx` |
| Export Center | [components/ui/dropdown-menu.tsx](components/ui/dropdown-menu.tsx) from the header, as `finance-workspace.tsx` |
| Feedback | [components/ui/toast.tsx](components/ui/toast.tsx) — `toast.add(...)` |
| Form reset on open | [hooks/use-reset-on-open.ts](hooks/use-reset-on-open.ts) |
| Loading | [components/ui/skeleton.tsx](components/ui/skeleton.tsx) + a `loading.tsx` per route segment |

---

## 2. Findings — the gap between today and the specification

### F1 — The route is linked and missing

`sideLinks[10]` points at `/reports`; nothing serves it. Every other module landed its route in
the same commit as its nav entry; Reports is the one nav entry that shipped ahead of its page.

### F2 — The Dashboard is entirely mock data, and Reports must not copy it

[lib/data/admin-dashboard-data.ts](lib/data/admin-dashboard-data.ts) is 570 lines of hardcoded
objects, and [app/(main)/dashboard/page.tsx:21](app/(main)/dashboard/page.tsx:21) is a
`"use client"` component calling `getAdminDashboardData()` with three filter handlers whose bodies
are empty comments. The four charts under `dashboard/components/charts/` and
`business-health/` are wired to literal arrays (`{ month: "January", desktop: 0, mobile: 0 }`).

Two consequences:

- **Reports is the first real cross-module aggregate in the app.** There is no existing query to
  copy, and no existing number to reconcile against.
- The spec's framing — *"Dashboard tells the CEO what needs attention today; Reports answer deeper
  questions"* — cannot be validated by comparing the two pages, because one of them is fiction.
  Do not treat any dashboard figure as a source of truth during implementation.

### F3 — There is no lead stage history, so half the funnel report is uncomputable

The spec's funnel asks for three things per stage: **count**, **stage-to-stage conversion %**, and
**average time spent in stage**.

`leads.stage` is a single mutable column. `changeLeadStageInStore()`
([leads.ts:607](lib/data/leads.ts:607)) writes the new stage and pushes a `lead_activity` row whose
only record of the transition is an English sentence:

```ts
`Stage moved from ${previous.replace(/_/g, " ").toLowerCase()} to ${input.stage...}`
```

`pushActivity()` ([leads.ts:389](lib/data/leads.ts:389)) does **not** persist the `metadata` jsonb
column the table offers — it is dropped on the floor.

So today:

| Funnel column | Computable? |
|---|---|
| Count per stage | ✅ — but only as a **current-stage snapshot**, which is not a funnel |
| Stage-to-stage conversion | ❌ — a lead now at `BOOKED` leaves no evidence it ever passed `QUALIFIED` |
| Average time in stage | ❌ — no entered-at / left-at timestamps anywhere |
| vs previous period | ❌ — follows from the above |

A current-stage snapshot is actively misleading as a funnel: it shows 52 `BOOKED` and 240
`NEW_LEAD` as if they were the same cohort. **This needs a `lead_stage_events` table** (§3.2 A),
backfilled from `created_at`/`first_response_at`/`last_contacted_at` and from parsing the existing
`STAGE_CHANGED` activity messages, with the sentence-generating mutator amended to write a real
row alongside it.

### F4 — Two of the six global filters cannot apply to the sales reports

The spec says *"These filters should apply to every report card/chart unless a report overrides
it."*

| Filter | Groups / Finance / Ops | Leads |
|---|---|---|
| Period | ✅ `created_at` | ✅ `created_at` |
| Branch | ✅ `departure_groups.branch` | ❌ **`leads` has no branch column** |
| Journey | ✅ `journey_type` | ✅ `journey_type` |
| Package | ✅ `package_template_id` | ⚠️ `desired_package_id`, nullable — an unqualified lead has none |
| Departure Group | ✅ `departure_group_id` | ⚠️ `selected_departure_group_id`, nullable |
| Sales owner | ⚠️ `finance_owner_name` etc., free text | ✅ `assigned_to_id` / `assigned_to_name` |

And `assigned_to_id` resolves against `LEAD_STAFF` — **a hardcoded six-person array** in
[lib/data/leads-seed.ts:31](lib/data/leads-seed.ts:31), not a table. There is no staff/users table
anywhere in the schema; `departure_groups.operations_owner_name`, `visa_owner_name`,
`finance_owner_name`, `primary_guide_name` and `departure_group_tasks.owner_name` are all
independent free-text strings.

Consequences: the **Sales team performance** and **Guide and staff workload** reports group by a
string that nothing guarantees is spelled the same way in two tables, and the Branch filter must
be declared *unsupported* by every Sales & Leads report rather than silently returning zero rows.

### F5 — "Compare with previous period" has no precedent anywhere in the codebase

Zero occurrences of period comparison, delta, or trend arithmetic in any module. Every KPI in the
app is a single-window figure. The spec puts `+14% vs previous period` on six executive tiles, and
`Comparison to previous period` on the funnel.

This is not a UI problem — it doubles the query count for **every** report, and it forces a
decision the spec leaves open: what *is* the previous period for `This Month` on the 13th? (D2.)

### F6 — There are three disagreeing definitions of cost, and none of them is snapshotted

The profitability reports (#7, and the group-profitability report) need `Revenue − Cost`.

| Candidate cost source | What it is | Problem |
|---|---|---|
| `packages.finance_estimate` jsonb | Seven per-pilgrim planning estimates (flight, accommodation, transport, visa/insurance, catering, guide/ops, contingency) | An **estimate on the live template**. `copyPackageSnapshot()` ([departure-groups-copy.ts:324](lib/data/departure-groups-copy.ts:324)) copies pricing, schedule, itinerary, inclusions, accommodation standards and transport requirements — **not the finance estimate**. So a template repriced today silently rewrites last season's margin |
| `supplier_commitments.amount` | What suppliers actually charge, per group | **Multi-currency** (`SAR·LKR·USD·AED`), and only exists where someone created a commitment |
| `departure_group_accommodations.internal_cost` + `departure_group_transports.internal_cost` | What `departure_group_payment_summaries.supplier_payables_due` sums | Two service kinds out of thirteen, ignores what is paid. Already flagged as wrong by the finance plan (F7) |

There is no `cost` column on a booking, a group, or a package. **Margin is not currently a
derivable number** — it is a modelling decision that this module must make explicitly and label on
screen, not a query.

### F7 — Multi-currency makes a single margin figure impossible

Revenue is LKR (`bookings.total_booking_value`, `pricing_snapshot.currency` defaulting `LKR`).
Supplier cost is predominantly SAR. **There is no FX rate anywhere in the codebase** — the
Suppliers plan flagged this as D1 and the Finance plan as F12/D1, and both answered it the same
way: never convert, report per currency.

The spec's `Projected Gross Margin 18.5%` and `Margin 21%` columns are single scalars. They can
only be honest once either (a) an FX rate table exists, or (b) the margin is computed against a
cost expressed in the same currency as the revenue. See D3.

### F8 — Readiness has no history, so the "trend" column has nothing behind it

`departure_groups.readiness_score` is a single scalar, recomputed in place. The departure-readiness
report asks for `Trend: improving / declining / unchanged`, and the group-health summary implies a
movement.

`departure_group_activity_logs` records readiness-item changes with `before_value`/`after_value`,
but not the composite score, and reconstructing a daily score from an event stream across every
group is not a report query. This needs either a small daily snapshot table (§3.2 B) or the column
is dropped from V1. See D4.

### F9 — Waitlist is a booking status, not a counter

The capacity report's `Waitlist` column has no column behind it. `departure_groups` carries
`capacity`, `booked_seats`, `held_seats` and generated `available_seats` — but waitlist is
`departure_group_bookings.booking_status = 'WAITLIST'` and
`departure_group_pilgrims.seat_status = 'WAITLIST'`. The report must count seats
(`sum(traveller_count)`), not bookings, or it will under-report a family of four as one.

### F10 — The post-departure performance report has no data model

`Pilgrims travelled`, `Late cancellations`, `Support incidents`, `Supplier issues`,
`Pilgrim feedback score`, `Visa rejection count` — of these:

| Field | Available? |
|---|---|
| Pilgrims travelled | ⚠️ derivable as `seat_status = 'TICKETED'` at departure, but nothing freezes it at departure time |
| Late cancellations | ⚠️ cancellations exist; "late" needs a threshold vs `departure_date` and a cancellation timestamp (there is `cancelled_at` on the enrolment, not on the booking) |
| Visa rejection count | ✅ `visa_status = 'REJECTED'` |
| Support incidents | ✅ `pilgrim_support_requests` ([20260813090000:89](supabase/migrations/20260813090000_create_pilgrims.sql:89)) |
| Supplier issues | ✅ `supplier_commitments.status = 'DISPUTED'` |
| Collection completion / refunds | ✅ finance views |
| **Pilgrim feedback score** | ❌ **No feedback model exists anywhere in the schema** |

This report is therefore ~70% buildable. See D5.

### F11 — "Confirmed on time" has no baseline

`supplier_directory_rows` gives `confirmed_count`, `pending_count`, `issue_count`. The spec's
supplier report wants **`Confirmed on time`** and **`Late`**. `supplier_commitments` has
`confirmed_at` and `created_at`, but no *promised-by* date — `payment_due_at` is a payment date,
and `service_start_date` is when the service happens, not when confirmation was due. On-time
therefore needs a convention (e.g. confirmed ≥ N days before `service_start_date`), stated once in
`REPORTS_COPY` and never hardcoded elsewhere.

### F12 — There is no scheduling, email, or PDF infrastructure

The spec's `Schedule Report` (Daily / Weekly / Monthly / Before every departure) and delivery
options (in-app notification, email, PDF, Excel/CSV) have no substrate:

- no cron, queue, or background-job runner in the project;
- no email sender — the closest precedent is `send-reminder-dialog.tsx`, which **drafts a message
  for a human to send** and logs that it was drafted;
- no notification model;
- no PDF dependency.

The spec itself says *"Support later"* for scheduling. This plan takes that literally: V1 stores
schedule **definitions** and runs reports **on demand**, and the schedule dialog states plainly
that delivery is not yet active. See D6/D7.

### F13 — `KpiRow` is a four-column grid and the executive summary has six tiles

[kpi-card.tsx:26](components/data-table/kpi-card.tsx:26) is
`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`. Six tiles wrap to 4 + 2. That is acceptable and is
already how the Finance page's five cards render. **Do not change the shared grid for this module.**

### F14 — `finance_receivable_rows` includes cancelled bookings; aggregating it naively is wrong

The view has **no `where` clause on `booking_status`**
([20260818090000:601](supabase/migrations/20260818090000_finance_payments.sql:601)), while
`departure_group_payment_summaries` explicitly excludes `booking_status <> 'CANCELLED'`
([20260810090000:117](supabase/migrations/20260810090000_departure_groups_supabase_fixes.sql:117)).

On the Finance page this is harmless — a cancelled booking has a zero outstanding balance, so it
contributes nothing to a sum and appears as one dead row in a queue. In a **report** it is not
harmless: `count(bookings)`, `sum(total_booking_value)` and any conversion-rate denominator all
change. Reports must filter `booking_status <> 'CANCELLED'` at every aggregate, and say so in a
comment pointing at this finding.

Related: `loadFinancePayments()` ([finance-repository.ts:111](lib/data/finance-repository.ts:111))
takes `limit = 500`. A report that reused it for a revenue trend would **silently truncate** to the
500 most recent payments. Reports must not reuse the module loaders that carry display limits.

### F15 — Every module repository loads its entire store; none of them may be reused here

`loadLeadStore()`, `loadPilgrimStore()`, `departure-groups-repository.ts`'s
`loadStore → mutate → persistStore` diff — all of them read whole tables into memory because they
exist to support **writes**. Reports is read-only and spans nine modules over an arbitrary date
range. Calling any of them from `/reports` would pull the whole database into one Server Component
render.

This is a constraint, not a defect, and it dictates §3.2 C: reports read **purpose-built
aggregate views**, not module stores.

---

## 3. Target architecture

### 3.1 Routes and files

```text
app/(main)/reports/
  page.tsx                         Server Component: role → capabilities → filters from
                                   searchParams → snapshot → workspace
  loading.tsx                      Skeleton (reports are the slowest page in the app)
  reports-store.tsx                Provider (snapshot, filters, comparison, nowIso, role, can)
  types.ts                         Re-exports lib/types/reports + tab/filter unions
  utils.ts                         Formatters (money, %, delta), search/sort predicates
  csv.ts                           One column mapping per report id
  xlsx.ts                          Thin re-export of the departure-groups writer (D6)
  actions.ts                       The ONLY writes in the module: save / delete / rename a
                                   saved report, create / pause a schedule. No report data
                                   is ever written.
  components/
    reports-workspace.tsx          PageHeader + global filter bar + tabs shell
    report-filter-bar.tsx          The six global chips + custom range popover
    comparison-delta.tsx           `+14%` / `−8%` badge — one component, used ~30 times
    report-card.tsx                Library card: title, description, roles, [Open] [Export]
    report-shell.tsx               Per-report frame: heading, override notice, export menu
    create-custom-report-sheet.tsx The constrained builder
    schedule-report-dialog.tsx     Definition only in V1 (F12)
    export-center-sheet.tsx        Format + scope picker, per-role defaults
    tabs/
      overview-tab.tsx             Executive summary, revenue trend, group health
      sales-tab.tsx                Funnel, source performance, team performance, lost leads
      finance-tab.tsx              Collections, aging, package profitability, payables, refunds
      groups-tab.tsx               Readiness, capacity, group profitability, performance
      pilgrims-tab.tsx             Documents, visa, passport validity, pilgrim readiness
      suppliers-tab.tsx            Supplier confirmation, service commitments, workload, tasks
      saved-tab.tsx                Saved reports list
    reports/                       One file per report — pure presentation over a prepared row set
      executive-summary.tsx
      revenue-trend.tsx
      group-health-summary.tsx
      lead-funnel.tsx
      lead-source-performance.tsx
      sales-team-performance.tsx
      lost-lead-analysis.tsx
      collections-report.tsx
      receivables-aging.tsx
      package-profitability.tsx
      supplier-payables.tsx
      refunds-adjustments.tsx
      departure-readiness.tsx
      capacity-occupancy.tsx
      group-profitability.tsx
      departure-performance.tsx
      document-completion.tsx
      visa-status.tsx
      passport-validity-risk.tsx
      pilgrim-readiness.tsx
      supplier-confirmation.tsx
      service-commitments.tsx
      staff-workload.tsx
      task-completion.tsx
      custom-report-result.tsx
  report-tables/
    columns/*.tsx                  ColumnDef sets, one file per tabular report
```

New server-only / shared modules:

```text
lib/types/reports.ts          Flat, JSON-safe aggregate row types + ReportFilters + Comparison
lib/access/reports-access.ts  ReportsCapabilities, capabilitiesForReports, visibleReportTabs,
                              visibleReportIds  ← the spec's role table, encoded once
lib/data/reports-repository.ts "server-only". Every aggregate query. The only Supabase caller
lib/data/reports.ts           Client-safe pure derivations: deltas, funnel maths, tones,
                              readiness/margin rollups, custom-report shaping
lib/data/reports-copy.ts      REPORT_REGISTRY + every label, threshold, bucket and taxonomy
lib/data/reports-period.ts    Period resolution + comparison windows (the F5 answer)
lib/validations/reports.ts    zod: filters, custom report definition, saved report, schedule
```

No sidebar change. No change to any existing module file except the two in §3.6.

### 3.2 Schema — `supabase/migrations/20260819090000_reports.sql`

Additive only, safe on a database with `20260808090000 … 20260818090000` applied. Reports is
read-only over existing data; this migration exists for the three things the spec needs that the
schema genuinely cannot answer (F3, F8), plus persistence for saved reports and schedules.

#### A. Lead stage history — the funnel's missing dimension (F3)

```sql
create table if not exists public.lead_stage_events (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads (id) on delete cascade,
  from_stage   text,                                  -- null on creation
  to_stage     text not null,
  -- Denormalised so a funnel query never joins back to leads.
  source       text,
  assigned_to_id   text,
  assigned_to_name text,
  journey_type text,
  actor_name   text not null default 'System',
  entered_at   timestamptz not null default now(),
  -- Set when the NEXT event for this lead is written. Null = still in stage.
  left_at      timestamptz,
  constraint lead_stage_events_direction check (from_stage is distinct from to_stage)
);

create index if not exists lead_stage_events_lead_idx    on public.lead_stage_events (lead_id, entered_at);
create index if not exists lead_stage_events_stage_idx   on public.lead_stage_events (to_stage, entered_at desc);
create index if not exists lead_stage_events_entered_idx on public.lead_stage_events (entered_at desc);
create index if not exists lead_stage_events_open_idx    on public.lead_stage_events (lead_id) where left_at is null;
```

`left_at` is maintained by a trigger that closes the previous open event for the same lead on
insert — the same shape as `supplier_payments_sync_amount_paid`
([20260817090000:265](supabase/migrations/20260817090000_supplier_directory.sql:265)). That makes
*average time in stage* a `avg(left_at - entered_at)` and *stage-to-stage conversion* a
`count(distinct lead_id) filter (where to_stage = X)` — both single-scan queries.

**Backfill**, in this migration, in three passes:

1. one `NEW_LEAD` event per lead at `leads.created_at`;
2. one event per `lead_activity` row of type `STAGE_CHANGED · LOST · POSTPONED · REOPENED`, with
   `to_stage` parsed from the message tail (`"… to proposal sent."` → `PROPOSAL_SENT`) and
   `entered_at = lead_activity.created_at`;
3. a final event at `leads.updated_at` for any lead whose current `stage` does not match its last
   backfilled event.

Message parsing is a one-time migration concern and is acceptable **only** because step 3
guarantees the terminal state is right regardless. `REPORTS_COPY.FUNNEL_HISTORY_BACKFILLED_AT`
records the cutover, and the funnel report shows a footnote for windows that start before it.

Also amended: [lib/data/leads.ts:607](lib/data/leads.ts:607) `changeLeadStageInStore()` and
`markLeadBookedInStore()` push a `lead_stage_events` row alongside the existing activity sentence,
and `pushActivity()` gains the `metadata` argument it already has a column for. **This is the only
change this module makes to another module's mutators.**

#### B. Daily readiness snapshot — the trend column (F8)

```sql
create table if not exists public.group_readiness_snapshots (
  departure_group_id uuid not null references public.departure_groups (id) on delete cascade,
  captured_on        date not null,
  readiness_score    integer not null check (readiness_score between 0 and 100),
  readiness_status   text not null,
  blocker_count      integer not null default 0,
  booked_seats       integer not null default 0,
  collected_amount   numeric(14,2) not null default 0,
  outstanding_amount numeric(14,2) not null default 0,
  primary key (departure_group_id, captured_on)
);
```

One row per live group per day. Written by an **idempotent upsert on read**: the first
`/reports` load of the day (and the group-detail readiness recompute) upserts today's row for
every non-archived, non-completed group. `on conflict do update` makes repeated calls free, and no
cron is required — which matters, because there is none (F12).

Trend = today's score vs the snapshot `PERIOD_TREND_DAYS` (7) ago; unchanged when no earlier row
exists, with the report labelling that as *"no baseline yet"* rather than *"unchanged"*.

#### C. Aggregate views — the report data sources

Nine views, all read-only, all following the existing `*_rows` house pattern
(`pilgrim_journey_rows`, `visa_application_rows`, `supplier_directory_rows`, `finance_*_rows`).
Each is deliberately **pre-aggregated in SQL** (F15), and each carries the filter columns
(`branch`, `journey_type`, `package_template_id`, `departure_group_id`, `owner`) so the six global
filters are `.eq()` calls in the repository, not client-side array work.

| View | Grain | Feeds |
|---|---|---|
| `report_booking_facts` | one row per **non-cancelled** booking (F14), with group, package, branch, journey, sales owner, lead source, booked_at, value, paid, outstanding | Executive summary, revenue trend, group health, collections, package/group profitability |
| `report_payment_facts` | one row per **completed** payment with group/package/branch/method/paid_at | Revenue & collections trend, collections-by-method |
| `report_milestone_aging` | one row per unsettled milestone with `days_overdue` and a `bucket` (`NOT_DUE · D1_7 · D8_30 · D31_PLUS`) | Receivables aging |
| `report_lead_funnel_facts` | one row per lead-stage event joined to source/owner/journey | Funnel, source performance, team performance |
| `report_lead_outcome_facts` | one row per lead: current stage, source, owner, lost reason, value, first-response and cycle durations | Source performance, lost-lead analysis, team performance |
| `report_group_facts` | one row per group: capacity/booked/held/available, **waitlist seats** (`sum(traveller_count)` where `booking_status = 'WAITLIST'`, F9), readiness score/status, blocker count, days to departure, per-category readiness percentages | Readiness, capacity, group health |
| `report_pilgrim_compliance_facts` | one row per enrolment: document counts (required/verified/missing/rework/expiring), visa status, passport expiry + days remaining, payment status, room, flight | Document completion, visa status, passport validity, pilgrim readiness |
| `report_supplier_facts` | one row per commitment: supplier, group, service, status, amounts+currency, due date, owner, `confirmed_on_time` (F11) | Supplier confirmation, service commitments, payables |
| `report_task_facts` | one row per task: category, status, owner, due, overdue flag, group | Task completion, staff workload |

Per-category readiness in `report_group_facts` is computed with `filter (where category = …)`
aggregates over `departure_group_readiness_items`, mirroring `buildReadinessMatrixRows()`
([operations.ts:204](lib/data/operations.ts:204)) column for column. **If the two ever disagree,
the TypeScript function wins** and the view is corrected — that is stated in a `comment on view`,
exactly as `departure_group_payment_summaries` documents its lockstep with `buildPaymentSummary()`.

#### D. Saved reports and schedules

```sql
create table if not exists public.saved_reports (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  report_id     text not null,             -- registry id, or 'custom'
  category      text not null
                  check (category in ('OVERVIEW','SALES','FINANCE','GROUPS','PILGRIMS','SUPPLIERS','CUSTOM')),
  -- The frozen filter set + (for custom) metrics / group-by / format.
  definition    jsonb not null default '{}'::jsonb,
  visibility    text not null default 'PRIVATE'
                  check (visibility in ('PRIVATE','SHARED')),
  created_by    uuid references auth.users (id) on delete set null,
  created_by_name text not null default 'Staff',
  created_by_role text,
  last_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.report_schedules (
  id              uuid primary key default gen_random_uuid(),
  saved_report_id uuid not null references public.saved_reports (id) on delete cascade,
  frequency       text not null
                    check (frequency in ('DAILY','WEEKLY','MONTHLY','BEFORE_DEPARTURE','CUSTOM_DATE')),
  day_of_week     integer check (day_of_week is null or day_of_week between 0 and 6),
  day_of_month    integer check (day_of_month is null or day_of_month between 1 and 28),
  run_at_time     time,
  days_before_departure integer,
  delivery_channels text[] not null default '{IN_APP}',
  recipients      text[]  not null default '{}',
  export_format   text not null default 'CSV'
                    check (export_format in ('CSV','XLSX','PDF','NONE')),
  -- V1: definitions only. Nothing executes these (plan F12 / D7).
  active          boolean not null default false,
  next_run_at     timestamptz,
  last_run_at     timestamptz,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

`active` defaults **false** and the UI renders it as *"Saved — delivery not yet enabled"*. Storing
a schedule nobody runs is honest; storing one that claims to run is not.

RLS on all three new tables: `enable row level security`, select + write policies for
`authenticated`, matching every other module. Real per-role enforcement stays in the application
layer until a staff-roles table exists. `set_updated_at()` triggers on `saved_reports` and
`report_schedules` (the function already exists).

No storage bucket. No new enum types. No changes to any existing table except the additive
`lead_stage_events` backfill reads.

### 3.3 Data layer

| File | Responsibility |
|---|---|
| `lib/data/reports-repository.ts` | `"server-only"`. `loadReportsSnapshot(db, can, filters, comparison)` plus one loader per view. **Every loader takes `ReportFilters` and applies them as `.eq()`/`.gte()`/`.lt()` — never post-filters in JS** (F15). Strips supplier cost, margin and internal notes per capability before rows leave the server, the same posture `finance-repository.ts` documents. **Never imports another module's repository** |
| `lib/data/reports-period.ts` | `resolvePeriod(period, customRange, nowIso) → { fromIso, toIso, label }` and `resolveComparison(period, mode) → { fromIso, toIso, label } \| null`. Periods: `Today · This Week · This Month · This Quarter · This Year · Last Month · Last Quarter · Custom`. Comparison modes: `Previous Period · Same Period Last Year · None`. **One file owns every date boundary in the module** (D2) |
| `lib/data/reports.ts` | Client-safe pure functions over flat fact rows: `computeExecutiveSummary()`, `buildRevenueTrend(buckets)`, `buildGroupHealth()`, `buildFunnel()`, `buildSourcePerformance()`, `buildTeamPerformance()`, `buildLostReasons()`, `buildAgingBuckets()`, `buildPackageProfitability()`, `buildReadinessMatrix()` (delegating to `operations.ts`), `buildCapacityRows()`, `buildComplianceRows()`, `buildSupplierPerformance()`, `buildTaskMatrix()`, `runCustomReport(definition, facts)`, plus `delta(current, previous)` and the tone helpers. Importable from Client Components |
| `lib/data/reports-copy.ts` | **`REPORT_REGISTRY`** (§3.5) plus every label, threshold and taxonomy: `AGING_BUCKETS`, `PASSPORT_MIN_MONTHS = 6`, `PERIOD_TREND_DAYS = 7`, `SUPPLIER_ON_TIME_DAYS`, `AT_RISK_READINESS_BELOW = 85`, `COLLECTION_RATE_TARGET`, `MARGIN_TARGET`, `FUNNEL_STAGE_ORDER`, `LOST_REASON_LABELS`, `SOURCE_LABELS`, `FUNNEL_HISTORY_BACKFILLED_AT`. **Nothing else hardcodes one of these** |
| `lib/access/reports-access.ts` | `ReportsCapabilities` + `capabilitiesForReports(role)` + `visibleReportTabs(role)` + `visibleReportIds(role)` — the spec's role table, encoded once (§3.4) |
| `lib/validations/reports.ts` | `reportFiltersSchema` (also used to parse `searchParams`), `customReportSchema`, `saveReportSchema`, `scheduleReportSchema`, `toReportFieldErrors` |

Server Actions in `app/(main)/reports/actions.ts` — **five, all about report definitions, none
about report data**: `saveReportAction`, `renameReportAction`, `deleteReportAction`,
`scheduleReportAction`, `setScheduleActiveAction`. Each: resolve role → check capability → zod
parse → repository → `revalidatePath("/reports")` → `{ ok, error?, fieldErrors? }`, the same
signature as `OperationsActionResult` / `SupplierActionResult` / `FinanceActionResult`.

**Filters live in the URL**, not in React state. `/reports?tab=finance&period=THIS_QUARTER&compare=PREVIOUS&branch=Colombo&report=receivables-aging`
is the whole point of a report page: it is what a saved report stores, what an export names, what a
CEO pastes into WhatsApp, and what the dashboard's drill-downs link to. This differs deliberately
from `finance-workspace.tsx`, which keeps its tab in `useState`. `page.tsx` reads `searchParams`,
`report-filter-bar.tsx` writes them with `router.replace(..., { scroll: false })`.

### 3.4 Capability matrix — `lib/access/reports-access.ts`

```ts
export interface ReportsCapabilities {
  viewModule: boolean;

  viewOverview: boolean;
  viewSales: boolean;
  viewFinance: boolean;
  viewGroups: boolean;
  viewPilgrims: boolean;
  viewSuppliers: boolean;
  viewSaved: boolean;

  /** Supplier cost, package/group margin, profitability reports. Admin/CEO/Finance only. */
  viewCostAndMargin: boolean;
  /** Branch-comparison slicing across the whole agency. */
  viewAllBranches: boolean;
  /** Guide: reports scoped to groups they are assigned to. */
  ownGroupsOnly: boolean;

  createCustomReports: boolean;
  saveReports: boolean;
  shareSavedReports: boolean;
  scheduleReports: boolean;

  exportCsv: boolean;
  exportExcel: boolean;
  exportPdf: boolean;
}
```

Encoding the spec's table exactly:

| Role | Shape |
|---|---|
| **ADMIN** | everything, including schedule management |
| **CEO** | every tab, `viewCostAndMargin`, `viewAllBranches`, save + schedule; export **PDF + Excel** (the spec's CEO row), no CSV-only workflows removed — CSV stays available |
| **FINANCE** | `overview · finance · groups · saved`, `viewCostAndMargin: true`; **no** sales-team or lead-source reports; export CSV + Excel |
| **MARKETING** | `overview · sales · saved`; funnel, source, team performance, lost-lead, campaign conversion. `viewCostAndMargin: false`. The overview tab renders **without** margin and supplier-payable tiles |
| **OPERATIONS** | `overview · groups · suppliers · pilgrims · saved`; readiness, capacity, commitments, tasks, rooming. `viewCostAndMargin: false` — supplier *confirmation* yes, supplier *cost* no |
| **VISA** | `pilgrims · saved` only: document, visa, expiry, group application reports |
| **GUIDE** | `groups · pilgrims`, `ownGroupsOnly: true`, `exportPdf` only — run sheets and pilgrim contact/rooming, which **already exist** on the group detail's Guide & Operations tab. See D8 |

Plus `visibleReportIds(role)` returning the subset of the registry a role may open. A role without
`viewCostAndMargin` has cost and margin fields **nulled in the repository**, not merely hidden —
the posture [operations-access.ts:8](lib/access/operations-access.ts:8) and
[finance-repository.ts:66](lib/data/finance-repository.ts:66) both document.

`page.tsx` `notFound()`s for `viewModule: false`; no role currently has it false, since every role
has at least one report.

### 3.5 The report registry — one declaration, four consumers

The single design decision that keeps this module from becoming 25 bespoke pages. Every report is
declared once in `reports-copy.ts`:

```ts
export interface ReportDefinition {
  id: ReportId;                       // 'receivables-aging'
  category: ReportCategory;           // 'FINANCE'
  title: string;
  description: string;                // the one-liner on the library card
  /** Which capability opens it. */
  capability: keyof ReportsCapabilities;
  requiresCostAccess: boolean;
  /** Global filters this report honours; the rest render disabled with a reason (F4). */
  supportedFilters: ReportFilterKey[];
  /** Filters this report overrides — e.g. aging is always "as of now". */
  overrides?: Partial<Record<ReportFilterKey, string>>;
  supportsComparison: boolean;        // false where there is no history (F3/F8)
  formats: ReportFormat[];            // TABLE | BAR | LINE | SUMMARY_CARDS | FUNNEL
  exports: ExportFormat[];            // CSV | XLSX | PDF
  /** Where a row click goes: '/departure-groups/{departureGroupId}' etc. */
  rowLink?: string;
  v1: boolean;                        // the spec's "best eight"
}
```

Consumed by: the **category tabs** (which cards to render), the **role gate**
(`visibleReportIds`), the **export center** (which formats), and the **saved-report opener**
(rehydrating a stored `report_id` + filters). Adding a report in a later phase is a registry entry
plus one presentation component — never a new route, provider, or access rule.

The eight V1 reports the spec names carry `v1: true`:

| # | Registry id | Category | Primary source | Comparison |
|---|---|---|---|---|
| 1 | `executive-summary` | OVERVIEW | `report_booking_facts` + `report_payment_facts` + `report_group_facts` | ✅ |
| 2 | `lead-funnel` + `lead-source-performance` | SALES | `report_lead_funnel_facts` / `report_lead_outcome_facts` | ✅ from backfill cutover (F3) |
| 3 | `receivables-aging` | FINANCE | `report_milestone_aging` | ❌ point-in-time (override) |
| 4 | `departure-readiness` | GROUPS | `report_group_facts` | ⚠️ trend only, from snapshots (F8) |
| 5 | `capacity-occupancy` | GROUPS | `report_group_facts` | ❌ point-in-time |
| 6 | `visa-document-completion` | PILGRIMS | `report_pilgrim_compliance_facts` | ❌ point-in-time |
| 7 | `package-profitability` | FINANCE | `report_booking_facts` + `report_supplier_facts` | ✅ revenue side only (F6) |
| 8 | `supplier-confirmation` | SUPPLIERS | `report_supplier_facts` | ✅ |

### 3.6 Changes to existing files

Exactly two, both small:

1. [lib/data/leads.ts](lib/data/leads.ts) — `changeLeadStageInStore()` and
   `markLeadBookedInStore()` append a `lead_stage_events` row; `pushActivity()` accepts and
   persists `metadata`. Covered by the leads store's existing diff-persist path
   ([leads-repository.ts:206](lib/data/leads-repository.ts:206)), so no new write path is created.
2. [app/(main)/departure-groups/[groupId]/page.tsx](app/(main)/departure-groups/[groupId]/page.tsx)
   — after the readiness recompute, upsert today's `group_readiness_snapshots` row (§3.2 B). One
   idempotent call, failure swallowed, never blocking the page.

**No sidebar change.** **No shared component change.** **No theme change.**

---

## 4. Screens

### 4.0 Header and global filters

```text
Home > Reports

Reports
Analyse sales, collections, group readiness, profitability, and operational performance.

[ + Create Custom Report ]  [ Schedule Report ]  [ ••• → Export Center ]
```

`PageHeader` with a two-entry breadcrumb. Following the Finance/Pilgrims precedent, the primary
action is a visible button and the rest live in the overflow `DropdownMenu` — `Create Custom
Report` renders with `createCustomReports`, `Schedule Report` with `scheduleReports`, Export Center
with any `export*`.

Directly below, `report-filter-bar.tsx` — six `FilterSelect` chips in one wrapping row:

```text
Period: This Month ▾   Compare With: Previous Period ▾   Branch: All Branches ▾
Journey: All ▾         Package: All Packages ▾           Departure Group: All Groups ▾
```

- `Period: Custom` opens the `Calendar` + `Popover` range picker used by
  `record-payment-dialog.tsx`.
- A chip a report does not support renders **disabled with a tooltip** carrying the reason from the
  registry (e.g. *"Sales reports are not branch-scoped — leads do not carry a branch"*, F4).
  Silently ignoring a filter is the failure mode.
- `Branch` is hidden entirely for roles without `viewAllBranches`.
- Every change rewrites `searchParams` and re-renders the Server Component; the tab and open report
  survive.

Below that, the seven category tabs (`Tabs` + `TabsList className="flex-wrap h-auto"`), then the
category's report library or an opened report.

**Library, not wall.** A category tab shows `ReportCard`s (title, one-line description, last-run
hint, `[Open]`); opening one swaps the tab body for `report-shell.tsx` with a back affordance and
the export menu. Overview is the exception — its three reports render stacked, since that *is* the
executive briefing.

### 4.1 Overview tab

**Executive Business Summary** — six `KpiCard`s in a `KpiRow` (wrapping 4 + 2, F13), each `desc`
carrying a `ComparisonDelta`:

| Tile | Value | Source |
|---|---|---|
| Revenue | `sum(total_booking_value)` of non-cancelled bookings **booked in the window** (F14) | `report_booking_facts` |
| Bookings | `count(*)` of the same set | `report_booking_facts` |
| Pilgrims | `sum(traveller_count)` + *"Across N active groups"* | `report_booking_facts` |
| Collection Rate | `collected / expected` — `computeFinanceKpis()`'s definition, not a new one | `report_payment_facts` + `report_booking_facts` |
| Average Group Readiness | `avg(readiness_score)` of live groups + *"N groups at risk"* (`< AT_RISK_READINESS_BELOW`) | `report_group_facts` |
| Projected Gross Margin | **Rendered only with `viewCostAndMargin`**, and labelled with its cost basis (D3) | `report_booking_facts` + `report_supplier_facts` |

The spec's `Target: 90%` and `Below 20% target` need targets that exist nowhere in the schema.
`REPORTS_COPY.COLLECTION_RATE_TARGET` / `MARGIN_TARGET` hold them as **configurable constants**
with a comment saying an agency-settings table should own them later — the same answer
`FINANCE_COPY.COLLECTION_TARGET_SOURCE` already gives.

**Revenue and collections trend** — `ChartContainer` + `AreaChart`, monthly/weekly toggle
(`ButtonGroup`), four series: booked value, cash collected, outstanding receivables, supplier
payables. Bucketing happens in `reports-period.ts`; supplier payables render **per currency or not
at all** for roles without cost access (F7/D3). Colours are `var(--primary)` and `var(--accent)`
with opacity variation — the existing chart vocabulary, no new palette.

**Group health summary** — `DataTable` over `report_group_facts`: group, readiness `ProgressBar`,
booked/capacity, revenue, risk `ToneBadge`. Row click → `/departure-groups/{id}`, using
`DataTable`'s `onRowClick`.

### 4.2 Sales & Leads tab

- **Lead funnel** — seven ordered stages from `FUNNEL_STAGE_ORDER`, each showing count,
  stage-to-stage conversion %, average time in stage, and a `ComparisonDelta`. Rendered as a
  horizontal `BarChart` plus a stage table (not a bespoke funnel SVG — no new component).
  A window starting before `FUNNEL_HISTORY_BACKFILLED_AT` shows a footnote (F3).
- **Lead source performance** — leads, bookings, conversion %, revenue, per source. Sortable.
- **Sales team performance** — leads, contact rate (`first_response_at` present / total), bookings,
  booking value, per `assigned_to_name`. Carries the free-text-owner caveat (F4).
- **Lost-lead analysis** — count per `lost_reason`, ordered desc, with share-of-total and a
  `ComparisonDelta`. Ten reasons, all check-constrained, so this is a pure group-by.

Branch chip disabled with a reason on all four (F4).

### 4.3 Finance tab

- **Collections report** — expected / collected / outstanding / overdue / collection-rate summary
  cards, then a breakdown table whose grouping dimension is a `FilterSelect`: departure group,
  package, sales owner, payment milestone, branch, payment method. One report, six slices — the
  spec's six bullets without six reports.
- **Receivables aging** — four buckets from `report_milestone_aging`, **milestone-level** (F14 /
  finance F4). Point-in-time; the Period chip is overridden to *"as of now"* with a visible notice.
- **Package profitability** — revenue, estimated cost, margin, per package. `viewCostAndMargin`
  only. Cost basis is labelled on the report per D3.
- **Supplier payable report** — supplier, service, due, amount, status, **grouped by currency**
  with no cross-currency total (F7).
- **Refunds and adjustments** — counts and amounts from `refund_requests` and
  `finance_adjustments`: requested, approved, pending, cancellation fees retained, discounts
  granted, price adjustments. Six summary cards + a detail table.

### 4.4 Departure Groups tab

- **Departure readiness** — the per-category matrix (Docs, Visa, Pay, Flight, Hotel, Transport,
  Guide, Overall) using `buildReadinessMatrixRows()` from `operations.ts` **unchanged**, plus
  blocker count, days to departure, key-blocker owner, and a trend `ToneBadge` from
  `group_readiness_snapshots` (F8/D4).
- **Capacity and occupancy** — capacity, booked, held, waitlist **seats** (F9), available.
- **Group profitability** — expected revenue, collected, supplier cost, margin.
  `viewCostAndMargin` only.
- **Departure performance** — post-return, for `group_status in ('COMPLETED','CLOSED')`. Ships with
  the seven fields that have data; the feedback-score column is **omitted, not faked** (F10/D5).

### 4.5 Pilgrims & Compliance tab

All four group-by `report_pilgrim_compliance_facts`:

- **Document completion** — required / verified / missing / rework / expiring, per group.
- **Visa status** — the six-state count per group (`Not Started · Ready to Submit · Submitted ·
  Issued · Rework · Rejected`), mapped from `visa_status` via `visa-copy.ts`'s existing labels.
- **Passport validity risk** — pilgrim, group, expiry, days remaining, required threshold
  (`PASSPORT_MIN_MONTHS`), status. Sorted most-urgent first.
- **Pilgrim readiness** — per-pilgrim documents / visa / payments / room / flight / overall. The
  spec flags this as Operations/Visa, not CEO: it is registry-gated to those roles.

### 4.6 Suppliers & Operations tab

- **Supplier confirmation performance** — active commitments, confirmed on time, pending, late,
  issues, per supplier. `confirmed_on_time` per the F11 convention, stated on the report.
- **Service commitment report** — group, supplier, service, reference, due date, status, owner.
- **Guide and staff workload** — assigned groups, open / overdue / completed tasks, per owner name
  (F4 caveat applies).
- **Operational task completion** — the category × status matrix over `report_task_facts`.

### 4.7 Custom report builder

A right-side `Sheet`, deliberately constrained — **not a drag-and-drop BI tool**, per the spec:

```text
Report type:  [ Sales ] [ Finance ] [ Departure Groups ] [ Pilgrims ] [ Suppliers ]   ButtonGroup
Metrics:      ☑ Bookings  ☑ Revenue  ☐ Collection rate  ☐ Visa issued
              ☐ Group readiness  ☐ Supplier payment amount                            Checkbox
Group by:     Month · Package · Departure Group · Branch · Sales Owner · Source        Combobox
Filters:      inherits the six global chips, editable here
Format:       Table · Bar chart · Line chart · Summary cards                           ButtonGroup
                                                        [ Generate Report ]
```

Every axis is a **closed union** validated by `customReportSchema`. The report type selects which
fact view is queried; metrics and group-by become a validated aggregate over rows the repository
already knows how to filter. There is no free-text field anywhere, so there is no query-injection
surface and no unbounded scan. Results render through the same `report-shell.tsx` and export
through the same CSV/XLSX mapping. `[Save this report]` in the footer writes `saved_reports` with
`report_id = 'custom'` and the definition in `definition`.

Metric × group-by combinations that cannot be computed (e.g. *Visa issued* by *Source*) are
disabled in the UI with a reason, not silently zeroed.

### 4.8 Saved reports and scheduling

Saved tab: cards with name, creator, schedule summary, `[Open] [Edit] [Schedule]`. Open =
`router.push` with the stored filters. `visibility = 'SHARED'` reports appear for everyone whose
role may open the underlying report; `PRIVATE` only for the creator.

`schedule-report-dialog.tsx` collects frequency, delivery channels, recipients and format, saves
the definition, and **states in the dialog that delivery is not yet active** (F12). Nothing is
scheduled, nothing is emailed, and the UI does not claim otherwise.

### 4.9 Export center

`Sheet` from the header: pick report(s), scope (current filters / all data the role may see), and
format. Defaults per the spec's role guidance:

| Role | Default format | Mechanism |
|---|---|---|
| CEO | PDF summary, Excel | print stylesheet / `xlsx.ts` |
| Finance | Excel, CSV | `xlsx.ts` / `lib/csv.ts` |
| Operations | Excel, CSV (manifests, checklists) | existing |
| Guide | PDF run sheets only | print stylesheet |
| Marketing | CSV (lead source, conversion) | `lib/csv.ts` |

CSV uses `toCsv` + `downloadTextFile` + `timestampedFilename` — the UTF-8 BOM already there for
Sinhala and Tamil names. Excel uses the existing dependency-free writer. PDF is `window.print()`
against a print stylesheet on `report-shell.tsx` (D6) — the guide run sheet's precedent, no new
dependency.

---

## 5. Phases

Each phase is independently shippable and leaves the app in a working state.

| # | Phase | Contents |
|---|---|---|
| **1** | **Skeleton** | `page.tsx` + `loading.tsx` + `reports-access.ts` + `reports-store.tsx` + `reports-workspace.tsx` with seven empty capability-filtered tabs. **Fixes the dead nav link.** No queries |
| **2** | **Period + filters** | `reports-period.ts`, `reports.ts` delta helpers, `report-filter-bar.tsx`, `comparison-delta.tsx`, URL round-tripping. The F5 answer, testable with no data |
| **3** | **Migration: views** | `20260819090000_reports.sql` §3.2 C only — the nine aggregate views. Nothing reads them yet |
| **4** | **Overview** | Repository + executive summary + revenue trend + group health. **The first real cross-module aggregate in the app** (F2) |
| **5** | **Finance + Groups** | Collections, aging, payables, refunds, readiness, capacity. Six of the eight V1 reports done. Margin reports deferred to phase 8 |
| **6** | **Pilgrims + Suppliers** | Compliance, visa, passport, pilgrim readiness, supplier confirmation, commitments, workload, tasks. **All eight V1 reports done** |
| **7** | **Migration: history** | `lead_stage_events` + backfill + the `leads.ts` mutator change (F3); `group_readiness_snapshots` + the group-detail upsert (F8). Funnel conversion, time-in-stage and readiness trend light up |
| **8** | **Cost & margin** | Package/group profitability behind `viewCostAndMargin`, with the D3 cost basis fixed and labelled |
| **9** | **Export** | `csv.ts` mappings for every report, `xlsx.ts` re-export, print stylesheet, export center sheet |
| **10** | **Saved + custom + schedule** | `saved_reports` / `report_schedules` tables, saved tab, custom builder, schedule dialog (definition only) |

Phases 1–6 deliver the spec's eight V1 reports. 7–10 are the depth the spec explicitly defers.

---

## 6. Decisions

**D1 — Filter state lives in the URL, not React state.**
Departs from `finance-workspace.tsx` deliberately. A report is defined by its filters; a saved
report, an export filename, a shared link and a dashboard drill-down are all just that filter set.
Local state would make every one of those a separate mechanism.

**D2 — "Previous period" means the immediately preceding window of equal length.**
`This Month` on the 13th compares **1–13 this month vs 1–13 last month**, not a partial month
against a full one — otherwise every month looks catastrophic until the 28th. `Same Period Last
Year` is offered as an alternative comparison mode for seasonal journeys (Ramadan Umrah against
Ramadan Umrah), which matters more here than in most businesses. Both are implemented in
`reports-period.ts` and nowhere else.

**D3 — Margin is reported against a stated cost basis, and never as a single cross-currency
number.** (F6/F7)
V1 computes **two** costs and labels which is shown:
- *Estimated* — `packages.finance_estimate` × travellers. Available for every group. Marked
  **"template estimate — not frozen at group creation"**.
- *Actual* — `sum(supplier_commitments.amount)`, per currency. Available only where commitments
  exist, and only comparable to LKR revenue for LKR commitments.

The executive tile shows *estimated* margin with that label; the profitability reports show both
columns. **The correct long-term fix is a `finance_estimate_snapshot` on
`departure_group_package_snapshots` plus an FX table** — both are called out as follow-ups in
`REPORTS_COPY` and neither is in this module's scope, because both change how *other* modules
write.

**D4 — Readiness trend uses an on-read daily snapshot, not a cron and not event replay.** (F8)
There is no job runner (F12). An idempotent `on conflict do update` upsert on the first page view
of the day costs one statement and needs no infrastructure. A group whose detail page is never
opened still gets snapshotted, because `/reports` upserts every live group. Trend shows *"no
baseline yet"* until a week of snapshots exists — honest, and self-healing.

**D5 — Ship the departure-performance report without the feedback score.** (F10)
Seven of its nine fields have data. Adding a feedback model — survey, channel, response storage,
scoring — is a product decision and a schema of its own, not a column on a report. The report notes
the absence rather than showing a zero.

**D6 — PDF is a print stylesheet; Excel is the existing writer; neither adds a dependency.**
`report-shell.tsx` gets `@media print` rules (hide chrome, expand tables, force light colours) and
`window.print()` — the guide run sheet already establishes this. If a real PDF renderer is ever
needed it is a separate decision with a bundle cost, and it is not needed to answer "the CEO wants
a PDF summary".

**D7 — Schedules are stored, not executed, and the UI says so.** (F12)
`report_schedules.active` defaults false. When a job runner exists, the reader is a `next_run_at`
query against this table and nothing about the definitions changes. Claiming a schedule runs when
nothing does is the one outcome worse than not building it.

**D8 — Guide gets no new reports; the registry points at what already exists.**
The spec gives Guide *"only assigned-group run sheets and pilgrim contact/rooming reports"* — all
three already ship on the group detail's Guide & Operations tab, including the print flow. The
Guide's Reports page lists those groups and links there. Building a second run sheet would create
two sources of truth for the document a guide carries onto a plane.

**D9 — Reports never mutates operational data, and the code enforces it.**
`reports-repository.ts` exposes exactly five writers, all against `saved_reports` /
`report_schedules` / `group_readiness_snapshots`. A file-header comment states the rule; a reviewer
seeing any other table name in a write there knows something is wrong. This is what makes the
module safe to give a CEO.

**D10 — One registry, not twenty-five pages.** (§3.5)
Every consumer of "what reports exist" reads `REPORT_REGISTRY`. Without it, role gating, tab
contents, export formats and saved-report rehydration each grow their own switch statement, and
report #26 touches five files.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Aggregate queries get slow as data grows.** Nine views, each scanned twice (period + comparison), on every filter change | All aggregation is SQL-side (F15); filters are indexed columns; `page.tsx` is `force-dynamic` with a `loading.tsx`; per-view row caps for detail tables with an explicit *"showing first N"* notice. If a view becomes hot, it converts to a materialized view refreshed by the same on-read upsert as D4 — no application change |
| 2 | **The funnel backfill mis-parses old activity messages** (F3) | Backfill pass 3 always reconciles the terminal state from `leads.stage`, so the *current* funnel is exact regardless; only historical timings can be approximate, and the report footnotes the cutover date |
| 3 | **Reports and a module page show different numbers**, destroying trust in both | Reports calls the module's own derivation functions (`computeFinanceKpis`, `buildReadinessMatrixRows`) rather than restating them; every view carries a `comment on view` naming the TypeScript function it must match, the lockstep convention `departure_group_payment_summaries` already established |
| 4 | **Cancelled bookings inflate counts and denominators** (F14) | Every fact view filters `booking_status <> 'CANCELLED'` at the source, with the finding referenced in a comment. Fixing the underlying `finance_receivable_rows` view is proposed to the Finance module rather than done here |
| 5 | **Margin numbers are quoted externally, then found to be estimates** (F6/D3) | The label ships with the number — on the tile, in the table header, and in the CSV/Excel header row. An exported file that loses the caveat is the real hazard, so the caveat is a data row, not a tooltip |
| 6 | **Free-text owner names split one person across two rows** (F4) | Owner group-bys normalise case and whitespace and surface a *"N unmatched owner names"* notice rather than silently merging or splitting. A staff table remains the real fix, shared with every other module |
| 7 | **Role gating leaks cost data through an export** | Stripping happens in the repository, before rows reach the client (§3.4); the export builds from the same stripped rows, so there is no path where a client-side hide is the only protection |
| 8 | **Scope creep into a BI product** | The registry's `v1` flag and the closed unions in `customReportSchema` are the guardrail. Anything needing a new metric axis is a registry + validation change, reviewed as such |
