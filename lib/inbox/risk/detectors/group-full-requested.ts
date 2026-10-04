/**
 * GROUP_FULL_REQUESTED — the departure the customer wants cannot take them. Pure, no model.
 * Fires when the requested group (read live) has fewer seats than the party, or is no longer open for sale. A group with
 * room for the whole party, or a conversation with no requested group or unknown party, never fires.
 */

import { type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

export function detectGroupFullRequested(facts: RiskFacts): RiskFinding | null {
  const group = facts.requestedGroup;
  if (!group) return null;
  const party = facts.partySize ?? 1;
  const full = group.availableSeats < party;
  if (!full && group.sellable) return null;
  const why = !group.sellable ? "is not open for sale" : `has ${group.availableSeats} seat${group.availableSeats === 1 ? "" : "s"} left for a party of ${party}`;
  return { code: "GROUP_FULL_REQUESTED", messageId: null, confidence: 1, evidence: [{ messageId: null, snippet: `${group.name} ${why}` }] };
}

export const groupFullRequested: RiskDetector = { code: "GROUP_FULL_REQUESTED", detect: detectGroupFullRequested };
