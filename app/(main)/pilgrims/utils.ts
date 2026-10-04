/**
 * Labels, tones, formatters, sort and filter helpers for the Pilgrims list.
 * Mirrors `app/(main)/leads/utils.ts` and
 * `app/(main)/departure-groups/utils.ts`.
 */

import type { Tone } from "@/lib/ui/tone";

import {
  ALL,
  type PilgrimFilters,
  type PilgrimJourneyStatus,
  type PilgrimListItem,
  type PilgrimListKpis,
  type PilgrimSavedView,
} from "./types";

/* ── Labels ───────────────────────────────────────────────────────────────── */

export const JOURNEY_STATUS_LABELS: Record<PilgrimJourneyStatus, string> = {
  PENDING_DETAILS: "Pending Details",
  ONBOARDING: "Onboarding",
  DOCUMENTS_PENDING: "Documents Pending",
  VISA_PROCESSING: "Visa Processing",
  PAYMENT_PENDING: "Payment Pending",
  PREPARING: "Preparing",
  READY_TO_TRAVEL: "Ready to Travel",
  TRAVELLED: "Travelled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const JOURNEY_STATUS_TONES: Record<PilgrimJourneyStatus, Tone> = {
  PENDING_DETAILS: "neutral",
  ONBOARDING: "info",
  DOCUMENTS_PENDING: "warning",
  VISA_PROCESSING: "warning",
  PAYMENT_PENDING: "warning",
  PREPARING: "info",
  READY_TO_TRAVEL: "success",
  TRAVELLED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export const VISA_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  DOCUMENTS_PENDING: "Documents Pending",
  READY_TO_SUBMIT: "Ready to Submit",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REWORK_REQUIRED: "Rework Required",
};

export const VISA_STATUS_TONES: Record<string, Tone> = {
  NOT_STARTED: "neutral",
  DOCUMENTS_PENDING: "warning",
  READY_TO_SUBMIT: "info",
  SUBMITTED: "info",
  UNDER_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
  REWORK_REQUIRED: "danger",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  DEPOSIT_PAID: "Deposit Paid",
  PARTIAL: "Partial",
  PAID_IN_FULL: "Paid in Full",
  OVERDUE: "Overdue",
  REFUND_PENDING: "Refund Pending",
};

export const PAYMENT_STATUS_TONES: Record<string, Tone> = {
  NOT_STARTED: "neutral",
  DEPOSIT_PAID: "info",
  PARTIAL: "warning",
  PAID_IN_FULL: "success",
  OVERDUE: "danger",
  REFUND_PENDING: "warning",
};

export const ROOM_STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Pending",
  ASSIGNED: "Assigned",
  LOCKED: "Locked",
};

export const FLIGHT_STATUS_LABELS: Record<string, string> = {
  TICKETED: "Ticketed",
  PENDING: "Pending",
  NAME_MISMATCH: "Name Mismatch",
  CANCELLED: "Cancelled",
  CHANGE_REQUESTED: "Change Requested",
};

export const JOURNEY_TYPE_LABELS: Record<string, string> = {
  UMRAH: "Umrah",
  HAJJ: "Hajj",
  EARLY_REGISTRATION: "Early Registration",
};

export function readinessTone(readiness: PilgrimListItem["readiness"]): Tone {
  if (readiness === "READY") return "success";
  if (readiness === "BLOCKED") return "danger";
  return "warning";
}

export function readinessLabel(readiness: PilgrimListItem["readiness"]): string {
  if (readiness === "READY") return "Ready";
  if (readiness === "BLOCKED") return "Blocked";
  return "At Risk";
}

export function formatCurrencyLKR(amount: number): string {
  if (amount >= 100_000) return `LKR ${(amount / 100_000).toFixed(1)}L`;
  return `LKR ${amount.toLocaleString("en-US")}`;
}

export function formatExactLKR(amount: number): string {
  return `LKR ${amount.toLocaleString("en-US")}`;
}

export function daysRemainingLabel(days: number): string {
  if (days < 0) return "Departed";
  if (days === 0) return "Departs today";
  return `Departs in ${days} day${days === 1 ? "" : "s"}`;
}

export function whatsappLink(whatsapp: string): string {
  const digits = whatsapp.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

/* ── Filtering ────────────────────────────────────────────────────────────── */

export function matchesPilgrimSearch(item: PilgrimListItem, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    item.fullName.toLowerCase().includes(q) ||
    item.reference.toLowerCase().includes(q) ||
    (item.passportNumber ?? "").toLowerCase().includes(q) ||
    item.whatsappNumber.toLowerCase().includes(q) ||
    item.bookingReference.toLowerCase().includes(q) ||
    item.groupName.toLowerCase().includes(q)
  );
}

export function matchesPilgrimFilters(item: PilgrimListItem, filters: PilgrimFilters): boolean {
  if (filters.departureGroupId !== ALL && item.groupId !== filters.departureGroupId) return false;
  if (filters.journeyType !== ALL && item.journeyType !== filters.journeyType) return false;
  if (filters.documentStatus !== ALL) {
    const complete = item.documentsCompleted >= item.documentsRequired;
    if (filters.documentStatus === "COMPLETE" && !complete) return false;
    if (filters.documentStatus === "MISSING" && complete) return false;
  }
  if (filters.visaStatus !== ALL && item.visaStatus !== filters.visaStatus) return false;
  if (filters.paymentStatus !== ALL && item.paymentStatus !== filters.paymentStatus) return false;
  if (filters.readiness !== ALL && item.readiness !== filters.readiness) return false;
  if (filters.roomAssignment !== ALL && item.roomAssignmentStatus !== filters.roomAssignment) return false;
  if (filters.flightStatus !== ALL && item.flightStatus !== filters.flightStatus) return false;
  if (filters.branch !== ALL && item.branch !== filters.branch) return false;
  return true;
}

export function applySavedView(
  items: PilgrimListItem[],
  view: PilgrimSavedView,
  currentStaffName: string | null,
): PilgrimListItem[] {
  switch (view) {
    case "My Group Pilgrims":
      return items.filter((i) => i.guideName === currentStaffName);
    case "Documents Missing":
      return items.filter((i) => i.documentsCompleted < i.documentsRequired);
    case "Visa Pending":
      return items.filter((i) =>
        ["NOT_STARTED", "DOCUMENTS_PENDING", "READY_TO_SUBMIT", "SUBMITTED", "UNDER_REVIEW"].includes(
          i.visaStatus,
        ),
      );
    case "Visa Rework Required":
      return items.filter((i) => i.visaStatus === "REWORK_REQUIRED" || i.visaStatus === "REJECTED");
    case "Payments Overdue":
      return items.filter((i) => i.paymentStatus === "OVERDUE");
    case "Rooming Incomplete":
      return items.filter((i) => i.roomAssignmentStatus === "UNASSIGNED");
    case "Flight Ticket Pending":
      return items.filter((i) => i.flightStatus !== "TICKETED" && i.flightStatus !== "CANCELLED");
    case "Ready to Travel":
      return items.filter((i) => i.journeyStatus === "READY_TO_TRAVEL");
    case "Departing in 14 Days":
      return items.filter((i) => i.daysToDeparture >= 0 && i.daysToDeparture <= 14);
    case "Cancelled / Replaced":
      return items.filter((i) => i.journeyStatus === "CANCELLED");
    case "All Active Pilgrims":
    default:
      return items.filter((i) => i.journeyStatus !== "CANCELLED");
  }
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export type PilgrimSortField = "departureDate" | "fullName" | "documentPercent" | "outstandingBalance";

export interface PilgrimSort {
  field: PilgrimSortField;
  direction: "asc" | "desc";
}

export const DEFAULT_PILGRIM_SORT: PilgrimSort = { field: "departureDate", direction: "asc" };

export function toggleSort(sort: PilgrimSort, field: PilgrimSortField): PilgrimSort {
  if (sort.field !== field) return { field, direction: "asc" };
  return { field, direction: sort.direction === "asc" ? "desc" : "asc" };
}

export function sortPilgrims(items: PilgrimListItem[], sort: PilgrimSort): PilgrimListItem[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sort.field) {
      case "fullName":
        return a.fullName.localeCompare(b.fullName) * dir;
      case "documentPercent":
        return (a.documentPercent - b.documentPercent) * dir;
      case "outstandingBalance":
        return (a.outstandingBalance - b.outstandingBalance) * dir;
      case "departureDate":
      default:
        return (Date.parse(a.departureDate) - Date.parse(b.departureDate)) * dir;
    }
  });
}

export function computePilgrimKpiDescriptions() {
  return {
    activePilgrims: "Across active Hajj and Umrah groups",
    documentsPending: "Requires action",
    visaIssues: "Pending, rejected, or rework required",
    paymentAttention: "Overdue or below threshold",
    readyToTravel: "Across upcoming groups",
  } satisfies Record<keyof PilgrimListKpis, string>;
}
