/**
 * Client-safe derivations for the Pilgrims & Compliance report tab. Pure
 * functions over `ReportPilgrimComplianceFact[]` — no Supabase import.
 */

import { PASSPORT_VALIDITY_THRESHOLD_DAYS, VISA_STATUS_GROUP_LABELS } from "@/lib/data/reports-copy";
import type { ReportPilgrimComplianceFact } from "@/lib/types/reports";
import type { Tone } from "@/lib/ui/tone";

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k) ?? [];
    bucket.push(row);
    map.set(k, bucket);
  }
  return map;
}

/* ── Document completion by group ────────────────────────────────────────── */

export interface DocumentCompletionRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  requiredDocuments: number;
  verifiedDocuments: number;
  missingDocuments: number;
  pilgrimCount: number;
}

export function buildDocumentCompletionRows(pilgrims: ReportPilgrimComplianceFact[]): DocumentCompletionRow[] {
  const byGroup = groupBy(pilgrims, (p) => p.departure_group_id);
  return Array.from(byGroup.entries())
    .map(([departureGroupId, rows]) => {
      const required = rows.reduce((total, r) => total + r.documents_required, 0);
      const verified = rows.reduce((total, r) => total + r.documents_completed, 0);
      return {
        departureGroupId,
        groupName: rows[0].group_name,
        groupCode: rows[0].group_code,
        requiredDocuments: required,
        verifiedDocuments: verified,
        missingDocuments: Math.max(required - verified, 0),
        pilgrimCount: rows.length,
      };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName));
}

/* ── Visa status by group ────────────────────────────────────────────────── */

type VisaBucket = keyof typeof VISA_STATUS_GROUP_LABELS;

const VISA_STATUS_TO_BUCKET: Record<string, VisaBucket> = {
  NOT_STARTED: "NOT_STARTED",
  DOCUMENTS_PENDING: "NOT_STARTED",
  READY_TO_SUBMIT: "READY_TO_SUBMIT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "SUBMITTED",
  APPROVED: "ISSUED",
  REWORK_REQUIRED: "REWORK",
  REJECTED: "REJECTED",
};

export interface VisaStatusRow {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  counts: Record<VisaBucket, number>;
  total: number;
}

export function buildVisaStatusRows(pilgrims: ReportPilgrimComplianceFact[]): VisaStatusRow[] {
  const byGroup = groupBy(pilgrims, (p) => p.departure_group_id);
  return Array.from(byGroup.entries())
    .map(([departureGroupId, rows]) => {
      const counts = { NOT_STARTED: 0, READY_TO_SUBMIT: 0, SUBMITTED: 0, ISSUED: 0, REWORK: 0, REJECTED: 0 } as Record<
        VisaBucket,
        number
      >;
      for (const r of rows) {
        const bucket = VISA_STATUS_TO_BUCKET[r.visa_status] ?? "NOT_STARTED";
        counts[bucket] += 1;
      }
      return {
        departureGroupId,
        groupName: rows[0].group_name,
        groupCode: rows[0].group_code,
        counts,
        total: rows.length,
      };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName));
}

/* ── Passport validity risk ──────────────────────────────────────────────── */

export type PassportRiskStatus = "EXPIRED" | "AT_RISK" | "OK" | "UNKNOWN";

export interface PassportRiskRow {
  pilgrimId: string;
  pilgrimName: string;
  groupName: string;
  groupCode: string;
  passportExpiry: string | null;
  daysRemaining: number | null;
  status: PassportRiskStatus;
}

export function buildPassportRiskRows(pilgrims: ReportPilgrimComplianceFact[]): PassportRiskRow[] {
  return pilgrims
    .map((p) => ({
      pilgrimId: p.pilgrim_id,
      pilgrimName: p.full_name,
      groupName: p.group_name,
      groupCode: p.group_code,
      passportExpiry: p.passport_expiry,
      daysRemaining: p.passport_days_remaining,
      status: passportRiskStatus(p.passport_days_remaining),
    }))
    .sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity));
}

function passportRiskStatus(daysRemaining: number | null): PassportRiskStatus {
  if (daysRemaining === null) return "UNKNOWN";
  if (daysRemaining < 0) return "EXPIRED";
  if (daysRemaining <= PASSPORT_VALIDITY_THRESHOLD_DAYS) return "AT_RISK";
  return "OK";
}

export function passportRiskTone(status: PassportRiskStatus): Tone {
  switch (status) {
    case "EXPIRED":
      return "danger";
    case "AT_RISK":
      return "warning";
    case "OK":
      return "success";
    default:
      return "neutral";
  }
}
