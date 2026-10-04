/**
 * Slim cross-system alerts for the Lead Drawer — at most one, and only when
 * lead data and live Departure Group data genuinely disagree. Never a
 * follow-up reminder, never generic "AI" nudging.
 *
 * Each alert carries a fingerprint of the facts behind it; a dismissal is
 * stored against that fingerprint, so the same finding stays dismissed but a
 * new one (different group, different seat count) can surface.
 */

import { MONTH_NAMES, OCCUPANCY_LABELS, daysBetween, monthIndexOf, yearOf } from "./format";
import type { CopilotSuggestion, LeadFacts, OfferCandidate, OfferMatchingResult } from "./types";

export interface AlertInput {
  lead: LeadFacts;
  hasIntent: boolean;
  result: OfferMatchingResult;
  /** The lead's selected group, even if it is no longer sellable. */
  selected: OfferCandidate | null;
  dismissedFingerprints: readonly string[];
  now: string;
}

type Draft = Omit<CopilotSuggestion, "createdAt" | "leadId">;

export function detectCopilotSuggestion(input: AlertInput): CopilotSuggestion | null {
  const { result, selected, lead } = input;
  const requirement = result.requirement;
  const drafts: Draft[] = [];

  if (selected && lead.selectedDepartureGroupId) {
    const facts = selected.facts;

    if (facts.availableSeats < requirement.travellers) {
      drafts.push({
        id: `CAPACITY_MISMATCH:${facts.groupId}:${facts.availableSeats}:${requirement.travellers}`,
        type: "CAPACITY_MISMATCH",
        message: `The selected group has ${facts.availableSeats} seat${facts.availableSeats === 1 ? "" : "s"}, but this enquiry needs ${requirement.travellers}.`,
        actionLabel: "Compare Options",
        actionType: "COMPARE_OPTIONS",
      });
    }

    if (requirement.roomType && facts.occupancyPrices[requirement.roomType] === undefined) {
      drafts.push({
        id: `ROOM_MISMATCH:${facts.groupId}:${requirement.roomType}`,
        type: "ROOM_MISMATCH",
        message: `${OCCUPANCY_LABELS[requirement.roomType]} is unavailable in the selected group.`,
        actionLabel: "Compare Options",
        actionType: "COMPARE_OPTIONS",
      });
    }

    const selectedOffer = result.offers.find((offer) => offer.departureGroupId === facts.groupId);
    if (selectedOffer && requirement.budgetPerPerson !== null && selectedOffer.pricePerPerson > requirement.budgetPerPerson) {
      drafts.push({
        id: `BUDGET_MISMATCH:${facts.groupId}:${selectedOffer.pricePerPerson}:${requirement.budgetPerPerson}`,
        type: "BUDGET_MISMATCH",
        message: "The selected option exceeds the lead’s stated budget range.",
        actionLabel: "Compare Options",
        actionType: "COMPARE_OPTIONS",
      });
    }

    const recommended = result.offers[0];
    if (
      selectedOffer &&
      recommended &&
      recommended.departureGroupId !== facts.groupId &&
      recommended.fitScore >= selectedOffer.fitScore + 15
    ) {
      drafts.push({
        id: `BETTER_GROUP_MATCH:${facts.groupId}:${recommended.departureGroupId}`,
        type: "BETTER_GROUP_MATCH",
        message: "A more suitable group is available for this lead’s preferences.",
        actionLabel: "View Better Match",
        actionType: "BUILD_OFFER",
      });
    }
  }

  // Date mismatch: the customer asked for a month no viable group departs in.
  if (requirement.month !== null && result.offers.length > 0 && (input.hasIntent || lead.preferredPeriod.trim())) {
    const inMonth = result.offers.some(
      (offer) =>
        monthIndexOf(String(offer.departureDate)) === requirement.month &&
        (requirement.year === null || yearOf(String(offer.departureDate)) === requirement.year),
    );
    if (!inMonth) {
      const target = `${requirement.year ?? yearOf(input.now)}-${String(requirement.month + 1).padStart(2, "0")}-15`;
      const closest = [...result.offers].sort(
        (a, b) =>
          Math.abs(daysBetween(target, String(a.departureDate))) - Math.abs(daysBetween(target, String(b.departureDate))),
      )[0];
      drafts.push({
        id: `DATE_MISMATCH:${requirement.month}:${closest.departureGroupId}`,
        type: "DATE_MISMATCH",
        message: `${MONTH_NAMES[requirement.month]} availability is unavailable. The closest active match is ${MONTH_NAMES[monthIndexOf(String(closest.departureDate))]}.`,
        actionLabel: "Build Offer",
        actionType: "BUILD_OFFER",
      });
    }
  }

  const dismissed = new Set(input.dismissedFingerprints);
  const next = drafts.find((draft) => !dismissed.has(draft.id));
  return next ? { ...next, leadId: lead.id, createdAt: input.now } : null;
}

export const SUGGESTION_LABELS: Record<CopilotSuggestion["type"], string> = {
  DATE_MISMATCH: "date mismatch",
  CAPACITY_MISMATCH: "capacity mismatch",
  ROOM_MISMATCH: "room mismatch",
  BUDGET_MISMATCH: "budget mismatch",
  BETTER_GROUP_MATCH: "better group match",
};
