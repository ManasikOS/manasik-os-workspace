/**
 * Commercial stage and estimated value — MI3.4 of docs/inbox/implementation-plan.md (Architecture §5.1, §6). Pure. NO MODEL.
 *
 * Where a conversation is in the sale, worked out ONLY from things that exist as records: the lead's stage, quotes, a booking,
 * the matched offer, and what S1/S2 read. It is derived from state, not from the last message, so a customer asking a
 * question after a quote was sent does not move the conversation back to "new".
 *
 * Order matters, first match wins:
 *   LOST → BOOKED → BOOKING_READY → QUOTE_SENT → READY_TO_RECOMMEND → QUALIFYING → UNQUALIFIED
 *
 * The four Sales queues read this column (compute_conversation_queues, migration `_mi3_4_commercial_queues`); the SQL and
 * `commercialQueuesFor` below are kept identical by a test. LOST and BOOKED are in none of them: a lost or booked customer
 * leaves the sales queues.
 *
 * `estimated_value_cents` comes from the matched offer's total and from nowhere else. A model never sets a price.
 */

import { COMMERCIAL_INTENT_CODES, type CommercialStage, type IntentCode, type MatchedOfferSnapshot, type QueueCode, type TravelIntentEvidence } from "./contracts";

export interface CommercialFacts {
  intentCode: IntentCode | null;
  /** `leads.stage` of the conversation's lead, or null when it has none. */
  leadStage: string | null;
  /** The lead's booking, if any. A cancelled or waitlisted booking is not a sale. */
  booking: { status: string } | null;
  /** `lead_quotes.status` for every quote on the lead. */
  quoteStatuses: readonly string[];
  matchedOffer: MatchedOfferSnapshot | null;
  /** What S2 read (empty when S2 is off). */
  readings: TravelIntentEvidence;
}

export interface CommercialState {
  stage: CommercialStage;
  estimatedValueCents: number | null;
  estimatedValueCurrency: string | null;
}

const LOST_LEAD_STAGES = new Set(["LOST", "DUPLICATE", "SPAM"]);
const REAL_BOOKING_STATUSES = new Set(["HELD", "DEPOSIT_PENDING", "CONFIRMED"]);
const SENT_QUOTE_STATUSES = new Set(["SENT", "VIEWED"]);
const SENT_LEAD_STAGES = new Set(["PROPOSAL_SENT", "NEGOTIATION"]);

const isCommercialIntent = (intent: IntentCode | null): boolean => intent !== null && (COMMERCIAL_INTENT_CODES as readonly IntentCode[]).includes(intent);

export function deriveCommercialStage(facts: CommercialFacts): CommercialStage {
  if (facts.leadStage !== null && LOST_LEAD_STAGES.has(facts.leadStage)) return "LOST";

  if ((facts.booking && REAL_BOOKING_STATUSES.has(facts.booking.status)) || facts.leadStage === "BOOKED" || facts.leadStage === "DEPOSIT_PENDING") return "BOOKED";

  // The customer has agreed: an accepted quote, or asked to book a departure Copilot has already matched to a known party.
  const agreed = facts.quoteStatuses.includes("ACCEPTED") || (facts.intentCode === "BOOKING_REQUEST" && facts.matchedOffer !== null);
  if (agreed) return "BOOKING_READY";

  if (facts.quoteStatuses.some((status) => SENT_QUOTE_STATUSES.has(status)) || (facts.leadStage !== null && SENT_LEAD_STAGES.has(facts.leadStage))) return "QUOTE_SENT";

  if (facts.matchedOffer !== null || (facts.readings.travellers && facts.readings.window) || facts.leadStage === "QUALIFIED") return "READY_TO_RECOMMEND";

  if (isCommercialIntent(facts.intentCode) || Object.keys(facts.readings).length > 0) return "QUALIFYING";
  return "UNQUALIFIED";
}

/** The value comes only from the matched offer's total, in cents. A lost lead has no pipeline value. */
export function estimatedValueOf(stage: CommercialStage, offer: MatchedOfferSnapshot | null): { cents: number | null; currency: string | null } {
  if (stage === "LOST" || !offer || offer.totalPrice === null) return { cents: null, currency: null };
  return { cents: Math.round(offer.totalPrice * 100), currency: offer.currency };
}

export function deriveCommercialState(facts: CommercialFacts): CommercialState {
  const stage = deriveCommercialStage(facts);
  const value = estimatedValueOf(stage, facts.matchedOffer);
  return { stage, estimatedValueCents: value.cents, estimatedValueCurrency: value.currency };
}

/**
 * The Sales queues a conversation belongs in. Mirrors `compute_conversation_queues` exactly (a test compares them). The
 * caller still applies "open and not spam", which every queue shares.
 */
export function commercialQueuesFor(stage: CommercialStage, intentCode: IntentCode | null): QueueCode[] {
  const queues: QueueCode[] = [];
  if ((stage === "UNQUALIFIED" || stage === "QUALIFYING") && isCommercialIntent(intentCode)) queues.push("NEW_ENQUIRIES");
  if (stage === "READY_TO_RECOMMEND") queues.push("QUALIFIED");
  if (stage === "BOOKING_READY") queues.push("BOOKING_READY");
  if (stage === "QUOTE_SENT") queues.push("QUOTE_SENT");
  return queues;
}
