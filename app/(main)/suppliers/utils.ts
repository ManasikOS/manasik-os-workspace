/**
 * Labels, formatters, sort and filter helpers for the Supplier Directory list.
 * Mirrors `app/(main)/pilgrims/utils.ts`. Status/type labels and tone
 * vocabulary live in `lib/data/suppliers-copy.ts` and `lib/data/suppliers.ts`
 * and are re-exported here so components import from one place.
 */

export {
  COMMITMENT_STATUS_LABELS,
  CURRENCY_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TERMS_LABELS,
  PREFERRED_CHANNEL_LABELS,
  RELIABILITY_LABELS,
  SEASON_LABELS,
  SERVICE_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
} from "@/lib/data/suppliers-copy";
export {
  commitmentPaymentStatus,
  commitmentStatusTone,
  confirmationHealthTone,
  largestCurrencyDue,
  paymentStatusTone,
  reliabilityTone,
} from "@/lib/data/suppliers";

import { ALL, type SupplierFilters, type SupplierListItem, type SupplierSavedView } from "./types";

/* ── Formatters ───────────────────────────────────────────────────────────── */

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US")}`;
}

export function daysUntilLabel(iso: string | null, nowIso: string): string {
  if (!iso) return "—";
  const days = Math.ceil((Date.parse(iso) - Date.parse(nowIso)) / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

export function whatsappLink(number: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

export function confirmationHealthLabel(item: Pick<SupplierListItem, "confirmedCount" | "pendingCount">): string {
  const parts: string[] = [];
  if (item.confirmedCount > 0) parts.push(`${item.confirmedCount} confirmed`);
  if (item.pendingCount > 0) parts.push(`${item.pendingCount} pending`);
  return parts.length > 0 ? parts.join(" · ") : "No commitments";
}

export function paymentStatusLabel(item: Pick<SupplierListItem, "outstandingAmount" | "nextPaymentDueAt" | "currency">, nowIso: string): string {
  if (item.outstandingAmount <= 0) return "Up to date";
  if (item.nextPaymentDueAt && Date.parse(item.nextPaymentDueAt) < Date.parse(nowIso)) {
    return `${formatMoney(item.outstandingAmount, item.currency)} overdue`;
  }
  return `${formatMoney(item.outstandingAmount, item.currency)} ${item.nextPaymentDueAt ? daysUntilLabel(item.nextPaymentDueAt, nowIso).toLowerCase() : "outstanding"}`;
}

/* ── Filtering ────────────────────────────────────────────────────────────── */

export function matchesSupplierSearch(item: SupplierListItem, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    item.supplierCode.toLowerCase().includes(q) ||
    (item.city ?? "").toLowerCase().includes(q) ||
    (item.primaryContactName ?? "").toLowerCase().includes(q) ||
    (item.primaryContactWhatsapp ?? "").toLowerCase().includes(q)
  );
}

export function matchesSupplierFilters(item: SupplierListItem, filters: SupplierFilters): boolean {
  if (filters.supplierType !== ALL && item.supplierType !== filters.supplierType) return false;
  if (filters.serviceCategory !== ALL && !item.serviceCategories.includes(filters.serviceCategory)) return false;
  if (filters.location !== ALL && item.city !== filters.location) return false;
  if (filters.activeStatus !== ALL && item.status !== filters.activeStatus) return false;
  if (filters.reliability !== ALL && item.reliability !== filters.reliability) return false;
  if (filters.commitmentStatus !== ALL) {
    if (filters.commitmentStatus === "PENDING" && item.pendingCount === 0) return false;
    if (filters.commitmentStatus === "CONFIRMED" && item.confirmedCount === 0) return false;
    if (filters.commitmentStatus === "ISSUES" && item.issueCount === 0) return false;
  }
  if (filters.paymentStatus !== ALL) {
    if (filters.paymentStatus === "DUE" && item.outstandingAmount <= 0) return false;
    if (filters.paymentStatus === "CLEAR" && item.outstandingAmount > 0) return false;
  }
  return true;
}

export function applySavedView(items: SupplierListItem[], view: SupplierSavedView): SupplierListItem[] {
  switch (view) {
    case "Makkah Suppliers":
      return items.filter((i) => (i.city ?? "").toLowerCase() === "makkah");
    case "Madinah Suppliers":
      return items.filter((i) => (i.city ?? "").toLowerCase() === "madinah");
    case "Hotels":
      return items.filter((i) => i.supplierType === "HOTEL");
    case "Transport Providers":
      return items.filter((i) => i.supplierType === "TRANSPORT");
    case "Catering":
      return items.filter((i) => i.supplierType === "CATERING");
    case "Ticketing Agents":
      return items.filter((i) => i.supplierType === "TICKETING");
    case "Brokers":
      return items.filter((i) => i.supplierType === "BROKER");
    case "Active Group Commitments":
      return items.filter((i) => i.activeGroupCount > 0);
    case "Confirmations Pending":
      return items.filter((i) => i.pendingCount > 0);
    case "Inactive Suppliers":
      return items.filter((i) => i.status === "INACTIVE");
    case "All Suppliers":
    default:
      return items;
  }
}

export function activeFilterCount(filters: SupplierFilters): number {
  return Object.values(filters).filter((v) => v !== ALL).length;
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export type SupplierSortField = "name" | "activeGroupCount" | "outstandingAmount" | "reliability";

export interface SupplierSort {
  field: SupplierSortField;
  direction: "asc" | "desc";
}

export const DEFAULT_SUPPLIER_SORT: SupplierSort = { field: "name", direction: "asc" };

export function sortSuppliers(items: SupplierListItem[], sort: SupplierSort): SupplierListItem[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sort.field) {
      case "activeGroupCount":
        return (a.activeGroupCount - b.activeGroupCount) * dir;
      case "outstandingAmount":
        return (a.outstandingAmount - b.outstandingAmount) * dir;
      case "reliability":
        return a.reliability.localeCompare(b.reliability) * dir;
      case "name":
      default:
        return a.name.localeCompare(b.name) * dir;
    }
  });
}
