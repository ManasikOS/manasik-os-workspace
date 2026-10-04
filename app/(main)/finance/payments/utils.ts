/**
 * Labels, formatters and predicates for the Finance workspace. Money/date
 * formatting is re-exported from Departure Groups rather than re-implemented
 * — same convention as `app/(main)/suppliers/utils.ts`.
 */

export {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatExactCurrency,
  formatShortDate,
  departureCountdown,
} from "@/app/(main)/departure-groups/utils";

import { FINANCE_SAVED_VIEWS, type FinanceSavedView } from "@/lib/data/finance-copy";
import { deriveReceivableStatus } from "@/lib/data/finance";
import type { FinanceReceivableRow } from "@/lib/types/finance";

export { FINANCE_SAVED_VIEWS, type FinanceSavedView };

export interface FinanceFilters {
  departureGroupId: string;
  status: string;
  milestoneType: string;
  financeOwner: string;
  branch: string;
}

export const EMPTY_FINANCE_FILTERS: FinanceFilters = {
  departureGroupId: "ALL",
  status: "ALL",
  milestoneType: "ALL",
  financeOwner: "ALL",
  branch: "ALL",
};

export function activeFilterCount(filters: FinanceFilters): number {
  return Object.values(filters).filter((v) => v !== "ALL").length;
}

export function matchesFinanceSearch(row: FinanceReceivableRow, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    row.primary_contact_name.toLowerCase().includes(q) ||
    row.booking_reference.toLowerCase().includes(q) ||
    row.group_name.toLowerCase().includes(q) ||
    row.group_code.toLowerCase().includes(q) ||
    (row.finance_owner_name ?? "").toLowerCase().includes(q)
  );
}

export function matchesFinanceFilters(row: FinanceReceivableRow, filters: FinanceFilters, nowIso: string): boolean {
  if (filters.departureGroupId !== "ALL" && row.departure_group_id !== filters.departureGroupId) return false;
  if (filters.status !== "ALL" && deriveReceivableStatus(row, nowIso) !== filters.status) return false;
  if (filters.milestoneType !== "ALL" && row.next_milestone_type !== filters.milestoneType) return false;
  if (filters.financeOwner !== "ALL" && row.finance_owner_name !== filters.financeOwner) return false;
  if (filters.branch !== "ALL" && row.branch !== filters.branch) return false;
  return true;
}

export function applyFinanceSavedView(
  rows: FinanceReceivableRow[],
  view: FinanceSavedView,
  nowIso: string,
  currentStaffName: string | null,
): FinanceReceivableRow[] {
  const now = Date.parse(nowIso);
  const in14Days = now + 14 * 24 * 60 * 60 * 1000;

  switch (view) {
    case "All Receivables":
      return rows.filter((r) => r.booking_status !== "CANCELLED");
    case "Due Today":
      return rows.filter((r) => {
        if (!r.next_milestone_due_at) return false;
        const due = new Date(Date.parse(r.next_milestone_due_at));
        const today = new Date(now);
        return due.toDateString() === today.toDateString();
      });
    case "Overdue":
      return rows.filter((r) => r.overdue_milestone_count > 0);
    case "Deposit Pending":
      return rows.filter((r) => deriveReceivableStatus(r, nowIso) === "DEPOSIT_PENDING");
    case "Final Balance Due":
      return rows.filter((r) => r.next_milestone_type === "FINAL_BALANCE" && r.outstanding_balance > 0);
    case "Departing in 14 Days":
      return rows.filter((r) => Date.parse(r.departure_date) <= in14Days && Date.parse(r.departure_date) >= now);
    case "My Collection Queue":
      return rows.filter((r) => currentStaffName && r.finance_owner_name === currentStaffName);
    case "Paid in Full":
      return rows.filter((r) => r.outstanding_balance <= 0 && r.booking_status !== "CANCELLED");
    case "Cancelled Bookings":
      return rows.filter((r) => r.booking_status === "CANCELLED");
    default:
      return rows;
  }
}
