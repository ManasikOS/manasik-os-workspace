/**
 * Labels, tones, formatters, sort and filter helpers for the Documents list.
 * Mirrors `app/(main)/pilgrims/utils.ts`.
 */

import type { Tone } from "@/lib/ui/tone";
import { DOCUMENT_TYPE_LABELS, documentTypeLabel } from "@/lib/data/documents-copy";
import { statusToneFor } from "@/lib/data/documents";

import {
  ALL,
  type DocumentFilters,
  type DocumentListItem,
  type DocumentQueue,
  type DocumentSavedView,
} from "./types";

/* ── Labels ───────────────────────────────────────────────────────────────── */

export const STATUS_LABELS: Record<string, string> = {
  NOT_SUBMITTED: "Missing",
  SUBMITTED: "Submitted",
  VERIFIED: "Verified",
  REJECTED: "Rejected / Rework Required",
  NOT_APPLICABLE: "Not Required",
};

export const STAGE_LABELS: Record<string, string> = {
  ON_BOOKING: "On Booking",
  BEFORE_VISA_SUBMISSION: "Before Visa Submission",
  BEFORE_FINAL_PAYMENT: "Before Final Payment",
  BEFORE_DEPARTURE: "Before Departure",
};

export const AI_VERDICT_LABELS: Record<string, string> = {
  PASS: "Pass",
  WARNING: "Warning",
  BLOCKED: "Blocked",
  ERROR: "Error",
};

export const AI_VERDICT_TONES: Record<string, Tone> = {
  PASS: "success",
  WARNING: "warning",
  BLOCKED: "danger",
  ERROR: "neutral",
};

export const DOCUMENT_TYPE_OPTIONS = Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export { DOCUMENT_TYPE_LABELS, documentTypeLabel };

/* ── Formatting ───────────────────────────────────────────────────────────── */

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatRelativeUpdated(value: string, nowIso: string): string {
  const diffMs = Date.parse(nowIso) - Date.parse(value);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function daysRemainingLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `Departs in ${days} day${days === 1 ? "" : "s"}`;
}

export function whatsappLink(phone: string, message?: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}

/* ── Queue predicates ─────────────────────────────────────────────────────── */

export function matchesQueue(item: DocumentListItem, queue: DocumentQueue): boolean {
  switch (queue) {
    case "All Documents":
    case "By Group":
      return true;
    case "Missing":
      return item.required && item.status === "NOT_SUBMITTED";
    case "Awaiting Review":
      return item.status === "SUBMITTED";
    case "AI Flagged":
      return item.status !== "VERIFIED" && (item.aiVerdict === "WARNING" || item.aiVerdict === "BLOCKED");
    case "Rework Required":
      return item.status === "REJECTED";
    case "Verified":
      return item.status === "VERIFIED";
    case "Expiring Soon":
      return item.isExpiringSoon;
    default:
      return true;
  }
}

export function applySavedView(
  items: DocumentListItem[],
  view: DocumentSavedView,
  currentStaffName: string | null,
): DocumentListItem[] {
  switch (view) {
    case "My Review Queue":
      return items.filter((i) => i.assignedToName === currentStaffName);
    case "Departing in 7 Days":
      return items.filter((i) => i.daysToDeparture >= 0 && i.daysToDeparture <= 7);
    case "Visa Submission Ready":
      return items.filter((i) => i.requiredByStage === "BEFORE_VISA_SUBMISSION" && i.status !== "VERIFIED");
    case "Missing Passport Copies":
      return items.filter((i) => i.documentType === "PASSPORT_BIO" && i.status === "NOT_SUBMITTED");
    case "Passport Expiry Risk":
      return items.filter((i) => i.documentType === "PASSPORT_BIO" && i.isExpiringSoon);
    case "AI Low Confidence":
      return items.filter((i) => (i.aiConfidence ?? 100) < 70 && i.aiVerdict !== null);
    case "Rework Required":
      return items.filter((i) => i.status === "REJECTED");
    case "Unassigned Documents":
      return items.filter((i) => !i.assignedTo && i.status !== "VERIFIED" && i.status !== "NOT_APPLICABLE");
    default:
      return items;
  }
}

export function matchesDocumentSearch(item: DocumentListItem, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.trim().toLowerCase();
  return (
    item.fullName.toLowerCase().includes(q) ||
    (item.passportNumber ?? "").toLowerCase().includes(q) ||
    item.documentId.toLowerCase().includes(q) ||
    item.pilgrimReference.toLowerCase().includes(q) ||
    item.groupName.toLowerCase().includes(q) ||
    item.groupCode.toLowerCase().includes(q)
  );
}

export function matchesDocumentFilters(item: DocumentListItem, filters: DocumentFilters): boolean {
  if (filters.groupId !== ALL && item.groupId !== filters.groupId) return false;
  if (filters.documentType !== ALL && item.documentType !== filters.documentType) return false;
  if (filters.status !== ALL && item.status !== filters.status) return false;
  if (filters.aiFinding !== ALL && item.aiVerdict !== filters.aiFinding) return false;
  if (filters.assignedTo !== ALL && item.assignedToName !== filters.assignedTo) return false;
  if (filters.branch !== ALL && item.branch !== filters.branch) return false;
  return true;
}

export function activeFilterCount(filters: DocumentFilters): number {
  return Object.values(filters).filter((v) => v !== ALL).length;
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

export interface DocumentSort {
  field: string;
  direction: "asc" | "desc";
}

export const DEFAULT_DOCUMENT_SORT: DocumentSort = { field: "priorityScore", direction: "desc" };

export function sortDocuments(items: DocumentListItem[], sort: DocumentSort): DocumentListItem[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sort.field) {
      case "fullName":
        return a.fullName.localeCompare(b.fullName) * dir;
      case "departureDate":
        return (Date.parse(a.departureDate) - Date.parse(b.departureDate)) * dir;
      case "dueAt":
        return ((Date.parse(a.dueAt ?? "") || 0) - (Date.parse(b.dueAt ?? "") || 0)) * dir;
      case "lastActivityAt":
        return (Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt)) * dir;
      case "priorityScore":
      default:
        return (a.priorityScore - b.priorityScore) * dir;
    }
  });
}

export { statusToneFor };
