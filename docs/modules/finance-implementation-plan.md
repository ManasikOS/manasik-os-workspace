# Finance Intelligence Workspace - Draft Specification

## Status

**Draft - scope approval required before implementation.** This is the module
specification and proposed capability map for the Finance workspace. It does
not authorise schema changes, new external integrations, automated financial
actions, or a general accounting ledger.

## Evidence and assumptions

### Evidence used

- Product reference: `C:/Users/moham/Downloads/The uploaded doc is about Finance Page. what about.pdf` (18 pages, reviewed 2026-09-26).
- Current route and capability implementation: `app/(main)/finance/**`,
  `lib/access/finance-access.ts`, and `lib/finance/workspace-navigation.ts`.
- Existing financial data and controls: `lib/data/finance-repository.ts`,
  `lib/data/reconciliation-repository.ts`, `lib/data/profitability-repository.ts`,
  and the Finance migrations under `supabase/migrations/`.
- Standing architecture, security, UI, API, and testing rules in `docs/`.

### Assumptions to confirm

1. This initiative is a staff-facing CRM workspace, not a statutory accounting
   product or pilgrim portal.
2. Existing payment, supplier-payment, invoice, refund, bank-transaction, and
   departure-cost data remain the financial source of truth. New screens do
   not create a parallel ledger.
3. The current LKR-first, multi-currency presentation remains in place.
   Amounts in different currencies are never silently totalled or converted
   without an approved FX source.
4. Finance, Admin, and CEO are the initial users of financial figures;
   Operations and Marketing receive payment-readiness-only information where
   their existing Finance access permits it.
5. Every recommendation is deterministic and evidence-linked. AI may explain,
   summarize, rank, draft communications, or simulate an approved scenario;
   it may never confirm a payment, approve a refund, alter due dates, create a
   payable, close a period, or send a message without applicable human approval.
6. The first delivery is navigation consolidation and an actionable overview.
   Forecasting, policy evaluation, expenses, and automation are separate
   capabilities with explicit gates below.

## Objective

Turn `/finance` from a collection of ledgers into the agency's **cash and
departure decision workspace**. A Finance user should be able to answer:

- Which money is confirmed, at risk, or still needs verification?
- Which customer collections, supplier obligations, refunds, or bank lines
  need action first?
- Which upcoming departure could become cash-unsafe or lose margin, and why?
- What safe, authorised next action reduces that risk?

The system succeeds when staff can act from an evidence-backed queue without
hunting through separate tabs, while the deterministic ledger, tenant boundary,
RLS, and human approval controls remain authoritative.

### Primary users and outcomes

| User                   | Needed outcome                                                                                                              | Not granted by this spec                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Finance                | Work a prioritised exception queue, collection queue, payable queue, and reconciliation workbench; take authorised actions. | Autonomous confirmation, approval, or fund movement.                                        |
| Admin                  | Review high-impact refunds/adjustments and manage the same operational queues.                                              | A bypass of audit or RLS controls.                                                          |
| CEO                    | See cash position, departure risk, margin, and exposure in read-only form.                                                  | Raw proof-review and write controls by default.                                             |
| Operations / Marketing | See payment readiness and finance blockers relevant to their work.                                                          | Balances, ledgers, supplier costs, margin, bank details, reconciliation, or Finance writes. |

## Capability map and delivery order

The reference document contains independently testable capabilities. They must
not be built as one large Finance-page change. Module IDs below are stable for
planning and PR selection.

| Module ID                    | Responsibility                                                                                                                      | Depends on                                                                                                        | Priority              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| `finance-navigation`         | One canonical `/finance` workspace, typed URL state, local navigation, legacy redirects, and role-aware page composition.           | Existing Finance capability matrix and workspace data.                                                            | P0                    |
| `finance-overview`           | Deterministic overview metrics and a cross-finance exception queue with direct, authorised drill-through.                           | `finance-navigation`; existing receivables, payments, payables, refunds, reconciliation, and profitability reads. | P1                    |
| `finance-receivables`        | Consolidated balances, payment activity, payment plans, invoices, and adjustments/refunds as one customer-obligation workflow.      | `finance-navigation`; existing Finance workflows.                                                                 | P0/P1                 |
| `finance-payables`           | Supplier obligation, payment, commitment, and departure drill-through; commitment-versus-invoice controls where source data exists. | `finance-navigation`; supplier commitments and payments.                                                          | P1                    |
| `finance-reconciliation`     | Evidence-rich, explainable candidate ranking and period-close workflow without auto-matching.                                       | `finance-navigation`; existing bank transactions, matches, and periods.                                           | P1                    |
| `departure-financial-safety` | Departure cash-safety, margin-risk, and break-even views based on deterministic cost/revenue data.                                  | `finance-overview`; `departure_group_costing`; receivables/payables.                                              | P1                    |
| `cash-forecast`              | Rolling cash outlook and scenario view, separated by currency and backed by an explicit opening-balance source.                     | `finance-overview`, `finance-payables`, and a confirmed opening-balance/data-source decision.                     | P1, gated             |
| `collection-strategy`        | Deterministic next-best collection action, approved reminder draft, and hand-off context.                                           | `finance-receivables`; payment reminders; consent/channel policy; Inbox integration where used.                   | P1/P2                 |
| `refund-policy-impact`       | Read-only policy eligibility and financial-impact assessment before the existing human decision workflow.                           | Refund workflow; approved, versioned policy snapshot decision.                                                    | P2, gated             |
| `departure-expenses`         | Controlled non-supplier departure expense capture and allocation.                                                                   | New data-model, accounting-owner, approval, and RLS decisions.                                                    | P2, separate approval |
| `finance-copilot`            | Evidence-backed explanation, prioritisation, drafting, and approved-scenario simulation.                                            | The deterministic modules above and proposal/approval infrastructure.                                             | P2                    |

**Proposed build order:** `finance-navigation` -> `finance-receivables` ->
`finance-overview` and `finance-payables` -> `finance-reconciliation` ->
`departure-financial-safety` -> `cash-forecast` -> `collection-strategy` ->
`refund-policy-impact` / `departure-expenses` -> `finance-copilot`.

### Approval gate

Approve the module boundaries and order above before an implementation plan or
task list is produced for an individual module. In particular, decide whether
`cash-forecast`, `departure-expenses`, and `refund-policy-impact` are in the
Finance roadmap now or remain later, gated modules.

## Current-state baseline

The codebase already supplies the operational foundation:

- `/finance` loads a capability-gated, agency-scoped snapshot and resolves
  typed `view` / `subview` URL state before rendering the workspace.
- Customer receivables, payment ledger entries, invoices, payment milestones,
  supplier payables, refunds/adjustments, and bank reconciliation already
  have records and workflows. Corrections use verification, reversal, void,
  and refund workflows rather than deletion.
- `departure_group_costing` and the profitability repository provide a
  per-departure foundation for cost, break-even, and margin analysis.
- Reconciliation already ranks candidates deterministically and requires a
  human to confirm a normal or split match. Period close has a checklist.
- `finance-access.ts` provides the current module capability model, including
  payment-status-only redaction for Operations and Marketing and read-only
  access for CEO.

The current gap is primarily information architecture and decision support:
the workspace still exposes several peer tabs; Payment Plans and Departure
P&L are separate routes; the overview lacks one deterministic exception queue
and a cash-safety narrative; no approved opening-balance source supports a
reliable cash forecast; and current policy/expense data is not sufficient to
silently claim full refund-policy or general-expense coverage.

## Product requirements

### 1. Canonical Finance navigation (`finance-navigation`)

Finance has one capability-gated sidebar destination: `/finance`. Its local
navigation uses the existing typed query model, expanded only through a
validated central resolver:

```text
/finance?view=overview
/finance?view=receivables&subview=balances
/finance?view=receivables&subview=payments
/finance?view=receivables&subview=payment-plans
/finance?view=receivables&subview=invoices
/finance?view=receivables&subview=adjustments
/finance?view=payables
/finance?view=reconciliation
/finance?view=departure-pnl
```

Legacy wrappers redirect to their canonical URL while preserving a valid,
authorised deep link. Repeated, malformed, unknown, or inaccessible query
values fall back to the caller's first safe view; they never broaden what is
fetched. The seven peer tabs are replaced by these local views and Receivables
subviews, so a booking obligation remains connected to its payment plan,
payment/proof, verification, invoice, and possible adjustment/refund.

Commissions stay in the Agent Portal until product ownership of accrual,
approval, and settlement is explicitly decided. A Finance cross-link is
permitted only for users authorised for both surfaces.

### 2. Overview and Finance exception queue (`finance-overview`)

The Overview asks one question: **what money needs attention today?** It
contains a compact, role-appropriate KPI row and a deterministic exception
queue. KPI and queue items drill directly into the workflow that can resolve
them.

Initial signals are limited to data that already exists:

- overdue and due-soon customer receivables;
- pending payment verification and unallocated payment activity;
- supplier obligations due or overdue;
- unmatched bank lines and incomplete/open reconciliation periods;
- pending refund/adjustment exposure; and
- departure collection, cost, and margin risk where the role can see those
  figures.

Priority is deterministic, explainable, and tenant-configurable only after a
separate policy design. The initial score is computed from documented fields
such as amount at risk, days overdue, departure proximity, and financial
blocker severity. Each item exposes the inputs and reason for its rank; no
LLM determines the score.

### 3. Receivables as one customer-money workflow (`finance-receivables`)

Receivables owns all views that start from a booking's obligation:

- **Balances:** collection queue, due date, owner, booking/group, payment
  status, and risk cues.
- **Payments:** record, verify, reverse, proof access, and activity history.
- **Payment plans:** milestone status, due-date changes, rescheduling reasons,
  reminders, and collection risk.
- **Invoices:** customer invoice creation, issue/send/void/credit-note flow,
  with return navigation to the related booking/receivable.
- **Adjustments:** refund requests, approval/payout status, and adjustments,
  with the existing separation of request, approval, and payment.

An Operations or Marketing user sees only the existing readiness-safe fields
and never receives amounts, bank evidence, supplier information, margin, or
mutation controls in the client payload.

### 4. Payables and supplier commitment controls (`finance-payables`)

Payables is the cross-supplier operational queue. It shows the authorised
supplier obligation, due date, payment state, commitment, supplier, and
departure context, with an authorised route to record a supplier payment.
Supplier directory, contacts, contracts, and commitment administration remain
the Suppliers module.

The first control increment may flag only facts that existing data can prove:
a due commitment with no linked supplier invoice, a recorded invoice greater
than the approved commitment, an invoice without a commitment, an obligation
due before its departure's collections cover it, duplicate reference/amount
patterns, and incorrect/missing departure allocation. Creating a supplier
invoice or a broad accounts-payable ledger is out of scope until data
ownership and invariant rules are approved.

### 5. Reconciliation workbench (`finance-reconciliation`)

The reconciliation view retains human confirmation as the only way to create
or undo a bank match. It adds a clear evidence explanation for each suggested
candidate: amount, reference, date distance, counterparty similarity, and any
prior confirmed pattern. Confidence communicates review urgency, not truth:

| Band   | Behaviour                                                                      |
| ------ | ------------------------------------------------------------------------------ |
| High   | Prefill the candidate; authorised Finance staff must still explicitly confirm. |
| Medium | Show ranked candidates; require explicit selection.                            |
| Low    | Keep the line unmatched; do not label a candidate as likely.                   |

No fuzzy name match, OCR result, or AI output can automatically reconcile a
bank line. Period close remains server-validated and audit-backed.

### 6. Departure financial safety (`departure-financial-safety`)

Extend existing Group Finance Health and profitability data into a
Finance-gated departure safety view. For each active departure, show its
collection coverage, outstanding amount, supplier obligations due before
departure, projected cash gap, margin status, break-even headcount (when
defined), and direct actions such as opening its collections queue, P&L, or
authorised supplier-payment workflow.

All figures are calculation-driven. The view must state `insufficient data`
instead of estimating when group costing, departure dates, package snapshots,
or commitment allocations are incomplete. It must not aggregate currencies.

### 7. Cash forecast (`cash-forecast`) - gated

After an opening-balance source is approved, add a rolling 30/60/90-day
forecast (the exact horizon is a product decision). For each currency and
period:

```text
projected cash balance
  = opening cash balance
  + confirmed collections expected in period
  - supplier payments due in period
  - approved refunds due in period
  - other approved cash outflows in period
```

The UI distinguishes confirmed, expected, and uncommitted amounts; links
every material line to evidence; and can show approved _what-if_ scenarios
without changing financial records. It must never treat an unverified proof,
open refund request, or unauthorised expense as confirmed cash movement.

### 8. Collection strategy (`collection-strategy`) - gated

For each receivable, calculate a deterministic next-best action from due/overdue
state, amount, departure proximity, milestone stage, previous reminders,
promise-to-pay state, operational blockers, and contactability/consent where
available. Present the reasons and a safe action: assign follow-up, create a
task, draft a reminder, or open the booking.

Sending requires the existing approved channel, consent, and policy checks.
Changing a due date, offering a discount, waiving a fee, confirming a payment,
or changing a booking materially remains human-only.

### 9. Refund policy impact (`refund-policy-impact`) - gated

Before an authorised refund decision, present a read-only assessment of the
policy version/snapshot, booking/departure status, requested amount, known
supplier-cancellation exposure, cash impact, and post-refund departure margin.
It may identify missing evidence and explain the applicable approved policy.
It never determines entitlement or bypasses the existing Admin approval and
payout workflow.

### 10. Finance Copilot (`finance-copilot`) - gated

The Finance Copilot is an event-driven explanation layer, not a generic chat
surface. It consumes authorised, minimised evidence from the deterministic
modules and may explain, prioritise, summarise, draft approved communications,
recommend a next action, generate an evidence pack, or simulate an approved
scenario. Every output names its source records and uncertainty.

It cannot write or approve financial facts by itself. Any resulting task,
reminder, or financial action travels through its existing validated,
capability-gated human workflow and produces an audit event.

## Data, access, and architecture requirements

### Data model decisions

| Capability                 | Existing source                                                                               | Potential new model                                                                    | Decision needed before work                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Overview / exception queue | Receivables, payments, payables, refunds, bank transactions, group costing                    | Prefer a `security_invoker` view or repository projection only.                        | Whether priority policy is configuration or fixed initial weights.          |
| Departure safety           | `departure_group_costing`, bookings, milestones, commitments                                  | Prefer a derived view/projection.                                                      | Exact definition of cash gap and treatment of incomplete costing.           |
| Cash forecast              | Payments, milestones, approved refunds, supplier commitments/payments, reconciliation periods | Possibly a forecast-input/policy table, never a shadow ledger.                         | Opening cash source, horizon, and approved outflow classes.                 |
| Supplier controls          | Supplier commitments, supplier payments, existing invoices                                    | New invoice-link model only if the current relationship cannot prove a control.        | Ownership and lifecycle of supplier invoice data.                           |
| Refund impact              | Refund requests, package/booking cancellation terms                                           | Versioned, immutable policy snapshot only if current booking snapshot is insufficient. | Authoritative policy source and exception/threshold rules.                  |
| Departure expenses         | None for non-supplier expenses                                                                | New tenant-scoped expense/allocation/attachment/audit models.                          | Separate module approval, categories, approvers, and accounting boundaries. |

Any new tenant-owned table must include `agency_id`, an index for its tenant
access pattern, RLS in the same migration, and an agency-scoped policy using
the active agency. New views must use `security_invoker = true`. Any new
security-definer RPC must verify role and agency internally, pin
`search_path`, and revoke inappropriate execution grants.

### Access model

Use the Finance capability interface as the module boundary. New permissions
must be added to `module-capability-keys.ts`, defaults, dynamic capability
resolution, `finance-access.ts`, UI gating, Server Action checks, and the
database policy or RPC boundary together. Do not hardcode role comparisons.

| Capability area                                  | Default audience                                            | Constraint                                                  |
| ------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Financial overview, payables, P&L, cash forecast | Admin, Finance; CEO read-only                               | CEO does not receive write controls.                        |
| Payment evidence and reconciliation workbench    | Admin, Finance                                              | Operations/Marketing never receive bank or proof details.   |
| Customer payment readiness                       | Existing Operations/Marketing scope                         | Redacted at repository boundary, not just hidden in the UI. |
| Refund / adjustment approval                     | Admin until an approved role/capability decision changes it | Request, approve, and pay remain separately auditable.      |
| Copilot suggestions                              | Users authorised to view the underlying source data         | Source redaction applies before prompts and responses.      |

### Layering and server-entry rules

```text
Finance page / shadcn UI
  -> Server Action or server-loaded repository projection
  -> Zod validation + Finance access check
  -> agency-scoped data-access function
  -> Supabase schema, RLS, and audited financial mutation
```

Every new Server Action begins with `requireUser()`, validates boundary input
with `lib/validations/finance.ts`, resolves dynamic Finance capability access,
delegates business logic to `lib/data/**` or `lib/finance/**`, revalidates
affected paths/tags, and returns a typed success/error result. Finance UI
components never query Supabase directly.

## UI requirements

- Use the existing `PageHeader`, shadcn primitives, `DataTable`, and design
  tokens. No new colour system or hand-rolled table.
- Give `/finance` one Display title and one clear primary focal point. The
  overview should lead with actionable attention, not a wall of competing
  metrics.
- Use tabular `tabular-nums` figures and display currency per value/currency
  group. Never sum or compare different currencies without an approved FX
  policy.
- Status uses the existing semantic tone system with text/icons, not colour
  alone. Reason/explanation panels make a risk or suggestion reviewable.
- Every data-driven view specifies loading, empty, permission-denied, and
  error states. Empty text states what is absent and, where authorised, points
  to the next safe action.
- Forms use the repository InputGroup pattern and labels that a non-technical
  operations user can understand.
- Verify desktop and mobile layouts. Dense data goes through the shared
  `DataTable` mobile-card fallback.

## Commands and project structure

```bash
npm run dev:http
npm run lint
npm run typecheck
npm run test
npm run build
```

| Location                                                     | Responsibility                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `app/(main)/finance/**`                                      | Finance routes, server components, UI, and actions.                 |
| `lib/finance/**`                                             | Pure deterministic finance calculations and their unit tests.       |
| `lib/data/finance-repository.ts`, `lib/data/*-repository.ts` | Agency-scoped Finance reads/writes and domain repositories.         |
| `lib/validations/finance.ts`                                 | Finance Zod schemas at action boundaries.                           |
| `lib/access/finance-access.ts`                               | Typed Finance capability checks.                                    |
| `supabase/migrations/**`                                     | Schema, RLS, views, RPCs, and database invariants.                  |
| `tests/finance/**` or colocated `*.test.ts`                  | Finance business-rule tests and reusable fixtures.                  |
| `docs/modules/`                                              | This living module specification and approved implementation plans. |

## Code style

Use specific, domain-revealing names; exported library functions have explicit
return types; pure rules are independently testable; and expected failures use
a discriminated result rather than an exception.

```ts
export type FinanceExceptionPriority =
  | { ok: true; score: number; reasons: string[] }
  | { ok: false; error: string };

export function calculateFinanceExceptionPriority(
  input: FinanceExceptionPriorityInput,
): FinanceExceptionPriority {
  if (input.amountAtRisk < 0) {
    return { ok: false, error: "Amount at risk cannot be negative." };
  }

  const score = input.amountAtRisk + input.daysOverdue * input.overdueDayWeight;
  return { ok: true, score, reasons: buildFinanceExceptionReasons(input) };
}
```

Do not use `any`, generic names such as `handleSubmit`, client-provided role
or agency identifiers, inline Supabase queries in UI, or silent catch-and-log
handling for financial failures.

## Testing strategy

Vitest covers pure logic and business-rule branching. Live Supabase/RLS and
browser checks remain manual verification until the project's test approach
changes deliberately.

| Area                        | Automated coverage                                                                                                              | Manual verification                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| URL navigation              | Valid, malformed, repeated, inaccessible, and redacted view fallback.                                                           | Directly open deep links under each role.                |
| Exception priority          | Deterministic rank, tie-break, missing-data, currency separation, and reason output.                                            | Check queue drill-through and copy.                      |
| Cash forecast               | Opening-balance presence, confirmed/expected separation, no cross-currency total, and scenario non-mutation.                    | Reconcile a sample period to source records.             |
| Departure safety            | Cash gap, margin/break-even edge cases, insufficient-data state, and no false healthy state.                                    | Review an active departure with Finance/CEO permissions. |
| Reconciliation              | Candidate evidence, confidence policy, human-confirmation-only behavior, split residual invariant, and closed-period rejection. | Test confirmation/undo against a scoped test bank line.  |
| Collections / refund impact | Consent/policy gates, explanation evidence, no autonomous send/approval, and threshold edge cases.                              | Verify approved action routes and audit history.         |
| Access and data isolation   | Capability branches and source-data redaction tests.                                                                            | RLS/advisor check with cross-agency and role test users. |

Before a PR, run `npm run lint`, `npm run typecheck`, and `npm run test`.
For UI slices, manually verify the golden path, empty state, error state,
permission-denied state, desktop width, and mobile width. For migrations, run
the relevant Supabase advisors and validate RLS independently of a mocked UI
role.

## Boundaries

### Always

- Preserve immutable/audited financial records; correct by authorised
  verification, reversal, void, adjustment, or refund workflows.
- Scope every read and write to the authenticated caller's active agency and
  enforce access in the UI, action/repository, and database layer.
- Validate all external input with Zod and make priority, forecast, safety,
  and matching calculations deterministic and explainable.
- Preserve existing currency separation, financial audit trails, and human
  approval boundaries.
- Update this specification before implementation if an approved decision
  changes scope or a data invariant.

### Ask first

- New tables, migrations, views/RPCs, dependencies, external bank/payment
  integrations, automatic reminders, new Finance roles/capabilities, or
  changes to RLS.
- The cash-forecast opening balance, forecast horizon, cash classification,
  FX approach, expense categories/approval model, and refund-policy source.
- Moving commissions from Agent Portal to Finance or changing the ownership of
  supplier invoices, expenses, or accounting exports.

### Never

- Build a general ledger, chart of accounts, payroll, tax filing, asset
  depreciation, or full double-entry accounting under this page scope.
- Let AI/OCR/fuzzy matching automatically confirm money, reconcile a bank
  line, approve/refuse a refund, change a financial record, close a period,
  or send customer communication without a valid authorised workflow.
- Expose financial amounts, bank evidence, supplier costs, margin, secrets,
  or cross-agency data to a user without the applicable capability and RLS
  protection.
- Create a parallel payment, payable, invoice, expense, or audit ledger when
  an existing source of truth already owns it.

## Success criteria

1. `/finance` is the canonical Finance entry point; local views use typed URL
   state, legacy routes redirect safely, and a user cannot open or fetch an
   inaccessible Finance view.
2. Receivables groups balances, payment activity, plans, invoices, and
   adjustments/refunds around a booking obligation without duplicating the
   underlying workflows or losing return navigation.
3. The Finance Overview shows an explainable, deterministic exception queue
   and role-safe metrics with a direct authorised action for every item.
4. No cross-currency aggregate is shown without an approved FX policy.
5. Reconciliation remains explicitly human-confirmed; evidence and confidence
   improve review but never cause auto-matching.
6. Departure safety shows only calculation-backed cash/margin/break-even
   results and clearly signals insufficient source data.
7. Cash forecasting, collection strategy, refund-policy assessment, expenses,
   and Copilot features ship only after their named approval gates and tests.
8. All financial mutations remain authenticated, Zod-validated,
   capability-gated, agency-scoped, RLS-protected, and auditable.
9. Every delivered slice passes lint, typecheck, and tests and is browser
   verified for relevant roles and responsive states.

## Open questions requiring product decisions

1. What is the authoritative, reconciled opening cash balance per bank account
   and currency for a forecast?
2. Which amounts count as confirmed versus expected cash, and which outflow
   classes may enter the forecast before payment?
3. Are Finance exception-priority weights globally fixed at first or
   configurable per agency? If configurable, who may change them and how is a
   policy version audited?
4. Which policy artifact is legally authoritative for a booking refund:
   package snapshot, a versioned agency policy, a booking override, or a
   hierarchy of all three?
5. Does the product need controlled non-supplier departure expenses now? If
   yes, who owns categories, approval thresholds, allocation, attachments, and
   later accounting export?
6. Who owns supplier invoices and commissions long-term: Finance, Suppliers,
   or Agent Portal? Do not duplicate these records before this is settled.
7. Should Operations and Marketing retain the current Finance entry for
   readiness-only data, or should that redacted data move to their existing
   operational screens?

## Implementation plan and checklist

The dependency-ordered, vertically sliced delivery plan and executable
checklist are in
[`TASK-012-finance-intelligence-workspace.md`](../tasks/TASK-012-finance-intelligence-workspace.md).
It treats the current Finance UI changes as unverified P0 work, keeps the
cash-forecast, policy, expenses, supplier-invoice, and role-placement choices
as decision gates, and requires a review checkpoint after P0 and P1.

## Approval record

- [ ] Capability map approved.
- [ ] P0 scope (`finance-navigation`, `finance-receivables`) approved.
- [ ] P1 scope and ordering approved.
- [ ] Gated P2 modules explicitly selected or deferred.
- [ ] Open questions resolved or recorded as deliberate deferrals.
- [ ] Individual module implementation plan and task list may be created.
