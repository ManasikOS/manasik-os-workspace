/**
 * Deterministic Finance evidence matcher (FIN-04). Pure code ranks which
 * existing payments could correspond to a copied receipt using only explicit
 * identifiers, amount, date and CRM links. The model-extracted receipt fields
 * are treated as untrusted signals to compare against, never as a decision.
 * Nothing here applies a match: the result always reports `autoApplied: false`
 * and ambiguous evidence stays unmatched for a human to resolve.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { inboxPageHref } from "@/lib/inbox/page-request";

export type EvidenceMatchReasonCode =
  | "REFERENCE_EXACT"
  | "AMOUNT_EXACT"
  | "BOOKING_LINKED"
  | "DEPARTURE_GROUP_LINKED"
  | "DATE_SAME_DAY"
  | "DATE_WITHIN_WINDOW";

export type EvidenceMatchStrength = "STRONG" | "POSSIBLE";

export type EvidenceUnmatchedReason = "NO_USABLE_EVIDENCE" | "NOT_PENDING_REVIEW" | "NO_CANDIDATE";

export interface EvidenceMatchingSubject {
  id: string;
  amount: number | null;
  reference: string | null;
  /** ISO calendar date (YYYY-MM-DD) read from the receipt. */
  date: string | null;
  bookingId: string | null;
  departureGroupId: string | null;
  status?: "PENDING_REVIEW" | "MATCHED_TO_PAYMENT" | "DISMISSED";
}

export interface EvidenceMatchingPayment {
  paymentId: string;
  paymentReference: string;
  referenceNumber: string | null;
  amount: number;
  currency: string;
  paidAt: string;
  status: string;
  bookingId: string;
  departureGroupId: string;
  reversesPaymentId: string | null;
}

export interface EvidenceMatchCandidate {
  paymentId: string;
  paymentReference: string;
  amount: number;
  currency: string;
  paidAt: string;
  bookingId: string;
  departureGroupId: string;
  score: number;
  strength: EvidenceMatchStrength;
  reasonCodes: EvidenceMatchReasonCode[];
  reasons: string[];
}

export interface EvidenceMatchResult {
  evidenceId: string;
  outcome: "CANDIDATES" | "AMBIGUOUS" | "UNMATCHED";
  candidates: EvidenceMatchCandidate[];
  unmatchedReason?: EvidenceUnmatchedReason;
  /** Literal by contract: this module never applies a match. */
  autoApplied: false;
}

const AMOUNT_TOLERANCE_CENTS = 1;
const DATE_WINDOW_DAYS = 7;
const MINIMUM_REFERENCE_LENGTH = 4;
const MATCHABLE_PAYMENT_STATUSES = new Set(["COMPLETED", "PENDING_VERIFICATION"]);
const FINANCE_EVIDENCE_REVIEW_ROLES: readonly StaffRole[] = ["ADMIN", "CEO", "FINANCE"];

const REASON_SCORE: Record<EvidenceMatchReasonCode, number> = {
  REFERENCE_EXACT: 40,
  AMOUNT_EXACT: 30,
  BOOKING_LINKED: 20,
  DEPARTURE_GROUP_LINKED: 5,
  DATE_SAME_DAY: 10,
  DATE_WITHIN_WINDOW: 5,
};

const REASON_TEXT: Record<EvidenceMatchReasonCode, string> = {
  REFERENCE_EXACT: "The receipt reference matches this payment's reference.",
  AMOUNT_EXACT: "The receipt amount equals this payment's amount.",
  BOOKING_LINKED: "The receipt's conversation is linked to the same booking as this payment.",
  DEPARTURE_GROUP_LINKED: "The receipt's conversation is linked to the same departure group as this payment.",
  DATE_SAME_DAY: "The payment was recorded on the same day as the receipt.",
  DATE_WITHIN_WINDOW: `The payment was recorded within ${DATE_WINDOW_DAYS} days of the receipt.`,
};

export function canReviewFinanceEvidence(role: StaffRole): boolean {
  return FINANCE_EVIDENCE_REVIEW_ROLES.includes(role);
}

/** Mirrors the evidence table's write policy: CEO may look but never match or dismiss. */
export function canDecideFinanceEvidence(role: StaffRole): boolean {
  return role === "ADMIN" || role === "FINANCE";
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function normalizedReference(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length >= MINIMUM_REFERENCE_LENGTH ? normalized : null;
}

function dayGap(evidenceDate: string, paidAt: string): number {
  return Math.abs(Date.parse(`${evidenceDate}T00:00:00.000Z`) - Date.parse(`${paidAt.slice(0, 10)}T00:00:00.000Z`)) / 86_400_000;
}

function unmatched(evidenceId: string, unmatchedReason: EvidenceUnmatchedReason): EvidenceMatchResult {
  return { evidenceId, outcome: "UNMATCHED", candidates: [], unmatchedReason, autoApplied: false };
}

function candidateFor(
  evidence: EvidenceMatchingSubject,
  evidenceReference: string | null,
  payment: EvidenceMatchingPayment,
): EvidenceMatchCandidate | null {
  const reasonCodes: EvidenceMatchReasonCode[] = [];

  if (
    evidenceReference !== null
    && [payment.paymentReference, payment.referenceNumber].some((reference) => normalizedReference(reference) === evidenceReference)
  ) {
    reasonCodes.push("REFERENCE_EXACT");
  }
  if (evidence.amount !== null && Math.abs(toCents(payment.amount) - toCents(evidence.amount)) <= AMOUNT_TOLERANCE_CENTS) {
    reasonCodes.push("AMOUNT_EXACT");
  }
  // A shared booking or date alone never makes a candidate: an exact reference
  // or amount must anchor it first.
  if (reasonCodes.length === 0) return null;

  const hasAnchoredAmount = reasonCodes.includes("AMOUNT_EXACT");
  const hasAnchoredReference = reasonCodes.includes("REFERENCE_EXACT");
  const bookingLinked = evidence.bookingId !== null && evidence.bookingId === payment.bookingId;
  if (bookingLinked) reasonCodes.push("BOOKING_LINKED");
  if (evidence.departureGroupId !== null && evidence.departureGroupId === payment.departureGroupId) {
    reasonCodes.push("DEPARTURE_GROUP_LINKED");
  }
  if (evidence.date !== null) {
    const gap = dayGap(evidence.date, payment.paidAt);
    if (gap === 0) reasonCodes.push("DATE_SAME_DAY");
    else if (gap <= DATE_WINDOW_DAYS) reasonCodes.push("DATE_WITHIN_WINDOW");
  }

  const strong = (hasAnchoredReference && hasAnchoredAmount) || (hasAnchoredAmount && bookingLinked);
  return {
    paymentId: payment.paymentId,
    paymentReference: payment.paymentReference,
    amount: payment.amount,
    currency: payment.currency,
    paidAt: payment.paidAt,
    bookingId: payment.bookingId,
    departureGroupId: payment.departureGroupId,
    score: reasonCodes.reduce((total, code) => total + REASON_SCORE[code], 0),
    strength: strong ? "STRONG" : "POSSIBLE",
    reasonCodes,
    reasons: reasonCodes.map((code) => REASON_TEXT[code]),
  };
}

export function matchFinanceEvidenceToPayments(
  evidence: EvidenceMatchingSubject,
  payments: readonly EvidenceMatchingPayment[],
): EvidenceMatchResult {
  if (evidence.status !== undefined && evidence.status !== "PENDING_REVIEW") {
    return unmatched(evidence.id, "NOT_PENDING_REVIEW");
  }
  const evidenceReference = normalizedReference(evidence.reference);
  if (evidenceReference === null && evidence.amount === null) return unmatched(evidence.id, "NO_USABLE_EVIDENCE");

  const candidates = payments
    .filter((payment) => payment.reversesPaymentId === null && payment.amount > 0 && MATCHABLE_PAYMENT_STATUSES.has(payment.status))
    .map((payment) => candidateFor(evidence, evidenceReference, payment))
    .filter((candidate): candidate is EvidenceMatchCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || b.paidAt.localeCompare(a.paidAt) || a.paymentId.localeCompare(b.paymentId));

  if (candidates.length === 0) return unmatched(evidence.id, "NO_CANDIDATE");

  const ambiguous = candidates.length > 1 && candidates[0].score === candidates[1].score;
  return { evidenceId: evidence.id, outcome: ambiguous ? "AMBIGUOUS" : "CANDIDATES", candidates, autoApplied: false };
}

/** What the Finance review screen receives: no agency id and no raw Inbox identifiers, only a permitted link. */
export interface FinanceEvidenceIntakeItem {
  id: string;
  amount: number | null;
  reference: string | null;
  date: string | null;
  createdAt: string;
  sourceHref: string | null;
  match: EvidenceMatchResult;
}

export function toFinanceEvidenceIntakeItem(
  item: {
    evidence: {
      id: string;
      amount: number | null;
      reference: string | null;
      date: string | null;
      createdAt: string;
      sourceConversationId: string | null;
    };
    match: EvidenceMatchResult;
  },
  canOpenInbox: boolean,
): FinanceEvidenceIntakeItem {
  const { evidence } = item;
  return {
    id: evidence.id,
    amount: evidence.amount,
    reference: evidence.reference,
    date: evidence.date,
    createdAt: evidence.createdAt,
    sourceHref: canOpenInbox && evidence.sourceConversationId
      ? inboxPageHref({ conversationId: evidence.sourceConversationId })
      : null,
    match: item.match,
  };
}
