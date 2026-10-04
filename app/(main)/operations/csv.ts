import { toCsv } from "@/lib/csv";

import type { OperationsSnapshot } from "./types";
import { formatDate } from "./utils";

export { downloadTextFile, timestampedFilename } from "@/lib/csv";

/**
 * "Export Operations Report" — one multi-section CSV covering the whole
 * control tower snapshot: groups, tasks, suppliers and readiness. Excel
 * treats a section header row as an ordinary row, which is enough for a
 * daily hand-off document; it does not need to be machine-parseable.
 */
export function operationsSnapshotToReportCsv(snapshot: OperationsSnapshot): string {
  const rows: string[][] = [];

  rows.push(["UPCOMING GROUPS"]);
  rows.push(["Group", "Code", "Departs In", "Status", "Readiness %", "Primary Blocker"]);
  for (const g of snapshot.groups) {
    rows.push([
      g.groupName,
      g.groupCode,
      String(g.daysUntilDeparture),
      g.readinessStatus,
      String(g.readinessScore),
      g.blockers[0]?.message ?? "All clear",
    ]);
  }
  rows.push([]);

  rows.push(["OPERATIONAL TASKS"]);
  rows.push(["Task", "Group", "Owner", "Due", "Status", "Category"]);
  for (const t of snapshot.tasks) {
    rows.push([t.title, t.groupName, t.ownerName ?? "Unassigned", formatDate(t.dueAt), t.status, t.category]);
  }
  rows.push([]);

  rows.push(["SUPPLIER CONFIRMATIONS"]);
  rows.push(["Group", "Service", "Supplier", "Reference", "Status", "Due"]);
  for (const s of snapshot.supplierRows) {
    rows.push([s.groupName, s.serviceLabel, s.supplierName ?? "—", s.reference ?? "—", s.status, formatDate(s.dueAt)]);
  }

  return toCsv(rows);
}
