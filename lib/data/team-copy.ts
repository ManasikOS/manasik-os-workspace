/**
 * Every label, threshold and taxonomy the Team module uses, in one file —
 * same convention as `suppliers-copy.ts` / `operations-copy.ts`. Nothing
 * else in the module hardcodes one of these values.
 */

export const ACCESS_REVIEW_DAYS = 60;
export const SEASONAL_EXPIRY_WARNING_DAYS = 7;
export const INVITATION_EXPIRY_DAYS = 7;
export const ACTIVITY_FEED_CAP = 50;

export const BRANCH_LABELS: Record<string, string> = {
  COLOMBO: "Colombo",
  KANDY: "Kandy",
  ALL: "All Branches",
};

/**
 * `staff_profiles.branch` used to be a hard `COLOMBO | KANDY | ALL` enum;
 * `supabase/migrations/20260821090000_agency_settings.sql` dropped that
 * CHECK constraint once a per-agency `branches` table existed, and the
 * column became a free-text display snapshot of whichever branch the
 * person is assigned to (see `branch_id`). `BRANCH_LABELS` only covers the
 * three legacy values — this falls back to the raw stored string for every
 * agency-defined branch name, instead of rendering `undefined`. See H2 of
 * docs/modules/team-module-remediation-plan.md.
 */
export function branchLabel(branch: string): string {
  return BRANCH_LABELS[branch] ?? branch;
}

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  PERMANENT: "Permanent",
  SEASONAL: "Seasonal",
  CONTRACT: "Contract",
  EXTERNAL_PARTNER: "External Partner",
};

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  DEACTIVATED: "Deactivated",
  SEASONAL_INACTIVE: "Seasonal Inactive",
};

export const RESPONSIBILITY_LABELS: Record<string, string> = {
  PRIMARY_GUIDE: "Primary Guide",
  BACKUP_GUIDE: "Backup Guide",
  OPERATIONS_OWNER: "Operations Owner",
  BACKUP_OPERATIONS: "Backup Operations",
  VISA_OWNER: "Visa Owner",
  FINANCE_OWNER: "Finance Owner",
  MARKETING_OWNER: "Marketing Owner",
};

export const WORKLOAD_BAND_LABELS: Record<string, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  OVERLOADED: "Overloaded",
};

// A third, never-imported phrasing of the activity feed's copy used to live
// here (`ACTIVITY_EVENT_COPY`) — every event's actual text comes from the
// `message` string `logStaffEvent()` builds at write time in
// `lib/data/team-repository.ts`, which is what `ActivitySecurityTab` renders.
// Removed as dead code (D3 of docs/modules/team-module-remediation-plan.md).
