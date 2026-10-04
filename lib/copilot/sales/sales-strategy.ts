/**
 * SalesStrategyService — an internal, staff-only plan for the next
 * conversation. Rule-based: every line traces back to a signal in the
 * TravelIntent, the lead, or the matched offers. Only shown when staff open
 * "View Sales Strategy" (Build Offer / Ask Manasik / quote preparation).
 */

import { OCCUPANCY_LABELS, formatShortDate } from "./format";
import { formatMoney } from "./money";
import type { LeadFacts, OfferMatchingResult, SalesStrategy, TravelIntent } from "./types";

export interface SalesStrategyInput {
  lead: LeadFacts;
  intent: TravelIntent | null;
  result: OfferMatchingResult;
}

export interface SalesStrategyService {
  generate(input: SalesStrategyInput): SalesStrategy;
}

function stageFor(lead: LeadFacts, intent: TravelIntent | null): SalesStrategy["customerStage"] {
  const signalled = intent?.commercialSignals.decisionStage;
  if (signalled && signalled !== "UNKNOWN") return signalled;
  if (lead.stage === "DEPOSIT_PENDING") return "READY_TO_BOOK";
  if (lead.stage === "QUALIFIED" || lead.stage === "PROPOSAL_SENT" || lead.stage === "NEGOTIATION") return "COMPARING";
  return "EXPLORING";
}

export function generateSalesStrategy({ lead, intent, result }: SalesStrategyInput): SalesStrategy {
  const offer = result.offers[0];
  const alternatives = result.offers.slice(1);
  const requirement = result.requirement;
  const stage = stageFor(lead, intent);

  /* Sales angle — the two strongest signals, in priority order */
  const angles: string[] = [];
  const family = intent?.travellers.groupType === "FAMILY" || requirement.children + requirement.infants > 0;
  if (family) angles.push("Family comfort");
  if (intent?.accommodationPreferences.hotelDistancePreference === "VERY_CLOSE") angles.push("a hotel close to the Haram");
  if (intent?.commercialSignals.instalmentInterest) angles.push("a flexible instalment plan");
  if (intent?.commercialSignals.budgetSensitivity === "HIGH") angles.push("clear value within budget");
  if (intent?.accommodationPreferences.hotelTier === "PREMIUM" || intent?.accommodationPreferences.hotelTier === "VIP") {
    angles.push("premium comfort");
  }
  if (offer && offer.availableSeats <= 10) angles.push("limited seats on the best-fitting departure");
  if (angles.length === 0) angles.push(offer ? "The best-fitting departure for their dates" : "Understanding their needs before offering");
  const angle = angles.slice(0, 2).join(" plus ");
  const recommendedSalesAngle = angle.charAt(0).toUpperCase() + angle.slice(1);

  /* Objections: stated, then inferred from the offer's trade-offs */
  const objections = new Map<string, string>();
  const stated = intent?.objections;
  const overBudget = offer?.tradeoffs.some((line) => line.includes("above the stated budget")) ?? false;
  if (stated?.price || intent?.commercialSignals.budgetSensitivity === "HIGH" || overBudget) {
    const cheaperRoom = offer && offer.roomType !== "QUAD";
    const cheaperGroup = alternatives.find((alt) => offer && alt.pricePerPerson < offer.pricePerPerson);
    objections.set(
      "Total package cost",
      cheaperGroup
        ? `Offer ${cheaperGroup.groupName} as the lower-cost alternative (${formatMoney(cheaperGroup.pricePerPerson, cheaperGroup.currency)} per person).`
        : cheaperRoom
          ? "Show quad-sharing and triple-sharing totals before introducing upgrades."
          : "Lead with what is included, then show the per-person price and the deposit.",
    );
  }
  if (stated?.dates || offer?.tradeoffs.some((line) => line.startsWith("Departure is in") || line.startsWith("Departs"))) {
    objections.set(
      "Travel dates",
      offer
        ? `Explain that ${formatShortDate(String(offer.departureDate))} is the closest available departure and check whether 1–2 weeks of flexibility works.`
        : "Confirm which weeks they can travel before offering a departure.",
    );
  }
  if (stated?.paymentPlan || (intent?.commercialSignals.instalmentInterest && offer)) {
    objections.set(
      "Paying in full up front",
      offer ? `Walk through the payment plan: ${offer.paymentPlanSummary.toLowerCase()}.` : "Confirm the payment plan the chosen group supports.",
    );
  }
  if (stated?.roomType || offer?.roomTypeAssumed) {
    objections.set(
      "Room sharing",
      offer?.roomType
        ? `Confirm whether ${OCCUPANCY_LABELS[offer.roomType].toLowerCase()} suits the party before quoting.`
        : "Confirm room occupancy before quoting.",
    );
  }
  if (stated?.hotel || offer?.tradeoffs.some((line) => line.startsWith("Makkah hotel"))) {
    objections.set(
      "Hotel distance",
      "Describe the hotel standard and distance from the package — hotel names are only shared once confirmed.",
    );
  }
  if (stated?.visa) {
    objections.set("Visa", "Explain the visa process honestly; never promise approval.");
  }
  for (const other of stated?.other ?? []) {
    if (/agenc/i.test(other)) {
      objections.set("Competing quote", "Compare inclusions line by line rather than price alone.");
    }
  }

  /* Conversation goal — the most valuable unanswered facts */
  const missing = [...new Set([...(intent?.unansweredQuestions ?? []), ...(offer?.missingInformation ?? [])])];
  const goals: string[] = [];
  if (requirement.month === null) goals.push("preferred departure week");
  else if (missing.some((line) => /exact departure date/i.test(line))) goals.push("preferred departure week");
  if (!requirement.roomType) goals.push("room occupancy");
  if (requirement.budgetPerPerson === null) goals.push("maximum budget per person");
  const bestNextConversationGoal =
    stage === "READY_TO_BOOK" && goals.length === 0
      ? "Agree the deposit and confirm the booking details."
      : goals.length > 0
        ? `Confirm ${goals.slice(0, 2).join(" and ")}.`
        : offer
          ? `Walk the customer through ${offer.groupName} and confirm their interest.`
          : "Understand which dates and budget would work so a suitable group can be found.";

  const suggestedMessageIntent =
    stage === "READY_TO_BOOK"
      ? "Payment plan and deposit explanation"
      : stage === "COMPARING"
        ? "Comparison reply highlighting value"
        : offer
          ? "Offer recommendation with key facts and one question"
          : "Clarifying questions";

  return {
    leadId: lead.id,
    recommendedOfferId: offer?.id,
    customerStage: stage,
    recommendedSalesAngle,
    likelyObjections: [...objections.keys()],
    objectionHandlingPoints: [...objections.values()],
    bestNextConversationGoal,
    missingInformationToAsk: missing.slice(0, 5),
    suggestedMessageIntent,
  };
}

export const ruleBasedSalesStrategy: SalesStrategyService = { generate: generateSalesStrategy };
