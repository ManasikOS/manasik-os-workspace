/**
 * Deterministic invoice system signals — plan §4.13. Pure functions over
 * figures already on hand; nothing here calls a model.
 */

const OVERPAYMENT_TOLERANCE = 0.01;
const UNSENT_WINDOW_DAYS = 3;
const STALE_DRAFT_WINDOW_DAYS = 7;

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/** True when payments allocated against this invoice exceed what it billed. */
export function isOverpaid(invoiceAmount: number, allocatedTotal: number): boolean {
  return allocatedTotal - invoiceAmount > OVERPAYMENT_TOLERANCE;
}

/** True for an ISSUED (or later) invoice that has sat unsent for more than 3 days. */
export function isIssuedUnsent(status: string, issuedAt: string | null, sentAt: string | null, nowIso: string): boolean {
  if (status === "DRAFT" || status === "VOID") return false;
  if (sentAt || !issuedAt) return false;
  return daysBetween(issuedAt, nowIso) > UNSENT_WINDOW_DAYS;
}

/** True for a DRAFT invoice older than 7 days — a draft nobody has issued is easy to forget. */
export function isDraftStale(status: string, createdAt: string, nowIso: string): boolean {
  if (status !== "DRAFT") return false;
  return daysBetween(createdAt, nowIso) > STALE_DRAFT_WINDOW_DAYS;
}
