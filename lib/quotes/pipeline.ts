/**
 * The Quotes module's pipeline rules, pure and client-safe.
 *
 * Lifted out of `app/(main)/quotes/components/quotes-list-view.tsx`, where
 * "expiring soon" was an inline closure, so the Quotes page and the
 * Dashboard share one definition instead of the Dashboard inventing its own
 * (docs/modules/dashboard-role-blocks-spec.md: "the dashboard never derives
 * a number" a module already owns).
 */

import type { QuoteStatus } from "@/lib/copilot/sales/types";

/** A sent quote is "expiring soon" when it lapses inside this many days. */
export const QUOTE_EXPIRING_WINDOW_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Out with the customer and not yet answered. */
export function isQuoteAwaitingReply(status: QuoteStatus): boolean {
  return status === "SENT" || status === "VIEWED";
}

/**
 * Awaiting a reply, not yet lapsed, and lapsing inside the window. `nowMs`
 * is passed in so a whole render is measured against one clock.
 */
export function isQuoteExpiringSoon(quote: { status: QuoteStatus; validUntil: string }, nowMs: number): boolean {
  if (!isQuoteAwaitingReply(quote.status)) return false;
  const left = Date.parse(quote.validUntil) - nowMs;
  return left >= 0 && left <= QUOTE_EXPIRING_WINDOW_DAYS * DAY_MS;
}
