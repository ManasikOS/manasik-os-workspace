/**
 * Supplier payables block (docs/modules/dashboard-role-blocks-spec.md
 * section 3.2) — pure, client-safe.
 *
 * Totals are `computeSupplierKpis()` and the window is the module's own
 * `PAYMENT_DUE_WINDOW_DAYS`, so "due" means exactly what it means on the
 * Suppliers page. Amounts stay per currency - nothing in this module
 * converts. This only picks which suppliers need paying soonest.
 *
 * Carries no contact details. The rows' amounts are already zeroed by
 * `loadSupplierDirectory(db, can)` for a role without `viewCosts`.
 */

import type { SupplierPayableRow, SupplierPayablesData } from "@/lib/types/dashboard";

import { computeSupplierKpis, type SupplierListItem } from "./suppliers";
import { PAYMENT_DUE_WINDOW_DAYS } from "./suppliers-copy";

/** Top N suppliers plus a count of the rest — progressive disclosure, spec section 2. */
export const SUPPLIER_PAYABLES_ROW_LIMIT = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildSupplierPayables(items: SupplierListItem[], nowIso: string): SupplierPayablesData {
  const now = Date.parse(nowIso);
  const windowEnd = now + PAYMENT_DUE_WINDOW_DAYS * DAY_MS;
  const kpis = computeSupplierKpis(items, nowIso);

  // Same predicate `computeSupplierKpis` uses for `paymentsDueByCurrency`:
  // something owed, a due date, and that date inside the window (an overdue
  // date is simply earlier than `now`, so it is included and sorts first).
  const due = items
    .filter((i) => i.outstandingAmount > 0 && i.nextPaymentDueAt !== null && Date.parse(i.nextPaymentDueAt) <= windowEnd)
    .sort((a, b) => Date.parse(a.nextPaymentDueAt as string) - Date.parse(b.nextPaymentDueAt as string));

  const rows: SupplierPayableRow[] = due.slice(0, SUPPLIER_PAYABLES_ROW_LIMIT).map((i) => {
    const dueAt = i.nextPaymentDueAt as string;
    const dueMs = Date.parse(dueAt);
    return {
      supplierId: i.id,
      name: i.name,
      supplierType: i.supplierType,
      currency: i.currency,
      outstandingAmount: i.outstandingAmount,
      dueAt,
      daysUntilDue: Math.ceil((dueMs - now) / DAY_MS),
      overdue: dueMs < now,
      hasIssue: i.issueCount > 0,
    };
  });

  return {
    paymentsDueByCurrency: kpis.paymentsDueByCurrency,
    confirmationsPending: kpis.confirmationsPending,
    supplierIssues: kpis.supplierIssues,
    dueSupplierCount: due.length,
    suppliers: rows,
    totalSuppliers: items.length,
  };
}
