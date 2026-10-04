/**
 * PAYMENT_CLAIM_UNVERIFIED — the customer says they have paid, and the books do not show it. Pure, no model.
 *
 * Fires when the newest customer message claims a payment in the PAST ("I have paid", "transferred yesterday", "bank slip
 * attached") and no confirmed payment covers it. A confirmed payment is one finance has completed; a payment still pending
 * verification does not clear the claim. If the customer names an amount, the confirmed total has to reach it. A question
 * ("how do I pay?", "when should I pay?") or a promise ("I will pay tomorrow") is not a claim.
 */

import { normaliseText, snippetOf, type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

const CLAIM = [
  /\b(i|we|i've|we've) ?(have|had)? ?(already |just |now )?(paid|transferred|deposited|remitted)\b/,
  /\b(i|we) (already |just )?(sent|made|did) (the |a |my |our )?(payment|money|transfer|deposit|advance)\b/,
  /\b(payment|money|advance|deposit|balance) (is |was |has been |have been )?(already )?(done|paid|sent|transferred|deposited)\b/,
  /\b(paid|transferred) (the |my |our )?(money|payment|advance|deposit|balance|amount|full|fully)\b/,
  /\b(bank|payment) (slip|receipt|proof|screenshot)\b.*\b(attached|sent|here|above)\b/,
  /\b(attached|sending|sent) (the |my )?(bank|payment) (slip|receipt|proof|screenshot)\b/,
  /ගෙව්වා|මුදල් යැව්වා|බැංකුවට දැම්මා/u,
  /செலுத்தினேன்|செலுத்திவிட்டேன்|பணம் அனுப்பினேன்|செலுத்தி விட்டோம்/u,
];

/** "how do I pay", "when should we pay", "I will pay", "can I pay" — asking or promising, not claiming. */
const NOT_A_CLAIM = /\b(how|when|where|can|could|should|shall|will|going to|want to|plan to|would like to|need to|have to|must) (do |can |should |shall |i |we |to )*(pay|transfer|deposit)\b|\bwill (pay|transfer|send|deposit)\b|\bif (i|we) (pay|paid)\b|\bhave (i|we) paid\b/;

/** The first amount in the text, in whole rupees: "LKR 250,000", "Rs. 250 000", "250000/=", "250k". */
export function claimedAmount(text: string): number | null {
  const match = normaliseText(text).match(/(?:lkr|rs\.?|rupees)?\s*(\d{1,3}(?:[ ,]\d{3})+|\d{4,9})(?:\.\d+)?\s*(?:\/=|lkr|rs|rupees)?|\b(\d{2,4})\s?k\b/);
  if (!match) return null;
  if (match[2]) return Number(match[2]) * 1000;
  const value = Number(match[1].replace(/[ ,]/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function detectPaymentClaimUnverified(facts: RiskFacts): RiskFinding | null {
  const message = facts.latest;
  if (!message || message.text.trim().length === 0) return null;
  const text = normaliseText(message.text);
  if (!CLAIM.some((pattern) => pattern.test(text)) || NOT_A_CLAIM.test(text)) return null;

  const confirmed = facts.payments?.confirmedTotal ?? 0;
  const amount = claimedAmount(message.text);
  const covered = (facts.payments?.confirmedCount ?? 0) > 0 && (amount === null || confirmed >= amount);
  if (covered) return null;

  return { code: "PAYMENT_CLAIM_UNVERIFIED", messageId: message.id, confidence: amount !== null ? 0.95 : 0.9, evidence: [{ messageId: message.id, snippet: snippetOf(message.text) }] };
}

export const paymentClaimUnverified: RiskDetector = { code: "PAYMENT_CLAIM_UNVERIFIED", detect: detectPaymentClaimUnverified };
