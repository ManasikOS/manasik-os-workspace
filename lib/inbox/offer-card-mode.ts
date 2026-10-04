/**
 * Which face the departure offer card shows. The card never hands staff something to confirm when the figures
 * behind it cannot be trusted.
 */

export type OfferCardMode = "READY" | "NEEDS_DETAILS" | "REVIEW_REQUIRED";

export function offerCardModeFor(offer: { missing: string[]; check: { canQuote: boolean } }): OfferCardMode {
  // Stale or unavailable price/seats win over everything: nothing may be quoted, so nothing is offered as ready.
  if (!offer.check.canQuote) return "REVIEW_REQUIRED";
  if (offer.missing.length > 0) return "NEEDS_DETAILS";
  return "READY";
}
