/**
 * Labels, tones, formatters, sort and filter helpers for the Operations
 * Control Center. Mirrors `app/(main)/visa/utils.ts`.
 */

import {
  readinessStatusTone,
  scoreTaskPriority,
  supplierStatusTone,
  taskPriorityLabel,
  taskPriorityTone,
  taskStatusTone,
} from "@/lib/data/operations";
import {
  SUPPLIER_STATUS_LABELS,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/data/operations-copy";

import {
  ALL,
  type SupplierFilters,
  type TaskFilters,
  type TaskSavedView,
} from "./types";
import type { OperationsSupplierRow, OperationsTaskItem } from "@/lib/types/operations";

export {
  readinessStatusTone,
  scoreTaskPriority,
  supplierStatusTone,
  taskPriorityLabel,
  taskPriorityTone,
  taskStatusTone,
  SUPPLIER_STATUS_LABELS,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
};

/* ── Formatting ───────────────────────────────────────────────────────────── */

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysRemainingLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Departs today";
  return `Departs in ${days} day${days === 1 ? "" : "s"}`;
}

/* ── Task queue predicates ────────────────────────────────────────────────── */

export function applyTaskSavedView(
  tasks: OperationsTaskItem[],
  view: TaskSavedView,
  currentStaffName: string | null,
  nowIso: string,
): OperationsTaskItem[] {
  const endOfToday = new Date(nowIso);
  endOfToday.setHours(23, 59, 59, 999);
  const now = Date.parse(nowIso);

  switch (view) {
    case "My Tasks":
      return tasks.filter((t) => t.ownerName === currentStaffName);
    case "Due Today":
      return tasks.filter((t) => t.status !== "COMPLETE" && Date.parse(t.dueAt) <= endOfToday.getTime());
    case "Overdue":
      return tasks.filter((t) => t.status === "OVERDUE" || (t.status !== "COMPLETE" && Date.parse(t.dueAt) < now));
    case "Critical Blockers":
      return tasks.filter((t) => taskPriorityLabel(t, nowIso) === "Critical");
    case "Unassigned":
      return tasks.filter((t) => t.status !== "COMPLETE" && !t.ownerName);
    case "Hotels & Suppliers":
      return tasks.filter((t) => /hotel|supplier|accommodation/i.test(t.title) || /hotel|supplier/i.test(t.linkedReadinessLabel ?? ""));
    case "Transport":
      return tasks.filter((t) => /transport|transfer|pickup|bus|driver/i.test(t.title));
    case "Guide Tasks":
      return tasks.filter((t) => t.category === "GUIDE");
    case "Departing in 7 Days":
      return tasks.filter((t) => t.daysUntilDeparture >= 0 && t.daysUntilDeparture <= 7);
    case "Completed This Week": {
      const weekAgo = now - 7 * 86_400_000;
      return tasks.filter((t) => t.status === "COMPLETE" && Date.parse(t.dueAt) >= weekAgo);
    }
    default:
      return tasks;
  }
}

export function matchesTaskFilters(task: OperationsTaskItem, filters: TaskFilters): boolean {
  if (filters.groupId !== ALL && task.groupId !== filters.groupId) return false;
  if (filters.status !== ALL && task.status !== filters.status) return false;
  if (filters.category !== ALL && task.category !== filters.category) return false;
  if (filters.owner !== ALL && task.ownerName !== filters.owner) return false;
  return true;
}

export function matchesTaskSearch(task: OperationsTaskItem, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    task.title.toLowerCase().includes(q) ||
    (task.description ?? "").toLowerCase().includes(q) ||
    (task.ownerName ?? "").toLowerCase().includes(q) ||
    task.groupName.toLowerCase().includes(q) ||
    task.groupCode.toLowerCase().includes(q)
  );
}

export function activeTaskFilterCount(filters: TaskFilters): number {
  return Object.values(filters).filter((v) => v !== ALL).length;
}

export interface TaskSort {
  field: "priority" | "dueAt" | "group";
  direction: "asc" | "desc";
}

export const DEFAULT_TASK_SORT: TaskSort = { field: "priority", direction: "desc" };

export function sortTasks(tasks: OperationsTaskItem[], sort: TaskSort, nowIso: string): OperationsTaskItem[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    switch (sort.field) {
      case "dueAt":
        return (Date.parse(a.dueAt) - Date.parse(b.dueAt)) * dir;
      case "group":
        return (a.daysUntilDeparture - b.daysUntilDeparture) * dir;
      case "priority":
      default:
        return (scoreTaskPriority(a, nowIso) - scoreTaskPriority(b, nowIso)) * dir;
    }
  });
}

/* ── Supplier board predicates ────────────────────────────────────────────── */

export function matchesSupplierFilters(row: OperationsSupplierRow, filters: SupplierFilters): boolean {
  if (filters.groupId !== ALL && row.groupId !== filters.groupId) return false;
  if (filters.serviceKind !== ALL && row.serviceKind !== filters.serviceKind) return false;
  if (filters.status !== ALL && row.status !== filters.status) return false;
  return true;
}

export function matchesSupplierSearch(row: OperationsSupplierRow, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    row.serviceLabel.toLowerCase().includes(q) ||
    (row.supplierName ?? "").toLowerCase().includes(q) ||
    (row.reference ?? "").toLowerCase().includes(q) ||
    row.groupName.toLowerCase().includes(q) ||
    row.groupCode.toLowerCase().includes(q)
  );
}

export function sortSupplierRows(rows: OperationsSupplierRow[]): OperationsSupplierRow[] {
  return [...rows].sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture);
}
