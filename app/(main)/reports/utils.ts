/**
 * Formatters and small predicates for the Reports workspace. Money/date
 * formatting is re-exported from Departure Groups rather than re-implemented
 * — same convention as `app/(main)/finance/payments/utils.ts`.
 */

export {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatExactCurrency,
  formatShortDate,
} from "@/app/(main)/departure-groups/utils";

/** `+14%` / `−8%` / `—`. `null` means "no comparison" — render an em dash. */
export function formatPercentDelta(delta: number | null): string {
  if (delta === null) return "—";
  const rounded = Math.round(delta * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "" : "±";
  return `${sign}${rounded}%`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}
