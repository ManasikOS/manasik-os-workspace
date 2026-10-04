/**
 * View models and UI-only types for the Operations Control Center.
 *
 * Row-level derivation lives in `lib/data/operations-repository.ts` (server
 * only); the flat shapes it produces live in `lib/types/operations.ts` and are
 * re-exported here so no component reaches past this file — same convention
 * as `app/(main)/visa/types.ts`.
 */

export type {
  FlightRiskState,
  OperationsAccommodationItem,
  OperationsActivityItem,
  OperationsBlocker,
  OperationsFlightItem,
  OperationsGroupSummary,
  OperationsGuideBoardRow,
  OperationsKpis,
  OperationsReadinessCategoryCell,
  OperationsServiceKind,
  OperationsServiceLine,
  OperationsSnapshot,
  OperationsSupplierRow,
  OperationsTaskItem,
  OperationsTransportItem,
} from "@/lib/types/operations";
export type { OperationsCapabilities } from "@/lib/access/operations-access";
export type { ReadinessMatrixRow } from "@/lib/data/operations";

/* ── Primary tabs ─────────────────────────────────────────────────────────── */

export const OPERATIONS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Operational Tasks" },
  { id: "suppliers", label: "Supplier Confirmations" },
  { id: "flights", label: "Flights & Tickets" },
  { id: "accommodation", label: "Accommodation & Rooming" },
  { id: "transport", label: "Transport" },
  { id: "support", label: "Support Cases" },
  { id: "guides", label: "Guides & Briefings" },
  { id: "readiness", label: "Group Readiness" },
  { id: "activity", label: "Activity" },
] as const;

export type OperationsTabId = (typeof OPERATIONS_TABS)[number]["id"];

/* ── Operational Tasks: saved views & filters ────────────────────────────── */

export const TASK_SAVED_VIEWS = [
  "All",
  "My Tasks",
  "Due Today",
  "Overdue",
  "Critical Blockers",
  "Unassigned",
  "Hotels & Suppliers",
  "Transport",
  "Guide Tasks",
  "Departing in 7 Days",
  "Completed This Week",
] as const;

export type TaskSavedView = (typeof TASK_SAVED_VIEWS)[number];

export const ALL = "ALL";

export interface TaskFilters {
  groupId: string;
  status: string;
  category: string;
  owner: string;
}

export const EMPTY_TASK_FILTERS: TaskFilters = {
  groupId: ALL,
  status: ALL,
  category: ALL,
  owner: ALL,
};

/* ── Supplier Confirmations: filters ──────────────────────────────────────── */

export interface SupplierFilters {
  groupId: string;
  serviceKind: string;
  status: string;
}

export const EMPTY_SUPPLIER_FILTERS: SupplierFilters = {
  groupId: ALL,
  serviceKind: ALL,
  status: ALL,
};
