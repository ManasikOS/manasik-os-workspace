/**
 * Client-safe derivations for the Operations Control Center — no `next/headers`,
 * no Supabase import, so the same functions run in the Server Component that
 * builds the snapshot and in any Client Component re-deriving from it after a
 * mutation, mirroring `lib/data/visa.ts` and `lib/data/documents.ts`.
 *
 * The snapshot itself (`OperationsSnapshot`) is built server-side in
 * `lib/data/operations-repository.ts`, which is the one place raw database
 * rows are read and `buildBlockers` / `buildSupplierLines` / `scoreReadiness`
 * from `lib/data/departure-groups.ts` are reused.
 */

import {
  MAX_CRITICAL_ALERTS,
  READINESS_MATRIX_COLUMNS,
} from "@/lib/data/operations-copy";
import type { Tone } from "@/lib/ui/tone";
import type {
  OperationsBlocker,
  OperationsGroupSummary,
  OperationsKpis,
  OperationsSnapshot,
  OperationsTaskItem,
} from "@/lib/types/operations";

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export function computeOperationsKpis(snapshot: OperationsSnapshot): OperationsKpis {
  const now = Date.parse(snapshot.nowIso);
  const endOfToday = new Date(snapshot.nowIso);
  endOfToday.setHours(23, 59, 59, 999);

  const upcomingDepartures = snapshot.groups.filter(
    (g) => g.daysUntilDeparture >= 0 && g.daysUntilDeparture <= 30,
  ).length;

  const groupsAtRisk = snapshot.groups.filter(
    (g) =>
      g.blockers.some((b) => b.severity === "CRITICAL") ||
      g.readinessStatus === "BLOCKED" ||
      (g.readinessStatus === "AT_RISK" && g.daysUntilDeparture <= 14),
  ).length;

  const supplierConfirmationsPending = snapshot.supplierRows.filter(
    (r) => r.status === "NOT_REQUESTED" || r.status === "REQUESTED",
  ).length;

  const tasksDueToday = snapshot.tasks.filter(
    (t) => t.status !== "COMPLETE" && Date.parse(t.dueAt) <= endOfToday.getTime(),
  ).length;

  const unassignedWork = snapshot.tasks.filter(
    (t) => t.status !== "COMPLETE" && !t.ownerName,
  ).length;

  const readinessAverage =
    snapshot.groups.length === 0
      ? 0
      : Math.round(
          snapshot.groups.reduce((sum, g) => sum + g.readinessScore, 0) / snapshot.groups.length,
        );

  void now;
  return {
    upcomingDepartures,
    groupsAtRisk,
    supplierConfirmationsPending,
    tasksDueToday,
    unassignedWork,
    readinessAverage,
  };
}

/* ── Critical Operations Alerts ───────────────────────────────────────────── */

/**
 * Flattens every group's blockers into one feed, re-weights severity by
 * proximity to departure (a blocker on a group departing in 7 days reads
 * differently than the same blocker at 60 days), and caps the result — "only
 * show serious operational blockers here, not every low-priority task."
 */
export function deriveOperationsAlerts(groups: OperationsGroupSummary[]): OperationsBlocker[] {
  const all = groups.flatMap((g) => g.blockers);
  return [...all]
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === "CRITICAL" ? -1 : 1;
      if (a.daysUntilDeparture !== b.daysUntilDeparture) return a.daysUntilDeparture - b.daysUntilDeparture;
      return a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1;
    })
    .slice(0, MAX_CRITICAL_ALERTS);
}

/* ── Task priority ────────────────────────────────────────────────────────── */

const CATEGORY_URGENCY: Record<string, number> = {
  OPERATIONS: 3,
  VISA: 3,
  FINANCE: 2,
  GUIDE: 2,
  MARKETING: 1,
  OTHER: 1,
};

/**
 * A deterministic composite of category weight, days-to-departure and
 * overdue-ness — the module has no persisted priority column, so this is
 * recomputed on every read rather than asserted once and left to rot, and it
 * doubles as the default sort (mirrors `scoreVisaApplication`).
 */
export function scoreTaskPriority(task: OperationsTaskItem, nowIso: string): number {
  const now = Date.parse(nowIso);
  const due = Date.parse(task.dueAt);
  const daysToDue = (due - now) / 86_400_000;
  const overdue = task.status === "OVERDUE" || (task.status !== "COMPLETE" && due < now);

  let score = CATEGORY_URGENCY[task.category] ?? 1;
  score += Math.max(0, 14 - task.daysUntilDeparture) / 14; // closer departure, higher score
  score += overdue ? 5 : daysToDue <= 1 ? 3 : daysToDue <= 3 ? 1.5 : 0;
  score += task.ownerName ? 0 : 1; // unassigned work needs surfacing
  return Math.round(score * 100) / 100;
}

export function taskPriorityLabel(task: OperationsTaskItem, nowIso: string): "Critical" | "High" | "Normal" | "Low" {
  const score = scoreTaskPriority(task, nowIso);
  if (score >= 7) return "Critical";
  if (score >= 4.5) return "High";
  if (score >= 2.5) return "Normal";
  return "Low";
}

export function taskPriorityTone(label: string): Tone {
  switch (label) {
    case "Critical":
      return "danger";
    case "High":
      return "warning";
    case "Normal":
      return "info";
    default:
      return "neutral";
  }
}

export function taskStatusTone(status: string): Tone {
  switch (status) {
    case "COMPLETE":
      return "success";
    case "OVERDUE":
      return "danger";
    case "IN_PROGRESS":
      return "info";
    default:
      return "neutral";
  }
}

export function supplierStatusTone(status: string): Tone {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
    case "TICKETED":
      return "success";
    case "REQUESTED":
    case "HELD":
      return "info";
    case "CANCELLED":
      return "danger";
    default:
      return "warning";
  }
}

/* ── Group Readiness matrix ───────────────────────────────────────────────── */

export interface ReadinessMatrixCell {
  category: string;
  label: string;
  percent: number | null;
  status: string | null;
  tab: string;
}

export interface ReadinessMatrixRow {
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  cells: ReadinessMatrixCell[];
  overall: number;
  status: string;
  primaryBlocker: string;
}

const CATEGORY_TAB: Record<string, string> = {
  DOCUMENT: "documents",
  VISA: "documents",
  PAYMENT: "payments",
  FLIGHT: "flights",
  HOTEL: "hotels",
  TRANSPORT: "transport",
  GUIDE: "guide",
};

export function buildReadinessMatrixRows(groups: OperationsGroupSummary[]): ReadinessMatrixRow[] {
  return groups
    .map((g) => {
      const byCategory = new Map(g.readinessCategories.map((c) => [c.category, c]));
      const cells: ReadinessMatrixCell[] = READINESS_MATRIX_COLUMNS.map(({ key, label }) => {
        const cell = byCategory.get(key);
        return {
          category: key,
          label,
          percent: cell ? cell.percent : null,
          status: cell ? cell.status : null,
          tab: CATEGORY_TAB[key] ?? "readiness",
        };
      });
      return {
        groupId: g.id,
        groupName: g.groupName,
        groupCode: g.groupCode,
        daysUntilDeparture: g.daysUntilDeparture,
        cells,
        overall: g.readinessScore,
        status: g.readinessStatus,
        primaryBlocker: g.blockers[0]?.message ?? "All clear",
      };
    })
    .sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture);
}

export function readinessStatusTone(status: string): Tone {
  switch (status) {
    case "READY":
      return "success";
    case "AT_RISK":
      return "warning";
    case "BLOCKED":
      return "danger";
    default:
      return "neutral";
  }
}
