# Current Finance page reference

## Purpose

This is a factual reference for the Finance experience currently implemented
in the CRM. It describes the live route structure, data flow, permissions,
tabs, actions, and known gaps. It is not the target-state redesign; see
[`ui-fix.md`](ui-fix.md) for that implementation plan.

## Entry point and navigation

The Finance sidebar has one item, **Finance**, visible to roles for which
`capabilitiesForFinance(role).viewModule` is true. It opens `/finance`.

`/finance` is a Server Component. It loads the authenticated, agency-scoped
Finance snapshot, resolves the requested URL state against the caller's
capabilities, and passes only authorised data to the client workspace.

The current URL contract is:

| URL | Current effect |
| --- | --- |
| `/finance?view=overview` | Opens the summary/attention tab for full Finance users. |
| `/finance?view=receivables&subview=balances` | Opens customer receivables. |
| `/finance?view=receivables&subview=payments` | Opens the payment ledger. |
| `/finance?view=receivables&subview=invoices` | Opens invoices. |
| `/finance?view=receivables&subview=adjustments` | Opens refunds and adjustments. |
| `/finance?view=payables` | Opens supplier payables. |
| `/finance?view=reconciliation` | Opens bank reconciliation. |

The workspace still renders its existing seven-tab presentation: Overview,
Customer Receivables, Payments, Invoices, Supplier Payables, Refunds &
Adjustments, and Reconciliation. The URL resolver is the new canonical
contract; the visual grouping into Receivables subviews is not yet complete.

An unknown, repeated, malformed, or inaccessible `view`/`subview` falls back
to the first safe destination. Operations and Marketing users fall back to
customer payment readiness rather than the financial overview.

## Data flow and security model

The Finance page follows the normal server-to-client layering:

```text
Finance page -> loadFinanceSnapshot -> finance repository -> Supabase with RLS
                         |
                         v
                  FinanceProvider -> FinanceWorkspace -> authorised tabs
```

`loadFinanceSnapshot()` obtains the current role and active-agency context,
then conditionally loads only the data supported by the capability matrix:

- receivables;
- payment ledger;
- invoices;
- supplier payables;
- refund summary and requests;
- booking options for record-payment and refund-request dialogs.

The repository is responsible for agency scoping and suppressing sensitive
fields before they reach the browser. UI visibility is therefore not the
security boundary. Every mutation continues through its existing server
action, validation, capability check, data-access implementation, audit
trail, and path revalidation.

## Roles and access

| Role | What the Finance page can show | What it can do |
| --- | --- | --- |
| ADMIN | All current tabs, costs, margins, and financial controls. | Records/verifies/reverses payments; manages invoices, supplier payments, reconciliation, refunds, and adjustments; may approve refunds/adjustments. |
| FINANCE | All current tabs and financial records. | Same operational work as Admin except refund/adjustment approval. |
| CEO | All current financial views, including supplier costs and margin. | Read-only; export is allowed, mutations are not. |
| OPERATIONS | Receivables/payment readiness only. | No ledger amounts, supplier costs, invoices, refunds, reconciliation, or financial writes. |
| MARKETING | Receivables/payment readiness only. | No finance writes or sensitive financial data. |
| VISA / GUIDE | No Finance module access. | No Finance route or actions. |

## Workspace features

### Overview

The Overview tab is the operational summary for roles that can see Finance
figures. It currently includes:

- KPI cards for collected this month, outstanding receivables, overdue amount,
  supplier payables due, and refund exposure;
- **Priority Follow-up**, a ranked collection queue built from receivables;
- **Group Finance Health**, a per-departure summary of expected revenue,
  collected amount, outstanding amount, overdue amount, supplier payables,
  collection progress, and readiness impact;
- links from cards and queue items to the relevant operational tab or
  departure group;
- a header **Record Payment** action when allowed;
- an export menu entry when the caller can export finance reports.

The legacy standalone Finance Overview implementation also contains an
optional Manasik Copilot cash-risk briefing. The current unified `/finance`
route uses the shared workspace overview rather than that legacy 12-metric
screen.

### Customer Receivables

Customer Receivables is the collections queue. It provides:

- saved views and search;
- filters for departure group, milestone type, finance owner, branch, and
  additional receivable states;
- sortable receivable rows with booking, contact, group, milestone, due date,
  amount, owner, and status data;
- record-payment entry points for authorised users;
- reminder and booking-navigation actions;
- payment-status-only redaction for Operations and Marketing;
- collection risk derived from payment milestones where the role may see it.

The receivables table is the intended parent for customer payment work, but
the present UI still shows Payments, Invoices, and Refunds as peer tabs.

### Payments

Payments is the ledger view. It shows recorded customer payment activity with:

- saved views: All, Today, This Month, Pending Verification, Unallocated,
  and Reversed & Voided;
- search by payment ID, booking, customer, or reference;
- sortable payment rows;
- payment-proof download where a proof exists;
- verification dialog for authorised users;
- reversal dialog for authorised users;
- the page-level and row-level Record Payment dialog for users with
  `recordPayments`.

Payment records are intentionally corrected through verification/reversal
workflows rather than deletion.

### Invoices

Invoices lists customer/supplier invoice records using the same server-loaded
Finance snapshot. It supports the capability-gated invoice workflow already
implemented by the page and its dialogs: creating, sending, and voiding an
invoice when allowed. `/finance/invoices/[invoiceId]` remains a standalone
invoice detail page for record-level review.

### Refunds and adjustments

This tab surfaces refund requests and finance adjustments. Its actions are
split deliberately:

- eligible staff can request refunds and apply adjustments;
- only Admin currently has approval capability for refunds/adjustments;
- users who lack `viewRefunds` do not receive this tab or its data.

The summary KPI reports pending request count and pending monetary exposure.

### Supplier Payables

Supplier Payables is the agency-wide queue of obligations derived from
supplier commitments. It shows due/overdue supplier liabilities and supports
the supplier-payment workflow for authorised staff. It is distinct from the
Suppliers module: Suppliers owns directory and commitment administration;
Finance owns the cross-supplier money queue.

### Reconciliation and period close

Reconciliation handles imported bank-statement lines and financial matching:

- unmatched, matched, and ignored bank lines;
- ranked payment/supplier-payment candidates;
- manual confirmation and optional split matching;
- extracted payer-name assistance used only to rank candidates, never to
  automatically decide a match;
- undo/restore controls for authorised staff;
- reconciliation period creation, close, and reopen;
- close checklist, including closing balance and cash-count confirmation.

A closed reconciliation period locks bank lines against new/undone matches at
the database layer. The UI is the workflow over that protection, not the
protection itself.

## Related Finance routes

| Route | Current status |
| --- | --- |
| `/finance/payments` | Legacy workspace entry. It loads the same snapshot and maps the old `tab` query to the new resolver where possible. |
| `/finance/invoices` | Dedicated wrapper around the shared workspace, initially selecting invoices. |
| `/finance/payables` | Dedicated wrapper around the shared workspace, initially selecting payables. |
| `/finance/refunds-credits` | Dedicated wrapper around the shared workspace, initially selecting adjustments/refunds. |
| `/finance/reconciliation` | Dedicated wrapper around the shared workspace, initially selecting reconciliation. |
| `/finance/payment-plans` | Separate milestone schedule page with overdue/due/rescheduled filters, collection risk, and due-date changes. It is planned to become a Receivables subview. |
| `/finance/departure-profitability` | Separate cross-group P&L page with margin and cash-negative filters. It is planned to become a Finance local view. |
| `/finance/commissions` | Redirects to Agent Portal commissions; Finance does not currently own commissions. |

## Known implementation gaps

- The Finance workspace's visual tab strip has not yet been replaced by the
  planned primary Finance views plus Receivables sub-navigation.
- Payment Plans and Departure P&L are separate pages, not workspace content.
- Legacy wrapper routes still render shared workspace shells rather than
  redirecting to canonical `/finance` URLs.
- Expenses is not an independent Finance feature. The product currently has
  supplier commitments/payables, not a general expense ledger.
- Commissions remain owned by the Agent Portal. A Finance commission view
  requires an explicit data-and-permission ownership decision.

## Source files

- `app/(main)/finance/page.tsx` - authenticated Finance entry route.
- `app/(main)/finance/payments/load-finance-snapshot.ts` - capability-gated
  server snapshot loader.
- `app/(main)/finance/payments/finance-store.tsx` - client context carrying
  authorised snapshot data.
- `app/(main)/finance/payments/components/finance-workspace.tsx` - shared
  page header, metrics, tabs, and action entry points.
- `lib/finance/workspace-navigation.ts` - typed URL resolver and canonical
  href builder.
- `lib/access/finance-access.ts` - Finance capability matrix.
