/**
 * Client-safe derivations for the Suppliers & Operations report tab. Pure
 * functions over `ReportSupplierFact[]` / `ReportTaskFact[]` — no Supabase
 * import.
 */

import type { ReportSupplierFact, ReportTaskFact } from "@/lib/types/reports";

const INACTIVE_COMMITMENT_STATUSES = new Set(["CANCELLED", "COMPLETED"]);

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k) ?? [];
    bucket.push(row);
    map.set(k, bucket);
  }
  return map;
}

/* ── Supplier confirmation performance ───────────────────────────────────── */

export interface SupplierPerformanceRow {
  supplierId: string;
  supplierName: string;
  activeCommitments: number;
  confirmedOnTime: number;
  pending: number;
  late: number;
  issues: number;
}

export function buildSupplierPerformanceRows(commitments: ReportSupplierFact[]): SupplierPerformanceRow[] {
  const bySupplier = groupBy(commitments, (c) => c.supplier_id);
  return Array.from(bySupplier.entries())
    .map(([supplierId, rows]) => {
      const active = rows.filter((r) => !INACTIVE_COMMITMENT_STATUSES.has(r.commitment_status));
      return {
        supplierId,
        supplierName: rows[0].supplier_name,
        activeCommitments: active.length,
        confirmedOnTime: rows.filter((r) => r.confirmed_on_time === true).length,
        pending: rows.filter((r) => !r.confirmed_at && !INACTIVE_COMMITMENT_STATUSES.has(r.commitment_status)).length,
        late: rows.filter((r) => r.confirmed_on_time === false).length,
        issues: rows.filter((r) => r.commitment_status === "DISPUTED").length,
      };
    })
    .sort((a, b) => b.activeCommitments - a.activeCommitments);
}

/* ── Service commitment report (raw list) ────────────────────────────────── */

export function sortServiceCommitments(commitments: ReportSupplierFact[]): ReportSupplierFact[] {
  return [...commitments].sort((a, b) => {
    if (!a.payment_due_at) return 1;
    if (!b.payment_due_at) return -1;
    return new Date(a.payment_due_at).getTime() - new Date(b.payment_due_at).getTime();
  });
}

/* ── Guide & staff workload ───────────────────────────────────────────────── */

export interface StaffWorkloadRow {
  ownerName: string;
  assignedGroups: number;
  openTasks: number;
  overdueTasks: number;
  completedTasks: number;
}

export function buildStaffWorkloadRows(tasks: ReportTaskFact[]): StaffWorkloadRow[] {
  const byOwner = groupBy(tasks, (t) => t.owner_name || "Unassigned");
  return Array.from(byOwner.entries())
    .map(([ownerName, rows]) => ({
      ownerName,
      assignedGroups: new Set(rows.map((r) => r.departure_group_id)).size,
      openTasks: rows.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS").length,
      overdueTasks: rows.filter((r) => r.status === "OVERDUE").length,
      completedTasks: rows.filter((r) => r.status === "COMPLETE").length,
    }))
    .sort((a, b) => b.openTasks - a.openTasks);
}

/* ── Operational task completion by category ─────────────────────────────── */

export interface TaskCategoryRow {
  category: string;
  open: number;
  inProgress: number;
  overdue: number;
  completed: number;
}

export function buildTaskCategoryRows(tasks: ReportTaskFact[]): TaskCategoryRow[] {
  const byCategory = groupBy(tasks, (t) => t.category);
  return Array.from(byCategory.entries())
    .map(([category, rows]) => ({
      category,
      open: rows.filter((r) => r.status === "OPEN").length,
      inProgress: rows.filter((r) => r.status === "IN_PROGRESS").length,
      overdue: rows.filter((r) => r.status === "OVERDUE").length,
      completed: rows.filter((r) => r.status === "COMPLETE").length,
    }))
    .sort((a, b) => b.open + b.overdue - (a.open + a.overdue));
}
