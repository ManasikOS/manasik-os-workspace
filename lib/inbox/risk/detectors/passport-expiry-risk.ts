/**
 * PASSPORT_EXPIRY_RISK — a traveller's passport will not be valid long enough for the trip. Pure, no model.
 * Fires when any passport expires before (departure date + the agency's validity months). A passport valid past that, or
 * one with no expiry on file, or a conversation with no departure date, never fires: not knowing is not a risk signal.
 */

import { type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function detectPassportExpiryRisk(facts: RiskFacts): RiskFinding | null {
  if (!facts.departureDate) return null;
  const needsValidUntil = addMonths(facts.departureDate, facts.passportValidityMonths);
  const short = facts.passengers.filter((passenger) => passenger.passportExpiry !== null && passenger.passportExpiry.slice(0, 10) < needsValidUntil);
  if (short.length === 0) return null;
  const names = short.map((passenger) => passenger.name || "A traveller").join(", ");
  return {
    code: "PASSPORT_EXPIRY_RISK",
    messageId: null,
    confidence: 1,
    evidence: [{ messageId: null, snippet: `${names}: passport expires before ${needsValidUntil} (${facts.passportValidityMonths} months after departure)` }],
  };
}

export const passportExpiryRisk: RiskDetector = { code: "PASSPORT_EXPIRY_RISK", detect: detectPassportExpiryRisk };
