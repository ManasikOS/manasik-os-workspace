/**
 * MINOR_OR_ASSISTANCE_NEEDED — a traveller is under 18 on the departure date, or needs help getting around. Pure, no model.
 * Three sources, any one fires: a traveller's date of birth (under 18 at departure), an accessibility need Copilot read, or
 * an assistance word in the customer's newest message ("wheelchair", "elderly mother", "needs assistance"). An adult with a
 * date of birth on file and no such words never fires; "help" alone is not enough.
 */

import { normaliseText, snippetOf, type RiskDetector, type RiskFacts, type RiskFinding } from "../types";

const ASSISTANCE = /\b(wheelchair|wheel chair|walking stick|walker|disabled|disability|handicapped|blind|cannot walk|can't walk|unable to walk|elderly|very old|oxygen|special assistance|needs assistance|need assistance|mobility)\b/;

function ageOn(dateOfBirth: string, onDate: string): number {
  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  const on = new Date(`${onDate.slice(0, 10)}T00:00:00Z`);
  let age = on.getUTCFullYear() - born.getUTCFullYear();
  if (on.getUTCMonth() < born.getUTCMonth() || (on.getUTCMonth() === born.getUTCMonth() && on.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

export function detectMinorOrAssistanceNeeded(facts: RiskFacts): RiskFinding | null {
  const onDate = facts.departureDate ?? facts.now;
  const minor = facts.passengers.find((passenger) => passenger.dateOfBirth !== null && ageOn(passenger.dateOfBirth, onDate) < 18);
  if (minor) return { code: "MINOR_OR_ASSISTANCE_NEEDED", messageId: null, confidence: 1, evidence: [{ messageId: null, snippet: `${minor.name || "A traveller"} is under 18 on the departure date` }] };

  if (facts.accessibilityNeeds.length > 0) return { code: "MINOR_OR_ASSISTANCE_NEEDED", messageId: facts.latest?.id ?? null, confidence: 0.9, evidence: [{ messageId: facts.latest?.id ?? null, snippet: snippetOf(facts.accessibilityNeeds.join(", ")) }] };

  const message = facts.latest;
  if (message && ASSISTANCE.test(normaliseText(message.text))) return { code: "MINOR_OR_ASSISTANCE_NEEDED", messageId: message.id, confidence: 0.8, evidence: [{ messageId: message.id, snippet: snippetOf(message.text) }] };
  return null;
}

export const minorOrAssistanceNeeded: RiskDetector = { code: "MINOR_OR_ASSISTANCE_NEEDED", detect: detectMinorOrAssistanceNeeded };
