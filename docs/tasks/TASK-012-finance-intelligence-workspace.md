# TASK-012 Finance Intelligence Workspace

## What

Plan the Finance module's staged transition from peer ledger tabs into one
role-aware cash and departure decision workspace. This task starts with P0
navigation consolidation and records the verified follow-on slices required for
a deterministic exception queue, departure safety, and gated intelligence.

## Why

The current Finance foundations are strong, but staff still move among peer
tabs and separate routes to understand collections, payables, reconciliation,
and departure risk. The module specification defines the target behaviour;
this task turns it into small, dependency-ordered, verifiable slices without
changing financial truth, tenancy, or approval boundaries.

## Data model changes

P0: None expected. It reuses the current Finance snapshot and typed URL
resolver.

P1: Prefer derived repository projections or `security_invoker` views for the
exception queue and departure safety. New tables are prohibited unless the
named decision gate is approved; any approved table requires `agency_id`,
indexing, RLS, and an audit trail in the same migration.

P2: Cash forecast, refund policy impact, supplier invoice linkage, and
non-supplier expenses remain gated by the product decisions in
`docs/modules/finance-implementation-plan.md`.

## Access control changes

P0: None expected. Existing `FinanceCapabilities` continues to decide
visibility and server-loaded data.

P1: Any new capability follows the Finance access boundary end-to-end:
`module-capability-keys.ts`, defaults, dynamic resolver,
`finance-access.ts`, UI, Server Action, and RLS/RPC policy. Do not add a
role merely to solve a capability problem.

## UI surfaces

- `/finance` and the Finance workspace shell.
- Legacy Finance wrapper routes and Finance sidebar/deep links.
- Receivables local subviews, Payables, Reconciliation, and Departure P&L.
- Finance Overview, then its deterministic exception and departure-safety
  content.

## Test plan

- Vitest unit tests for URL fallback, priority/scoring, currency handling,
  risk calculations, and reconciliation confidence.
- Existing and new role/capability tests for data redaction and inaccessible
  navigation.
- Browser verification for Finance, CEO, Operations, and Marketing roles:
  desktop/mobile, deep links, empty/error/permission states.
- RLS/advisor verification for every future migration.

## Status

Draft - planning complete; implementation requires review of the gates and
individual task approval.

## Decision gates

- [ ] **G1 - Navigation ownership:** confirm Payment Plans and Departure P&L
  become Finance local views, and legacy Finance wrappers redirect rather than
  remain alternate workspace shells.
- [x] **G2 - Priority policy:** fixed deterministic weights: overdue
  receivables, disputed/overdue supplier commitments, pending refunds, then
  due-soon receivables. Amounts never influence ranking; they remain separated
  by currency. Approved by product owner on 2026-09-27.
- [ ] **G3 - Cash forecast:** name the reconciled opening-balance source,
  horizon, cash classifications, and no-FX policy.
- [ ] **G4 - Refund policy:** name the authoritative versioned policy source
  and the rule for booking-specific overrides.
- [ ] **G5 - Supplier invoice ownership:** decide whether Finance or Suppliers
  owns supplier invoice lifecycle/linkage.
- [ ] **G6 - Departure expenses:** approve a separate domain before creating
  non-supplier expense records.
- [ ] **G7 - Role placement:** confirm whether Operations and Marketing keep
  the current Finance readiness-only entry or move that information to their
  existing work surfaces.

## Dependency graph

```text
P0 canonical URL + capability-safe navigation
  ├─ Receivables local subviews ───────────────┐
  ├─ Payables local view ──────────────────────┤
  ├─ Reconciliation local view ────────────────┼─ Finance overview + exception projection
  └─ Departure P&L local view ─────────────────┘                 │
                                                                   ├─ Departure financial safety
                                                                   ├─ Cash forecast (G3)
                                                                   └─ Collection strategy
Existing bank lines + matching ─────────────────── Reconciliation explanations
Existing refund workflow + policy source (G4) ──── Refund-policy impact
Separate expense approval (G6) ─────────────────── Departure expenses
Deterministic outputs + approval infrastructure ── Finance Copilot
```

## Delivery plan

### Phase P0 - Canonical Finance workspace

## Task 1: Lock the Finance URL contract and access fallback

**Description:** Align the central navigation resolver with the approved
Finance views, define the precise legacy-route mapping, and cover every
malformed or inaccessible query path before changing the workspace UI.

**Acceptance criteria:**

- [ ] Canonical hrefs cover Overview, every Receivables subview, Payables,
  Reconciliation, and Departure P&L.
- [ ] Repeated, unknown, malformed, and capability-inaccessible values fall
  back to the first safe view without broadening snapshot data.
- [ ] Vitest covers Finance, CEO, Operations, Marketing, and no-access roles.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/workspace-navigation.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: open each canonical and invalid URL under representative
  roles.

**Dependencies:** G1.
**Files likely touched:** `lib/finance/workspace-navigation.ts`,
`lib/finance/workspace-navigation.test.ts`, `lib/access/finance-access.ts`.
**Estimated scope:** S.

## Task 2: Replace the peer tab strip with Finance local navigation

**Description:** Make the shared workspace render top-level Finance views and
nested Receivables navigation from the canonical resolver rather than mapping
URLs back onto the seven legacy tabs.

**Acceptance criteria:**

- [ ] The Finance page has one title and local navigation for Overview,
  Receivables, Payables, Reconciliation, and Departure P&L.
- [ ] Receivables exposes balances, payments, payment plans, invoices, and
  adjustments as local subviews.
- [ ] Only capability-visible destinations and authorised actions render.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/workspace-navigation.test.ts`.
- [ ] Lint and typecheck pass: `npm run lint` and `npm run typecheck`.
- [ ] Manual check: verify desktop/mobile navigation, an empty subview, and
  Operations/Marketing redaction.

**Dependencies:** Task 1.
**Files likely touched:** `app/(main)/finance/payments/components/finance-workspace.tsx`,
new Finance navigation/subview components under the same directory, and
`app/(main)/finance/payments/finance-store.tsx`.
**Estimated scope:** M.

## Task 3: Bring Payment Plans into Receivables

**Description:** Reuse the existing milestone query, risk calculation, and
reschedule workflow inside the Receivables payment-plans subview. Preserve
direct deep links and avoid duplicating mutation logic.

**Acceptance criteria:**

- [ ] `view=receivables&subview=payment-plans` renders the authorised
  milestone list with current filters and reschedule flow.
- [ ] The standalone URL redirects to the canonical subview after G1 approval.
- [ ] Operations/Marketing receive only the existing safe data contract.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/collection-risk.test.ts lib/finance/plan-invariant.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: reschedule an authorised milestone and confirm the
  canonical return URL.

**Dependencies:** Tasks 1-2.
**Files likely touched:** `app/(main)/finance/payment-plans/page.tsx`,
`app/(main)/finance/payment-plans/components/payment-plans-view.tsx`,
`app/(main)/finance/payments/components/finance-workspace.tsx`, and a
new Receivables subview adapter.
**Estimated scope:** M.

## Task 4: Bring Departure P&L into Finance

**Description:** Present the existing profitability list as the Departure P&L
Finance local view and retain its supplier-cost capability gate and
currency-separated display.

**Acceptance criteria:**

- [ ] `view=departure-pnl` displays the authorised profitability list.
- [ ] Inaccessible roles cannot obtain the source data through the route or
  workspace snapshot.
- [ ] The old route redirects safely after G1 approval.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/data/finance.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: test CEO/Finance visibility and Operations denial.

**Dependencies:** Tasks 1-2.
**Files likely touched:** `app/(main)/finance/departure-profitability/page.tsx`,
`app/(main)/finance/departure-profitability/components/profitability-view.tsx`,
`app/(main)/finance/payments/components/finance-workspace.tsx`, and a
new local-view adapter.
**Estimated scope:** M.

## Task 5: Redirect legacy wrappers and update Finance deep links

**Description:** Convert old Finance wrapper pages and sidebar/deep links to
the canonical URL contract once all corresponding local views work.

**Acceptance criteria:**

- [ ] Legacy routes redirect to their exact canonical authorised destination.
- [ ] The sidebar has one Finance destination and no misleading Expenses or
  duplicate Commission entries.
- [ ] Existing Finance action links preserve their relevant Finance context.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/workspace-navigation.test.ts`.
- [ ] Lint and typecheck pass: `npm run lint` and `npm run typecheck`.
- [ ] Manual check: open every legacy route and confirm browser back/forward
  behaviour and no redirect loop.

**Dependencies:** Tasks 2-4.
**Files likely touched:** `components/app-sidebar.tsx`, Finance wrapper
`page.tsx` files (split across small commits), and Finance deep-link call
sites.
**Estimated scope:** M, split by wrapper family if more than five files change.

### Checkpoint P0 - Navigation consolidation

- [ ] G1 is recorded as approved.
- [ ] Tasks 1-5 pass their focused verification.
- [ ] `npm run lint`, `npm run typecheck`, and `npm run test` pass.
- [ ] Finance, CEO, Operations, and Marketing browser checks are recorded.
- [ ] No Finance snapshot exposes inaccessible data to a client component.
- [ ] Review the completed P0 slice before beginning P1.

### Phase P1 - Deterministic decision support

## Task 6: Build pure Finance exception priority rules

**Description:** Add an explicit, pure ranking function and typed reason model
for existing Finance signals. Do not persist scores or add tenant
configuration before G2.

**Acceptance criteria:**

- [ ] Ranking uses only approved deterministic inputs and returns visible
  reason codes.
- [ ] Missing data and mixed currencies produce a safe, explainable result.
- [ ] No LLM output participates in the score.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/finance-exception-priority.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: inspect priority reasons against a known sample dataset.

**Dependencies:** P0 checkpoint and G2.
**Files likely touched:** new `lib/finance/finance-exception-priority.ts`,
new colocated test, and Finance domain types.
**Estimated scope:** S.

## Task 7: Load an agency-scoped exception projection

**Description:** Compose existing Finance records into an authorised,
currency-separated exception projection. Prefer repository queries or a
`security_invoker` view; do not create a shadow ledger.

**Acceptance criteria:**

- [ ] The projection includes only source records the caller can already view.
- [ ] Every item has deterministic source links, priority reasons, and an
  authorised destination.
- [ ] Cross-agency results are prevented by RLS and repository scoping.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/finance-exception-priority.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: verify Finance/CEO data and Operations/Marketing redaction.

**Dependencies:** Task 6.
**Files likely touched:** `lib/data/finance-repository.ts`,
`app/(main)/finance/payments/load-finance-snapshot.ts`, Finance types, and
possibly one migration if a view is justified.
**Estimated scope:** M.

## Task 8: Deliver the actionable Finance Overview

**Description:** Replace the current metric-first overview presentation with
a compact role-safe KPI row, exception queue, source links, and the existing
staff-triggered cash-risk briefing below operational content.

**Acceptance criteria:**

- [ ] Every displayed exception has an explanation, source, and safe action.
- [ ] The page has loading, empty, error, and permission-denied states.
- [ ] The Copilot briefing remains a staff-triggered suggestion, not the
  queue's source of truth.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/finance-exception-priority.test.ts`.
- [ ] Lint and typecheck pass: `npm run lint` and `npm run typecheck`.
- [ ] Manual check: desktop/mobile Finance and CEO overview; empty queue;
  Operations/Marketing redaction.

**Dependencies:** Task 7.
**Files likely touched:** Finance overview component, workspace shell, snapshot
types, and a new exception-queue component.
**Estimated scope:** M.

## Task 9: Explain reconciliation candidate evidence

**Description:** Render the current deterministic matching signals as a
reviewable explanation panel and apply the High/Medium/Low confidence policy
without changing the human-confirmation requirement.

**Acceptance criteria:**

- [ ] Candidate evidence shows amount, reference, date, counterparty, and
  prior-pattern signals where present.
- [ ] High confidence only prefills a candidate; it never confirms one.
- [ ] Split-match and closed-period safeguards remain unchanged.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/reconciliation-candidates.test.ts lib/finance/period-close-checklist.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: review high, medium, low, split-match, and closed-period
  examples.

**Dependencies:** P0 checkpoint.
**Files likely touched:** `lib/finance/reconciliation-candidates.ts`,
its test, the reconciliation tab, and a new evidence component.
**Estimated scope:** M.

## Task 10: Compute departure financial-safety results

**Description:** Create a pure, currency-aware calculation over existing
profitability, collection, and payable information. It returns a safe
insufficient-data state rather than an invented cash-gap or margin result.

**Acceptance criteria:**

- [ ] Each result explains collection coverage, payable timing, cash-gap
  inputs, margin/break-even state, or insufficient data.
- [ ] Mixed currencies are not totalled.
- [ ] Results link to source departure, receivables, payables, or P&L views.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/departure-financial-safety.test.ts`.
- [ ] Typecheck passes: `npm run typecheck`.
- [ ] Manual check: review healthy, attention, critical, and incomplete-cost
  departures.

**Dependencies:** Tasks 7-8.
**Files likely touched:** new `lib/finance/departure-financial-safety.ts`,
new test, `lib/data/profitability-repository.ts`, and Finance snapshot types.
**Estimated scope:** M.

## Task 11: Surface the departure financial-safety view

**Description:** Add the role-gated Finance local view/table and overview
drill-through for departure safety using the result from Task 10.

**Acceptance criteria:**

- [ ] Finance and CEO see an accessible per-departure safety view.
- [ ] The UI does not show undisclosed supplier/margin detail to Operations
  or Marketing.
- [ ] Every status has text and a direct authorised next action.

**Verification:**

- [ ] Focused tests pass: `npm run test -- lib/finance/departure-financial-safety.test.ts`.
- [ ] Lint and typecheck pass: `npm run lint` and `npm run typecheck`.
- [ ] Manual check: desktop/mobile table, empty state, and each role boundary.

**Dependencies:** Task 10.
**Files likely touched:** Finance workspace, Finance overview, a new safety
view component, and snapshot types.
**Estimated scope:** M.

### Checkpoint P1 - Decision support

- [ ] G2 is recorded as approved.
- [ ] Tasks 6-11 pass focused verification.
- [ ] `npm run lint`, `npm run typecheck`, and `npm run test` pass.
- [ ] RLS/advisor review is recorded for any new view/migration.
- [ ] Finance and CEO verify source-backed actions; Operations/Marketing
  verify redaction.
- [ ] Review the P1 outcome before approving any gated capability.

### Gated follow-on checklist

- [ ] **Cash forecast:** G3 approved; then write a dedicated task covering
  opening-balance provenance, deterministic forecast rules, per-currency
  projection, scenario non-mutation, and Finance/CEO UI.
- [ ] **Collection strategy:** channel consent and Inbox ownership confirmed;
  then write a dedicated task for deterministic actions and approved reminder
  hand-off.
- [ ] **Refund impact:** G4 approved; then write a dedicated task for
  versioned policy lookup, evidence requirements, and read-only impact
  explanation.
- [ ] **Supplier controls:** G5 approved; then write a dedicated task for
  supplier-invoice linkage and enforceable commitment invariants.
- [ ] **Departure expenses:** G6 approved; create a separate module plan and
  migration/RLS/access design before any UI work.
- [ ] **Finance Copilot:** deterministic source modules and proposal/approval
  integration are ready; then write a dedicated task for evidence-minimised,
  staff-approved suggestions only.
- [ ] **Role placement:** G7 approved; record the final Operations/Marketing
  Finance entry behaviour and test the selected redaction model.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Legacy worktree changes overlap P0 files. | High | Reconcile against the current diff; do not overwrite or tick a task based on unverified local code. |
| Local views accidentally fetch more than a role may see. | High | Resolve capabilities before loading data; redaction occurs in the repository; test deep links by role. |
| Forecast creates a second financial truth. | High | Gate on G3; use named source records and a derived projection only. |
| Cross-currency roll-ups look plausible but are wrong. | High | Keep every aggregate currency-separated until an approved FX policy exists. |
| AI is treated as a financial decision maker. | High | Keep calculation, approval, and audit deterministic; AI is advisory and source-linked only. |
| A planned task grows beyond a small PR. | Medium | Split adapters, redirects, and UI surfaces by route family; retain the same acceptance contract. |

## Parallelisation

After Task 1 establishes the navigation contract, Task 3 (payment-plan adapter)
and Task 4 (P&L adapter) can proceed in parallel if isolated worktrees are
used. Tasks 6 and 9 can proceed in parallel after P0. Tasks 7-8 and 10-11 are
sequential pairs because each UI slice depends on its projection/calculation.

## Completion checklist

- [ ] Every implemented task has its acceptance criteria and verification
  recorded as passing.
- [ ] No task changes more than roughly five files without being split.
- [ ] Every migration has same-PR RLS, agency scoping, validation, access, and
  audit coverage.
- [ ] Every UI slice uses shadcn, InputGroup, design tokens, DataTable where
  applicable, and responsive states.
- [ ] No financial action becomes autonomous.
- [ ] The module specification is updated before any approved scope change.
