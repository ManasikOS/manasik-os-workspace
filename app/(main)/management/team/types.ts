/**
 * View models and UI-only types for the Team module.
 *
 * Row-level derivation lives in `lib/data/team.ts` (client-safe) and
 * `lib/data/team-repository.ts` (server only); the flat shapes they produce
 * are re-exported here so no component reaches past this file — same
 * convention as `app/(main)/suppliers/types.ts`.
 */

export type { TeamInvitationListItem, TeamKpis, TeamMemberListItem, WorkloadBand } from "@/lib/data/team";
export type { RoleAccessSummary, TeamCapabilities, TeamTabId } from "@/lib/access/team-access";
export type { StaffRole } from "@/lib/access/departure-groups-access";
export type {
  StaffAccountStatus,
  StaffActivityEventType,
  StaffActivityRow,
  StaffAssignmentResponsibility,
  StaffBranch,
  StaffEmploymentType,
  StaffGroupAssignmentRow,
  StaffInvitationChannel,
  StaffInvitationRow,
  StaffInvitationStatus,
  StaffProfileRow,
  TeamDirectoryRow,
} from "@/lib/types/team";

/* ── Saved views ──────────────────────────────────────────────────────────── */

export const TEAM_SAVED_VIEWS = [
  "All Team Members",
  "Active Staff",
  "Seasonal Guides",
  "Operations Team",
  "Visa Team",
  "Finance Team",
  "Pending Invitations",
  "Deactivated Accounts",
  "Overloaded Staff",
  "No Recent Activity",
] as const;

export type TeamSavedView = (typeof TEAM_SAVED_VIEWS)[number];

/* ── Filters ──────────────────────────────────────────────────────────────── */

export const ALL = "ALL";

export interface TeamFilters {
  role: string;
  branch: string;
  accountStatus: string;
  assignedGroup: string;
  taskLoad: string;
  lastActive: string;
}

export const EMPTY_TEAM_FILTERS: TeamFilters = {
  role: ALL,
  branch: ALL,
  accountStatus: ALL,
  assignedGroup: ALL,
  taskLoad: ALL,
  lastActive: ALL,
};

export type TeamQuickFilter = "activeStaff" | "pendingInvitations" | "seasonalGuides" | "needsReview";
