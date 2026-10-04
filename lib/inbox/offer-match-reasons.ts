import type { RailOffer } from "@/lib/inbox/intelligence/rail-view";

/**
 * Why Copilot recommends this departure, as short lines staff can check against the customer's messages.
 * A recommendation with no reasons is never shown as if it were solid: the card says "Based on limited information".
 */

export type OfferReasonSource = Pick<RailOffer, "recommendationReason" | "fitLabel" | "departureLabel" | "roomLabel" | "seatsLabel" | "check">;

export interface OfferMatchReasons {
  lines: string[];
  /** The expander's heading. */
  heading: "Why this matches" | "Based on limited information";
}

export function offerMatchReasons(offer: OfferReasonSource): OfferMatchReasons {
  const lines: string[] = [];
  if (offer.recommendationReason?.trim()) lines.push(offer.recommendationReason.trim());
  if (offer.fitLabel) lines.push(`${offer.fitLabel} for what the customer asked`);
  if (offer.departureLabel) lines.push(offer.departureLabel);
  if (offer.roomLabel) lines.push(`Room type: ${offer.roomLabel}`);
  if (offer.seatsLabel) lines.push(offer.seatsLabel);
  // Only a claim we actually verified: the live check must have passed.
  if (offer.check.canQuote) lines.push("Price and seats were checked against the live departure");

  // The freshness line alone is not a reason to recommend anything.
  const substantive = lines.filter((line) => line !== "Price and seats were checked against the live departure");
  return { lines, heading: substantive.length > 0 ? "Why this matches" : "Based on limited information" };
}
