/**
 * Detector precision from staff verdicts — the measurement MI4.1's exit and MI4.3's recall gate depend on.
 *
 * Pure: it turns the rows of `inbox_signal_precision` into "how many were judged, how many were right, and is the gate met".
 * A gate is met only with enough judged signals; a handful of correct ones is not evidence (Architecture R5's "a quiet
 * week is not evidence", applied to detectors).
 */

/** The roles that read the Inbox's risk output and can tell whether it was right; the table's update policy allows exactly these. */
export const SIGNAL_REVIEW_ROLES = ["ADMIN", "MARKETING", "OPERATIONS", "FINANCE"] as const;

export interface SignalPrecisionRow {
  signalCode: string;
  detector: "RULE" | "MODEL";
  totalSignals: number;
  reviewed: number;
  correct: number;
  wrong: number;
}

/** Precision targets that gate later work. Only `PAYMENT_CLAIM_UNVERIFIED` gates MI4.2's move past SHADOW today. */
export const PRECISION_TARGETS: Readonly<Record<string, number>> = { PAYMENT_CLAIM_UNVERIFIED: 0.95 };

/** Judged signals needed before a target can count as met. */
export const MIN_REVIEWED_FOR_GATE = 20;

export type GateState = "NO_TARGET" | "NEEDS_MORE_REVIEWS" | "MET" | "NOT_MET";

export interface SignalPrecisionSummary extends SignalPrecisionRow {
  /** correct ÷ reviewed, or null until something has been judged. */
  precision: number | null;
  target: number | null;
  gate: GateState;
  /** How many more verdicts the gate needs before it can be decided (0 once enough). */
  reviewsStillNeeded: number;
}

export function summariseSignalPrecision(rows: readonly SignalPrecisionRow[]): SignalPrecisionSummary[] {
  const merged = new Map<string, SignalPrecisionRow>();
  for (const row of rows) {
    // The same code can come from a rule and from the model; a gate judges the code, so their counts add up.
    const key = row.signalCode;
    const existing = merged.get(key);
    merged.set(key, existing
      ? { ...existing, detector: existing.detector === row.detector ? row.detector : existing.detector, totalSignals: existing.totalSignals + row.totalSignals, reviewed: existing.reviewed + row.reviewed, correct: existing.correct + row.correct, wrong: existing.wrong + row.wrong }
      : { ...row });
  }

  return [...merged.values()]
    .map((row): SignalPrecisionSummary => {
      const precision = row.reviewed > 0 ? row.correct / row.reviewed : null;
      const target = PRECISION_TARGETS[row.signalCode] ?? null;
      const reviewsStillNeeded = Math.max(0, MIN_REVIEWED_FOR_GATE - row.reviewed);
      const gate: GateState =
        target === null ? "NO_TARGET"
        : reviewsStillNeeded > 0 ? "NEEDS_MORE_REVIEWS"
        : (precision ?? 0) >= target ? "MET"
        : "NOT_MET";
      return { ...row, precision, target, gate, reviewsStillNeeded };
    })
    .sort((a, b) => a.signalCode.localeCompare(b.signalCode));
}
