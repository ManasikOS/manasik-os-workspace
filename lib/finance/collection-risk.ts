/**
 * Deterministic collection-risk scorer — plan §4.14. No model call: every
 * factor is read straight off milestone rows already in hand. The AI layer
 * (`lib/ai/surfaces/finance/payment-plan-workflows.ts`) only ever explains
 * this score after the fact; it never produces the number itself, so there
 * is no "opaque predicted probability" presented as fact.
 *
 * Deliberately excludes two factors plan §4.14 lists ("time to departure",
 * "payer's prior on-time rate across bookings") — neither is derivable from
 * a `FinanceMilestoneRow` alone (they need the group's departure date and a
 * cross-booking join respectively). Rather than fabricate them, `factors`
 * only ever reports what was actually computed — same "never fabricate a
 * number" posture as `lib/ai/trust/claim-verifier.ts`.
 */

export type CollectionRiskBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CollectionRiskMilestoneInput {
  amount: number;
  paidAmount: number;
  dueAt: string | null;
  waived: boolean;
  rescheduled: boolean;
}

export interface CollectionRiskFactors {
  /** Largest number of days any single unpaid, past-due instalment has been overdue. */
  maxDaysOverdue: number;
  /** Count of instalments currently overdue (past due, not fully paid, not waived). */
  overdueCount: number;
  /** Fraction of amount due (across due instalments) still unpaid, 0-1. */
  unpaidDueRatio: number;
  /** Count of instalments rescheduled at least once. */
  rescheduledCount: number;
}

export interface CollectionRiskResult {
  score: number;
  band: CollectionRiskBand;
  factors: CollectionRiskFactors;
}

const WEIGHT_OVERDUE_DAYS = 1.5; // per day overdue, capped
const MAX_OVERDUE_DAYS_CONTRIBUTION = 45; // caps the days-overdue term at 45 * 1.5 = 67.5
const WEIGHT_OVERDUE_COUNT = 8; // per overdue instalment
const WEIGHT_UNPAID_RATIO = 20; // scaled by unpaidDueRatio (0-1)
const WEIGHT_RESCHEDULED = 4; // per rescheduled instalment

function daysOverdue(dueAt: string, nowIso: string): number {
  const due = Date.parse(dueAt);
  const now = Date.parse(nowIso);
  return Math.max(0, Math.floor((now - due) / 86_400_000));
}

function bandFor(score: number): CollectionRiskBand {
  if (score >= 70) return "CRITICAL";
  if (score >= 40) return "HIGH";
  if (score >= 15) return "MEDIUM";
  return "LOW";
}

/**
 * Scores one booking's collection risk from its instalments. Monotonic: score
 * never decreases when an instalment becomes more overdue, gains a missed
 * payment, or is rescheduled again — verified by
 * `collection-risk.test.ts`. Bounded to [0, 100].
 */
export function computeCollectionRisk(
  milestones: readonly CollectionRiskMilestoneInput[],
  nowIso: string,
): CollectionRiskResult {
  let maxDaysOverdue = 0;
  let overdueCount = 0;
  let rescheduledCount = 0;
  let dueTotal = 0;
  let unpaidOfDueTotal = 0;

  for (const m of milestones) {
    if (m.waived) continue;
    if (m.rescheduled) rescheduledCount += 1;

    const outstanding = Math.max(0, m.amount - m.paidAmount);
    const isDue = m.dueAt !== null && Date.parse(m.dueAt) <= Date.parse(nowIso);
    if (isDue) {
      dueTotal += m.amount;
      unpaidOfDueTotal += outstanding;
      if (outstanding > 0) {
        overdueCount += 1;
        const d = daysOverdue(m.dueAt as string, nowIso);
        if (d > maxDaysOverdue) maxDaysOverdue = d;
      }
    }
  }

  const unpaidDueRatio = dueTotal > 0 ? unpaidOfDueTotal / dueTotal : 0;

  const score =
    Math.min(maxDaysOverdue, MAX_OVERDUE_DAYS_CONTRIBUTION) * WEIGHT_OVERDUE_DAYS +
    overdueCount * WEIGHT_OVERDUE_COUNT +
    unpaidDueRatio * WEIGHT_UNPAID_RATIO +
    rescheduledCount * WEIGHT_RESCHEDULED;

  const bounded = Math.max(0, Math.min(100, Math.round(score * 100) / 100));

  return {
    score: bounded,
    band: bandFor(bounded),
    factors: { maxDaysOverdue, overdueCount, unpaidDueRatio, rescheduledCount },
  };
}
