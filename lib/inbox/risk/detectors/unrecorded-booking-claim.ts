/**
 * UNRECORDED_BOOKING_CLAIM — the customer quotes a booking reference we have no booking for. Pure, no model.
 * The loader looks each quoted reference up (agency-scoped); this fires for one that does not exist. A reference that exists
 * never fires, and text with no reference in it never fires: this is about a specific claim, not about the word "booking".
 */

import { snippetOf, type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

/** References look like `UMR-NOV-BK012`: letters, digits and dashes, then `-BK` and the number. */
export const BOOKING_REFERENCE = /\b[A-Z0-9][A-Z0-9]*(?:-[A-Z0-9]+)*-BK\d{2,5}\b/gi;

export function referencesIn(text: string): string[] {
  return [...new Set((text.match(BOOKING_REFERENCE) ?? []).map((reference) => reference.toUpperCase()))];
}

export function detectUnrecordedBookingClaim(facts: RiskFacts): RiskFinding | null {
  const message = facts.latest;
  const missing = facts.claimedReferences.find((claim) => !claim.exists);
  if (!message || !missing) return null;
  return { code: "UNRECORDED_BOOKING_CLAIM", messageId: message.id, confidence: 0.95, evidence: [{ messageId: message.id, snippet: snippetOf(message.text) }] };
}

export const unrecordedBookingClaim: RiskDetector = { code: "UNRECORDED_BOOKING_CLAIM", detect: detectUnrecordedBookingClaim };
