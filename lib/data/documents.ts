/**
 * View models and derivations for the Documents Operations module.
 *
 * Deliberately client-safe — no `next/headers`, no Supabase import — so the
 * same functions run in the Server Component that loads the queue and in any
 * Client Component that re-derives from it after a refresh, mirroring
 * `lib/data/pilgrims.ts`.
 */

import type { Tone } from "@/lib/ui/tone";
import {
  EXPIRY_WARNING_DAYS,
  PASSPORT_VALIDITY_MONTHS,
  STAGE_READINESS_WEIGHT,
} from "@/lib/data/documents-copy";
import type { DocumentQueueRow } from "@/lib/types/documents";

/* ── List item ────────────────────────────────────────────────────────────── */

export interface DocumentListItem {
  documentId: string;
  requirementId: string;
  name: string;
  category: string;
  documentType: string;
  required: boolean;
  requiredByStage: string;
  verifiedByRole: string;
  status: string;
  filePath: string | null;
  fileName: string | null;
  rejectionReason: string | null;
  notes: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  dueAt: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  expiresAt: string | null;
  isExpiringSoon: boolean;
  visibleInPortal: boolean;
  lastActivityAt: string;
  priorityScore: number;

  assignedTo: string | null;
  assignedToName: string | null;

  aiVerdict: string | null;
  aiConfidence: number | null;

  pilgrimId: string;
  pilgrimReference: string;
  fullName: string;
  initials: string;
  whatsappNumber: string;
  passportNumber: string | null;

  journeyId: string;
  visaStatus: string;

  groupId: string;
  groupName: string;
  groupCode: string;
  branch: string;
  departureDate: string;
  daysToDeparture: number;
  returnDate: string;
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function toDocumentListItem(row: DocumentQueueRow, nowIso: string): DocumentListItem {
  const now = Date.parse(nowIso);
  const daysToDeparture = Math.round((Date.parse(row.departure_date) - now) / 86_400_000);
  const daysUntilDue = row.due_at ? Math.round((Date.parse(row.due_at) - now) / 86_400_000) : null;
  const isOverdue =
    daysUntilDue !== null && daysUntilDue < 0 && row.status !== "VERIFIED" && row.status !== "NOT_APPLICABLE";

  const expiryThresholdMs = EXPIRY_WARNING_DAYS * 86_400_000;
  const isExpiringSoon =
    row.expires_at !== null &&
    Date.parse(row.expires_at) - now <= expiryThresholdMs &&
    Date.parse(row.expires_at) - now >= -expiryThresholdMs * 6;

  return {
    documentId: row.document_id,
    requirementId: row.requirement_id,
    name: row.name,
    category: row.category,
    documentType: row.document_type,
    required: row.required,
    requiredByStage: row.required_by_stage,
    verifiedByRole: row.verified_by_role,
    status: row.status,
    filePath: row.file_path,
    fileName: row.file_name,
    rejectionReason: row.rejection_reason,
    notes: row.notes,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    verifiedByName: row.verified_by_name,
    dueAt: row.due_at,
    daysUntilDue,
    isOverdue,
    expiresAt: row.expires_at,
    isExpiringSoon,
    visibleInPortal: row.visible_in_portal,
    lastActivityAt: row.last_activity_at,
    priorityScore: row.priority_score,

    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name,

    aiVerdict: row.ai_verdict,
    aiConfidence: row.ai_confidence,

    pilgrimId: row.pilgrim_id,
    pilgrimReference: row.pilgrim_reference,
    fullName: row.full_name,
    initials: initialsFor(row.full_name),
    whatsappNumber: row.whatsapp_number,
    passportNumber: row.passport_number,

    journeyId: row.journey_id,
    visaStatus: row.visa_status,

    groupId: row.group_id,
    groupName: row.group_name,
    groupCode: row.group_code,
    branch: row.branch,
    departureDate: row.departure_date,
    daysToDeparture,
    returnDate: row.return_date,
  };
}

export function toDocumentListItems(rows: DocumentQueueRow[], nowIso: string): DocumentListItem[] {
  return rows.map((row) => toDocumentListItem(row, nowIso));
}

/* ── Status tone ──────────────────────────────────────────────────────────── */

export const STATUS_TONE: Record<string, Tone> = {
  NOT_SUBMITTED: "neutral",
  SUBMITTED: "info",
  VERIFIED: "success",
  REJECTED: "danger",
  NOT_APPLICABLE: "neutral",
};

export function statusToneFor(item: DocumentListItem): Tone {
  if (item.status === "VERIFIED") return "success";
  if (item.status === "REJECTED") return "danger";
  if (item.aiVerdict === "BLOCKED") return "danger";
  if (item.isOverdue || item.isExpiringSoon || item.aiVerdict === "WARNING") return "warning";
  if (item.status === "SUBMITTED") return "info";
  return "neutral";
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface DocumentKpis {
  missingDocuments: number;
  missingPilgrims: number;
  awaitingReview: number;
  aiFlagged: number;
  expiringSoon: number;
  groupsAtRisk: number;
}

export function computeDocumentKpis(items: DocumentListItem[]): DocumentKpis {
  const missing = items.filter((i) => i.required && i.status === "NOT_SUBMITTED");
  const awaitingReview = items.filter((i) => i.status === "SUBMITTED");
  const aiFlagged = items.filter(
    (i) => i.status !== "VERIFIED" && (i.aiVerdict === "WARNING" || i.aiVerdict === "BLOCKED"),
  );
  const expiringSoon = items.filter((i) => i.isExpiringSoon);
  const missingPilgrims = new Set(missing.map((i) => i.pilgrimId)).size;

  const groupsWithBlockers = new Set(
    items
      .filter(
        (i) =>
          (i.required && i.status === "NOT_SUBMITTED") ||
          i.status === "REJECTED" ||
          i.isExpiringSoon,
      )
      .map((i) => i.groupId),
  );

  return {
    missingDocuments: missing.length,
    missingPilgrims,
    awaitingReview: awaitingReview.length,
    aiFlagged: aiFlagged.length,
    expiringSoon: expiringSoon.length,
    groupsAtRisk: groupsWithBlockers.size,
  };
}

/* ── Critical alerts ──────────────────────────────────────────────────────── */

export interface CriticalAlert {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  actionLabel: string;
  queue: string;
  groupId?: string;
  documentType?: string;
  aiVerdict?: string;
}

/** Up to five severe issues, each linking to a precise filtered queue — never
 *  a generic "open list". */
export function deriveCriticalAlerts(items: DocumentListItem[]): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];

  // Groups departing within 7 days with missing required documents.
  const byGroup = new Map<string, DocumentListItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupId);
    if (list) list.push(item);
    else byGroup.set(item.groupId, [item]);
  }
  for (const [groupId, groupItems] of byGroup) {
    const first = groupItems[0];
    if (first.daysToDeparture > 7 || first.daysToDeparture < 0) continue;
    const missing = groupItems.filter((i) => i.required && i.status === "NOT_SUBMITTED");
    if (missing.length === 0) continue;
    const missingPilgrims = new Set(missing.map((i) => i.pilgrimId)).size;
    alerts.push({
      id: `dep-${groupId}`,
      severity: "critical",
      title: `${first.groupName} departs in ${first.daysToDeparture} day${first.daysToDeparture === 1 ? "" : "s"}`,
      detail: `${missingPilgrims} pilgrim${missingPilgrims === 1 ? "" : "s"} still missing required documents`,
      actionLabel: "Open Group Queue",
      queue: "Missing",
      groupId,
    });
  }

  // Passport expiry risk.
  const expiringPassports = items.filter(
    (i) => i.documentType === "PASSPORT_BIO" && i.isExpiringSoon,
  );
  const expiringPilgrims = new Set(expiringPassports.map((i) => i.pilgrimId)).size;
  if (expiringPilgrims > 0) {
    alerts.push({
      id: "passport-expiry",
      severity: "critical",
      title: `${expiringPilgrims} passport${expiringPilgrims === 1 ? "" : "s"} expire within ${PASSPORT_VALIDITY_MONTHS} months`,
      detail: "Visa submission may be blocked",
      actionLabel: "Review Passports",
      queue: "Expiring Soon",
      documentType: "PASSPORT_BIO",
    });
  }

  // AI low confidence.
  const lowConfidence = items.filter(
    (i) => i.status !== "VERIFIED" && (i.aiVerdict === "WARNING" || i.aiVerdict === "BLOCKED") && (i.aiConfidence ?? 100) < 80,
  );
  if (lowConfidence.length > 0) {
    alerts.push({
      id: "ai-low-confidence",
      severity: "warning",
      title: `${lowConfidence.length} uploaded scan${lowConfidence.length === 1 ? " is" : "s are"} unreadable or incomplete`,
      detail: "AI confidence below 80%",
      actionLabel: "Review AI Flags",
      queue: "AI Flagged",
    });
  }

  // Rework queue.
  const rejected = items.filter((i) => i.status === "REJECTED");
  if (rejected.length > 0) {
    alerts.push({
      id: "rework",
      severity: "warning",
      title: `${rejected.length} document${rejected.length === 1 ? "" : "s"} require re-submission`,
      detail: "Sent back to the pilgrim for rework",
      actionLabel: "Open Rework Queue",
      queue: "Rework Required",
    });
  }

  return alerts
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))
    .slice(0, 5);
}

/* ── Priority scoring ─────────────────────────────────────────────────────── */

/** Combines departure proximity (dominant), stage weight, AI verdict and
 *  overdue days into one sortable integer. Higher sorts first. */
export function scoreDocument(item: DocumentListItem): number {
  let score = 0;
  if (item.daysToDeparture <= 30) score += (30 - Math.max(item.daysToDeparture, 0)) * 10;
  score += (STAGE_READINESS_WEIGHT[item.requiredByStage as keyof typeof STAGE_READINESS_WEIGHT] ?? 1) * 20;
  if (item.aiVerdict === "BLOCKED") score += 150;
  else if (item.aiVerdict === "WARNING") score += 80;
  if (item.isOverdue && item.daysUntilDue !== null) score += Math.min(Math.abs(item.daysUntilDue) * 5, 200);
  if (item.status === "REJECTED") score += 60;
  return score;
}

/* ── Group document readiness (By Group board) ───────────────────────────── */

export interface GroupDocumentBoard {
  groupId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  daysToDeparture: number;
  pilgrimCount: number;
  byType: { documentType: string; verified: number; total: number }[];
  criticalBlockers: string[];
  readinessPercent: number;
}

export function computeGroupDocumentBoards(items: DocumentListItem[]): GroupDocumentBoard[] {
  const byGroup = new Map<string, DocumentListItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupId);
    if (list) list.push(item);
    else byGroup.set(item.groupId, [item]);
  }

  const boards: GroupDocumentBoard[] = [];
  for (const [groupId, groupItems] of byGroup) {
    const first = groupItems[0];
    const applicable = groupItems.filter((i) => i.required && i.status !== "NOT_APPLICABLE");

    const typeMap = new Map<string, { verified: number; total: number }>();
    for (const item of applicable) {
      const entry = typeMap.get(item.documentType) ?? { verified: 0, total: 0 };
      entry.total += 1;
      if (item.status === "VERIFIED") entry.verified += 1;
      typeMap.set(item.documentType, entry);
    }

    let weightedVerified = 0;
    let weightedTotal = 0;
    for (const item of applicable) {
      const weight = STAGE_READINESS_WEIGHT[item.requiredByStage as keyof typeof STAGE_READINESS_WEIGHT] ?? 1;
      weightedTotal += weight;
      if (item.status === "VERIFIED") weightedVerified += weight;
    }
    const readinessPercent = weightedTotal === 0 ? 100 : Math.round((weightedVerified / weightedTotal) * 100);

    const blockers: string[] = [];
    const missingPhotos = groupItems.filter((i) => i.documentType === "PASSPORT_PHOTO" && i.status === "NOT_SUBMITTED").length;
    if (missingPhotos > 0) blockers.push(`${missingPhotos} missing passport photo${missingPhotos === 1 ? "" : "s"}`);
    const expiringPassports = groupItems.filter((i) => i.documentType === "PASSPORT_BIO" && i.isExpiringSoon).length;
    if (expiringPassports > 0) blockers.push(`${expiringPassports} passport${expiringPassports === 1 ? "" : "s"} expire too soon`);
    const rework = groupItems.filter((i) => i.status === "REJECTED").length;
    if (rework > 0) blockers.push(`${rework} document${rework === 1 ? "" : "s"} awaiting rework`);

    boards.push({
      groupId,
      groupName: first.groupName,
      groupCode: first.groupCode,
      departureDate: first.departureDate,
      daysToDeparture: first.daysToDeparture,
      pilgrimCount: new Set(groupItems.map((i) => i.pilgrimId)).size,
      byType: [...typeMap.entries()].map(([documentType, v]) => ({ documentType, ...v })),
      criticalBlockers: blockers,
      readinessPercent,
    });
  }

  return boards.sort((a, b) => a.daysToDeparture - b.daysToDeparture);
}
