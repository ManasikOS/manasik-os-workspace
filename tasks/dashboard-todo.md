# Task list: Dashboard — role-driven block system (v2)

Plan: [`tasks/dashboard-plan.md`](./dashboard-plan.md) · Spec: `docs/modules/dashboard-role-blocks-spec.md`
Sizes: XS 1 file · S 1–2 · M 3–5. One task = one PR.
Standing verification for every code task: `npm run lint`, `npm run typecheck`, `npm test`, plus `npm run build` at checkpoints.
Standing rules (spec §9): gate before fetch · `null` = absent, `0` = real zero · reuse the owning module's derivation · no hard-coded data.

---

## Phase 1 — Access fix + spine

### [x] T1: Dashboard capability bundle + pure gate table
**Description:** Create the single resolver the page uses for permissions, merging custom-role overrides over code-level capabilities, and
the pure `BLOCK_GATES` / `visibleBlocks` functions. No page or repository changes yet.
**Acceptance:**
- [ ] `getCurrentDashboardCapabilities()` returns `{ finance, leads, operations, reports, visa, documents, suppliers, inbox, quotes }`, each = `loadDynamicCapabilities(...)` over the matching `capabilitiesFor*(role)`; no `roleId` → pure fallback.
- [ ] A DB read error denies that module's booleans (inherits `loadDynamicCapabilities` behaviour) — asserted.
- [ ] `BLOCK_GATES` has an entry for **every** `DashboardPanelId` (type-enforced via `Record`); `visibleBlocks(preset, caps)` filters by it.
**Verification:** `npx vitest run lib/access/dashboard-access.test.ts` — includes "custom role with `finance.viewLedger=false` loses `collections` + `revenue-trend`".
**Dependencies:** None
**Files:** `lib/access/dashboard-access.ts` (new), `lib/access/dashboard-access.test.ts` (new), `lib/data/dashboard-layout.ts` (ids only, if T3 types not yet merged)
**Scope:** S

### [x] T2: Route repository and page through the capability bundle  ← closes G1
**Description:** Replace the four direct `capabilitiesFor*(role)` calls in `loadDashboardData` (and `loadInboxOwnerIntelligence`'s
role check) with the bundle from T1, so custom-role restrictions are honoured everywhere the dashboard fetches or renders.
**Acceptance:**
- [ ] `loadDashboardData` signature takes the bundle (or resolves it internally); no `capabilitiesFor*` call remains in `dashboard-repository.ts`.
- [ ] Custom role on ADMIN base with finance ledger off → `collections`, `businessHealth`, finance KPIs and the refunds attention row are `null`/absent; loaders not invoked.
- [ ] Built-in roles' output unchanged (snapshot test of existing role → data shape).
**Verification:** `npx vitest run lib/data/dashboard` ; manual: log in as a seeded custom role, confirm Finance panels absent in page *and* RSC payload (Network tab).
**Dependencies:** T1
**Files:** `lib/data/dashboard-repository.ts`, `app/(main)/dashboard/page.tsx`, `lib/data/dashboard-repository.test.ts` (new)
**Scope:** M

### [x] T3: Registry owns every block; presets per spec §2 (existing blocks only)
**Description:** Add `status-line`, `ai-briefing`, `kpis`, `inbox-owner` to `DashboardPanelId`; make `page.tsx` render *only* from
`visibleBlocks(resolveDashboardLayout(role), caps)`; rewrite `DASHBOARD_LAYOUTS` to the §2 matrix for existing blocks. Setup guide stays a
fixed onboarding banner (not a role block) — documented in the file.
**Acceptance:**
- [ ] `page.tsx` has no block rendered outside the registry loop (except header + setup guide).
- [ ] Each role preset ≤ 8 L2/L3 blocks, ids unique, GUIDE preset has no finance/leads/team ids.
- [ ] Inbox-owner block ordering is registry-driven; its ADMIN/CEO-only check moves into its gate.
- [ ] Unknown/custom role resolves to its **base role** preset, then pruned by caps.
**Verification:** `npx vitest run lib/data/dashboard-layout.test.ts lib/access/dashboard-access.test.ts`; manual visual check of ADMIN, FINANCE, GUIDE pages (Browser pane, `npm run dev:http`).
**Dependencies:** T1
**Files:** `lib/data/dashboard-layout.ts`, `lib/access/dashboard-access.ts`, `app/(main)/dashboard/page.tsx`, `lib/data/dashboard-layout.test.ts` (new)
**Scope:** M

### [x] T4: Demand-driven fetch plan
**Description:** `loadDashboardData` receives the visible block list and runs each loader only if a visible block (or KPI/status line
input) needs it; skipped loaders resolve `null`.
**Acceptance:**
- [ ] GUIDE render calls no finance, leads, reports or proposals loader (asserted with mocks).
- [ ] FINANCE render does not call `loadReportsSalesSnapshot` or the proposals loader.
- [ ] Status line still correct when its optional inputs are skipped (no `NaN`, no false "All clear" caused by a skipped loader — gate-denied input is *unknown*, not zero).
**Verification:** `npx vitest run lib/data/dashboard-repository.test.ts`
**Dependencies:** T2, T3
**Files:** `lib/data/dashboard-repository.ts`, `lib/data/dashboard.ts`, `lib/data/dashboard-repository.test.ts`
**Scope:** M

### Checkpoint A
- [ ] lint · typecheck · test · build green
- [ ] G1 regression test present and passing
- [ ] ADMIN/FINANCE/GUIDE pages visually unchanged except the intended preset diffs (list diffs in PR)
- [ ] **Review with human before Phase 2**

---

## Phase 2 — KPIs, resilience, polish

### [x] T5a: Role-selected KPI row, cap 6
**Description:** `buildKpis` takes the role's ordered tile list (spec §4) and returns at most 6; a tile whose gate fails is dropped and the
next fills the slot.
**Acceptance:**
- [ ] KPI id lists per role live in `dashboard-layout.ts` data, not in `buildKpis`.
- [ ] No role renders > 6 tiles; tiles absent when gate fails; margin `null` → `—`.
**Verification:** `npx vitest run lib/data/dashboard.test.ts`
**Dependencies:** T3
**Files:** `lib/data/dashboard-repository.ts` (or extract `buildKpis` → `lib/data/dashboard.ts`), `lib/data/dashboard-layout.ts`, `lib/data/dashboard.test.ts`
**Scope:** S

### [x] T5b: KPI tiles that need no new loader
**Description:** Add tiles derivable from data already fetched: Groups at risk, My open tasks, My groups, Overdue amount, Refunds pending,
Avg seat fill, Revenue, Gross margin.
**Acceptance:**
- [ ] Each tile's value equals the owning derivation (`computeOperationsKpis`, `computeExecutiveSummary`, receivables overdue) for the same window.
- [ ] Each links to a pre-filtered destination.
**Verification:** unit tests per tile; manual compare Revenue tile vs `/reports` overview for the same period.
**Dependencies:** T5a
**Files:** `lib/data/dashboard-repository.ts`, `lib/data/dashboard.ts`, `lib/data/dashboard.test.ts`, `lib/types/dashboard.ts`
**Scope:** S

### [x] T6: Per-block failure isolation
**Description:** Loader failures degrade one block, not the page. `Promise.allSettled` in the repository; a rejected loader yields
`{ status: "error" }` for its dependents; each rendered block is wrapped in the existing route error boundary pattern.
**Acceptance:**
- [ ] Forcing `loadFinanceReceivables` to throw → Collections shows an error card, every other block renders.
- [ ] Error is logged (existing logger/Sentry path), not swallowed.
- [ ] A *render* error inside one block doesn't blank siblings.
**Verification:** `npx vitest run lib/data/dashboard-repository.test.ts`; manual: temporarily throw in one component.
**Dependencies:** T4
**Files:** `lib/data/dashboard-repository.ts`, `lib/types/dashboard.ts`, `app/(main)/dashboard/components/block-boundary.tsx` (new), `app/(main)/dashboard/page.tsx`
**Scope:** M

### [x] T7: Recent Activity on the merged feed
**Description:** Replace the Operations-only activity slice with `loadMergedActivityFeed`; map real `type` per row.
**Acceptance:**
- [ ] A finance/visa/lead event appears with the correct type icon; no row hard-coded `"operations"`.
- [ ] Capped at 8 rows; each links to the owning module; role-scoped (GUIDE sees only assigned-group activity).
**Verification:** unit test on the mapper; manual check as VISA and GUIDE.
**Dependencies:** T3
**Files:** `lib/data/dashboard-repository.ts`, `lib/types/dashboard.ts`, `app/(main)/dashboard/components/recent-activity.tsx`, test
**Scope:** S

### [x] T8: Zero-visible-blocks state + retire stale plan status
**Acceptance:**
- [ ] A role whose preset prunes to 0 blocks shows named empty state ("No dashboard blocks are available for <role>. Ask an admin."), not a blank grid.
- [ ] `docs/modules/dashboard-module-implementation-plan.md` header updated to "Implemented through Phase 4; role matrix superseded by dashboard-role-blocks-spec.md".
**Verification:** component test; render check.
**Dependencies:** T3
**Files:** `app/(main)/dashboard/page.tsx`, `docs/modules/dashboard-module-implementation-plan.md`
**Scope:** XS

### Checkpoint B
- [ ] lint · typecheck · test · build green
- [ ] G1, G2, G3, G5, G6, G7 each have a passing test
- [ ] Review with human — confirm role KPI sets with one real user per role (plan §11 of old doc)

---

## Phase 3 — New blocks

**Common template for T9–T15.** Step 1 verify the loader (write 5 lines in the PR on what it returns; if insufficient, stop and drop the
block). Then: mapper `lib/data/dashboard-<block>.ts` (pure, tested) → view model in `lib/types/dashboard.ts` → component → registry id +
gate + preset row (spec §2) → KPI tile if listed in §4 → empty/denied/error states → test. Top ≤ 6 rows, each with verb + filtered link.

### [x] T9: `visa-queue`  (hero for VISA)
**Acceptance:** stage counts + soonest-departure-first rows from `loadVisaQueue`/`toVisaListItems`; gate `visa.viewModule`; present for VISA (hero), OPERATIONS (summary); absent for others; "Visa pending" + "Docs…" KPI wired for VISA; GUIDE never sees it.
**Verification:** mapper unit tests (stage bucketing, ordering, empty); capability test; manual as VISA.
**Dependencies:** T3, T5a · **Files:** `lib/data/dashboard-visa.ts`(+test), `components/visa-queue.tsx`, `dashboard-layout.ts`/`dashboard-access.ts` (1 line each), `lib/types/dashboard.ts` · **Scope:** M

### [x] T10: `document-review`
**Acceptance:** awaiting-review / rejected / passport-expiring-before-departure counts + top rows from `loadDocumentQueue`; gate `documents.viewModule`; VISA + OPERATIONS only; sensitive traveller data respects `viewSensitiveTravellerData` (names masked if denied).
**Dependencies:** T3 · **Files:** as T9 pattern · **Scope:** M

### [x] T11: `supplier-payables`
**Acceptance:** payments due ≤14d and unconfirmed commitments on groups ≤30d; gate `suppliers.viewPayments`; CEO sees totals only (no per-supplier rows); "Supplier payments due" KPI for FINANCE; OPERATIONS (viewPayments=false) never receives payment amounts.
**Dependencies:** T3, T5a · **Scope:** M (loader may need a new aggregate read on `suppliers-repository` — R2 applies)

### [ ] T12: `quotes-pending`
**Acceptance:** sent-unanswered, expiring ≤3d, unsent drafts; gate `leads.viewModule ∧ leads.viewQuotes`; margin column only if `viewMargin`; MARKETING/ADMIN full, CEO/FINANCE summary; "Open quotes" KPI for MARKETING.
**Dependencies:** T3, T5a · **Scope:** M

### [ ] T13: `campaign-pulse`
**Acceptance:** active/scheduled campaigns, last send outcome, audience size from `campaigns-repository`; gate `leads.viewModule`; MARKETING + ADMIN only.
**Dependencies:** T3 · **Scope:** M

### [ ] T14: `inbox-sla`
**Acceptance:** my open conversations, SLA breaches, unassigned count; gate `inbox.viewModule`; scope = own for non-ADMIN, agency-wide for ADMIN; respects inbox entitlement/feature availability (reuse `resolveInboxFeatureAvailability`); absent when inbox not entitled.
**Dependencies:** T3 · **Scope:** M

### [ ] T15: `guest-voice`  — BLOCKED (spec Q5)
**Unblock condition:** a real capability key gating feedback/complaints exists, or you approve gating on `reports.viewModule`.
**Acceptance (when unblocked):** open complaints + lowest recent survey scores from `feedback-repository`; CEO + OPERATIONS.
**Dependencies:** T3, decision · **Scope:** M

### Checkpoint C
- [ ] lint · typecheck · test · build green
- [ ] VISA lands on `visa-queue`; MARKETING sees quotes + campaigns; FINANCE sees supplier payables (manual per role)
- [ ] No block added to a role outside spec §2
- [ ] Review with human

---

## Phase 4 — Proof

### [ ] T16: Role-matrix e2e
**Description:** Start by inspecting `e2e/support` for per-role session helpers. One spec iterating the 7 roles + 1 restricted custom role.
**Acceptance:**
- [ ] Per role: expected block ids present; forbidden ids absent from DOM and from the RSC response text.
- [ ] GUIDE page contains no agency-wide figures.
- [ ] If per-role fixtures don't exist and can't be added cheaply, deliver the same assertions at repository level and record the e2e gap in the PR (R6).
**Verification:** `npm run test:e2e -- e2e/dashboard-roles.spec.ts`
**Dependencies:** T3 (T9–T14 for full matrix) · **Files:** `e2e/dashboard-roles.spec.ts` (new), maybe `e2e/support/*` · **Scope:** M

### [ ] T17: Render-time baseline + budget
**Acceptance:**
- [ ] `withTiming("dashboard.loadData")` p50/p95 recorded for ADMIN (worst case) and GUIDE on a seeded 20-group/500-pilgrim agency; numbers + method in the plan file.
- [ ] Budget set from the baseline; a test or script flags regressions beyond it.
**Verification:** run with `PERF_TIMING=1`; record output.
**Dependencies:** T4 · **Files:** `tasks/dashboard-plan.md`, optional `scripts/*` · **Scope:** S

### Checkpoint D — release gate
- [ ] All spec §10 success criteria 1–8 demonstrably met
- [ ] Spec status → APPROVED/IMPLEMENTED; old plan doc cross-linked
- [ ] Code review (`/review`) and security pass on `dashboard-access.ts` + repository (G1 is an access change)
