/**
 * WINDOW_CLOSING_SOON — the customer's free-reply window closes within two hours and we still owe them an answer. Pure.
 * Fires only while the window is still open (a closed window is a different problem the composer already explains), only
 * inside CHANNEL_WINDOW_BUFFER_MINUTES, and only while the customer is waiting for us.
 */

import { CHANNEL_WINDOW_BUFFER_MINUTES } from "@/lib/inbox/sla/due-at";

import { type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

export function detectWindowClosingSoon(facts: RiskFacts): RiskFinding | null {
  if (!facts.serviceWindowExpiresAt || !facts.awaitingReply) return null;
  const minutesLeft = (Date.parse(facts.serviceWindowExpiresAt) - Date.parse(facts.now)) / 60_000;
  if (!(minutesLeft > 0 && minutesLeft <= CHANNEL_WINDOW_BUFFER_MINUTES)) return null;
  return { code: "WINDOW_CLOSING_SOON", messageId: null, confidence: 1, evidence: [{ messageId: null, snippet: `The reply window closes in ${Math.ceil(minutesLeft)} minutes` }] };
}

export const windowClosingSoon: RiskDetector = { code: "WINDOW_CLOSING_SOON", detect: detectWindowClosingSoon };
