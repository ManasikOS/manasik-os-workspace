import { z } from "zod";

import type { StaffRole } from "@/lib/access/departure-groups-access";

export const copyReceiptToFinanceSchema = z.object({ attachmentId: z.string().uuid() }).strict();

export interface FinanceEvidenceCandidate {
  amount: number | null;
  reference: string | null;
  date: string | null;
  confidence: number | null;
  attribution: Record<string, "MODEL_CANDIDATE" | false>;
}

export type ReceiptFinancePromotionAvailability =
  | { state: "HIDDEN" }
  | { state: "DENIED"; reason: string }
  | { state: "READY" };

export type ReceiptFinancePromotionSettlement =
  | { state: "COPIED"; evidenceId: string; message: string }
  | { state: "ERROR"; message: string };

const FINANCE_EVIDENCE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function normalizedFinanceEvidenceMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

export function financeEvidenceMimeTypeIsSupported(mimeType: string | null): boolean {
  return mimeType !== null && normalizedFinanceEvidenceMimeType(mimeType) in FINANCE_EVIDENCE_EXTENSIONS;
}

export function financeEvidenceItemHref(evidenceId: string): string {
  const params = new URLSearchParams({
    view: "receivables",
    subview: "payments",
    evidenceId,
  });
  return `/finance?${params.toString()}`;
}

export function receiptFinancePromotionAvailability(input: {
  kind: string;
  status: string;
  mimeType: string | null;
  canOpenFinanceReview: boolean;
}): ReceiptFinancePromotionAvailability {
  if (
    input.kind !== "RECEIPT"
    || input.status !== "REVIEW_REQUIRED"
    || !financeEvidenceMimeTypeIsSupported(input.mimeType)
  ) {
    return { state: "HIDDEN" };
  }

  if (!input.canOpenFinanceReview) {
    return {
      state: "DENIED",
      reason: "Finance review access is required to copy this receipt.",
    };
  }

  return { state: "READY" };
}

export function settleReceiptFinancePromotion(
  result:
    | { ok: true; evidenceId: string; message: string }
    | { ok: false; error: string },
): ReceiptFinancePromotionSettlement {
  return result.ok
    ? {
        state: "COPIED",
        evidenceId: result.evidenceId,
        message: result.message,
      }
    : { state: "ERROR", message: result.error };
}

export function canCopyReceiptToFinance(input: {
  role: StaffRole;
  staffId: string | null;
  assignedToId: string | null;
  openFinanceReview: boolean;
}): boolean {
  if (input.role === "ADMIN" || input.role === "CEO" || input.role === "FINANCE") return true;
  return input.openFinanceReview && input.staffId !== null && input.staffId === input.assignedToId;
}

export function financeEvidenceDestinationPath(input: {
  agencyId: string;
  attachmentId: string;
  mimeType: string;
}): string {
  const type = normalizedFinanceEvidenceMimeType(input.mimeType);
  const suffix = FINANCE_EVIDENCE_EXTENSIONS[type];
  if (!suffix) throw new Error("Receipt file type is not supported by Finance");
  return `${input.agencyId}/inbox-receipts/${input.attachmentId}.${suffix}`;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function dateCandidate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export function receiptCandidateFromAnalysis(fields: Record<string, unknown>, confidence: number | null): FinanceEvidenceCandidate {
  const amount = finitePositive(fields.amount);
  const reference = typeof fields.reference === "string" && fields.reference.trim() ? fields.reference.trim().slice(0, 200) : null;
  const date = dateCandidate(fields.paidAt);
  const boundedConfidence = confidence === null || !Number.isFinite(confidence) ? null : Math.max(0, Math.min(1, confidence));
  return {
    amount,
    reference,
    date,
    confidence: boundedConfidence,
    attribution: {
      ...(amount === null ? {} : { amount: "MODEL_CANDIDATE" as const }),
      ...(reference === null ? {} : { reference: "MODEL_CANDIDATE" as const }),
      ...(date === null ? {} : { date: "MODEL_CANDIDATE" as const }),
      authoritative: false,
    },
  };
}

export function financeEvidenceRetentionExpiry(nowIso: string, retentionDays: number): string {
  const safeDays = Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 365 ? retentionDays : 90;
  return new Date(new Date(nowIso).getTime() + safeDays * 86_400_000).toISOString();
}
