/**
 * Shared quote status display — plan §4.4 gap 1 ("PENDING_APPROVAL displays
 * as 'Internal Review', DECLINED as 'Rejected'"). Client-safe, pure; every
 * quote-status badge in the app (list, detail, lead drawer) reads from here
 * instead of keeping its own copy.
 */

import type { QuoteStatus } from "@/lib/copilot/sales/types";
import type { Tone } from "@/lib/ui/tone";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Internal Review",
  SENT: "Sent",
  VIEWED: "Viewed",
  EXPIRED: "Expired",
  ACCEPTED: "Accepted",
  DECLINED: "Rejected",
  SUPERSEDED: "Superseded",
  CANCELLED: "Cancelled",
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  SENT: "info",
  VIEWED: "info",
  EXPIRED: "neutral",
  ACCEPTED: "success",
  DECLINED: "danger",
  SUPERSEDED: "neutral",
  CANCELLED: "neutral",
};

/** Statuses where the quote is still an open ask — not yet decided or lapsed. */
export const OPEN_QUOTE_STATUSES: readonly QuoteStatus[] = ["DRAFT", "PENDING_APPROVAL", "SENT", "VIEWED"];
