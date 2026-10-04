import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";
import type { PilgrimSupportPriority, PilgrimSupportStatus } from "@/lib/types/pilgrims";

/**
 * Pure rules for the Support Cases queue (Operations → Support Cases and the
 * legacy /support-incidents page): who may see cases, which cases a filter
 * keeps, and the headline counts.
 */

export type SupportCaseStatusFilter = "OPEN_ALL" | "ALL" | PilgrimSupportStatus;
export type SupportCasePriorityFilter = "ALL" | PilgrimSupportPriority;

export interface SupportCaseFilters {
  search: string;
  status: SupportCaseStatusFilter;
  priority: SupportCasePriorityFilter;
}

export interface SupportCaseSummary {
  open: number;
  urgentUnresolved: number;
  inProgress: number;
  resolved: number;
  overdue: number;
}

/**
 * A case's `detail` can hold medical information whatever its category, so a
 * role needs either `viewMedical` or `manageSupportRequests` to see any case —
 * the same combined gate as each pilgrim's own Support tab.
 */
export function canViewSupportCases(
  can: Pick<PilgrimCapabilities, "viewModule" | "viewMedical" | "manageSupportRequests">,
): boolean {
  return can.viewModule && (can.viewMedical || can.manageSupportRequests);
}

const isUnresolved = (row: CrossPilgrimSupportRow) =>
  row.status === "OPEN" || row.status === "IN_PROGRESS";

export function isSupportCaseOverdue(row: CrossPilgrimSupportRow, now: number): boolean {
  return isUnresolved(row) && row.slaDueAt !== null && Date.parse(row.slaDueAt) < now;
}

export function filterSupportCases(
  rows: CrossPilgrimSupportRow[],
  { search, status, priority }: SupportCaseFilters,
): CrossPilgrimSupportRow[] {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (status === "OPEN_ALL" && !isUnresolved(row)) return false;
    if (status !== "OPEN_ALL" && status !== "ALL" && row.status !== status) return false;
    if (priority !== "ALL" && row.priority !== priority) return false;
    if (!needle) return true;
    return [row.title, row.detail ?? "", row.pilgrimName, row.groupName ?? "", row.groupCode ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function summariseSupportCases(
  rows: CrossPilgrimSupportRow[],
  now: number,
): SupportCaseSummary {
  return {
    open: rows.filter((row) => row.status === "OPEN").length,
    urgentUnresolved: rows.filter((row) => row.priority === "URGENT" && isUnresolved(row)).length,
    inProgress: rows.filter((row) => row.status === "IN_PROGRESS").length,
    resolved: rows.filter((row) => row.status === "RESOLVED").length,
    overdue: rows.filter((row) => isSupportCaseOverdue(row, now)).length,
  };
}

/**
 * A viewer restricted to their assigned groups (a Guide) only sees cases of
 * those groups. A case with no group cannot be tied to one, so it is dropped.
 */
export function restrictSupportCasesToGroups(
  rows: CrossPilgrimSupportRow[],
  assignedGroupIds: string[],
): CrossPilgrimSupportRow[] {
  return rows.filter(
    (row) => row.departureGroupId !== null && assignedGroupIds.includes(row.departureGroupId),
  );
}
