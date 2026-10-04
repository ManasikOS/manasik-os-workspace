/**
 * Deterministic quote system signals — plan §4.4. Pure functions over
 * numbers/dates already on hand; the AI layer
 * (`lib/ai/surfaces/quotes/workflows.ts`) only ever narrates what these
 * already decided, it never re-derives one of these booleans itself.
 */

export interface ExpiringQuoteInput {
  status: string;
  validUntil: string;
}

const EXPIRING_WINDOW_MS = 72 * 60 * 60 * 1000;

/** True for an open quote (SENT/VIEWED) whose validity lapses within 72h and has had no follow-up activity since it was sent. */
export function isExpiringWithoutFollowUp(quote: ExpiringQuoteInput, nowIso: string, hasFollowUpSinceSent: boolean): boolean {
  if (quote.status !== "SENT" && quote.status !== "VIEWED") return false;
  const msUntilExpiry = Date.parse(quote.validUntil) - Date.parse(nowIso);
  if (msUntilExpiry < 0 || msUntilExpiry > EXPIRING_WINDOW_MS) return false;
  return !hasFollowUpSinceSent;
}

/** True when a discount exceeds the agency's approval-free band, as a percentage of the pre-discount total. */
export function isDiscountOutsideBand(discountAmount: number, totalBeforeDiscount: number, bandMaxPercent: number): boolean {
  if (discountAmount <= 0 || totalBeforeDiscount <= 0) return false;
  const percent = (discountAmount / totalBeforeDiscount) * 100;
  return percent > bandMaxPercent;
}

/** True when a quote's snapshotted per-person price no longer matches the group's current live price beyond a tolerance. */
export function snapshotPriceDiffersFromCurrent(
  snapshotPricePerPerson: number,
  currentPricePerPerson: number,
  toleranceRatio = 0.01,
): boolean {
  if (currentPricePerPerson <= 0) return false;
  const diffRatio = Math.abs(snapshotPricePerPerson - currentPricePerPerson) / currentPricePerPerson;
  return diffRatio > toleranceRatio;
}
