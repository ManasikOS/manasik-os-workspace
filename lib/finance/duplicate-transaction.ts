/**
 * "Same transaction reference imported twice" — plan §4.19 system signal.
 * Distinct from the exact-duplicate unique constraint on `bank_transactions`
 * (which silently skips a byte-for-byte re-paste): this flags a *different*
 * row — different description text, maybe a different date within a short
 * window — that shares a reference and amount with one already on file,
 * the way two overlapping statement exports can describe the same wire
 * slightly differently.
 */

export interface DuplicateCheckTransaction {
  id: string;
  reference: string | null;
  amount: number;
  statementDate: string;
}

const DUPLICATE_WINDOW_DAYS = 3;

/** Returns the id of the existing transaction this one duplicates, or null. */
export function findDuplicateTransaction(
  candidate: DuplicateCheckTransaction,
  existing: readonly DuplicateCheckTransaction[],
): string | null {
  if (!candidate.reference) return null;

  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (!other.reference) continue;
    if (other.reference !== candidate.reference) continue;
    if (other.amount !== candidate.amount) continue;
    const dayGap = Math.abs(Date.parse(other.statementDate) - Date.parse(candidate.statementDate)) / 86_400_000;
    if (dayGap <= DUPLICATE_WINDOW_DAYS) return other.id;
  }
  return null;
}
