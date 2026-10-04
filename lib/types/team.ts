/**
 * Hand-maintained row types for the Team & Access schema.
 *
 * Keep these in sync with `supabase/migrations/20260820090000_team_access.sql`.
 * Same convention as `lib/types/suppliers.ts` / `lib/types/pilgrims.ts`:
 * snake_case, exactly the shape a `select *` (or, for `TeamDirectoryRow`, the
 * `team_directory_rows` view) returns.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";

/* ── Enumerations ─────────────────────────────────────────────────────────── */

export type StaffBranch = "COLOMBO" | "KANDY" | "ALL";

export type StaffEmploymentType = "PERMANENT" | "SEASONAL" | "CONTRACT" | "EXTERNAL_PARTNER";

export type StaffAccountStatus = "ACTIVE" | "INVITED" | "DEACTIVATED" | "SEASONAL_INACTIVE";

export type StaffInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export type StaffInvitationChannel = "EMAIL" | "WHATSAPP";

export type StaffAssignmentResponsibility =
  | "PRIMARY_GUIDE"
  | "BACKUP_GUIDE"
  | "OPERATIONS_OWNER"
  | "BACKUP_OPERATIONS"
  | "VISA_OWNER"
  | "FINANCE_OWNER"
  | "MARKETING_OWNER";

export type StaffActivityEventType =
  | "INVITED"
  | "INVITATION_RESENT"
  | "INVITATION_REVOKED"
  | "ACCOUNT_ACTIVATED"
  | "ROLE_CHANGED"
  | "BRANCH_CHANGED"
  | "PROFILE_UPDATED"
  | "GROUP_ASSIGNED"
  | "GROUP_UNASSIGNED"
  | "ACCOUNT_DEACTIVATED"
  | "ACCOUNT_REACTIVATED"
  | "ACCESS_EXPIRED"
  | "ACCESS_EXTENDED"
  | "PASSWORD_RESET_SENT"
  | "SESSIONS_REVOKED"
  | "SENSITIVE_DATA_VIEWED";

/* ── A. staff_profiles ────────────────────────────────────────────────────── */

export interface StaffProfileRow {
  id: string;
  full_name: string;
  email: string;
  whatsapp: string | null;
  role: StaffRole;
  branch: StaffBranch;
  employment_type: StaffEmploymentType;
  status: StaffAccountStatus;
  access_starts_on: string | null;
  access_ends_on: string | null;
  job_title: string | null;
  last_active_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns the invite / edit-profile forms write. The database fills in the rest. */
export type StaffProfileWritable = Omit<
  StaffProfileRow,
  | "id"
  | "status"
  | "last_active_at"
  | "activated_at"
  | "deactivated_at"
  | "deactivated_by"
  | "deactivation_reason"
  | "created_at"
  | "updated_at"
>;

/* ── B. staff_invitations ─────────────────────────────────────────────────── */

export interface StaffInvitationRow {
  id: string;
  staff_profile_id: string;
  email: string;
  role: StaffRole;
  branch: StaffBranch;
  employment_type: StaffEmploymentType;
  invited_by: string | null;
  invited_by_name: string | null;
  sent_via: StaffInvitationChannel[];
  status: StaffInvitationStatus;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

/* ── C. staff_group_assignments ───────────────────────────────────────────── */

export interface StaffGroupAssignmentRow {
  id: string;
  staff_profile_id: string;
  departure_group_id: string;
  responsibility: StaffAssignmentResponsibility;
  assigned_by: string | null;
  assigned_by_name: string | null;
  assigned_at: string;
  unassigned_at: string | null;
}

/* ── D. staff_activity_logs ───────────────────────────────────────────────── */

export interface StaffActivityRow {
  id: string;
  staff_profile_id: string;
  actor_id: string | null;
  actor_name_snapshot: string;
  event_type: StaffActivityEventType;
  before_value: unknown;
  after_value: unknown;
  message: string;
  is_high_impact: boolean;
  created_at: string;
}

/* ── E. team_directory_rows — a database view, not a table. ──────────────────
 * One row per staff profile with assignment and task aggregates folded in.
 * This is what the Team list reads; nothing here is written directly.
 */
export interface TeamDirectoryRow extends StaffProfileRow {
  assigned_group_count: number;
  primary_groups: { groupId: string; groupName: string; responsibility: StaffAssignmentResponsibility }[];
  open_task_count: number;
  overdue_task_count: number;
  due_today_count: number;
  pending_invitation_at: string | null;
}
