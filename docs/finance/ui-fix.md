# Finance workspace UI fix plan

## Purpose and scope

This plan rewrites the Finance navigation around the operating-system model
shown in the supplied sidebar review: the global sidebar is for daily
operating loops, while specialised financial work belongs inside one
role-aware Finance workspace.

**In scope:** the Finance sidebar group, Finance list/overview routes,
their internal navigation, related deep links, and role-aware visibility.

**Not in scope:** rebuilding the wider sidebar, creating a new expense
ledger, changing finance data/RLS, or implementing the document's proposed
Booking, Departure, Readiness, Inbox, More, or Copilot redesigns. Those
recommendations provide product context but need their own approved plans.

## Decision

Replace all Finance sidebar items with one capability-gated entry:

```text
OPERATIONS
  Readiness
  Finance
```

`Finance` opens `/finance`, the sole Finance workspace. It is visible only
when `capabilitiesForFinance(role).viewModule` is true.

The workspace uses contextual secondary navigation, not more global
navigation:

```text
Finance
├── Overview
├── Receivables
├── Payables
├── Expenses
├── Reconciliation
├── Commissions
└── Departure P&L
```

This does not conceal needed controls. It lets a user remain in one
money-management context while moving from a customer balance, to an invoice
or refund, to a supplier obligation, then to a bank match or a departure
margin question. That matches agency work and avoids presenting accounting
entities as unrelated products.

## Current-state audit and target placement

| Current sidebar item | Existing implementation | Target in the Finance workspace | Decision |
| --- | --- | --- | --- |
| Finance Overview | `/finance`; 12 KPI cards plus cash-risk briefing. | **Overview** | Keep as landing view, but reduce it to an actionable Finance summary. |
| Payments & Collections | `/finance/payments`; seven-tab workspace containing overview, receivables, payments, invoices, supplier payables, refunds, and reconciliation. | **Receivables** and payment activity | Remove as a sidebar entry and split its contents by the job they support. |
| Payment Plans | `/finance/payment-plans`; cross-booking milestone schedule. | **Receivables** | Keep as a Receivables sub-view/filter: it is another way to work customer obligations. |
| Invoices | `/finance/invoices`; duplicate workspace shell at invoices tab. | **Receivables → Invoices** | Keep list/detail, but make invoice work a receivable action/sub-view. |
| Refunds & Credits | `/finance/refunds-credits`; duplicate shell at refunds tab. | **Receivables → Adjustments & refunds** | Keep approvals/actions but remove the global destination. |
| Expenses & Supplier Bills | Sidebar points to `/suppliers`, a supplier-domain route. | **Expenses** | Remove the misleading link. Start only from honest, existing cost/commitment information. |
| Payables | `/finance/payables`; duplicate shell at supplier-payables tab. | **Payables** | Keep as local top-level view: a cross-supplier payment queue. |
| Commissions | `/finance/commissions` redirects to Agent Portal. | **Commissions** | Remove the duplicate sidebar link. Agent Portal remains source of truth until ownership is defined. |
| Reconciliation | `/finance/reconciliation`; duplicate shell with bank matching and close. | **Reconciliation** | Keep as local top-level view with its specialised close-off workflow. |
| Departure Profitability | `/finance/departure-profitability`; cross-group P&L list. | **Departure P&L** | Keep locally in Finance and alongside the departure-detail Finance context. |

Two structural problems must be removed:

1. `/finance/invoices`, `/finance/payables`, `/finance/refunds-credits`, and
   `/finance/reconciliation` all load the same provider/workspace shell and
   merely select a tab.
2. `/finance` and that old workspace both report collections, receivables,
   refunds, and supplier-payable metrics. A metric needs one source of truth
   and one owning workflow.

## Finance experience

### Overview - "What money needs attention today?"

Overview is the workspace start, not a second dashboard. Show a small,
role-appropriate set of actionable signals:

- overdue and due-soon customer balances -> **Receivables**;
- unverified/recent payment activity -> **Receivables**;
- supplier obligations due -> **Payables**;
- unmatched bank lines or an open period -> **Reconciliation**;
- pending refund/credit decisions -> **Receivables → Adjustments & refunds**;
- departure margin risks -> **Departure P&L** for users allowed to see cost data.

Keep the priority follow-up queue and group finance-health content when data
is authorised. Keep the Manasik Copilot cash-risk briefing below operational
content as a staff-triggered, evidence-backed suggestion - never as a
replacement for a queue or unverified figure.

Replace the 12-card wall. Advanced figures belong beside the work they
explain, and currencies continue to be displayed separately.

### Receivables - "What customers owe, paid, or need help with"

This is the customer-money workspace. It contains local sub-views or
well-labelled filters for:

- balances and collection follow-up (current Receivables table);
- payment activity and record/verify/reverse controls;
- payment-plan milestones, due dates, collection risk, and reschedule actions;
- invoices, including the existing invoice detail route;
- adjustments, refunds, and credits.

These are not permanent sidebar items. They all begin from a booking's
obligation and share one collection workflow. An invoice/refund flow must
retain a clear route back to its receivable and booking.

### Payables - "What the agency owes suppliers"

Keep Supplier Payables as a local Finance view. It is the cross-supplier
obligation queue: status, due date, commitment, supplier payment, and
supplier/departure drill-through.

Supplier directory, contacts, contracts, and commitment administration
remain in **Suppliers**. Finance must not create a second supplier directory.

### Expenses - "What costs the agency has committed or incurred"

The reference architecture calls for Expenses, but today the application has
supplier commitments/payables rather than a general expense ledger. Use this
two-step rule:

1. In this navigation refactor, render **Expenses** only if it can honestly
   show authorised supplier commitment/cost information already available to
   Finance users, with direct links to the Supplier or Departure owner.
2. If staff expenses, overheads, categories, receipts, or approvals are
   needed, stop and create a separate expense-domain plan first. It requires
   data model, agency RLS, access capabilities, Zod validation, audit trail,
   server actions, and tests.

No placeholder destination and no relabelled `/suppliers` page is allowed.

### Reconciliation - "Does the bank agree with recorded money?"

Keep bank-line matching, suggested candidates, undo/split controls, period
close, and reopen actions together. It passes the page test because it is a
cross-agency control queue with specialised alerts and close-off workflow.

### Commissions - "What is owed to agents or partners?"

The current page redirects to Agent Portal, so commissions have no independent
Finance implementation. Keep Agent Portal as the source of truth and expose
a Finance cross-link only when the active user may access both surfaces.

Do not duplicate commission data, permissions, or mutation controls. A
Finance Commissions view is conditional on a written decision of whether
Finance or Partners & Agents owns accrual, approval, and settlement.

### Departure P&L - "Which departures have margin or cash risk?"

Keep the cross-group profitability list as a local Finance view. Preserve its
supplier-payables gate, multi-currency display, estimate qualification, and
group drill-through. The departure-detail Finance tab remains the answer to
why a specific departure is at risk.

## Navigation and URL contract

Use `/finance` with typed, validated URL state in one central pure resolver:

```text
/finance?view=overview
/finance?view=receivables&subview=balances
/finance?view=receivables&subview=payment-plans
/finance?view=receivables&subview=invoices
/finance?view=payables
/finance?view=reconciliation
/finance?view=departure-pnl
```

Only valid, capability-visible values render. A malformed or inaccessible
value falls back to the first authorised view and never changes fetched data.
Use URL state for shareable navigation. Persist a user's last authorised
local view only if a suitable existing preference mechanism exists.

| Legacy route | Canonical route |
| --- | --- |
| `/finance/payments` | `/finance?view=receivables&subview=balances` |
| `/finance/payment-plans` | `/finance?view=receivables&subview=payment-plans` |
| `/finance/invoices` | `/finance?view=receivables&subview=invoices` |
| `/finance/refunds-credits` | `/finance?view=receivables&subview=adjustments` |
| `/finance/payables` | `/finance?view=payables` |
| `/finance/reconciliation` | `/finance?view=reconciliation` |
| `/finance/departure-profitability` | `/finance?view=departure-pnl` |
| `/finance/commissions` | `/relationships/agent-portal?tab=commissions` |

Keep `/finance/invoices/[invoiceId]` as a standalone record-detail route.
Preserve only recognised safe filters during redirects; discard unknown
parameters. Update dashboard, inbox, booking, departure, and Finance CTAs
after canonical routes exist. Keep redirects for bookmarks and hand-offs.

## Role-aware experience

Role-based navigation is part of the design, not merely a UI preference.

| Role outcome | Finance experience |
| --- | --- |
| ADMIN / FINANCE | Current authorised views/actions; FINANCE still cannot self-approve where the existing matrix denies approval. |
| CEO | Current authorised read-only overview, receivables, payables, reconciliation, and P&L; no action controls. |
| OPERATIONS / MARKETING | Customer payment readiness only. Default to authorised Receivables content, retain redaction, and do not preload ledger, supplier-cost, reconciliation, or P&L data. |
| VISA / GUIDE | No Finance sidebar entry or route content, consistent with current capabilities. |

Capability checks remain at repository/action boundaries. Hiding a view,
redirecting a legacy URL, or disabling a button is not access control.

## Implementation plan

### Slice A - Establish navigation contract

1. Add a specific typed Finance navigation model: view ids, Receivables
   subview ids, labels, required capabilities, canonical URLs, legacy maps.
2. Add Vitest tests for valid resolution, bad-parameter fallback, redirects,
   and each role's visible view set.
3. Explicitly test forged `view=payables`, `view=reconciliation`, and
   `view=departure-pnl` for `viewPaymentStatusOnly` users; they must neither
   render nor trigger sensitive data fetches.

### Slice B - Consolidate workspace shell

1. Make `/finance` load one server-authorised snapshot and workspace shell.
2. Refactor `FinanceWorkspace` into specifically named pieces: workspace
   header, local view navigator, Receivables subview navigator, authorised
   content renderer.
3. Migrate existing tabs without changing business rules: Receivables
   absorbs payments, plans, invoices, adjustments; Payables and
   Reconciliation remain peer views.
4. Replace the separate `FinanceOverviewView` load with actionable Overview.
   Reuse governed derivations; no client Supabase reads or parallel metrics.
5. Add P&L as an authorised local view. Show Expenses only if it has honest
   existing data; otherwise hide it until the separate domain plan exists.

### Slice C - Remove global duplication safely

1. Change `components/app-sidebar.tsx` so Finance contains one `Finance`
   item. Remove Finance links for Payment Plans, Expenses & Supplier Bills,
   Commissions, and Departure Profitability; leave unrelated groups alone.
2. Turn duplicate list wrappers into server redirects using the contract;
   preserve invoice detail.
3. Repoint breadcrumbs, dashboard/Inbox prompts, Finance metric cards, and
   group links to canonical routes.
4. Update finance architecture/implementation documentation that currently
   prescribes multiple top-level Finance routes.

### Slice D - UX and release verification

1. Use existing shadcn primitives/tokens. On desktop use compact local view
   navigation; on narrow screens use project `Select` for primary local view
   and a scrollable Receivables subview list. Do not build a second sidebar.
2. Verify 320px, 768px, 1024px, and 1440px: no clipped tabs, unreadable
   wrapping, or page-wide horizontal scrolling.
3. Verify keyboard navigation, focus after URL changes, visible focus,
   semantic tabs/current state, one page title, loading, empty, error, and
   permission states.
4. Manually test Admin, Finance, CEO, Operations, and Marketing. Run
   `npm run lint`, `npm run typecheck`, and `npm run test`.

## Engineering, data, and security constraints

- This UI/IA change requires no migration or RLS change. Do not weaken agency
  scoping, role resolution, Zod validation, repository capability gates,
  action-level approval checks, or audit trails while relocating UI.
- A future Expenses domain is a separate feature: migration plus RLS,
  validation, access capabilities, data access, actions, and tests.
- Preserve multi-currency semantics; do not merge currencies into one KPI.
- Use shared `DataTable`, `ToneBadge`, semantic tones, `InputGroup` for new
  inputs, and specific component/function names.

## Acceptance criteria

- A Finance-authorised user sees exactly one Finance item in the sidebar.
- `/finance` is one role-aware workspace with Overview, Receivables,
  Payables, Reconciliation, and Departure P&L; Expenses/Commissions appear
  only when real authorised ownership exists.
- Invoices, payments, plans, refunds, and credits are reached from
  Receivables, not separate sidebar destinations.
- Supplier administration is not mislabelled as Expenses; Payables remains
  a cross-supplier financial queue.
- Reconciliation retains its period-close flow and is easily found by
  authorised finance users.
- Old list URLs redirect safely; invoice detail and Agent Portal commissions
  remain available.
- Forged queries and legacy routes cannot expose hidden capabilities or data.
- The sidebar communicates a smaller, intentional daily flow; specialist
  work appears in Finance only when it is relevant.
