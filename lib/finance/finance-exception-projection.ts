import { deriveSupplierPayableStatus } from "@/lib/data/finance";
import type {
  FinanceReceivableRow,
  FinanceRefundRequestRow,
  FinanceSupplierPayableRow,
} from "@/lib/types/finance";

import {
  rankFinanceExceptionPriorities,
  type FinanceExceptionReasonCode,
  type FinanceExceptionSignal,
} from "./finance-exception-priority";

export type FinanceExceptionSource = "RECEIVABLE" | "REFUND" | "SUPPLIER_PAYABLE";

export interface FinanceExceptionItem {
  id: string;
  source: FinanceExceptionSource;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  priorityScore: number;
  reasonCodes: FinanceExceptionReasonCode[];
  currency: string;
  amount: number | null;
}

export interface FinanceExceptionProjection {
  items: FinanceExceptionItem[];
  byCurrency: Record<string, FinanceExceptionItem[]>;
}

export interface FinanceExceptionProjectionInput {
  receivables: readonly FinanceReceivableRow[];
  supplierPayables: readonly FinanceSupplierPayableRow[];
  refundRequests: readonly FinanceRefundRequestRow[];
  nowIso: string;
  /** Readiness-only roles must not receive financial amounts. */
  includeAmounts: boolean;
}

type ExceptionSourceCandidate = {
  id: string;
  source: FinanceExceptionSource;
  signal: FinanceExceptionSignal;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  currency: string;
  amount: number | null;
  overdueDays?: number | null;
  overdueMilestoneCount?: number;
};

const EXCEPTION_HREF = {
  receivables: "/finance?view=receivables&subview=balances",
  refunds: "/finance?view=receivables&subview=adjustments",
  payables: "/finance?view=payables",
} as const;

function overdueDays(dueAt: string | null, nowIso: string): number | null {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return null;
  return Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(dueAt)) / 86_400_000));
}

function sourceCandidates(input: FinanceExceptionProjectionInput): ExceptionSourceCandidate[] {
  const candidates: ExceptionSourceCandidate[] = [];
  for (const row of input.receivables) {
    if (row.booking_status === "CANCELLED" || row.outstanding_balance <= 0) continue;
    const dueAt = row.next_milestone_due_at ? Date.parse(row.next_milestone_due_at) : Number.NaN;
    const now = Date.parse(input.nowIso);
    const dueSoon = Number.isFinite(dueAt) && dueAt >= now && dueAt - now <= 7 * 86_400_000;
    const signal = row.overdue_milestone_count > 0 ? "OVERDUE_RECEIVABLE" : dueSoon ? "DUE_SOON_RECEIVABLE" : null;
    if (!signal) continue;
    candidates.push({
      id: `receivable:${row.booking_id}`,
      source: "RECEIVABLE",
      signal,
      title: signal === "OVERDUE_RECEIVABLE" ? `Payment overdue — ${row.primary_contact_name}` : `Payment due soon — ${row.primary_contact_name}`,
      description: `${row.booking_reference} · ${row.next_milestone_label ?? "Next payment"}`,
      href: EXCEPTION_HREF.receivables,
      actionLabel: "Open receivable",
      currency: row.currency,
      amount: input.includeAmounts ? (signal === "OVERDUE_RECEIVABLE" ? row.overdue_amount : row.outstanding_balance) : null,
      overdueDays: overdueDays(row.next_milestone_due_at, input.nowIso),
      overdueMilestoneCount: row.overdue_milestone_count,
    });
  }

  for (const row of input.refundRequests) {
    if (row.status !== "PENDING_APPROVAL") continue;
    candidates.push({
      id: `refund:${row.id}`,
      source: "REFUND",
      signal: "PENDING_REFUND",
      title: `Refund awaiting approval — ${row.primary_contact_name}`,
      description: `${row.reference} · ${row.group_name}`,
      href: EXCEPTION_HREF.refunds,
      actionLabel: "Open refund",
      currency: row.currency,
      amount: input.includeAmounts ? row.amount : null,
    });
  }

  for (const row of input.supplierPayables) {
    const status = deriveSupplierPayableStatus(row, input.nowIso);
    const signal = status === "DISPUTED" ? "DISPUTED_SUPPLIER" : status === "OVERDUE" ? "OVERDUE_SUPPLIER" : null;
    if (!signal) continue;
    candidates.push({
      id: `supplier:${row.commitment_id}`,
      source: "SUPPLIER_PAYABLE",
      signal,
      title: signal === "DISPUTED_SUPPLIER" ? `Supplier commitment disputed — ${row.supplier_name}` : `Supplier payment overdue — ${row.supplier_name}`,
      description: `${row.reference_code} · ${row.group_name}`,
      href: EXCEPTION_HREF.payables,
      actionLabel: "Open payable",
      currency: row.currency,
      amount: input.includeAmounts ? row.outstanding_amount : null,
    });
  }
  return candidates;
}

/** Builds a caller-safe, currency-separated projection from already authorised source rows. */
export function buildFinanceExceptionProjection(input: FinanceExceptionProjectionInput): FinanceExceptionProjection {
  const candidates = sourceCandidates(input);
  const ranked = rankFinanceExceptionPriorities(candidates);
  const sourceById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const items = ranked.map((rankedItem) => {
    const source = sourceById.get(rankedItem.id)!;
    return {
      id: source.id,
      source: source.source,
      title: source.title,
      description: source.description,
      href: source.href,
      actionLabel: source.actionLabel,
      priorityScore: rankedItem.score,
      reasonCodes: rankedItem.reasonCodes,
      currency: source.currency,
      amount: source.amount,
    };
  });
  const byCurrency: Record<string, FinanceExceptionItem[]> = {};
  for (const item of items) (byCurrency[item.currency] ??= []).push(item);
  return { items, byCurrency };
}
