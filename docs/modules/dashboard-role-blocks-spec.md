# Spec: Dashboard — role-driven block system (v2)

Status: **DRAFT — awaiting review.** No code until approved.
Supersedes the *status* of [dashboard-module-implementation-plan.md](dashboard-module-implementation-plan.md)
(that doc says "nothing implemented"; Phases 0–4 largely are — see §1). Its principles
(assembler-not-deriver, every tile is a door, no fabricated numbers) stay in force and are not repeated.

---

## 0. Assumptions I'm making — correct me now

1. **The dashboard already exists** (`app/(main)/dashboard`, 20 components, layout registry, role-gated repository). This spec is therefore *a v2 that closes the gaps against the rest of the system*, not a greenfield build.
2. The unit of decision is **"which blocks, in what order, for whom"**, expressed as data in `lib/data/dashboard-layout.ts` — not a second access system.
3. Block *visibility* is decided by **capabilities (incl. custom-role overrides)**, never by role name. Role only picks the *preset order* and KPI set.
4. Seven built-in roles (`ADMIN, CEO, FINANCE, MARKETING, OPERATIONS, VISA, GUIDE`) plus **custom roles** that inherit a base role and carry `role_permissions` overrides.
5. No new migration unless a block below says otherwise; no new dependency.
6. Dashboard = "what needs me now". Reports = "what happened". Module page = "act on rows". (Unchanged boundary.)

---

## 1. Objective

Give every signed-in person a landing page that answers **"what do I do first?"** using only blocks their permissions allow, drawn from *every* operational module in the system — not just Operations/Finance/Leads.

**Who:** the 7 staff roles + custom roles. (Pilgrim portal, agent portal and `/platform` are separate surfaces and out of scope.)

**What exists today (verified in code):**

| Area | State |
|---|---|
| Registry | `DASHBOARD_LAYOUTS: Record<StaffRole, DashboardPanelId[]>`, 11 panel ids |
| Always-on blocks | Setup guide, AI briefing, KPI row, Inbox intelligence — **outside** the registry |
| Gating | `capabilitiesFor{Finance,Leads,Operations,Reports}(role)` — **code-level only** |
| Tests | **None** for dashboard code |
| Plan doc | Stale ("nothing implemented") |

**Gaps this spec closes** (each is a Success Criterion in §9):

| # | Gap | Evidence | Severity |
|---|---|---|---|
| G1 | **Custom-role overrides are ignored.** Repository calls `capabilitiesFor*(role)` directly; a custom role restricted from Finance still gets Finance panels if its base role has them. | `dashboard-repository.ts:525-528` vs. the rule at `departure-groups.ts:558-561` | **High — access leak** |
| G2 | **KPI row is not role-selected.** Every role gets every non-null tile; no cap of 6. | `buildKpis()` has no role input | Medium |
| G3 | **Blocks outside the registry.** Inbox panel, AI briefing, setup guide can't be ordered/hidden per role. Inbox panel is hard-coded to ADMIN/CEO. | `page.tsx` bottom; `loadInboxOwnerIntelligence` | Medium |
| G4 | **Whole modules have no dashboard presence:** Visa, Documents, Suppliers/payables, Quotes, Campaigns, Feedback/complaints, Inbox SLA. VISA role's page is generic ops. | Nav in `app-sidebar.tsx`; layouts above | High for VISA/MARKETING/FINANCE |
| G5 | **Recent Activity is Operations-only** and every row is typed `"operations"`. | `dashboard-repository.ts` activity map | Low |
| G6 | **No per-block isolation.** One loader failure / slow query blanks or blocks the page. | `page.tsx` single `await`; plan §9 | Medium |
| G7 | **No zero-visible-blocks state** for a role/custom role that ends up with nothing. | — | Low |

---

## 2. Role × block matrix

`H` = hero (first row of L2), `●` = shown, `s` = shown as summary/filtered, `–` = absent (not fetched).
Visibility still requires the **gate** in §3; the matrix is the *preset*, not permission.

| Block | ADMIN | CEO | FINANCE | MARKETING | OPERATIONS | VISA | GUIDE |
|---|---|---|---|---|---|---|---|
| status-line | ● | ● | ● | ● | ● | ● | ● |
| ai-briefing | ● | ● | ● | ● | ● | ● | – |
| kpis (≤6, §4) | ● | ● | ● | ● | ● | ● | ● |
| my-day | H | – | H | H | H | H | H |
| attention-rail | ● | s | s (finance rows) | s (lead rows) | ● | s (visa+doc rows) | – |
| approvals (agent) | ● | – | – | – | ● | – | – |
| upcoming-departures | ● | ● | ● (payment readiness) | – | ● | ● | **H** (assigned only) |
| seat-fill-pace | ● | ● | – | ● | ● | – | – |
| readiness-heatmap | ● | – | – | – | ● | – | – |
| revenue-trend (+aging) | ● | **H** | ● | – | – | – | – |
| collections | ● | – | **H** | – | – | – | – |
| pipeline | ● | ● | – | **H** | – | – | – |
| team-performance | ● | ● | – | ● | – | – | – |
| inbox-owner (existing) | ● | ● | – | – | – | – | – |
| recent-activity | ● | – | – | – | ● | ● | ● |
| **visa-queue** *(new)* | – | – | – | – | s | **H** | – |
| **document-review** *(new)* | – | – | – | – | ● | ● | – |
| **supplier-payables** *(new)* | ● | s | ● | – | – | – | – |
| **quotes-pending** *(new)* | ● | s | s | ● | – | – | – |
| **campaign-pulse** *(new)* | ● | – | – | ● | – | – | – |
| **inbox-sla** *(new)* | ● | – | – | ● | ● | – | – |
| **guest-voice** *(new)* | – | ● | – | – | ● | – | – |

**Design rules behind the matrix** (these make future blocks decidable without a meeting):

1. **Specialist blocks go to specialists; generalists get the rail.** ADMIN/CEO do not get `visa-queue` / `document-review` — their `attention-rail` already rolls those up with a link. Otherwise ADMIN's page is 20 blocks.
2. **Max 8 L2/L3 blocks per role.** Past that, a block must displace another.
3. **Money blocks require money capability.** CEO gets read-only summaries; approve actions stay with ADMIN.
4. **GUIDE sees nothing agency-wide**: no finance, leads, team, approvals, or global attention counts. Assigned groups only (`staff_group_assignments`).
5. **Hero = the role's job.** FINANCE→collections, VISA→visa-queue, MARKETING→pipeline, CEO→revenue-trend, GUIDE→upcoming-departures, OPERATIONS/ADMIN→my-day + attention.

---

## 3. Block catalog

`New` = needs a new component + view model. `Reuse` = existing. Every block names its gate and its **owning derivation** (the dashboard never re-defines a metric).

### 3.1 Existing blocks (reuse; changes in §5)

| id | Gate (capability) | Source |
|---|---|---|
| status-line | none (content self-filters) | `buildStatusLine` |
| my-day | `staffId != null`; Unassigned tab ADMIN/CEO | `loadTasksForStaff`, `loadUnassignedTaskCount` |
| attention-rail | per-row: ops/leads/finance caps | `buildAttentionCandidates` + `rankAttentionRows` |
| approvals | `operations.viewModule` + agency | `listAgencyOpenProposals` |
| upcoming-departures | `departure_groups.viewModule` (+ GUIDE scope) | `buildOperationsSnapshot` |
| seat-fill-pace | same as departures | `buildSeatPacePoints` |
| readiness-heatmap | same as departures | snapshot groups |
| revenue-trend | `reports.viewFinance` | `buildRevenueTrend`, `buildReceivablesAging` |
| collections | `finance.viewLedger` | `loadFinanceReceivables` |
| pipeline | `reports.viewSales` | `buildLeadFunnel`, `buildLeadSourcePerformance` |
| team-performance | `reports.viewSales` ∧ role ∈ ADMIN/CEO/MARKETING | `buildSalesTeamPerformance` |
| inbox-owner | `inbox` entitlement ownerPanel ≠ NONE ∧ ADMIN/CEO | `loadInboxOwnerIntelligence` |
| recent-activity | `staffId != null` | snapshot activity → merged feed (G5) |

### 3.2 New blocks

| id | Shows (top ≤6 rows, verb + destination) | Gate | Source (existing — confirm in plan) | Dest. |
|---|---|---|---|---|
| **visa-queue** | Applications by stage (not submitted / submitted / awaiting embassy / approved / rejected), soonest departure first; "Submit 12 →" | `visa.viewModule` | `loadVisaQueue` + `toVisaListItems` (`lib/data/visa*.ts`) | `/visa?status=` |
| **document-review** | Docs awaiting review, rejected, passports expiring <6 mo before departure | `documents.viewModule` | `loadDocumentQueue` (`documents-repository.ts`) | `/documents?status=` |
| **supplier-payables** | Supplier payments due ≤14d, unconfirmed commitments on groups ≤30d | `suppliers.viewPayments` (CEO: `viewModule`, totals only) | `suppliers-repository` commitments | `/suppliers`, `/finance/payables` |
| **quotes-pending** | Quotes sent & unanswered, expiring ≤3d, drafts unsent | `leads.viewQuotes` | quotes loaders (`quote-transitions`) | `/quotes?status=` |
| **campaign-pulse** | Active/scheduled campaigns, last send result, audience size | `leads.viewModule` | `campaigns-repository` | `/campaigns` |
| **inbox-sla** | My open conversations, SLA breaches, unassigned count | `inbox.viewModule` (own scope; ADMIN agency-wide) | `inbox-sla-repository`, `inbox-queue-repository` | `/inbox` |
| **guest-voice** | Open complaints, lowest recent survey scores | relationships/feedback cap (confirm key) | `feedback-repository` | `/relationships/feedback-complaints` |

Sources are **named, not verified end-to-end**: Plan phase must confirm each loader returns what the row needs without a new view. Any block whose loader doesn't exist is **dropped from this version, not stubbed** (inherited rule).

### 3.3 Explicitly not dashboard blocks

Flights / Hotels & rooming / Transport / Itinerary (their risks already feed `attention-rail` via the snapshot); Loyalty, Announcements, Referrals, Packages, Pilgrims, Settings, Team admin, Platform. Reason: no "needs me today" signal that isn't already in the rail, or purely configuration.

---

## 4. KPI tiles per role (cap 6, selected not accumulated)

| Role | Tiles (ordered) |
|---|---|
| ADMIN | New Inquiries · Active Pilgrims · Departing 30d · Collections · Outstanding · Group Readiness |
| CEO | Revenue · Collections · Outstanding · Gross Margin¹ · Group Readiness · New Inquiries |
| FINANCE | Collections · Outstanding · Overdue · Refunds pending · Supplier payments due · Departing 30d |
| MARKETING | New Inquiries · Open quotes · Quote→booking rate · Active Pilgrims · Departing 30d · Avg seat fill |
| OPERATIONS | Groups at risk · Group Readiness · Departing 30d · Open tasks · Supplier confirmations pending · Active Pilgrims |
| VISA | Visa pending · Docs awaiting review · Departing 30d (pilgrims) · My open tasks |
| GUIDE | My open tasks · My groups · Departing 30d |

¹ `null` margin renders `—` (inherited rule). A tile whose gate fails is **dropped and the next tile in the list fills the slot** — never rendered `0`.

---

## 5. Required changes to existing code

| Id | Change | Closes |
|---|---|---|
| C1 | `loadDashboardData` takes a resolved **capabilities bundle** (`getCurrentDashboardCapabilities()`, React-`cache`d, merges `loadDynamicCapabilities` over `capabilitiesFor*` for finance/leads/operations/reports/visa/documents/suppliers/inbox) instead of `role` | G1 |
| C2 | `DashboardPanelId` gains the 7 new ids + `inbox-owner`, `ai-briefing`, `kpis`, `status-line`; `page.tsx` renders **only** from the registry | G3 |
| C3 | `DASHBOARD_LAYOUTS` preset order per §2; **custom role** = base-role preset, then pruned by capabilities | G1, G3 |
| C4 | `buildKpis(input, role)` selects from §4 with cap 6 | G2 |
| C5 | Fetch plan: a loader runs only if a block in the resolved layout needs it AND its gate passes | perf |
| C6 | Each block wrapped in its own `<Suspense>` + error boundary (reuse `route-loading-skeleton` / `route-error-boundary`) | G6 |
| C7 | Recent Activity → `loadMergedActivityFeed`, real `type` per row | G5 |
| C8 | Zero-visible-blocks empty state with the role name and "ask an admin" copy | G7 |
| C9 | Mark `dashboard-module-implementation-plan.md` status = "Implemented through Phase 4; superseded by this spec for role matrix" | docs |

---

## 6. Tech stack, commands, structure

**Stack (from `package.json`):** Next.js 16.4 (App Router, Server Components), React 19.2, TypeScript, Supabase (`@supabase/ssr`), Recharts 3, Tailwind 4 + `@base-ui/react` + shadcn primitives, Vitest, Playwright.

```bash
npm run dev:http        # local dev without the https cert
npm run typecheck       # next typegen && tsc --noEmit
npm run lint            # eslint
npm test                # vitest run
npm run test:e2e        # playwright
npm run build           # next build
```

```text
app/(main)/dashboard/page.tsx            registry-driven renderer (Server Component)
app/(main)/dashboard/components/         one file per block
lib/data/dashboard-layout.ts             role → ordered block ids (pure, client-safe)
lib/data/dashboard-repository.ts         server-only assembler, capability-gated
lib/data/dashboard.ts                    pure derivations (ranking, status line, KPI selection)
lib/access/dashboard-access.ts           NEW: capability bundle + per-block gate table
lib/types/dashboard.ts                   view models
lib/data/dashboard-*.test.ts             co-located unit tests
e2e/dashboard-roles.spec.ts              NEW
```

## 7. Code style

Match the existing registry idiom — layout is data, gate is a separate pure function, no role-name checks inside components:

```ts
// lib/access/dashboard-access.ts
export const BLOCK_GATES: Record<DashboardPanelId, (c: DashboardCapabilities) => boolean> = {
  "visa-queue": (c) => c.visa.viewModule,
  "supplier-payables": (c) => c.suppliers.viewPayments,
  "quotes-pending": (c) => c.leads.viewModule && c.leads.viewQuotes,
  // …
};

export function visibleBlocks(preset: DashboardPanelId[], caps: DashboardCapabilities): DashboardPanelId[] {
  return preset.filter((id) => BLOCK_GATES[id](caps));
}
```

Conventions: server-only repositories; `nowIso` injected (one clock); `null` = absent, `0` = real zero; money via existing `formatCurrencyLKR`; tones only via `lib/ui/tone.ts`.

---

## 8. Testing strategy

| Level | Where | What |
|---|---|---|
| Unit | `lib/data/dashboard-layout.test.ts` | every role resolves a non-empty preset; no preset > 8 blocks; ids unique; GUIDE preset contains no finance/leads/team blocks |
| Unit | `lib/access/dashboard-access.test.ts` | gate table is **total** over `DashboardPanelId`; custom-role override removing `finance.viewLedger` removes `collections`, `revenue-trend`, finance KPIs (G1 regression) |
| Unit | `lib/data/dashboard.test.ts` | KPI selection cap 6, null-gate fills next tile; ranking: critical@T-5 outranks critical@T-90 |
| Unit | repository | skipped loaders **not called** (assert via mocks); GUIDE totals count assigned groups only |
| Unit | grep test | no hard-coded data arrays under `app/(main)/dashboard/` (inherited from plan §10.1) |
| E2E | `e2e/dashboard-roles.spec.ts` | one login per role: expected blocks present, forbidden blocks absent from DOM **and** RSC payload |
| Perf | manual + `withTiming` | server render p95 on seeded 20-group/500-pilgrim agency — budget set in plan phase from a measured baseline |

---

## 9. Boundaries

- **Always:** gate server-side before fetching; link every row to the owning module pre-filtered; add a test with every new block; reuse the owning module's derivation; handle empty/denied/error/loading.
- **Ask first:** any new migration or DB view; new dependency; adding a block to a role not in §2; changing a capability definition in `lib/access/*`; adding a dashboard-side mutation beyond one-click (complete task, send reminder, approve/reject proposal).
- **Never:** compute a metric the owning module already defines; render a number without a real source; grey-out a denied block as a teaser; show agency-wide totals to GUIDE; read `role` name inside a component to decide visibility; add export / custom date range (that is Reports).

---

## 10. Success criteria

1. **G1:** a custom role with `finance.viewLedger = false` on an ADMIN base renders no collections/revenue/finance KPI **and** the RSC payload contains no receivable rows. (test)
2. **G2:** no role renders > 6 KPI tiles; each role's tiles match §4. (test)
3. **G3:** every visible block is produced from `visibleBlocks()`; `page.tsx` contains no hard-coded block outside the registry. (grep + test)
4. **G4:** VISA lands on `visa-queue` as hero; MARKETING sees `quotes-pending` + `campaign-pulse`; FINANCE sees `supplier-payables`. (e2e)
5. GUIDE page: status line, my-day, assigned departures, recent activity only; all counts equal assigned-group scope. (test)
6. **G6:** forcing one loader to throw yields one error card; the rest render. (test)
7. Typecheck, lint, vitest, playwright all green; no new `any`.
8. Each block's figure equals the owning module's figure for the same window (spot-checked for revenue, overdue, visa pending).

---

## 11. Open questions (need your call)

1. **Is this a v2 on top of what exists, or do you want the dashboard rebuilt from scratch?** I assumed v2 because ~80% of the plan is already in code. If you want a rebuild, say so and §5 becomes a full component list.
2. **CEO and My Day** — omitted on the assumption executives don't work a task queue. Keep omitted?
3. **VISA, DOCUMENTS and OPERATIONS overlap** (document-review appears for both). OK, or should OPERATIONS only get the rail version?
4. **Custom roles:** preset = base role's layout, pruned by capabilities (my default). Alternative: store a per-role block list in `role_permissions` so admins can curate (needs migration + settings UI). Out of scope here unless you want it.
5. **`guest-voice` capability key** — I couldn't confirm which access module gates feedback/complaints (`relationships-access.ts` is a placeholder "view only for all roles"). Ship it, or defer until that module has a real capability set?
6. **Scope cut** — if this is too wide for one release, my order is: C1 (access leak) → C2/C3/C4 (registry + KPIs) → `visa-queue` → `supplier-payables` → `quotes-pending`/`campaign-pulse` → `inbox-sla` → `guest-voice`.
