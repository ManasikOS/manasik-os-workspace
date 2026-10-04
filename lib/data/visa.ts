/**
 * View models and derivations for the Visa Operations module.
 *
 * Deliberately client-safe — no `next/headers`, no Supabase import — so the
 * same functions run in the Server Component that loads the queue and in any
 * Client Component that re-derives from it after a refresh, mirroring
 * `lib/data/documents.ts`.
 */

import type { Tone } from "@/lib/ui/tone";
import {
  VISA_DEPARTURE_RISK_DAYS,
  VISA_GROUP_RISK_DAYS,
  VISA_NO_UPDATE_CHASE_DAYS,
  VISA_VALIDITY_RISK_DAYS,
} from "@/lib/data/visa-copy";
import type { VisaApplicationRow } from "@/lib/types/visa";

/* ── List item ────────────────────────────────────────────────────────────── */

export type VisaValidityState = "NONE" | "VALID" | "EXPIRING_SOON" | "EXPIRED";
export type VisaRiskBand = "GREEN" | "AMBER" | "RED";

export interface VisaListItem {
  journeyId: string;
  groupId: string;
  visaStatus: string;
  visaType: string;
  applicationReference: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  visaId: string | null;
  issueNote: string | null;
  filePath: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  validUntil: string | null;
  entryType: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  evidenceSource: string | null;

  assignedTo: string | null;
  assignedToName: string | null;

  batchId: string | null;
  batchReference: string | null;
  batchSequence: number | null;
  batchStatus: string | null;
  submissionDeadline: string | null;

  statusCheckedAt: string | null;
  lastUpdateAt: string | null;
  priorityScore: number;

  documentsCompleted: number;
  documentsRequired: number;
  documentCompletionPercent: number;
  gatingOutstanding: number;
  rejectedDocuments: number;

  pilgrimId: string;
  pilgrimReference: string;
  fullName: string;
  initials: string;
  whatsappNumber: string;
  passportNumber: string | null;
  passportMasked: string;

  bookingReference: string;
  outstandingBalance: number;

  groupName: string;
  groupCode: string;
  journeyType: string;
  branch: string;
  departureDate: string;
  daysToDeparture: number;
  returnDate: string;
  groupVisaOwnerName: string | null;

  validityState: VisaValidityState;
  riskBand: VisaRiskBand;
  daysSinceUpdate: number | null;
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function maskPassport(passportNumber: string | null): string {
  if (!passportNumber) return "—";
  const value = passportNumber.trim();
  if (value.length <= 4) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 4)}${"*".repeat(Math.max(value.length - 6, 2))}${value.slice(-2)}`;
}

export function deriveValidityState(
  expiryDate: string | null,
  validUntil: string | null,
  nowIso: string,
): VisaValidityState {
  const boundary = validUntil ?? expiryDate;
  if (!boundary) return "NONE";
  const now = Date.parse(nowIso);
  const diffDays = Math.round((Date.parse(boundary) - now) / 86_400_000);
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= VISA_VALIDITY_RISK_DAYS) return "EXPIRING_SOON";
  return "VALID";
}

function deriveRiskBand(
  status: string,
  validityState: VisaValidityState,
  verifiedAt: string | null,
  daysToDeparture: number,
  gatingOutstanding: number,
  rejectedDocuments: number,
): VisaRiskBand {
  if (status === "REJECTED") return "RED";
  if (validityState === "EXPIRED") return "RED";
  if (status !== "APPROVED" && daysToDeparture <= VISA_DEPARTURE_RISK_DAYS && daysToDeparture >= 0) return "RED";
  if (rejectedDocuments > 0 && status !== "APPROVED") return "RED";
  if (status === "REWORK_REQUIRED") return "AMBER";
  if (validityState === "EXPIRING_SOON") return "AMBER";
  if (status === "APPROVED" && !verifiedAt) return "AMBER";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW") return "AMBER";
  if (status === "APPROVED" && verifiedAt) return "GREEN";
  return "GREEN";
}

export function toVisaListItem(row: VisaApplicationRow, nowIso: string): VisaListItem {
  const now = Date.parse(nowIso);
  const daysToDeparture = Math.round((Date.parse(row.departure_date) - now) / 86_400_000);
  const validityState = deriveValidityState(row.visa_expiry_date, row.visa_valid_until, nowIso);
  const lastUpdateAt = row.visa_last_update_at;
  const daysSinceUpdate = lastUpdateAt ? Math.round((now - Date.parse(lastUpdateAt)) / 86_400_000) : null;

  return {
    journeyId: row.journey_id,
    groupId: row.group_id,
    visaStatus: row.visa_status,
    visaType: row.visa_type ?? "—",
    applicationReference: row.visa_application_reference,
    submittedAt: row.visa_submitted_at,
    reviewedAt: row.visa_reviewed_at,
    rejectedAt: row.visa_rejected_at,
    rejectionReason: row.visa_rejection_reason,
    visaId: row.visa_id,
    issueNote: row.visa_issue_note,
    filePath: row.visa_file_path,
    issueDate: row.visa_issue_date,
    expiryDate: row.visa_expiry_date,
    validUntil: row.visa_valid_until,
    entryType: row.visa_entry_type,
    verifiedAt: row.visa_verified_at,
    verifiedByName: row.visa_verified_by_name,
    evidenceSource: row.visa_evidence_source,

    assignedTo: row.visa_assigned_to,
    assignedToName: row.visa_assigned_to_name,

    batchId: row.visa_batch_id,
    batchReference: row.batch_reference,
    batchSequence: row.batch_sequence,
    batchStatus: row.batch_status,
    submissionDeadline: row.submission_deadline,

    statusCheckedAt: row.visa_status_checked_at,
    lastUpdateAt,
    priorityScore: row.visa_priority_score,

    documentsCompleted: row.documents_completed,
    documentsRequired: row.documents_required,
    documentCompletionPercent: row.document_completion_percent,
    gatingOutstanding: row.gating_outstanding,
    rejectedDocuments: row.rejected_documents,

    pilgrimId: row.pilgrim_id,
    pilgrimReference: row.pilgrim_reference,
    fullName: row.full_name,
    initials: initialsFor(row.full_name),
    whatsappNumber: row.whatsapp_number,
    passportNumber: row.passport_number,
    passportMasked: maskPassport(row.passport_number),

    bookingReference: row.booking_reference,
    outstandingBalance: row.outstanding_balance,

    groupName: row.group_name,
    groupCode: row.group_code,
    journeyType: row.journey_type,
    branch: row.branch,
    departureDate: row.departure_date,
    daysToDeparture,
    returnDate: row.return_date,
    groupVisaOwnerName: row.group_visa_owner_name,

    validityState,
    riskBand: deriveRiskBand(
      row.visa_status,
      validityState,
      row.visa_verified_at,
      daysToDeparture,
      row.gating_outstanding,
      row.rejected_documents,
    ),
    daysSinceUpdate,
  };
}

export function toVisaListItems(rows: VisaApplicationRow[], nowIso: string): VisaListItem[] {
  return rows.map((row) => toVisaListItem(row, nowIso));
}

/* ── Status tone ──────────────────────────────────────────────────────────── */

export function visaStatusTone(status: string): Tone {
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
    default:
      return "neutral";
  }
}

export function riskBandTone(band: VisaRiskBand): Tone {
  if (band === "RED") return "danger";
  if (band === "AMBER") return "warning";
  return "success";
}

export function validityTone(state: VisaValidityState): Tone {
  if (state === "EXPIRED") return "danger";
  if (state === "EXPIRING_SOON") return "warning";
  if (state === "VALID") return "success";
  return "neutral";
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface VisaKpis {
  readyToSubmit: number;
  submittedPending: number;
  visaIssues: number;
  issued: number;
  groupsAtRisk: number;
}

export function computeVisaKpis(items: VisaListItem[]): VisaKpis {
  const readyToSubmit = items.filter((i) => i.visaStatus === "READY_TO_SUBMIT").length;
  const submittedPending = items.filter((i) => i.visaStatus === "SUBMITTED" || i.visaStatus === "UNDER_REVIEW").length;
  const visaIssues = items.filter(
    (i) => i.visaStatus === "REJECTED" || i.visaStatus === "REWORK_REQUIRED" || i.rejectedDocuments > 0,
  ).length;
  const issued = items.filter((i) => i.visaStatus === "APPROVED").length;
  const groupsAtRisk = new Set(items.filter((i) => i.riskBand === "RED" || i.riskBand === "AMBER").map((i) => i.groupId)).size;

  return { readyToSubmit, submittedPending, visaIssues, issued, groupsAtRisk };
}

/* ── Critical alerts ──────────────────────────────────────────────────────── */

export interface VisaAlert {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  actionLabel: string;
  queue: string;
  groupId?: string;
}

export function deriveVisaAlerts(items: VisaListItem[]): VisaAlert[] {
  const alerts: VisaAlert[] = [];

  const byGroup = new Map<string, VisaListItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupId);
    if (list) list.push(item);
    else byGroup.set(item.groupId, [item]);
  }
  for (const [groupId, groupItems] of byGroup) {
    const first = groupItems[0];
    if (first.daysToDeparture > VISA_GROUP_RISK_DAYS || first.daysToDeparture < 0) continue;
    const unissued = groupItems.filter((i) => i.visaStatus !== "APPROVED");
    if (unissued.length === 0) continue;
    alerts.push({
      id: `dep-${groupId}`,
      severity: "critical",
      title: `${first.groupName} departs in ${first.daysToDeparture} day${first.daysToDeparture === 1 ? "" : "s"}`,
      detail: `${unissued.length} visa${unissued.length === 1 ? "" : "s"} still not issued`,
      actionLabel: "Open Group Queue",
      queue: "By Group",
      groupId,
    });
  }

  const rejected = items.filter((i) => i.visaStatus === "REJECTED");
  if (rejected.length > 0) {
    alerts.push({
      id: "rejected",
      severity: "critical",
      title: `${rejected.length} application${rejected.length === 1 ? "" : "s"} rejected`,
      detail: "Record the escalation or release the seat",
      actionLabel: "Open Rejected Queue",
      queue: "Rejected",
    });
  }

  const passportRisk = items.filter((i) => i.gatingOutstanding > 0 && i.visaStatus === "DOCUMENTS_PENDING");
  if (passportRisk.length > 0) {
    alerts.push({
      id: "passport-risk",
      severity: "critical",
      title: `${passportRisk.length} application${passportRisk.length === 1 ? "" : "s"} blocked by document or passport validity`,
      detail: "Resolve in Documents before this can be submitted",
      actionLabel: "Review Blockers",
      queue: "All Applications",
    });
  }

  const noUpdate = items.filter(
    (i) =>
      (i.visaStatus === "SUBMITTED" || i.visaStatus === "UNDER_REVIEW") &&
      (i.daysSinceUpdate ?? 0) >= VISA_NO_UPDATE_CHASE_DAYS,
  );
  if (noUpdate.length > 0) {
    alerts.push({
      id: "no-update",
      severity: "warning",
      title: `${noUpdate.length} application${noUpdate.length === 1 ? " has" : "s have"} no status update for ${VISA_NO_UPDATE_CHASE_DAYS}+ days`,
      detail: "Follow up or record a status check",
      actionLabel: "Open Submitted",
      queue: "Submitted",
    });
  }

  const unverified = items.filter((i) => i.visaStatus === "APPROVED" && !i.verifiedAt);
  if (unverified.length > 0) {
    alerts.push({
      id: "unverified",
      severity: "warning",
      title: `${unverified.length} issued visa${unverified.length === 1 ? " is" : "s are"} not yet staff-verified`,
      detail: "Confirm evidence and mark verified",
      actionLabel: "Open Issued",
      queue: "Issued",
    });
  }

  return alerts
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))
    .slice(0, 5);
}

/* ── Priority scoring ─────────────────────────────────────────────────────── */

export function scoreVisaApplication(item: VisaListItem): number {
  let score = 0;
  if (item.daysToDeparture <= 30) score += (30 - Math.max(item.daysToDeparture, 0)) * 10;
  if (item.riskBand === "RED") score += 150;
  else if (item.riskBand === "AMBER") score += 70;
  if (item.visaStatus === "REJECTED") score += 100;
  if (item.visaStatus === "REWORK_REQUIRED") score += 60;
  if (item.daysSinceUpdate !== null) score += Math.min(item.daysSinceUpdate * 5, 100);
  return score;
}

/* ── Group visa board (By Group) ─────────────────────────────────────────── */

export interface GroupVisaBoard {
  groupId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  daysToDeparture: number;
  pilgrimCount: number;
  readyToSubmit: number;
  submitted: number;
  issued: number;
  reworkRequired: number;
  rejected: number;
  readinessPercent: number;
  riskBand: VisaRiskBand;
  criticalBlockers: string[];
}

export function computeGroupVisaBoards(items: VisaListItem[]): GroupVisaBoard[] {
  const byGroup = new Map<string, VisaListItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupId);
    if (list) list.push(item);
    else byGroup.set(item.groupId, [item]);
  }

  const boards: GroupVisaBoard[] = [];
  for (const [groupId, groupItems] of byGroup) {
    const first = groupItems[0];
    const verifiedIssued = groupItems.filter((i) => i.visaStatus === "APPROVED" && i.verifiedAt).length;
    const readinessPercent = groupItems.length === 0 ? 100 : Math.round((verifiedIssued / groupItems.length) * 100);

    const blockers: string[] = [];
    const rejected = groupItems.filter((i) => i.visaStatus === "REJECTED").length;
    if (rejected > 0) blockers.push(`${rejected} application${rejected === 1 ? "" : "s"} rejected`);
    const rework = groupItems.filter((i) => i.visaStatus === "REWORK_REQUIRED").length;
    if (rework > 0) blockers.push(`${rework} require${rework === 1 ? "s" : ""} rework`);
    const unverified = groupItems.filter((i) => i.visaStatus === "APPROVED" && !i.verifiedAt).length;
    if (unverified > 0) blockers.push(`${unverified} issued but unverified`);
    const expiring = groupItems.filter((i) => i.validityState === "EXPIRING_SOON" || i.validityState === "EXPIRED").length;
    if (expiring > 0) blockers.push(`${expiring} expiring or expired`);

    const worstBand: VisaRiskBand = groupItems.some((i) => i.riskBand === "RED")
      ? "RED"
      : groupItems.some((i) => i.riskBand === "AMBER")
        ? "AMBER"
        : "GREEN";

    boards.push({
      groupId,
      groupName: first.groupName,
      groupCode: first.groupCode,
      departureDate: first.departureDate,
      daysToDeparture: first.daysToDeparture,
      pilgrimCount: groupItems.length,
      readyToSubmit: groupItems.filter((i) => i.visaStatus === "READY_TO_SUBMIT").length,
      submitted: groupItems.filter((i) => i.visaStatus === "SUBMITTED" || i.visaStatus === "UNDER_REVIEW").length,
      issued: groupItems.filter((i) => i.visaStatus === "APPROVED").length,
      reworkRequired: groupItems.filter((i) => i.visaStatus === "REWORK_REQUIRED").length,
      rejected,
      readinessPercent,
      riskBand: worstBand,
      criticalBlockers: blockers,
    });
  }

  return boards.sort((a, b) => a.daysToDeparture - b.daysToDeparture);
}
