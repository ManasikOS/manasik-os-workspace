/**
 * Which status changes a person may make to a quote by hand.
 *
 * `lead_quotes.status` has a CHECK constraint on its values and nothing else, so before this any status could be written over any other — most
 * importantly `PENDING_APPROVAL` → `SENT`, which let anyone who could send a quote release a discount that was waiting for an administrator.
 *
 * `PENDING_APPROVAL` is only left for `DRAFT` / `SENT` by an approver (`needsApproval`); anyone may withdraw it (`CANCELLED`). The database trigger
 * `lead_quotes_guard` (20270125090000) enforces the same rule for a caller that does not come through the application.
 */

import type { QuoteStatus } from "@/lib/copilot/sales/types";

const TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "SENT", "CANCELLED", "EXPIRED"],
  PENDING_APPROVAL: ["DRAFT", "SENT", "CANCELLED"],
  SENT: ["VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED", "SUPERSEDED"],
  VIEWED: ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED", "SUPERSEDED"],
  // A customer's acceptance is only taken back by recording that they declined; cancelling an accepted quote is refused elsewhere.
  ACCEPTED: ["DECLINED"],
  DECLINED: [],
  EXPIRED: [],
  SUPERSEDED: [],
  CANCELLED: [],
};

export type QuoteTransitionVerdict = { ok: true } | { ok: false; error: string };

export interface QuoteTransitionContext {
  from: QuoteStatus;
  to: QuoteStatus;
  /** True when the caller is allowed to approve a held discount (administrators). */
  isApprover: boolean;
}

export function checkQuoteTransition({ from, to, isApprover }: QuoteTransitionContext): QuoteTransitionVerdict {
  if (from === to) return { ok: true };

  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `A ${label(from)} quote cannot be marked ${label(to)}.` };
  }
  if (from === "PENDING_APPROVAL" && (to === "SENT" || to === "DRAFT") && !isApprover) {
    return { ok: false, error: "This quote is waiting for administrator approval before it can be released." };
  }
  return { ok: true };
}

function label(status: QuoteStatus): string {
  return status.replace(/_/g, " ").toLowerCase();
}
