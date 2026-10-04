/**
 * Labels, tones, formatters, sort and filter helpers for the Visa list.
 * Mirrors `app/(main)/documents/utils.ts`.
 */

import { riskBandTone, validityTone, visaStatusTone } from "@/lib/data/visa";

import {
  ALL,
  type VisaFilters,
  type VisaListItem,
  type VisaQueue,
  type VisaSavedView,
} from "./types";

/* ── Labels ───────────────────────────────────────────────────────────────── */

export const VISA_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  DOCUMENTS_PENDING: "Documents Pending",
  READY_TO_SUBMIT: "Ready to Submit",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Issued",
  REJECTED: "Rejected",
  REWORK_REQUIRED: "Rework Required",
};

export const JOURNEY_TYPE_LABELS: Record<string, string> = {
  UMRAH: "Umrah",
  HAJJ: "Hajj",
  EARLY_REGISTRATION: "Early Registration",
};

export const VALIDITY_STATE_LABELS: Record<string, string> = {
  NONE: "—",
  VALID: "Valid",
  EXPIRING_SOON: "Expiring Soon",
  EXPIRED: "Expired",
};

export { riskBandTone, validityTone, visaStatusTone };

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

export function whatsappLink(phone: string, message?: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}

/* ── Queue predicates ─────────────────────────────────────────────────────── */

export function matchesQueue(item: VisaListItem, queue: VisaQueue): boolean {
  switch (queue) {
    case "All Applications":
    case "By Group":
      return true;
    case "Ready to Submit":
      return item.visaStatus === "READY_TO_SUBMIT";
    case "Submitted":
      return item.visaStatus === "SUBMITTED";
    case "Under Review":
      return item.visaStatus === "UNDER_REVIEW";
    case "Issued":
      return item.visaStatus === "APPROVED";
    case "Rework Required":
      return item.visaStatus === "REWORK_REQUIRED";
    case "Rejected":
      return item.visaStatus === "REJECTED";
    case "Expiring / Validity Risk":
      return item.validityState === "EXPIRING_SOON" || item.validityState === "EXPIRED" || item.gatingOutstanding > 0;
    default:
      return true;
  }
}

export function applySavedView(
  items: VisaListItem[],
  view: VisaSavedView,
  currentStaffName: string | null,
): VisaListItem[] {
  switch (view) {
    case "My Visa Queue":
      return items.filter((i) => i.assignedToName === currentStaffName);
    case "Ready to Submit Today":
      return items.filter((i) => i.visaStatus === "READY_TO_SUBMIT");
    case "Departing in 7 Days":
      return items.filter((i) => i.daysToDeparture >= 0 && i.daysToDeparture <= 7);
    case "Submitted but Unresolved":
      return items.filter((i) => i.visaStatus === "SUBMITTED" || i.visaStatus === "UNDER_REVIEW");
    case "Visa Rework Required":
      return items.filter((i) => i.visaStatus === "REWORK_REQUIRED");
    case "Rejected Applications":
      return items.filter((i) => i.visaStatus === "REJECTED");
    case "Visa Validity Risk":
      return items.filter((i) => i.validityState === "EXPIRING_SOON" || i.validityState === "EXPIRED");
    default:
      return items;
  }
}

export function matchesVisaSearch(item: VisaListItem, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    item.fullName.toLowerCase().includes(q) ||
    (item.passportNumber ?? "").toLowerCase().includes(q) ||
    (item.visaId ?? "").toLowerCase().includes(q) ||
    (item.applicationReference ?? "").toLowerCase().includes(q) ||
    (item.batchReference ?? "").toLowerCase().includes(q) ||
    item.pilgrimReference.toLowerCase().includes(q) ||
    item.groupName.toLowerCase().includes(q) ||
    item.groupCode.toLowerCase().includes(q)
  );
}

export function matchesVisaFilters(item: VisaListItem, filters: VisaFilters): boolean {
  if (filters.groupId !== ALL && item.groupId !== filters.groupId) return false;
  if (filters.visaStatus !== ALL && item.visaStatus !== filters.visaStatus) return false;
  if (filters.journeyType !== ALL && item.journeyType !== filters.journeyType) return false;
  if (filters.visaType !== ALL && item.visaType !== filters.visaType) return false;
  if (filters.batchId !== ALL && item.batchId !== filters.batchId) return false;
  if (filters.assignedTo !== ALL && item.assignedToName !== filters.assignedTo) return false;
  if (filters.branch !== ALL && item.branch !== filters.branch) return false;
  return true;
}

export function activeFilterCount(filters: VisaFilters): number {
  return Object.values(filters).filter((v) => v !== ALL).length;
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export interface VisaSort {
  field: string;
  direction: "asc" | "desc";
}

export const DEFAULT_VISA_SORT: VisaSort = { field: "priorityScore", direction: "desc" };

export function sortVisaApplications(items: VisaListItem[], sort: VisaSort): VisaListItem[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sort.field) {
      case "fullName":
        return a.fullName.localeCompare(b.fullName) * dir;
      case "departureDate":
        return (Date.parse(a.departureDate) - Date.parse(b.departureDate)) * dir;
      case "submittedAt":
        return ((Date.parse(a.submittedAt ?? "") || 0) - (Date.parse(b.submittedAt ?? "") || 0)) * dir;
      case "priorityScore":
      default:
        return (a.priorityScore - b.priorityScore) * dir;
    }
  });
}
