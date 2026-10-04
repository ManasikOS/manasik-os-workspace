/**
 * Client-safe derivations for Payments & Invoices — no `next/headers`, no
 * Supabase import, so the same functions run in the Server Component that
 * builds the snapshot and in any Client Component re-deriving after a
 * mutation. Mirrors `lib/data/suppliers.ts` / `lib/data/operations.ts`.
 *
 * The rows themselves are read server-side in `lib/data/finance-repository.ts`,
 * the only file that touches Supabase for this module.
 */

import {
  DUE_SOON_WINDOW_DAYS,
  PRIORITY_QUEUE_CAP,
  SUPPLIER_PAYABLE_WINDOW_DAYS,
} from "@/lib/data/finance-copy";
import type { Tone } from "@/lib/ui/tone";
import type {
  FinanceInvoiceRow,
  FinanceMilestoneRow,
  FinancePaymentRow,
  FinanceReceivableRow,
  FinanceSupplierPayableRow,
  InvoiceStatus,
  PaymentPlanStatus,
  ReceivableStatus,
  SupplierPayableStatus,
} from "@/lib/types/finance";

/* ── Receivable status (plan §4.4 — milestone-level, never booking.next_due_at) ── */

/**
 * The single source of truth for a booking's receivable status. Evaluated in
 * order — the first match wins, so a cancelled booking is never "overdue"
 * and an overdue balance is never softened to "due soon" (plan F4).
 */
export function deriveReceivableStatus(row: FinanceReceivableRow, nowIso: string): ReceivableStatus {
  const now = Date.parse(nowIso);

  if (row.booking_status === "CANCELLED") return "CANCELLED";
  if (row.open_refund_count > 0) return "REFUND_PENDING";
  if (row.outstanding_balance <= 0) return "PAID_IN_FULL";
  if (row.overdue_milestone_count > 0) return "OVERDUE";

  if (row.next_milestone_due_at) {
    const dueSoonEdge = now + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.parse(row.next_milestone_due_at) <= dueSoonEdge) return "DUE_SOON";
  }

  if (row.advance_deposit !== null && row.amount_paid < row.advance_deposit) {
    return "DEPOSIT_PENDING";
  }
  if (row.amount_paid > 0) return "PARTIALLY_PAID";
  return "ON_TRACK";
}

export const RECEIVABLE_STATUS_TONE: Record<ReceivableStatus, Tone> = {
  CANCELLED: "neutral",
  REFUND_PENDING: "info",
  PAID_IN_FULL: "success",
  OVERDUE: "danger",
  DUE_SOON: "warning",
  DEPOSIT_PENDING: "warning",
  PARTIALLY_PAID: "info",
  ON_TRACK: "neutral",
};

/* ── Payment plan (milestone) status ─────────────────────────────────────── */

/**
 * One instalment's status, evaluated in order so a cancelled booking's
 * milestone is never "overdue" and a waived one is never "due" — same
 * first-match-wins posture as `deriveReceivableStatus`.
 */
export function derivePlanStatus(row: FinanceMilestoneRow, nowIso: string): PaymentPlanStatus {
  if (row.booking_status === "CANCELLED") return "CANCELLED";
  if (row.waived) return "WAIVED";
  if (row.amount <= 0) return "COMPLETED";
  if (row.paid_amount >= row.amount && row.amount > 0) return "COMPLETED";
  if (!row.due_at) return "NO_DUE_DATE";

  const now = new Date(nowIso);
  const due = new Date(row.due_at);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const daysUntilDue = Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86_400_000);

  if (daysUntilDue < 0) return "OVERDUE";
  if (daysUntilDue === 0) return "DUE_TODAY";
  if (daysUntilDue <= 7) return "DUE_THIS_WEEK";
  return "UPCOMING";
}

export const PAYMENT_PLAN_STATUS_TONE: Record<PaymentPlanStatus, Tone> = {
  CANCELLED: "neutral",
  COMPLETED: "success",
  WAIVED: "neutral",
  OVERDUE: "danger",
  DUE_TODAY: "warning",
  DUE_THIS_WEEK: "warning",
  UPCOMING: "neutral",
  NO_DUE_DATE: "neutral",
};

export const PAYMENT_PLAN_STATUS_LABEL: Record<PaymentPlanStatus, string> = {
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  WAIVED: "Waived",
  OVERDUE: "Overdue",
  DUE_TODAY: "Due Today",
  DUE_THIS_WEEK: "Due This Week",
  UPCOMING: "Upcoming",
  NO_DUE_DATE: "No Due Date",
};

/** A milestone whose due date has been changed at least once since creation. */
export function isRescheduledPlan(row: FinanceMilestoneRow): boolean {
  return row.due_at_previous !== null;
}

/* ── Supplier payable status ─────────────────────────────────────────────── */

export function deriveSupplierPayableStatus(row: FinanceSupplierPayableRow, nowIso: string): SupplierPayableStatus {
  const now = Date.parse(nowIso);

  if (row.commitment_status === "CANCELLED") return "CANCELLED";
  if (row.commitment_status === "DISPUTED") return "DISPUTED";
  if (row.outstanding_amount <= 0) return "PAID";
  if (row.amount_paid > 0) return "PARTIALLY_PAID";
  if (row.payment_due_at) {
    const due = Date.parse(row.payment_due_at);
    if (due < now) return "OVERDUE";
    const soonEdge = now + SUPPLIER_PAYABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (due <= soonEdge) return "DUE_SOON";
  }
  return "NOT_DUE";
}

export const SUPPLIER_PAYABLE_STATUS_TONE: Record<SupplierPayableStatus, Tone> = {
  NOT_DUE: "neutral",
  DUE_SOON: "warning",
  OVERDUE: "danger",
  PARTIALLY_PAID: "info",
  PAID: "success",
  DISPUTED: "danger",
  CANCELLED: "neutral",
};

/* ── Invoice status ───────────────────────────────────────────────────────── */

export function invoiceDisplayStatus(row: FinanceInvoiceRow): InvoiceStatus {
  // status is stored (plan D6) — an invoice's overdue-ness is a fact about
  // a document that was sent, not a live computation.
  return row.status;
}

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PAID: "success",
  OVERDUE: "danger",
  VOID: "neutral",
};

/* ── Payment ledger status ───────────────────────────────────────────────── */

export const PAYMENT_STATUS_TONE: Record<string, Tone> = {
  COMPLETED: "success",
  PENDING_VERIFICATION: "warning",
  FAILED: "danger",
  REVERSED: "neutral",
  REFUNDED: "info",
  VOIDED: "neutral",
};

/* ── Refund request status ───────────────────────────────────────────────── */

export const REFUND_STATUS_TONE: Record<string, Tone> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  PAID: "success",
  CANCELLED: "neutral",
};

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface FinanceKpis {
  collectedThisMonth: number;
  collectedThisMonthCurrency: string;
  collectedThisMonthByCurrency: Record<string, number>;
  outstandingReceivables: number;
  outstandingReceivablesByCurrency: Record<string, number>;
  outstandingReceivablesCount: number;
  overdueAmount: number;
  overdueAmountByCurrency: Record<string, number>;
  overdueCount: number;
  /** Per currency — no FX conversion happens anywhere in this module (plan D1). */
  supplierPayablesDueByCurrency: Record<string, number>;
  supplierPayablesUndatedByCurrency: Record<string, number>;
  refundsPendingCount: number;
  refundsPendingAmount: number;
}

export function computeFinanceKpis(
  receivables: FinanceReceivableRow[],
  payments: FinancePaymentRow[],
  supplierPayables: FinanceSupplierPayableRow[],
  refundsPendingAmount: number,
  refundsPendingCount: number,
  nowIso: string,
): FinanceKpis {
  const now = new Date(nowIso);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  const collectedThisMonthByCurrency: Record<string, number> = {};
  for (const payment of payments) {
    const paidAt = Date.parse(payment.paid_at);
    if (payment.status !== "COMPLETED" || payment.amount <= 0 || paidAt < monthStart || paidAt > now.getTime()) continue;
    collectedThisMonthByCurrency[payment.currency] =
      (collectedThisMonthByCurrency[payment.currency] ?? 0) + payment.amount;
  }
  const collectedThisMonth = Object.values(collectedThisMonthByCurrency).reduce((sum, amount) => sum + amount, 0);

  const outstandingReceivablesByCurrency: Record<string, number> = {};
  for (const row of receivables) {
    if (row.outstanding_balance <= 0) continue;
    outstandingReceivablesByCurrency[row.currency] =
      (outstandingReceivablesByCurrency[row.currency] ?? 0) + row.outstanding_balance;
  }
  const outstandingReceivables = Object.values(outstandingReceivablesByCurrency).reduce((sum, amount) => sum + amount, 0);
  const outstandingReceivablesCount = receivables.filter((r) => r.outstanding_balance > 0).length;

  const overdueRows = receivables.filter((r) => r.overdue_milestone_count > 0);
  const overdueAmountByCurrency: Record<string, number> = {};
  for (const row of overdueRows) {
    overdueAmountByCurrency[row.currency] =
      (overdueAmountByCurrency[row.currency] ?? 0) + row.overdue_amount;
  }
  const overdueAmount = Object.values(overdueAmountByCurrency).reduce((sum, amount) => sum + amount, 0);

  const windowEnd = Date.parse(nowIso) + SUPPLIER_PAYABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const supplierPayablesDueByCurrency: Record<string, number> = {};
  const supplierPayablesUndatedByCurrency: Record<string, number> = {};
  for (const row of supplierPayables) {
    if (row.outstanding_amount <= 0) continue;
    if (!row.payment_due_at) {
      supplierPayablesUndatedByCurrency[row.currency] =
        (supplierPayablesUndatedByCurrency[row.currency] ?? 0) + row.outstanding_amount;
      continue;
    }
    if (Date.parse(row.payment_due_at) > windowEnd) continue;
    supplierPayablesDueByCurrency[row.currency] =
      (supplierPayablesDueByCurrency[row.currency] ?? 0) + row.outstanding_amount;
  }

  return {
    collectedThisMonth,
    collectedThisMonthCurrency: Object.entries(collectedThisMonthByCurrency).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "LKR",
    collectedThisMonthByCurrency,
    outstandingReceivables,
    outstandingReceivablesByCurrency,
    outstandingReceivablesCount,
    overdueAmount,
    overdueAmountByCurrency,
    overdueCount: overdueRows.length,
    supplierPayablesDueByCurrency,
    supplierPayablesUndatedByCurrency,
    refundsPendingCount,
    refundsPendingAmount,
  };
}

/** The KPI card shows the largest currency, "+N more" for the rest (plan D1). */
export function largestCurrencyDue(byCurrency: Record<string, number>): {
  currency: string | null;
  amount: number;
  otherCount: number;
} {
  const entries = Object.entries(byCurrency).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { currency: null, amount: 0, otherCount: 0 };
  const [currency, amount] = entries[0];
  return { currency, amount, otherCount: entries.length - 1 };
}

/* ── Priority collection queue ───────────────────────────────────────────── */

export interface PriorityQueueItem {
  bookingId: string;
  customerName: string;
  bookingReference: string;
  groupName: string;
  milestoneLabel: string;
  amountDue: number;
  currency: string;
  dueAt: string | null;
  overdueDays: number;
  financeOwnerName: string | null;
  duePhrase: string;
}

function duePhrase(dueAt: string | null, overdueDays: number): string {
  if (overdueDays > 0) return `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}`;
  if (!dueAt) return "No due date";
  const days = Math.ceil((Date.parse(dueAt) - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

/**
 * Ranked by overdue days desc, then soonest due date, then largest amount —
 * so the queue leads with what is actually most urgent to chase.
 */
export function buildPriorityQueue(receivables: FinanceReceivableRow[], nowIso: string): PriorityQueueItem[] {
  const now = Date.parse(nowIso);

  return receivables
    .filter((r) => r.booking_status !== "CANCELLED" && r.next_milestone_id && r.outstanding_balance > 0)
    .map((r) => {
      const overdueDays =
        r.next_milestone_due_at && Date.parse(r.next_milestone_due_at) < now
          ? Math.floor((now - Date.parse(r.next_milestone_due_at)) / (24 * 60 * 60 * 1000))
          : 0;
      const amountDue = Math.max((r.next_milestone_amount ?? 0) - (r.next_milestone_paid ?? 0), 0);
      return {
        bookingId: r.booking_id,
        customerName: r.primary_contact_name,
        bookingReference: r.booking_reference,
        groupName: r.group_name,
        milestoneLabel: r.next_milestone_label ?? "Balance",
        amountDue,
        currency: r.currency,
        dueAt: r.next_milestone_due_at,
        overdueDays,
        financeOwnerName: r.finance_owner_name,
        duePhrase: duePhrase(r.next_milestone_due_at, overdueDays),
      };
    })
    .sort((a, b) => {
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
      const aDue = a.dueAt ? Date.parse(a.dueAt) : Infinity;
      const bDue = b.dueAt ? Date.parse(b.dueAt) : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return b.amountDue - a.amountDue;
    })
    .slice(0, PRIORITY_QUEUE_CAP);
}

/* ── Group finance health ────────────────────────────────────────────────── */

export interface GroupFinanceHealth {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  expectedRevenue: number;
  collected: number;
  outstanding: number;
  overdue: number;
  supplierPayables: number;
  currency: string;
  collectedPercent: number;
  readinessImpact: "On Track" | "At Risk";
}

export function buildGroupFinanceHealth(
  receivables: FinanceReceivableRow[],
  supplierPayables: FinanceSupplierPayableRow[],
): GroupFinanceHealth[] {
  const byGroup = new Map<string, FinanceReceivableRow[]>();
  for (const row of receivables) {
    if (row.booking_status === "CANCELLED") continue;
    const list = byGroup.get(row.departure_group_id);
    if (list) list.push(row);
    else byGroup.set(row.departure_group_id, [row]);
  }

  const payablesByGroup = new Map<string, number>();
  for (const row of supplierPayables) {
    payablesByGroup.set(
      row.departure_group_id,
      (payablesByGroup.get(row.departure_group_id) ?? 0) + row.outstanding_amount,
    );
  }

  return Array.from(byGroup.entries()).map(([groupId, rows]) => {
    const expectedRevenue = rows.reduce((sum, r) => sum + r.total_booking_value, 0);
    const collected = rows.reduce((sum, r) => sum + r.amount_paid, 0);
    const outstanding = rows.reduce((sum, r) => sum + r.outstanding_balance, 0);
    const overdue = rows.reduce((sum, r) => sum + r.overdue_amount, 0);
    const collectedPercent = expectedRevenue === 0 ? 0 : Math.round((collected / expectedRevenue) * 100);

    return {
      departureGroupId: groupId,
      groupName: rows[0].group_name,
      groupCode: rows[0].group_code,
      expectedRevenue,
      collected,
      outstanding,
      overdue,
      supplierPayables: payablesByGroup.get(groupId) ?? 0,
      currency: rows[0].currency,
      collectedPercent,
      readinessImpact: overdue > 0 ? "At Risk" : "On Track",
    };
  });
}
