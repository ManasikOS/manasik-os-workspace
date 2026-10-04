import { toCsv, downloadTextFile } from "@/lib/csv";

import { ACCOUNT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, ROLE_LABELS, branchLabel, effectiveAccountStatus } from "./utils";
import type { TeamMemberListItem } from "./types";

export { downloadTextFile };

export function teamToCsv(items: TeamMemberListItem[]): string {
  const headers = [
    "Name",
    "Email",
    "WhatsApp",
    "Role",
    "Branch",
    "Employment Type",
    "Status",
    "Assigned Groups",
    "Open Tasks",
    "Overdue Tasks",
    "Last Active",
  ];

  const rows = items.map((item) => [
    item.fullName,
    item.email,
    item.whatsapp ?? "",
    ROLE_LABELS[item.role] ?? item.role,
    branchLabel(item.branch),
    EMPLOYMENT_TYPE_LABELS[item.employmentType] ?? item.employmentType,
    ACCOUNT_STATUS_LABELS[item.status] ?? item.status,
    String(item.assignedGroupCount),
    String(item.openTaskCount),
    String(item.overdueTaskCount),
    item.lastActiveAt ?? "",
  ]);

  return toCsv([headers, ...rows]);
}

/**
 * Who has access, what role, and how recently they used it — the spec's
 * "Export Access Audit". Deliberately narrower than `teamToCsv()`: workload
 * counts are operational noise here, not an access fact.
 *
 * "Last Active" is the raw ISO timestamp, matching `teamToCsv()` — a CSV is
 * for re-import and spreadsheet sorting, so a machine-sortable value beats
 * the humanised "3 days ago" string (D12 of docs/modules/team-module-remediation-plan.md).
 */
export function accessAuditToCsv(items: TeamMemberListItem[], nowIso: string): string {
  const headers = ["Name", "Email", "Role", "Branch", "Employment Type", "Effective Status", "Access Starts", "Access Ends", "Last Active"];

  const rows = items.map((item) => {
    const status = effectiveAccountStatus(item, nowIso);
    return [
      item.fullName,
      item.email,
      ROLE_LABELS[item.role] ?? item.role,
      branchLabel(item.branch),
      EMPLOYMENT_TYPE_LABELS[item.employmentType] ?? item.employmentType,
      ACCOUNT_STATUS_LABELS[status] ?? status,
      item.accessStartsOn ?? "",
      item.accessEndsOn ?? "",
      item.lastActiveAt ?? "",
    ];
  });

  return toCsv([headers, ...rows]);
}

export function timestampedFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}.csv`;
}
