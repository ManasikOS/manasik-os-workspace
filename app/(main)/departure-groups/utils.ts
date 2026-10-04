/**
 * Client-safe display helpers for the Departure Groups module.
 *
 * No server imports here — the list table, the detail tabs and the create sheet
 * all pull from this file, so a stray `cookies()` import would break them.
 *
 * Colour is never the only signal: every helper that returns a colour also has
 * a matching text label, and the badge components render both.
 */

import type {
  BookingStatus,
  DepartureGroupListItem,
  DepartureGroupListKpis,
  DepartureGroupStatus,
  DeviationStatus,
  DocumentStage,
  DocumentStatus,
  FlightStatus,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
  PilgrimFlightStatus,
  PilgrimPaymentStatus,
  PilgrimVisaStatus,
  ReadinessItemStatus,
  RoomStatus,
  RoomType,
  SeatStatus,
  SupplierStatus,
  TaskStatus,
} from "./types";
import type { Tone } from "@/lib/ui/tone";
export type { Tone } from "@/lib/ui/tone";

/* ── Labels ───────────────────────────────────────────────────────────────── */

export const JOURNEY_TYPE_LABELS: Record<GroupJourneyType, string> = {
  UMRAH: "Umrah",
  HAJJ: "Hajj",
  EARLY_REGISTRATION: "Early Registration",
};

export const GROUP_STATUS_LABELS: Record<DepartureGroupStatus, string> = {
  PLANNING: "Planning",
  PREPARING: "Preparing",
  READY_TO_DEPART: "Ready to Depart",
  DEPARTED: "Departed",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const SALES_STATUS_LABELS: Record<GroupSalesStatus, string> = {
  SELLING: "Selling",
  LIMITED_AVAILABILITY: "Limited Availability",
  WAITLIST: "Waitlist",
  SALES_CLOSED: "Sales Closed",
  CANCELLED: "Cancelled",
};

export const READINESS_STATUS_LABELS: Record<GroupReadinessStatus, string> = {
  READY: "Ready",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_STARTED: "Not Started",
};

export const READINESS_ITEM_STATUS_LABELS: Record<ReadinessItemStatus, string> =
  {
    NOT_STARTED: "Not Started",
    IN_PROGRESS: "In Progress",
    COMPLETE: "Complete",
    AT_RISK: "At Risk",
    BLOCKED: "Blocked",
    NOT_REQUIRED: "Not Required",
  };

export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  NOT_REQUESTED: "Not Requested",
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const FLIGHT_STATUS_LABELS: Record<FlightStatus, string> = {
  DRAFT: "Draft",
  HELD: "Held",
  CONFIRMED: "Confirmed",
  TICKETED: "Ticketed",
  CANCELLED: "Cancelled",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  HELD: "Held",
  DEPOSIT_PENDING: "Deposit Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  WAITLIST: "Waitlist",
};

export const SEAT_STATUS_LABELS: Record<SeatStatus, string> = {
  HELD: "Held",
  CONFIRMED: "Confirmed",
  TICKETED: "Ticketed",
  CANCELLED: "Cancelled",
  WAITLIST: "Waitlist",
};

export const VISA_STATUS_LABELS: Record<PilgrimVisaStatus, string> = {
  NOT_STARTED: "Not Started",
  DOCUMENTS_PENDING: "Documents Pending",
  READY_TO_SUBMIT: "Ready to Submit",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REWORK_REQUIRED: "Rework Required",
};

export const PAYMENT_STATUS_LABELS: Record<PilgrimPaymentStatus, string> = {
  NOT_STARTED: "Not Started",
  DEPOSIT_PAID: "Deposit Paid",
  PARTIAL: "Partial",
  PAID_IN_FULL: "Paid in Full",
  OVERDUE: "Overdue",
  REFUND_PENDING: "Refund Pending",
};

export const FLIGHT_PILGRIM_STATUS_LABELS: Record<PilgrimFlightStatus, string> =
  {
    TICKETED: "Ticketed",
    PENDING: "Pending",
    NAME_MISMATCH: "Name Mismatch",
    CANCELLED: "Cancelled",
    CHANGE_REQUESTED: "Change Requested",
  };

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  QUAD: "Quad",
  TRIPLE: "Triple",
  DOUBLE: "Double",
  SINGLE: "Single",
  OTHER: "Other",
};

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  AVAILABLE: "Available",
  PARTIAL: "Partial",
  COMPLETE: "Complete",
  BLOCKED: "Blocked",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  OVERDUE: "Overdue",
};

/* ── Badge tones ──────────────────────────────────────────────────────────── */

/**
 * `Tone`, `TONE_CLASS` and `TONE_BAR` live in @/lib/ui/tone — the shared
 * vocabulary every module's status colour reads from. Re-exported here so
 * existing imports of `TONE_CLASS`/`TONE_BAR` from this file keep working;
 * the domain-specific `*Tone()` mappers below (journeyTone, salesTone, …)
 * are this file's own value-add and stay here.
 */
export { TONE_CLASS, TONE_BAR } from "@/lib/ui/tone";

export function journeyTone(journeyType: GroupJourneyType): Tone {
  if (journeyType === "HAJJ") return "warning";
  if (journeyType === "EARLY_REGISTRATION") return "neutral";
  return "success";
}

export function salesTone(status: GroupSalesStatus): Tone {
  switch (status) {
    case "SELLING":
      return "success";
    case "LIMITED_AVAILABILITY":
      return "warning";
    case "WAITLIST":
      return "info";
    case "SALES_CLOSED":
      return "neutral";
    case "CANCELLED":
      return "danger";
  }
}

export function groupStatusTone(status: DepartureGroupStatus): Tone {
  switch (status) {
    case "PLANNING":
      return "neutral";
    case "PREPARING":
      return "info";
    case "READY_TO_DEPART":
      return "success";
    case "DEPARTED":
      return "brand";
    case "COMPLETED":
      return "success";
    case "CLOSED":
      return "neutral";
    case "CANCELLED":
      return "danger";
  }
}

export function readinessTone(status: GroupReadinessStatus): Tone {
  switch (status) {
    case "READY":
      return "success";
    case "AT_RISK":
      return "warning";
    case "BLOCKED":
      return "danger";
    case "NOT_STARTED":
      return "neutral";
  }
}

export function readinessItemTone(status: ReadinessItemStatus): Tone {
  switch (status) {
    case "COMPLETE":
      return "success";
    case "IN_PROGRESS":
      return "info";
    case "AT_RISK":
      return "warning";
    case "BLOCKED":
      return "danger";
    case "NOT_REQUIRED":
      return "neutral";
    case "NOT_STARTED":
      return "neutral";
  }
}

export function supplierTone(status: SupplierStatus): Tone {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "success";
    case "REQUESTED":
      return "warning";
    case "NOT_REQUESTED":
      return "neutral";
    case "CANCELLED":
      return "danger";
  }
}

export function flightTone(status: FlightStatus): Tone {
  switch (status) {
    case "TICKETED":
      return "success";
    case "CONFIRMED":
      return "success";
    case "HELD":
      return "warning";
    case "DRAFT":
      return "neutral";
    case "CANCELLED":
      return "danger";
  }
}

export function bookingTone(status: BookingStatus): Tone {
  switch (status) {
    case "CONFIRMED":
      return "success";
    case "DEPOSIT_PENDING":
      return "warning";
    case "HELD":
      return "info";
    case "WAITLIST":
      return "neutral";
    case "CANCELLED":
      return "danger";
  }
}

export function seatTone(status: SeatStatus): Tone {
  switch (status) {
    case "TICKETED":
      return "success";
    case "CONFIRMED":
      return "info";
    case "HELD":
      return "warning";
    case "WAITLIST":
      return "neutral";
    case "CANCELLED":
      return "danger";
  }
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  NOT_SUBMITTED: "Not received",
  SUBMITTED: "Awaiting verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  NOT_APPLICABLE: "Not applicable",
};

export const DOCUMENT_STAGE_LABELS: Record<DocumentStage, string> = {
  ON_BOOKING: "On booking",
  BEFORE_VISA_SUBMISSION: "Before visa submission",
  BEFORE_FINAL_PAYMENT: "Before final payment",
  BEFORE_DEPARTURE: "Before departure",
};

export function documentTone(status: DocumentStatus): Tone {
  switch (status) {
    case "VERIFIED":
      return "success";
    case "SUBMITTED":
      return "info";
    case "REJECTED":
      return "danger";
    case "NOT_APPLICABLE":
      return "neutral";
    case "NOT_SUBMITTED":
      return "warning";
  }
}

export function visaTone(status: PilgrimVisaStatus): Tone {
  switch (status) {
    case "APPROVED":
      return "success";
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "READY_TO_SUBMIT":
      return "info";
    case "DOCUMENTS_PENDING":
      return "warning";
    case "REJECTED":
    case "REWORK_REQUIRED":
      return "danger";
    case "NOT_STARTED":
      return "neutral";
  }
}

export function paymentTone(status: PilgrimPaymentStatus): Tone {
  switch (status) {
    case "PAID_IN_FULL":
      return "success";
    case "DEPOSIT_PAID":
    case "PARTIAL":
      return "info";
    case "OVERDUE":
      return "danger";
    case "REFUND_PENDING":
      return "warning";
    case "NOT_STARTED":
      return "neutral";
  }
}

export function pilgrimFlightTone(status: PilgrimFlightStatus): Tone {
  switch (status) {
    case "TICKETED":
      return "success";
    case "PENDING":
      return "warning";
    case "NAME_MISMATCH":
    case "CANCELLED":
      return "danger";
    case "CHANGE_REQUESTED":
      return "info";
  }
}

export function roomTone(status: RoomStatus): Tone {
  switch (status) {
    case "COMPLETE":
      return "success";
    case "PARTIAL":
      return "warning";
    case "AVAILABLE":
      return "neutral";
    case "BLOCKED":
      return "danger";
  }
}

export function taskTone(status: TaskStatus): Tone {
  switch (status) {
    case "COMPLETE":
      return "success";
    case "IN_PROGRESS":
      return "info";
    case "OVERDUE":
      return "danger";
    case "OPEN":
      return "neutral";
  }
}

export const DEVIATION_STATUS_LABELS: Record<DeviationStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  ARRANGED: "Arranged",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

export function deviationTone(status: DeviationStatus): Tone {
  switch (status) {
    case "REQUESTED":
      return "warning";
    case "APPROVED":
      return "info";
    case "ARRANGED":
      return "success";
    case "DECLINED":
      return "danger";
    case "CANCELLED":
      return "neutral";
  }
}

export function percentTone(percent: number): Tone {
  if (percent >= 90) return "success";
  if (percent >= 50) return "warning";
  if (percent > 0) return "danger";
  return "neutral";
}

/**
 * Shared tail sentence for an auto-assign outcome, used verbatim by both the
 * client-side toast and the server-side activity log message so the two can
 * never drift out of sync with each other.
 */
export function describeAutoAssignSkipped(
  skipped: number,
  typeMismatched: number,
): string {
  if (skipped === 0) return "";
  return ` ${skipped} left unassigned${
    typeMismatched > 0
      ? ` — ${typeMismatched} need${typeMismatched === 1 ? "s" : ""} an occupancy type with no free beds`
      : " — no capacity remaining"
  }.`;
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const value = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(value) ? "—" : DATE_FORMAT.format(value);
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const value = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(value) ? "—" : SHORT_DATE_FORMAT.format(value);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "—";
  return `${DATE_FORMAT.format(value)} · ${TIME_FORMAT.format(value)}`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const value = Date.parse(iso);
  return Number.isNaN(value) ? "—" : TIME_FORMAT.format(value);
}

/** "Departs in 7 days" / "Departed 3 days ago" / "Departs today". */
export function departureCountdown(days: number): string {
  if (days === 0) return "Departs today";
  if (days === 1) return "Departs tomorrow";
  if (days > 0) return `Departs in ${days} days`;
  if (days === -1) return "Departed yesterday";
  return `Departed ${Math.abs(days)} days ago`;
}

export function formatCurrency(value: number, currency = "LKR"): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${currency} ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${currency} ${(value / 1_000).toFixed(0)}K`;
  }
  return `${currency} ${value.toLocaleString("en-US")}`;
}

export function formatExactCurrency(value: number, currency = "LKR"): string {
  return `${currency} ${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function relativeTimestamp(iso: string): string {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "—";

  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const time = TIME_FORMAT.format(value);

  if (value >= startOfToday) return `Today, ${time}`;
  if (value >= startOfToday - 86_400_000) return `Yesterday, ${time}`;
  return `${DATE_FORMAT.format(date)}, ${time}`;
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

/**
 * Recomputed on the client whenever the filters change, so the KPI row always
 * describes the groups actually on screen rather than the unfiltered set.
 */
export function computeListKpis(
  groups: DepartureGroupListItem[],
): DepartureGroupListKpis {
  const live = groups.filter(
    (g) =>
      g.groupStatus !== "CANCELLED" &&
      g.groupStatus !== "COMPLETED" &&
      g.groupStatus !== "CLOSED",
  );

  return {
    upcomingDepartures: live.filter((g) => g.daysUntilDeparture >= 0).length,
    atRiskGroups: groups.filter(
      (g) => g.readinessStatus === "AT_RISK" || g.readinessStatus === "BLOCKED",
    ).length,
    seatsAvailable: groups
      .filter(
        (g) =>
          g.salesStatus === "SELLING" ||
          g.salesStatus === "LIMITED_AVAILABILITY",
      )
      .reduce((sum, g) => sum + g.availableSeats, 0),
    groupsPreparing: groups.filter((g) => g.groupStatus === "PREPARING").length,
    departingInFourteenDays: live.filter(
      (g) => g.daysUntilDeparture >= 0 && g.daysUntilDeparture <= 14,
    ).length,
  };
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export type GroupSortField =
  | "departureDate"
  | "groupName"
  | "readinessScore"
  | "readinessRisk"
  | "availableSeats"
  | "occupancyRate"
  | "salesStatus"
  | "groupStatus"
  | "updatedAt";

export type SortDirection = "asc" | "desc";

export interface GroupSort {
  field: GroupSortField;
  direction: SortDirection;
}

/** Soonest departure first — the order operations actually works in. */
export const DEFAULT_GROUP_SORT: GroupSort = {
  field: "departureDate",
  direction: "asc",
};

/**
 * `defaultDirection` is the direction each field is most useful in, applied
 * when the field is first chosen: dates ascending (soonest first) but readiness
 * descending is wrong — an operator picking "readiness" wants the weakest
 * groups, so it starts ascending too. Seats and occupancy start descending.
 */
export const GROUP_SORT_OPTIONS: {
  field: GroupSortField;
  label: string;
  defaultDirection: SortDirection;
  /** Wording for the direction toggle, per field type. */
  ascLabel: string;
  descLabel: string;
}[] = [
  {
    field: "departureDate",
    label: "Departure date",
    defaultDirection: "asc",
    ascLabel: "Soonest first",
    descLabel: "Latest first",
  },
  {
    field: "readinessRisk",
    label: "Readiness risk",
    defaultDirection: "asc",
    ascLabel: "Most at risk first",
    descLabel: "Ready first",
  },
  {
    field: "readinessScore",
    label: "Readiness score",
    defaultDirection: "asc",
    ascLabel: "Lowest first",
    descLabel: "Highest first",
  },
  {
    field: "availableSeats",
    label: "Seats available",
    defaultDirection: "desc",
    ascLabel: "Fewest first",
    descLabel: "Most first",
  },
  {
    field: "occupancyRate",
    label: "Capacity filled",
    defaultDirection: "desc",
    ascLabel: "Emptiest first",
    descLabel: "Fullest first",
  },
  {
    field: "groupName",
    label: "Group name",
    defaultDirection: "asc",
    ascLabel: "A to Z",
    descLabel: "Z to A",
  },
  {
    field: "salesStatus",
    label: "Sales status",
    defaultDirection: "asc",
    ascLabel: "Selling first",
    descLabel: "Closed first",
  },
  {
    field: "groupStatus",
    label: "Operations status",
    defaultDirection: "asc",
    ascLabel: "Planning first",
    descLabel: "Completed first",
  },
  {
    field: "updatedAt",
    label: "Last updated",
    defaultDirection: "desc",
    ascLabel: "Oldest first",
    descLabel: "Newest first",
  },
];

/* Statuses sort by lifecycle position, not alphabetically — "Selling" before
   "Sales Closed" is meaningful, "Limited Availability" before "Selling" is not. */
const SALES_STATUS_ORDER: Record<GroupSalesStatus, number> = {
  SELLING: 0,
  LIMITED_AVAILABILITY: 1,
  WAITLIST: 2,
  SALES_CLOSED: 3,
  CANCELLED: 4,
};

const GROUP_STATUS_ORDER: Record<DepartureGroupStatus, number> = {
  PLANNING: 0,
  PREPARING: 1,
  READY_TO_DEPART: 2,
  DEPARTED: 3,
  COMPLETED: 4,
  CLOSED: 5,
  CANCELLED: 6,
};

/** Worst first, so ascending "readiness risk" surfaces what needs work. */
const READINESS_RISK_ORDER: Record<GroupReadinessStatus, number> = {
  BLOCKED: 0,
  AT_RISK: 1,
  NOT_STARTED: 2,
  READY: 3,
};

function sortKey(
  group: DepartureGroupListItem,
  field: GroupSortField,
): number | string {
  switch (field) {
    case "departureDate":
      return group.departureDate;
    case "groupName":
      return group.groupName.toLowerCase();
    case "readinessScore":
      return group.readinessScore;
    case "readinessRisk":
      return READINESS_RISK_ORDER[group.readinessStatus];
    case "availableSeats":
      return group.availableSeats;
    case "occupancyRate":
      return group.capacity === 0 ? 0 : group.bookedSeats / group.capacity;
    case "salesStatus":
      return SALES_STATUS_ORDER[group.salesStatus];
    case "groupStatus":
      return GROUP_STATUS_ORDER[group.groupStatus];
    case "updatedAt":
      return group.updatedAt;
  }
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Returns a new sorted array. Ties fall back to departure date and then group
 * name, so rows never reshuffle between renders when the primary key matches —
 * sorting by "Sales status" alone would otherwise leave equal rows in an
 * arbitrary order.
 */
/**
 * Orders two groups under the given sort. Exported as a comparator rather
 * than only as the whole-array `sortGroups` below because
 * `useFilteredRows` (hooks/use-filtered-rows.ts) owns the sort pass itself
 * and needs to be handed the comparison, not a sorter.
 *
 * Ties break on departure date then name, so the order is total and a
 * re-render can never reshuffle rows that compare equal on the chosen field.
 */
export function compareGroups(
  a: DepartureGroupListItem,
  b: DepartureGroupListItem,
  sort: GroupSort,
): number {
  const modifier = sort.direction === "asc" ? 1 : -1;

  const primary = compare(sortKey(a, sort.field), sortKey(b, sort.field));
  if (primary !== 0) return primary * modifier;

  if (sort.field !== "departureDate") {
    const byDate = a.departureDate.localeCompare(b.departureDate);
    if (byDate !== 0) return byDate;
  }
  return a.groupName.localeCompare(b.groupName);
}

export function sortGroups(
  groups: DepartureGroupListItem[],
  sort: GroupSort,
): DepartureGroupListItem[] {
  return [...groups].sort((a, b) => compareGroups(a, b, sort));
}

export function sortLabel(sort: GroupSort): string {
  const option = GROUP_SORT_OPTIONS.find(
    (entry) => entry.field === sort.field,
  );
  if (!option) return "Sort";
  return `${option.label} · ${
    sort.direction === "asc" ? option.ascLabel : option.descLabel
  }`;
}

/**
 * Header-click behaviour: clicking the active column flips direction, clicking
 * a new one adopts that field's most useful direction.
 */
export function toggleSort(
  current: GroupSort,
  field: GroupSortField,
): GroupSort {
  if (current.field === field) {
    return {
      field,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  const option = GROUP_SORT_OPTIONS.find((entry) => entry.field === field);
  return { field, direction: option?.defaultDirection ?? "asc" };
}

/* ── Saved views ──────────────────────────────────────────────────────────── */

export function applySavedView(
  groups: DepartureGroupListItem[],
  view: string,
  /**
   * From `staff_group_assignments` via `loadAssignedGroupIds()`, not a name
   * match against `primaryGuideName` / `operationsOwnerName` — this used to
   * compare display names, so two staff sharing a name saw each other's
   * "My Assigned Groups", and renaming anyone emptied the view for them.
   */
  assignedGroupIds: string[],
): DepartureGroupListItem[] {
  switch (view) {
    case "Open for Sale":
      return groups.filter(
        (g) =>
          g.salesStatus === "SELLING" ||
          g.salesStatus === "LIMITED_AVAILABILITY",
      );
    case "Preparing":
      return groups.filter((g) => g.groupStatus === "PREPARING");
    case "At Risk":
      return groups.filter(
        (g) => g.readinessStatus === "AT_RISK" || g.readinessStatus === "BLOCKED",
      );
    case "Departing in 14 Days":
      return groups.filter(
        (g) => g.daysUntilDeparture >= 0 && g.daysUntilDeparture <= 14,
      );
    case "Ready to Depart":
      return groups.filter((g) => g.groupStatus === "READY_TO_DEPART");
    case "Completed":
      return groups.filter(
        (g) => g.groupStatus === "COMPLETED" || g.groupStatus === "CLOSED",
      );
    case "My Assigned Groups": {
      const assigned = new Set(assignedGroupIds);
      return groups.filter((g) => assigned.has(g.id));
    }
    default:
      return groups;
  }
}

/** The list page's free-text search: name, code, template, guide, branch. */
export function matchesSearch(
  group: DepartureGroupListItem,
  query: string,
): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return [
    group.groupName,
    group.groupCode,
    group.packageTemplateName,
    group.packageTemplateCode,
    group.primaryGuideName ?? "",
    group.branch,
    JOURNEY_TYPE_LABELS[group.journeyType],
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function departureMonthKey(group: DepartureGroupListItem): string {
  return group.departureDate.slice(0, 7);
}

export function departureMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${year}-${month}-01T00:00:00Z`));
}
