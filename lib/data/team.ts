/**
 * Client-safe derivations for the Team module — no `next/headers`, no
 * Supabase import, so the same functions run in the Server Component that
 * builds the directory/profile and in any Client Component re-deriving after
 * a mutation. Mirrors `lib/data/suppliers.ts` / `lib/data/operations.ts`.
 *
 * The rows themselves are read server-side in `lib/data/team-repository.ts`,
 * the only file that touches Supabase for this module.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { ACCESS_REVIEW_DAYS, SEASONAL_EXPIRY_WARNING_DAYS } from "@/lib/data/team-copy";
import type { StaffActivityLogWithId, StaffAssignmentWithGroup, StaffProfileBundle, StaffTaskWithGroup } from "@/lib/data/team-repository";
import type { Tone } from "@/lib/ui/tone";
import type {
  StaffAccountStatus,
  StaffAssignmentResponsibility,
  StaffBranch,
  StaffEmploymentType,
  StaffInvitationChannel,
  StaffInvitationRow,
  StaffInvitationStatus,
  TeamDirectoryRow,
} from "@/lib/types/team";

/* ── Directory list item ──────────────────────────────────────────────────── */

export interface TeamMemberListItem {
  id: string;
  fullName: string;
  email: string;
  whatsapp: string | null;
  role: StaffRole;
  branch: StaffBranch;
  employmentType: StaffEmploymentType;
  status: StaffAccountStatus;
  jobTitle: string | null;
  accessStartsOn: string | null;
  accessEndsOn: string | null;
  lastActiveAt: string | null;
  assignedGroupCount: number;
  primaryGroups: { groupId: string; groupName: string; responsibility: StaffAssignmentResponsibility }[];
  openTaskCount: number;
  overdueTaskCount: number;
  dueTodayCount: number;
  pendingInvitationAt: string | null;
  createdAt: string;
}

export function toTeamMemberListItems(rows: TeamDirectoryRow[]): TeamMemberListItem[] {
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    whatsapp: row.whatsapp,
    role: row.role,
    branch: row.branch,
    employmentType: row.employment_type,
    status: row.status,
    jobTitle: row.job_title,
    accessStartsOn: row.access_starts_on,
    accessEndsOn: row.access_ends_on,
    lastActiveAt: row.last_active_at,
    assignedGroupCount: row.assigned_group_count,
    primaryGroups: row.primary_groups,
    openTaskCount: row.open_task_count,
    overdueTaskCount: row.overdue_task_count,
    dueTodayCount: row.due_today_count,
    pendingInvitationAt: row.pending_invitation_at,
    createdAt: row.created_at,
  }));
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface TeamKpis {
  activeTeamMembers: number;
  pendingInvitations: number;
  seasonalGuidesActive: number;
  unassignedTasks: number;
  accountsNeedingReview: number;
}

/**
 * `unassignedTasks` is not derivable from the team list — it counts
 * `departure_group_tasks` with no owner at all, so the repository fetches it
 * separately and hands it in here.
 */
export function computeTeamKpis(
  items: TeamMemberListItem[],
  nowIso: string,
  unassignedTasks: number,
): TeamKpis {
  const activeTeamMembers = items.filter((i) => effectiveAccountStatus(i, nowIso) === "ACTIVE").length;
  const pendingInvitations = items.filter((i) => i.status === "INVITED").length;
  const seasonalGuidesActive = items.filter(
    (i) => i.role === "GUIDE" && i.employmentType === "SEASONAL" && effectiveAccountStatus(i, nowIso) === "ACTIVE",
  ).length;
  const accountsNeedingReview = items.filter((i) => needsAccessReview(i, nowIso)).length;

  return { activeTeamMembers, pendingInvitations, seasonalGuidesActive, unassignedTasks, accountsNeedingReview };
}

/** Active with no recent activity — the spec's "No login in 60+ days" card. */
export function needsAccessReview(item: Pick<TeamMemberListItem, "status" | "lastActiveAt">, nowIso: string): boolean {
  if (item.status !== "ACTIVE") return false;
  if (!item.lastActiveAt) return true;
  const days = (Date.parse(nowIso) - Date.parse(item.lastActiveAt)) / (24 * 60 * 60 * 1000);
  return days >= ACCESS_REVIEW_DAYS;
}

/* ── Workload ─────────────────────────────────────────────────────────────── */

export type WorkloadBand = "LOW" | "NORMAL" | "HIGH" | "OVERLOADED";

/** Low: 0–4 open tasks · Normal: 5–8 · High: 9–12 · Overloaded: 13+. A raw signal, never a performance score. */
export function workloadBand(openTaskCount: number): WorkloadBand {
  if (openTaskCount >= 13) return "OVERLOADED";
  if (openTaskCount >= 9) return "HIGH";
  if (openTaskCount >= 5) return "NORMAL";
  return "LOW";
}

export function workloadTone(band: WorkloadBand): Tone {
  switch (band) {
    case "OVERLOADED":
      return "danger";
    case "HIGH":
      return "warning";
    case "NORMAL":
      return "success";
    default:
      return "neutral";
  }
}

/* ── Seasonal access ──────────────────────────────────────────────────────── */

/**
 * `staff_profiles.status` only flips to `SEASONAL_INACTIVE` when a job runs
 * (there is none yet — see the Team build plan's D10). Enforcement already
 * happens at read time in `getCurrentStaffRole()`; this mirrors that same
 * date check for display, so the Team list never shows "Active" for someone
 * who can no longer sign in.
 */
export function isSeasonalExpired(
  item: Pick<TeamMemberListItem, "employmentType" | "accessEndsOn">,
  nowIso: string,
): boolean {
  return item.employmentType === "SEASONAL" && item.accessEndsOn !== null && item.accessEndsOn < nowIso.slice(0, 10);
}

export function effectiveAccountStatus(
  item: Pick<TeamMemberListItem, "status" | "employmentType" | "accessEndsOn">,
  nowIso: string,
): StaffAccountStatus {
  if (item.status === "ACTIVE" && isSeasonalExpired(item, nowIso)) return "SEASONAL_INACTIVE";
  return item.status;
}

/** Active Seasonal staff whose access lapses within the warning window — never past staff. */
export function seasonalAccessExpiringSoon(
  item: Pick<TeamMemberListItem, "status" | "employmentType" | "accessEndsOn">,
  nowIso: string,
): boolean {
  if (item.status !== "ACTIVE" || item.employmentType !== "SEASONAL" || !item.accessEndsOn) return false;
  if (isSeasonalExpired(item, nowIso)) return false;
  const days = (Date.parse(item.accessEndsOn) - Date.parse(nowIso.slice(0, 10))) / (24 * 60 * 60 * 1000);
  return days <= SEASONAL_EXPIRY_WARNING_DAYS;
}

/* ── Tones ────────────────────────────────────────────────────────────────── */

export function accountStatusTone(status: StaffAccountStatus): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "INVITED":
      return "info";
    case "SEASONAL_INACTIVE":
      return "warning";
    default:
      return "neutral";
  }
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

/** "18 minutes ago" / "3 days ago" / "Invited, not yet signed in" / "Never". */
export function formatLastActive(item: Pick<TeamMemberListItem, "status" | "lastActiveAt">, nowIso: string): string {
  if (!item.lastActiveAt) {
    return item.status === "INVITED" ? "Invited, not yet signed in" : "Never";
  }

  const diffMs = Date.parse(nowIso) - Date.parse(item.lastActiveAt);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/* ── Invitation history ───────────────────────────────────────────────────── */

export interface TeamInvitationListItem {
  id: string;
  staffId: string;
  staffFullName: string;
  email: string;
  role: StaffRole;
  branch: StaffBranch;
  employmentType: StaffEmploymentType;
  invitedByName: string | null;
  sentVia: StaffInvitationChannel[];
  status: StaffInvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/**
 * `expires_at` is stamped on every invitation and never transitioned in the
 * database — nothing moves `PENDING -> EXPIRED` there (C5 of
 * docs/modules/team-module-remediation-plan.md needs a scheduler for that; this
 * doesn't). Derived here at read time instead, so the Invitation History
 * sheet stops offering Resend/Revoke on a link Supabase has already
 * invalidated (C7).
 */
export function toTeamInvitationListItems(
  rows: (StaffInvitationRow & { staffFullName: string })[],
  nowIso: string,
): TeamInvitationListItem[] {
  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_profile_id,
    staffFullName: row.staffFullName,
    email: row.email,
    role: row.role,
    branch: row.branch,
    employmentType: row.employment_type,
    invitedByName: row.invited_by_name,
    sentVia: row.sent_via,
    status: row.status === "PENDING" && row.expires_at < nowIso ? "EXPIRED" : row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  }));
}

export function invitationStatusTone(status: StaffInvitationStatus): Tone {
  switch (status) {
    case "ACCEPTED":
      return "success";
    case "PENDING":
      return "info";
    case "EXPIRED":
      return "warning";
    default:
      return "neutral";
  }
}

/* ── Profile page ─────────────────────────────────────────────────────────── */

export interface StaffAssignmentListItem {
  id: string;
  staffId: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  groupStatus: string;
  readinessScore: number;
  readinessStatus: string;
  bookedSeats: number;
  responsibility: StaffAssignmentResponsibility;
  assignedByName: string | null;
  assignedAt: string;
}

export function toStaffAssignmentListItems(rows: StaffAssignmentWithGroup[]): StaffAssignmentListItem[] {
  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_profile_id,
    groupId: row.departure_group_id,
    groupName: row.group_name,
    groupCode: row.group_code,
    departureDate: row.departure_date,
    groupStatus: row.group_status,
    readinessScore: row.readiness_score,
    readinessStatus: row.readiness_status,
    bookedSeats: row.booked_seats,
    responsibility: row.responsibility as StaffAssignmentResponsibility,
    assignedByName: row.assigned_by_name,
    assignedAt: row.assigned_at,
  }));
}

export interface RoleChangeLogItem {
  id: string;
  actorName: string;
  message: string;
  beforeRole: string | null;
  afterRole: string | null;
  createdAt: string;
}

function extractRole(value: unknown): string | null {
  if (value && typeof value === "object" && "role" in value) {
    const role = (value as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  }
  return null;
}

export function toRoleChangeLogItems(rows: StaffActivityLogWithId[]): RoleChangeLogItem[] {
  return rows.map((row) => ({
    id: row.id,
    actorName: row.actor_name_snapshot,
    message: row.message,
    beforeRole: extractRole(row.before_value),
    afterRole: extractRole(row.after_value),
    createdAt: row.created_at,
  }));
}

export interface TeamMemberProfile {
  member: TeamMemberListItem;
  assignments: StaffAssignmentListItem[];
  completedThisWeekCount: number;
  recentRoleChanges: RoleChangeLogItem[];
}

export function buildTeamMemberProfile(bundle: StaffProfileBundle): TeamMemberProfile {
  return {
    member: toTeamMemberListItems([bundle.profile])[0],
    assignments: toStaffAssignmentListItems(bundle.assignments),
    completedThisWeekCount: bundle.completedThisWeekCount,
    recentRoleChanges: toRoleChangeLogItems(bundle.recentRoleChanges),
  };
}

/* ── Tasks & Workload tab ─────────────────────────────────────────────────── */

export interface StaffTaskListItem {
  id: string;
  title: string;
  category: string;
  dueAt: string;
  groupId: string;
  groupName: string;
  /** Derived from `dueAt < now`, not the stored `status` — the same reconciliation `deriveReadinessStatuses()` does for readiness, so this table and the KPI counters can never disagree. */
  isOverdue: boolean;
  isDueToday: boolean;
}

export function toStaffTaskListItems(rows: StaffTaskWithGroup[], nowIso: string): StaffTaskListItem[] {
  const today = nowIso.slice(0, 10);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    dueAt: row.due_at,
    groupId: row.departure_group_id,
    groupName: row.group_name,
    isOverdue: row.due_at < nowIso,
    isDueToday: row.due_at.slice(0, 10) === today,
  }));
}
