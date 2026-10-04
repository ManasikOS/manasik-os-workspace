/**
 * Labels, formatters, sort and filter helpers for the Team list. Mirrors
 * `app/(main)/suppliers/utils.ts`. Status/role labels and tone
 * vocabulary live in `lib/data/team-copy.ts` and `lib/data/team.ts` and are
 * re-exported here so components import from one place.
 */

export {
  ACCESS_REVIEW_DAYS,
  ACCOUNT_STATUS_LABELS,
  BRANCH_LABELS,
  branchLabel,
  EMPLOYMENT_TYPE_LABELS,
  RESPONSIBILITY_LABELS,
  SEASONAL_EXPIRY_WARNING_DAYS,
  WORKLOAD_BAND_LABELS,
} from "@/lib/data/team-copy";
export {
  accountStatusTone,
  effectiveAccountStatus,
  formatLastActive,
  isSeasonalExpired,
  needsAccessReview,
  seasonalAccessExpiringSoon,
  workloadBand,
  workloadTone,
} from "@/lib/data/team";
export { ROLE_LABELS } from "@/lib/access/team-access";

import { ROLE_LABELS } from "@/lib/access/team-access";
import { effectiveAccountStatus, needsAccessReview, workloadBand } from "@/lib/data/team";

import { ALL, type TeamFilters, type TeamMemberListItem, type TeamSavedView } from "./types";

/* ── Filtering ────────────────────────────────────────────────────────────── */

export function matchesTeamSearch(item: TeamMemberListItem, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    item.fullName.toLowerCase().includes(q) ||
    item.email.toLowerCase().includes(q) ||
    (item.whatsapp ?? "").toLowerCase().includes(q)
  );
}

export function matchesTeamFilters(item: TeamMemberListItem, filters: TeamFilters, nowIso: string): boolean {
  if (filters.role !== ALL && item.role !== filters.role) return false;
  if (filters.branch !== ALL && item.branch !== filters.branch) return false;
  if (filters.accountStatus !== ALL && effectiveAccountStatus(item, nowIso) !== filters.accountStatus) return false;
  if (filters.assignedGroup !== ALL) {
    const hasGroup = item.primaryGroups.some((g) => g.groupId === filters.assignedGroup);
    if (!hasGroup) return false;
  }
  if (filters.taskLoad !== ALL && workloadBand(item.openTaskCount) !== filters.taskLoad) return false;
  if (filters.lastActive === "NEEDS_REVIEW" && !needsAccessReview(item, nowIso)) return false;
  return true;
}

export function applyTeamSavedView(items: TeamMemberListItem[], view: TeamSavedView, nowIso: string): TeamMemberListItem[] {
  switch (view) {
    case "Active Staff":
      return items.filter((i) => effectiveAccountStatus(i, nowIso) === "ACTIVE");
    case "Seasonal Guides":
      return items.filter((i) => i.role === "GUIDE" && i.employmentType === "SEASONAL");
    case "Operations Team":
      return items.filter((i) => i.role === "OPERATIONS");
    case "Visa Team":
      return items.filter((i) => i.role === "VISA");
    case "Finance Team":
      return items.filter((i) => i.role === "FINANCE");
    case "Pending Invitations":
      return items.filter((i) => i.status === "INVITED");
    case "Deactivated Accounts":
      return items.filter((i) => i.status === "DEACTIVATED");
    case "Overloaded Staff":
      return items.filter((i) => workloadBand(i.openTaskCount) === "OVERLOADED");
    case "No Recent Activity":
      return items.filter((i) => needsAccessReview(i, nowIso));
    case "All Team Members":
    default:
      return items;
  }
}

export function activeFilterCount(filters: TeamFilters): number {
  return Object.values(filters).filter((v) => v !== ALL).length;
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export type TeamSortField = "fullName" | "role" | "openTaskCount" | "lastActiveAt";

export interface TeamSort {
  field: TeamSortField;
  direction: "asc" | "desc";
}

export const DEFAULT_TEAM_SORT: TeamSort = { field: "fullName", direction: "asc" };

export function sortTeamMembers(items: TeamMemberListItem[], sort: TeamSort): TeamMemberListItem[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sort.field) {
      case "role":
        return ROLE_LABELS[a.role].localeCompare(ROLE_LABELS[b.role]) * dir;
      case "openTaskCount":
        return (a.openTaskCount - b.openTaskCount) * dir;
      case "lastActiveAt":
        return ((Date.parse(a.lastActiveAt ?? "") || 0) - (Date.parse(b.lastActiveAt ?? "") || 0)) * dir;
      case "fullName":
      default:
        return a.fullName.localeCompare(b.fullName) * dir;
    }
  });
}
