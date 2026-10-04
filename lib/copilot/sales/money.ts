/**
 * Decimal-safe money for the Sales Intelligence Engine.
 *
 * Every amount is converted to integer cents before any arithmetic, so a
 * total built from a per-person price, a child price and a discount can never
 * pick up floating-point drift (0.1 + 0.2). Amounts leave this module as
 * two-decimal numbers — the precision the numeric(14,2) columns store.
 */

/** Rupees (up to two decimals) → integer cents. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100);
}

/** Integer cents → rupees. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + Math.round(value), 0);
}

/** A percentage of a cents amount, rounded to the nearest cent. */
export function percentOfCents(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

const LKR_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** `420000` → `LKR 420,000`; `1250.5` → `LKR 1,250.5`. Locale pinned. */
export function formatMoney(amount: number, currency = "LKR"): string {
  return `${currency} ${LKR_FORMATTER.format(amount)}`;
}
