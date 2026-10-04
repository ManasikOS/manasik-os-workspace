/**
 * STALE_PRICE_QUOTED — a price was sent to the customer, and that price has since changed. Pure, no model.
 *
 * R1: this is change-detection, never a timer. It fires only when the stored offer's live check says PRICE_CHANGED (the
 * group's `priced_at` moved) AND a message we sent after the offer was worked out states one of the offer's own figures. An
 * offer that is merely old, with its price unchanged, never fires. A different number in a message (a phone, a date) is not a
 * quoted price: the figure has to equal the offer's per-person or total price.
 */

import { normaliseText, snippetOf, type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

/** Every whole-number figure in a text, with thousands separators removed: "LKR 420,000", "420000/=", "4,20,000". */
export function figuresIn(text: string): number[] {
  const found = normaliseText(text).match(/\d[\d,. ]{2,}\d|\d{4,}/g) ?? [];
  const figures = new Set<number>();
  for (const raw of found) {
    const cleaned = raw.replace(/[ ,]/g, "");
    const value = Number(cleaned);
    if (Number.isFinite(value) && value >= 1000) figures.add(Math.round(value));
  }
  return [...figures];
}

export function detectStalePriceQuoted(facts: RiskFacts): RiskFinding | null {
  const offer = facts.matchedOffer;
  if (!offer || facts.offerCheck !== "PRICE_CHANGED") return null;

  const quotedFigures = new Set([Math.round(offer.pricePerPerson), ...(offer.totalPrice !== null ? [Math.round(offer.totalPrice)] : [])]);
  const since = Date.parse(offer.asOf);
  const sent = facts.outbound.filter((message) => Date.parse(message.createdAt) >= since).find((message) => figuresIn(message.text).some((figure) => quotedFigures.has(figure)));
  if (!sent) return null;

  return { code: "STALE_PRICE_QUOTED", messageId: sent.id, confidence: 1, evidence: [{ messageId: sent.id, snippet: snippetOf(sent.text) }] };
}

export const stalePriceQuoted: RiskDetector = { code: "STALE_PRICE_QUOTED", detect: detectStalePriceQuoted };
