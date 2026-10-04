/**
 * Every threshold and label the Operations Control Center uses, in one file —
 * same convention as `visa-copy.ts` / `documents-copy.ts`. Nothing else in the
 * module hardcodes one of these numbers.
 */

import type { ReadinessCategory } from "@/lib/types/departure-groups";

export const UPCOMING_DEPARTURE_WINDOW_DAYS = 30;
export const CRITICAL_DEPARTURE_WINDOW_DAYS = 14;
export const TICKETING_DEADLINE_RISK_DAYS = 7;
export const TRANSPORT_PICKUP_REQUIRED_HOURS = 48;
export const TRANSPORT_DRIVER_REQUIRED_HOURS = 24;
export const MAX_CRITICAL_ALERTS = 6;
export const MAX_UPCOMING_GROUP_CARDS = 8;

/** Overview tab compact lists. */
export const OVERVIEW_LIST_CAP = 6;

/**
 * The Group Readiness matrix's fixed column order. A group with no items in a
 * category renders "—" for that column rather than shifting the grid.
 */
export const READINESS_MATRIX_COLUMNS: { key: ReadinessCategory; label: string }[] = [
  { key: "DOCUMENT", label: "Docs" },
  { key: "VISA", label: "Visa" },
  { key: "PAYMENT", label: "Pay" },
  { key: "FLIGHT", label: "Flight" },
  { key: "HOTEL", label: "Hotel" },
  { key: "TRANSPORT", label: "Transport" },
  { key: "GUIDE", label: "Guide" },
];

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  OVERDUE: "Overdue",
};

export const TASK_CATEGORY_LABELS: Record<string, string> = {
  OPERATIONS: "Operations",
  VISA: "Visa",
  FINANCE: "Finance",
  GUIDE: "Guide",
  MARKETING: "Marketing",
  OTHER: "Other",
};

export const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  NOT_REQUESTED: "Not Requested",
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SERVICE_KIND_LABELS: Record<string, string> = {
  FLIGHT: "Flights",
  ACCOMMODATION: "Accommodation",
  TRANSPORT: "Transport",
};
