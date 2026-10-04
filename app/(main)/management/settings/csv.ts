import { toCsv } from "@/lib/csv";
import { AUDIT_SOURCE_LABELS } from "@/lib/data/settings-copy";
import type { AuditLogRow } from "@/lib/types/settings";

/** Export column definitions for the Data & Audit section (§5.9). */
export function auditLogToCsv(rows: AuditLogRow[]): string {
  const header = ["Date", "Source", "User", "Action", "Entity", "Branch", "Before", "After"];
  const body = rows.map((row) => [
    row.created_at,
    AUDIT_SOURCE_LABELS[row.source] ?? row.source,
    row.actor_name_snapshot,
    row.action,
    row.entity_label,
    row.branch ?? "",
    row.before_value ? JSON.stringify(row.before_value) : "",
    row.after_value ? JSON.stringify(row.after_value) : "",
  ]);
  return toCsv([header, ...body]);
}
