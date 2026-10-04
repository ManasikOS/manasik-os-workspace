/**
 * Fixed, deterministic priority policy approved at G2. Scores deliberately
 * exclude money: unlike urgency, amounts cannot be compared across currencies
 * without an FX policy. This module has no persistence or AI dependency.
 */

export const FINANCE_EXCEPTION_SIGNALS = [
  "OVERDUE_RECEIVABLE",
  "DUE_SOON_RECEIVABLE",
  "PENDING_REFUND",
  "OVERDUE_SUPPLIER",
  "DISPUTED_SUPPLIER",
] as const;

export type FinanceExceptionSignal = (typeof FINANCE_EXCEPTION_SIGNALS)[number];

export type FinanceExceptionReasonCode =
  | FinanceExceptionSignal
  | "MULTIPLE_OVERDUE_MILESTONES"
  | "OVERDUE_DATE_UNAVAILABLE";

export interface FinanceExceptionPriorityCandidate {
  id: string;
  signal: FinanceExceptionSignal;
  overdueDays?: number | null;
  overdueMilestoneCount?: number;
  /** Preserved for display only; never contributes to priority. */
  currency?: string;
  /** Preserved for display only; never contributes to priority. */
  amount?: number | null;
}

export interface RankedFinanceExceptionPriority extends FinanceExceptionPriorityCandidate {
  score: number;
  reasonCodes: FinanceExceptionReasonCode[];
}

const BASE_SCORE: Record<FinanceExceptionSignal, number> = {
  OVERDUE_RECEIVABLE: 100,
  DISPUTED_SUPPLIER: 90,
  OVERDUE_SUPPLIER: 80,
  PENDING_REFUND: 70,
  DUE_SOON_RECEIVABLE: 50,
};

function rankCandidate(candidate: FinanceExceptionPriorityCandidate): RankedFinanceExceptionPriority {
  const reasonCodes: FinanceExceptionReasonCode[] = [candidate.signal];
  let score = BASE_SCORE[candidate.signal];

  if (candidate.signal === "OVERDUE_RECEIVABLE") {
    if (typeof candidate.overdueDays === "number" && Number.isFinite(candidate.overdueDays)) {
      score += Math.min(Math.max(Math.floor(candidate.overdueDays), 0), 30);
    } else {
      reasonCodes.push("OVERDUE_DATE_UNAVAILABLE");
    }

    const overdueMilestoneCount = candidate.overdueMilestoneCount ?? 0;
    if (overdueMilestoneCount > 1) {
      score += Math.min((overdueMilestoneCount - 1) * 2, 10);
      reasonCodes.push("MULTIPLE_OVERDUE_MILESTONES");
    }
  }

  return { ...candidate, score, reasonCodes };
}

/** Returns the policy-ranked queue with a deterministic identity tie-breaker. */
export function rankFinanceExceptionPriorities(
  candidates: readonly FinanceExceptionPriorityCandidate[],
): RankedFinanceExceptionPriority[] {
  return candidates
    .map(rankCandidate)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
