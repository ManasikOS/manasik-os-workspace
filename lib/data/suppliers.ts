/**
 * Client-safe derivations for the Supplier Directory — no `next/headers`, no
 * Supabase import, so the same functions run in the Server Component that
 * builds the directory/profile and in any Client Component re-deriving after
 * a mutation. Mirrors `lib/data/operations.ts` and `lib/data/pilgrims.ts`.
 *
 * The rows themselves are read server-side in `lib/data/suppliers-repository.ts`,
 * the only file that touches Supabase for this module.
 */

import { PAYMENT_DUE_WINDOW_DAYS } from "@/lib/data/suppliers-copy";
import type { Tone } from "@/lib/ui/tone";
import type {
  SupplierActivityEventRow,
  SupplierCommitmentPaymentStatus,
  SupplierCommitmentRow,
  SupplierContactRow,
  SupplierDirectoryRow,
  SupplierPaymentRow,
  SupplierRow,
  SupplierServiceRow,
} from "@/lib/types/suppliers";

/* ── Directory list item ──────────────────────────────────────────────────── */

export interface SupplierListItem {
  id: string;
  supplierCode: string;
  name: string;
  supplierType: string;
  status: string;
  reliability: string;
  reliabilityReason: string | null;
  city: string | null;
  country: string | null;
  currency: string;
  serviceCategories: string[];
  activeGroupCount: number;
  confirmedCount: number;
  pendingCount: number;
  issueCount: number;
  outstandingAmount: number;
  nextPaymentDueAt: string | null;
  primaryContactName: string | null;
  primaryContactWhatsapp: string | null;
  primaryContactPhone: string | null;
  createdAt: string;
}

export function toSupplierListItems(rows: SupplierDirectoryRow[]): SupplierListItem[] {
  return rows.map((row) => ({
    id: row.id,
    supplierCode: row.supplier_code,
    name: row.name,
    supplierType: row.supplier_type,
    status: row.status,
    reliability: row.reliability,
    reliabilityReason: row.reliability_reason,
    city: row.city,
    country: row.country,
    currency: row.currency,
    serviceCategories: row.service_categories ? row.service_categories.split(",").filter(Boolean) : [],
    activeGroupCount: row.active_group_count,
    confirmedCount: row.confirmed_count,
    pendingCount: row.pending_count,
    issueCount: row.issue_count,
    outstandingAmount: row.outstanding_amount,
    nextPaymentDueAt: row.next_payment_due_at,
    primaryContactName: row.primary_contact_name,
    primaryContactWhatsapp: row.primary_contact_whatsapp,
    primaryContactPhone: row.primary_contact_phone,
    createdAt: row.created_at,
  }));
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface SupplierKpis {
  activeSuppliers: number;
  activeCommitments: number;
  confirmationsPending: number;
  /** Per currency — no FX conversion happens anywhere in this module. */
  paymentsDueByCurrency: Record<string, number>;
  supplierIssues: number;
}

export function computeSupplierKpis(items: SupplierListItem[], nowIso: string): SupplierKpis {
  const now = Date.parse(nowIso);
  const windowEnd = now + PAYMENT_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const activeSuppliers = items.filter((i) => i.status === "ACTIVE").length;
  const activeCommitments = items.reduce((sum, i) => sum + i.confirmedCount + i.pendingCount, 0);
  const confirmationsPending = items.reduce((sum, i) => sum + i.pendingCount, 0);
  const supplierIssues = items.reduce((sum, i) => sum + i.issueCount, 0);

  const paymentsDueByCurrency: Record<string, number> = {};
  for (const item of items) {
    if (!item.nextPaymentDueAt || item.outstandingAmount <= 0) continue;
    const due = Date.parse(item.nextPaymentDueAt);
    if (due > windowEnd) continue;
    paymentsDueByCurrency[item.currency] = (paymentsDueByCurrency[item.currency] ?? 0) + item.outstandingAmount;
  }

  return { activeSuppliers, activeCommitments, confirmationsPending, paymentsDueByCurrency, supplierIssues };
}

/** The KPI card shows the largest currency, "+N more" for the rest. */
export function largestCurrencyDue(paymentsDueByCurrency: Record<string, number>): {
  currency: string | null;
  amount: number;
  otherCount: number;
} {
  const entries = Object.entries(paymentsDueByCurrency).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { currency: null, amount: 0, otherCount: 0 };
  const [currency, amount] = entries[0];
  return { currency, amount, otherCount: entries.length - 1 };
}

/* ── Tones ────────────────────────────────────────────────────────────────── */

export function reliabilityTone(reliability: string): Tone {
  switch (reliability) {
    case "RELIABLE":
      return "success";
    case "NEEDS_ATTENTION":
      return "warning";
    case "ON_HOLD":
      return "danger";
    default:
      return "neutral";
  }
}

export function commitmentStatusTone(status: string): Tone {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "success";
    case "SUPPLIER_RESPONDED":
      return "info";
    case "REQUESTED":
      return "warning";
    case "DISPUTED":
      return "danger";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

export function confirmationHealthTone(item: Pick<SupplierListItem, "issueCount" | "pendingCount">): Tone {
  if (item.issueCount > 0) return "danger";
  if (item.pendingCount > 0) return "warning";
  return "success";
}

/* ── Commitment payment status — derived, never stored (see migration D) ────── */

export function commitmentPaymentStatus(
  commitment: Pick<SupplierCommitmentRow, "amount" | "amount_paid" | "payment_due_at" | "status">,
  nowIso: string,
): SupplierCommitmentPaymentStatus {
  const amount = commitment.amount ?? 0;
  if (amount <= 0) return "PAID";
  if (commitment.amount_paid >= amount) return "PAID";
  if (
    commitment.payment_due_at &&
    Date.parse(commitment.payment_due_at) < Date.parse(nowIso) &&
    commitment.status !== "CANCELLED" &&
    commitment.status !== "COMPLETED"
  ) {
    return "OVERDUE";
  }
  return commitment.amount_paid > 0 ? "PARTIAL" : "UNPAID";
}

export function paymentStatusTone(status: SupplierCommitmentPaymentStatus): Tone {
  switch (status) {
    case "PAID":
      return "success";
    case "PARTIAL":
      return "info";
    case "OVERDUE":
      return "danger";
    default:
      return "neutral";
  }
}

/* ── Supplier profile view model ─────────────────────────────────────────── */

export interface SupplierProfileStats {
  activeGroups: number;
  servicesConfirmed: number;
  servicesTotal: number;
  pendingConfirmations: number;
  paymentDueByCurrency: Record<string, number>;
}

export interface SupplierProfile {
  supplier: SupplierRow;
  services: SupplierServiceRow[];
  contacts: SupplierContactRow[];
  commitments: SupplierCommitmentRow[];
  payments: SupplierPaymentRow[];
  activity: SupplierActivityEventRow[];
  stats: SupplierProfileStats;
}

export function buildSupplierProfile(bundle: {
  supplier: SupplierRow;
  services: SupplierServiceRow[];
  contacts: SupplierContactRow[];
  commitments: SupplierCommitmentRow[];
  payments: SupplierPaymentRow[];
  activity: SupplierActivityEventRow[];
}): SupplierProfile {
  const { commitments } = bundle;
  const active = commitments.filter((c) => c.status === "REQUESTED" || c.status === "SUPPLIER_RESPONDED" || c.status === "CONFIRMED");

  const activeGroups = new Set(active.map((c) => c.departure_group_id)).size;
  const servicesConfirmed = commitments.filter((c) => c.status === "CONFIRMED" || c.status === "COMPLETED").length;
  const servicesTotal = commitments.filter((c) => c.status !== "CANCELLED").length;
  const pendingConfirmations = commitments.filter((c) => c.status === "REQUESTED" || c.status === "SUPPLIER_RESPONDED").length;

  const paymentDueByCurrency: Record<string, number> = {};
  for (const c of commitments) {
    if (c.status === "CANCELLED" || !c.amount) continue;
    const outstanding = c.amount - c.amount_paid;
    if (outstanding <= 0) continue;
    paymentDueByCurrency[c.currency] = (paymentDueByCurrency[c.currency] ?? 0) + outstanding;
  }

  return {
    ...bundle,
    stats: { activeGroups, servicesConfirmed, servicesTotal, pendingConfirmations, paymentDueByCurrency },
  };
}
