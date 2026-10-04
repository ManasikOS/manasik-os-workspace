/**
 * Period-close checklist — plan §4.19 gap 4: "all lines matched or
 * explained, unverified payments cleared, cash counted". Pure evaluation
 * over counts the caller already has (unmatched/ignored bank lines for the
 * period's account + date range, pending-verification payments) — the
 * actual CLOSED/OPEN state transition and its trigger-enforced lock live in
 * `lib/data/reconciliation-repository.ts` and the migration.
 */

export interface PeriodCloseInput {
  unmatchedCount: number;
  pendingVerificationCount: number;
  /** Whether a human has recorded the counted cash-on-hand figure for this period. */
  cashCounted: boolean;
}

export interface PeriodCloseChecklistItem {
  key: "linesMatched" | "paymentsVerified" | "cashCounted";
  label: string;
  done: boolean;
}

export interface PeriodCloseChecklistResult {
  ok: boolean;
  items: PeriodCloseChecklistItem[];
}

/** `ok` is true only when every item is done — the gate `closePeriod()` should check before allowing CLOSED. */
export function evaluatePeriodCloseChecklist(input: PeriodCloseInput): PeriodCloseChecklistResult {
  const items: PeriodCloseChecklistItem[] = [
    {
      key: "linesMatched",
      label: "Every bank line for this period is matched or explained (ignored)",
      done: input.unmatchedCount === 0,
    },
    {
      key: "paymentsVerified",
      label: "No payment left pending verification",
      done: input.pendingVerificationCount === 0,
    },
    { key: "cashCounted", label: "Cash on hand counted and recorded", done: input.cashCounted },
  ];
  return { ok: items.every((i) => i.done), items };
}
