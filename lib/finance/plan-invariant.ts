/**
 * Σ milestones = booking total − credit notes — plan §4.14 gap 4. A pure
 * check over numbers already in hand; when it fails, the page shows a system
 * signal instead of silently trusting whichever total happens to be on
 * screen.
 */

export interface PlanInvariantInput {
  milestoneAmounts: readonly number[];
  bookingTotal: number;
  creditNoteTotal: number;
}

export interface PlanInvariantResult {
  ok: boolean;
  expected: number;
  actual: number;
  differenceAbs: number;
}

/** Cents-level float drift is tolerated; anything larger is a real mismatch. */
const TOLERANCE = 0.01;

export function checkPlanInvariant(input: PlanInvariantInput): PlanInvariantResult {
  const actual = input.milestoneAmounts.reduce((sum, a) => sum + a, 0);
  const expected = input.bookingTotal - input.creditNoteTotal;
  const differenceAbs = Math.abs(actual - expected);
  return { ok: differenceAbs <= TOLERANCE, expected, actual, differenceAbs };
}
