/**
 * S3 — live offer matching for a conversation (MI3.2 of docs/inbox/implementation-plan.md). Pure, and free: no model.
 *
 * This is a thin adapter over the Sales Intelligence Engine's own matcher (`lib/copilot/sales/offer-matching.ts`), so
 * the Inbox and the Leads drawer can never disagree about which departure is the best fit. The matcher wants a lead;
 * a conversation may not have one, so a stand-in is built from what S2 read (`conversationLeadFacts`) and the party,
 * month, room and budget come from the travel intent, exactly as they would for a lead with a saved intent.
 *
 * What is stored is a snapshot (`MatchedOfferSnapshot`): the best option, the runners-up, and the three values R1's
 * change-detection compares later — `asOf`, the price's `pricedAt`, and the seat count it was matched against.
 * `revalidateOffer` answers "is this still true?" from those, so a price or seat that moved is never quoted as fresh.
 * R1 compares `priced_at`, not `updated_at`: an edit that did not change the price does not raise a warning.
 */

import { formatShortDate, OCCUPANCY_LABELS } from "@/lib/copilot/sales/format";
import { formatMoney } from "@/lib/copilot/sales/money";
import { matchOffers } from "@/lib/copilot/sales/offer-matching";
import type { LeadFacts, OccupancyType, OfferCandidate, OfferMatchingResult, TravelIntent } from "@/lib/copilot/sales/types";

import { canQuoteOffer, type MatchedOfferSnapshot, type OfferCheckState, type TravelIntentEvidence } from "./contracts";

/** An early-bird price ending within this many days is called out. */
export const EARLY_BIRD_WARNING_DAYS = 7;
const MAX_ALTERNATIVES = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Inputs ───────────────────────────────────────────────────────────────── */

/**
 * S3 only runs when the customer has said which journey and how many people. Without them the matcher would offer
 * for a party of nobody, and a recommendation built on a guess is worse than none.
 */
export function hasOfferInputs(readings: TravelIntentEvidence): boolean {
  return readings.journey !== undefined && readings.travellers !== undefined;
}

/** A stand-in lead for a conversation: everything the matcher needs to know about the customer comes from the intent. */
export function conversationLeadFacts(conversationId: string, intent: TravelIntent): LeadFacts {
  return {
    id: conversationId,
    reference: "",
    fullName: "",
    firstName: "",
    stage: "NEW_LEAD",
    journeyType: intent.journeyType ?? "UMRAH",
    adults: 0,
    children: 0,
    roomPreference: "UNDECIDED",
    preferredPeriod: "",
    budgetRange: "",
    preferredLanguage: "",
    packageId: null,
    packageName: null,
    selectedDepartureGroupId: null,
    notes: [],
  };
}

export function matchConversationOffers(input: { conversationId: string; intent: TravelIntent; candidates: OfferCandidate[]; now: string }): OfferMatchingResult {
  return matchOffers({ lead: conversationLeadFacts(input.conversationId, input.intent), intent: input.intent, candidates: input.candidates, now: input.now });
}

/* ── The snapshot ─────────────────────────────────────────────────────────── */

/** The best option and its runners-up as a snapshot, or null when nothing is bookable (waitlist-only is not an offer). */
export function buildOfferSnapshot(result: OfferMatchingResult, candidates: readonly OfferCandidate[], now: string): MatchedOfferSnapshot | null {
  const best = result.offers[0];
  if (!best) return null;
  const candidateOf = (groupId: string) => candidates.find((candidate) => candidate.facts.groupId === groupId);
  const bestCandidate = candidateOf(best.departureGroupId);
  const dateOf = (value: string | Date) => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));

  return {
    departureGroupId: best.departureGroupId,
    // A built-in template has no `packages` row; its key is not a uuid, and the snapshot's column is.
    packageId: UUID.test(best.packageTemplateId) ? best.packageTemplateId : null,
    seatsMatched: best.availableSeats,
    roomType: best.roomType ?? null,
    pricePerPerson: best.pricePerPerson,
    currency: best.currency,
    // A group priced from its template snapshot has no pricing row yet: `asOf` stands in, and a row created later is newer.
    pricedAt: bestCandidate?.internal.pricedAt ?? now,
    asOf: now,
    inclusions: best.majorInclusions,
    groupName: best.groupName,
    departureDate: dateOf(best.departureDate),
    returnDate: dateOf(best.returnDate),
    durationDays: best.durationDays,
    totalPrice: best.totalPrice,
    party: { adults: best.adults, children: best.children, infants: best.infants },
    fitLevel: best.fitLevel,
    recommendationReason: result.recommendationReason,
    reasons: best.matchReasons,
    constraints: best.tradeoffs,
    missingInformation: best.missingInformation,
    alternatives: result.offers.slice(1, 1 + MAX_ALTERNATIVES).map((offer) => ({
      departureGroupId: offer.departureGroupId,
      groupName: offer.groupName,
      departureDate: dateOf(offer.departureDate),
      roomType: offer.roomType ?? null,
      pricePerPerson: offer.pricePerPerson,
      seatsAvailable: offer.availableSeats,
    })),
    earlyBirdValidUntil: bestCandidate?.internal.earlyBirdValidUntil ?? null,
  };
}

/* ── R1: is the stored offer still true? ──────────────────────────────────── */

/** What the live group says right now, read by the caller from `departure_groups` and `departure_group_pricing`. */
export interface LiveOfferFacts {
  /** Open for sale, not archived, not departed or closed. */
  available: boolean;
  availableSeats: number;
  pricedAt: string | null;
  earlyBirdValidUntil: string | null;
}

export function partySizeOf(snapshot: MatchedOfferSnapshot): number {
  const party = snapshot.party;
  return party ? Math.max(1, party.adults + party.children + party.infants) : 1;
}

/**
 * The first thing that no longer holds, in the order that matters most to a customer: the departure is gone, the seats
 * are gone, the price moved, the early-bird is about to end. `updated_at` is deliberately not an input.
 */
export function revalidateOffer(snapshot: MatchedOfferSnapshot, live: LiveOfferFacts, now: string): OfferCheckState {
  if (!live.available) return "NO_LONGER_AVAILABLE";
  if (live.availableSeats < partySizeOf(snapshot)) return "SEATS_INSUFFICIENT";
  if (live.pricedAt !== null && Date.parse(live.pricedAt) > Date.parse(snapshot.pricedAt)) return "PRICE_CHANGED";

  const endsOn = live.earlyBirdValidUntil ?? snapshot.earlyBirdValidUntil;
  if (endsOn) {
    const today = now.slice(0, 10);
    const daysLeft = Math.round((Date.parse(`${endsOn.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (daysLeft >= 0 && daysLeft <= EARLY_BIRD_WARNING_DAYS) return "EARLY_BIRD_EXPIRING";
  }
  return "FRESH";
}

/* ── What the two composer actions say ────────────────────────────────────── */

function partyWords(snapshot: MatchedOfferSnapshot): string {
  const party = snapshot.party;
  if (!party) return "";
  const parts = [`${party.adults} adult${party.adults === 1 ? "" : "s"}`];
  if (party.children > 0) parts.push(`${party.children} child${party.children === 1 ? "" : "ren"}`);
  if (party.infants > 0) parts.push(`${party.infants} infant${party.infants === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/**
 * A reply staff can edit and send, built only from the stored offer's own figures and only while it is current.
 * Internal notes (readiness, margins, tradeoffs the customer has not asked about) never appear here.
 */
export function composeOfferReply(snapshot: MatchedOfferSnapshot, state: OfferCheckState): string | null {
  if (!canQuoteOffer(state)) return null;
  const room = snapshot.roomType ? OCCUPANCY_LABELS[snapshot.roomType as OccupancyType].toLowerCase() : null;
  const lines = [
    "Assalamu alaikum, thank you for your enquiry.",
    "",
    `Based on what you have told us, the best fit right now is ${snapshot.groupName}${snapshot.departureDate ? `, departing ${formatShortDate(snapshot.departureDate)}` : ""}${snapshot.durationDays ? ` (${snapshot.durationDays} days)` : ""}.`,
    `${room ? `${room[0].toUpperCase()}${room.slice(1)}: ` : ""}${formatMoney(snapshot.pricePerPerson, snapshot.currency)} per person${snapshot.totalPrice !== null && snapshot.party ? `, ${formatMoney(snapshot.totalPrice, snapshot.currency)} in total for ${partyWords(snapshot)}` : ""}.`,
  ];
  if (snapshot.inclusions.length > 0) lines.push(`It includes ${snapshot.inclusions.join(", ")}.`);
  if (state === "EARLY_BIRD_EXPIRING" && snapshot.earlyBirdValidUntil) lines.push(`This price is available until ${formatShortDate(snapshot.earlyBirdValidUntil)}.`);
  lines.push("", "Would you like us to prepare a quotation for you?");
  return lines.join("\n");
}

/** The questions a customer can be asked, keyed by the internal gap they close. Anything else stays internal. */
const FOLLOW_UP_QUESTIONS: Array<{ gap: RegExp; question: string }> = [
  { gap: /preferred travel month/i, question: "Which month would you like to travel?" },
  { gap: /room occupancy/i, question: "How many people would share each room (quad, triple, double or single)?" },
  { gap: /maximum budget/i, question: "What is your budget per person?" },
  { gap: /hotel distance/i, question: "How close to the Haram would you like your hotel to be?" },
];

/** Follow-up questions for what is still missing; null when there is nothing a customer could answer. */
export function composeFollowUp(snapshot: MatchedOfferSnapshot): string | null {
  const questions = FOLLOW_UP_QUESTIONS.filter((entry) => snapshot.missingInformation.some((gap) => entry.gap.test(gap))).map((entry) => entry.question);
  if (questions.length === 0) return null;
  return ["To find the best option for you, could you tell us:", ...questions.map((question) => `- ${question}`)].join("\n");
}
