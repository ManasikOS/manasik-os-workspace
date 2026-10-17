/**
 * Quotes pending block (docs/modules/dashboard-role-blocks-spec.md
 * section 3.2) — pure, client-safe.
 *
 * "Open" is `OPEN_QUOTE_STATUSES`, "expiring soon" is `isQuoteExpiringSoon`
 * and the accept rate is accepted over every quote - all the Quotes page's
 * own definitions (`lib/quotes`). This only counts and orders.
 *
 * Carries no customer, price or margin data - a reference and a date per
 * row - so the one block serves MARKETING in full and CEO/FINANCE as an
 * oversight view without anything to redact.
 */

import type { QuoteStatus } from "@/lib/copilot/sales/types";
import type { QuotePipelineData, QuoteExpiringRow } from "@/lib/types/dashboard";
import { isQuoteAwaitingReply, isQuoteExpiringSoon } from "@/lib/quotes/pipeline";
import { OPEN_QUOTE_STATUSES } from "@/lib/quotes/status";

import type { QuoteDashboardFacts } from "./leads-repository";

/** Top N quotes plus a count of the rest — progressive disclosure, spec section 2. */
export const QUOTE_PIPELINE_ROW_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildQuotePipeline(quotes: QuoteDashboardFacts[], nowIso: string): QuotePipelineData {
  const now = Date.parse(nowIso);
  const status = (q: QuoteDashboardFacts) => q.status as QuoteStatus;

  const expiring = quotes
    .filter((q) => isQuoteExpiringSoon({ status: status(q), validUntil: q.valid_until }, now))
    .sort((a, b) => Date.parse(a.valid_until) - Date.parse(b.valid_until));

  const rows: QuoteExpiringRow[] = expiring.slice(0, QUOTE_PIPELINE_ROW_LIMIT).map((q) => ({
    quoteId: q.id,
    reference: q.reference,
    validUntil: q.valid_until,
    daysLeft: Math.max(0, Math.ceil((Date.parse(q.valid_until) - now) / DAY_MS)),
  }));

  const accepted = quotes.filter((q) => status(q) === "ACCEPTED").length;

  return {
    counts: {
      drafts: quotes.filter((q) => status(q) === "DRAFT").length,
      awaitingApproval: quotes.filter((q) => status(q) === "PENDING_APPROVAL").length,
      awaitingReply: quotes.filter((q) => isQuoteAwaitingReply(status(q))).length,
      expiringSoon: expiring.length,
      accepted,
    },
    open: quotes.filter((q) => OPEN_QUOTE_STATUSES.includes(status(q))).length,
    total: quotes.length,
    acceptRatePercent: quotes.length > 0 ? Math.round((accepted / quotes.length) * 100) : null,
    expiring: rows,
  };
}
