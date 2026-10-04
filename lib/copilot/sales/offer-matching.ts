/**
 * OfferMatchingService — the core of the Sales Intelligence Engine.
 *
 * Finds the best Package Template + live Departure Group combination for one
 * lead. Pure: the caller (CopilotKnowledgeContextService) supplies the
 * candidates with live seats, resolved pricing and payment schedules.
 *
 * Hard gates (a candidate failing any is never offered):
 *   sellable status · live group status · linked package published ·
 *   journey type · seats for the whole party · requested room type priced.
 * Sold-out groups only surface as waitlist options, never as offers.
 *
 * Ranking follows the brief: date → seats → party fit → room → budget →
 * hotel tier/distance → flight → payment plan → readiness (internal, can
 * only lower a score) → closest viable date as the tie-breaker. A group with
 * a critical operational block is never recommended when a comparable safe
 * group exists.
 */

import {
  MONTH_NAMES,
  OCCUPANCY_LABELS,
  daysBetween,
  formatShortDate,
  monthIndexOf,
  numberWord,
  yearOf,
} from "./format";
import { parseBudgetMention, parseMonthMention, resolveMonthYear } from "./intent-extraction";
import { formatMoney, fromCents, sumCents, toCents } from "./money";
import type {
  CustomerSafeOfferFacts,
  LeadFacts,
  OccupancyType,
  OfferCandidate,
  OfferMatch,
  OfferMatchingResult,
  OfferRequirement,
  TravelIntent,
  WaitlistOption,
} from "./types";

export interface OfferMatchingInput {
  lead: LeadFacts;
  intent: TravelIntent | null;
  candidates: OfferCandidate[];
  now: string;
}

export interface OfferMatchingService {
  match(input: OfferMatchingInput): OfferMatchingResult;
}

const JOURNEY_LABEL = { UMRAH: "Umrah", HAJJ: "Hajj", EARLY_REGISTRATION: "Early Registration" } as const;
const TIER_RANK = { ECONOMY: 1, STANDARD: 2, PREMIUM: 3, VIP: 4 } as const;
type Tier = keyof typeof TIER_RANK;

/* ── Requirement: what this lead actually needs ───────────────────────────── */

export function resolveRequirement(lead: LeadFacts, intent: TravelIntent | null, now: string): OfferRequirement {
  const intentTravellers = intent && intent.travellers.adults > 0 ? intent.travellers : null;
  const adults = intentTravellers?.adults ?? lead.adults;
  const children = intentTravellers ? intentTravellers.children : lead.children;
  const infants = intentTravellers?.infants ?? 0;

  const intentRoom = intent?.accommodationPreferences.roomType;
  const roomType: OccupancyType | null =
    intentRoom && intentRoom !== "NOT_DECIDED"
      ? intentRoom
      : lead.roomPreference !== "UNDECIDED"
        ? lead.roomPreference
        : null;

  let month: number | null = null;
  let year: number | null = null;
  const earliest = intent?.travelWindow.earliestDate;
  if (typeof earliest === "string") {
    month = monthIndexOf(earliest);
    year = yearOf(earliest);
  } else {
    const mention = parseMonthMention(lead.preferredPeriod, now);
    if (mention) {
      month = mention.month;
      year = resolveMonthYear(mention, now);
    }
  }

  const travellers = adults + children + infants;
  let budgetPerPerson: number | null = intent?.commercialSignals.statedBudget ?? null;
  if (budgetPerPerson === null) {
    const mention = parseBudgetMention(lead.budgetRange);
    if (mention) {
      budgetPerPerson =
        mention.basis === "TOTAL" && travellers > 0 ? Math.round(mention.amount / travellers) : mention.amount;
    }
  }

  return {
    journeyType: intent?.journeyType ?? lead.journeyType,
    adults,
    children,
    infants,
    travellers,
    roomType,
    month,
    year,
    monthLabel: month === null ? null : MONTH_NAMES[month],
    budgetPerPerson,
    usedIntent: intent !== null,
  };
}

/* ── Candidate feature parsing ────────────────────────────────────────────── */

/** Hotel tier inferred from the customer-facing standard ("4-star within 500m"). */
function tierOf(facts: CustomerSafeOfferFacts): Tier | null {
  const text = facts.accommodation.map((stay) => stay.description).join(" ").toLowerCase();
  if (/\b(vip|luxury)\b/.test(text)) return "VIP";
  const stars = [...text.matchAll(/(\d)\s*[- ]?star/g)].map((match) => Number(match[1]));
  if (stars.length === 0) return null;
  const best = Math.max(...stars);
  return best >= 5 ? "PREMIUM" : best === 4 ? "STANDARD" : "ECONOMY";
}

/** Makkah hotel distance to the Haram in metres, when the package states it. */
function makkahDistanceMetres(facts: CustomerSafeOfferFacts): number | null {
  const stay = facts.accommodation.find((entry) => entry.city === "MAKKAH") ?? facts.accommodation[0];
  if (!stay) return null;
  const text = `${stay.distance} ${stay.description}`.toLowerCase();
  const metric = /(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|m|met(?:er|re)s?)\b/.exec(text);
  if (metric) return Number(metric[1]) * (metric[2].startsWith("k") ? 1000 : 1);
  if (/\b(front|adjacent|next to|facing)\b/.test(text)) return 100;
  if (/\bwalk/.test(text)) return 800;
  if (/\bshuttle\b/.test(text)) return 2000;
  return null;
}

function hotelStandardLabel(facts: CustomerSafeOfferFacts): string | undefined {
  if (facts.accommodation.length === 0) return undefined;
  return facts.accommodation
    .map((stay) => `${stay.city.charAt(0)}${stay.city.slice(1).toLowerCase()}: ${stay.description}`)
    .join(" · ");
}

export function paymentPlanSummary(facts: CustomerSafeOfferFacts): { summary: string; supportsInstalments: boolean } {
  const count = facts.paymentSchedule.length;
  if (count >= 3) return { summary: `Deposit + ${count - 1} instalments`, supportsInstalments: true };
  if (count === 2) return { summary: "Deposit + final balance", supportsInstalments: true };
  if (count === 1) return { summary: "Single payment", supportsInstalments: false };
  if (facts.depositPerPerson !== null) {
    return { summary: "Deposit on booking, balance before departure", supportsInstalments: true };
  }
  return { summary: "Payment terms to be confirmed", supportsInstalments: false };
}

const PARTY_ROOM: Record<number, OccupancyType> = { 2: "DOUBLE", 3: "TRIPLE", 4: "QUAD" };

function chooseRoom(
  facts: CustomerSafeOfferFacts,
  requirement: OfferRequirement,
): { room: OccupancyType; assumed: boolean } | null {
  const priced = (Object.keys(facts.occupancyPrices) as OccupancyType[]).filter(
    (room) => typeof facts.occupancyPrices[room] === "number",
  );
  if (priced.length === 0) return null;
  if (requirement.roomType) {
    return priced.includes(requirement.roomType) ? { room: requirement.roomType, assumed: false } : null;
  }
  const bySize = PARTY_ROOM[requirement.adults + requirement.children];
  if (bySize && priced.includes(bySize)) return { room: bySize, assumed: true };
  const cheapest = [...priced].sort(
    (a, b) => (facts.occupancyPrices[a] ?? 0) - (facts.occupancyPrices[b] ?? 0),
  )[0];
  return { room: cheapest, assumed: true };
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

function partOfMonth(isoDate: string): string {
  const day = Number(isoDate.slice(8, 10));
  return day <= 10 ? "early" : day <= 20 ? "mid" : "late";
}

function targetDate(requirement: OfferRequirement, intent: TravelIntent | null, now: string): string {
  const earliest = intent?.travelWindow.earliestDate;
  if (typeof earliest === "string") return earliest.slice(0, 10);
  if (requirement.month !== null && requirement.year !== null) {
    return `${requirement.year}-${String(requirement.month + 1).padStart(2, "0")}-15`;
  }
  return now.slice(0, 10);
}

interface Scored {
  offer: OfferMatch;
  candidate: OfferCandidate;
  distanceFromTarget: number;
}

function scoreCandidate(
  candidate: OfferCandidate,
  room: { room: OccupancyType; assumed: boolean },
  requirement: OfferRequirement,
  intent: TravelIntent | null,
  lead: LeadFacts,
  now: string,
): Scored {
  const { facts, internal } = candidate;
  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  const missing: string[] = [];
  let score = 0;

  /* 1–2. Journey (gated) and travel date — 30 */
  const departure = facts.departureDate;
  const window = intent?.travelWindow;
  const earliest = typeof window?.earliestDate === "string" ? window.earliestDate.slice(0, 10) : null;
  const latest = typeof window?.latestDate === "string" ? window.latestDate.slice(0, 10) : null;
  if (earliest && latest && departure >= earliest && departure <= latest) {
    score += 30;
    reasons.push(`Departs within the preferred ${requirement.monthLabel ?? "travel"} window`);
  } else if (requirement.month !== null) {
    const depMonth = monthIndexOf(departure);
    const depYear = yearOf(departure);
    const monthsApart = Math.abs((depYear - (requirement.year ?? depYear)) * 12 + depMonth - requirement.month);
    if (monthsApart === 0) {
      score += window?.flexibility === "FIXED" && earliest ? 20 : 28;
      reasons.push(`Matches ${requirement.monthLabel} travel preference`);
      if (earliest && window?.flexibility === "FIXED") {
        tradeoffs.push(`Departs ${formatShortDate(departure)}, outside the exact dates requested`);
      }
    } else if (monthsApart === 1) {
      score += window?.flexibility === "FIXED" ? 8 : 18;
      reasons.push(`Closest available match to ${requirement.monthLabel} preference`);
      tradeoffs.push(`Departure is in ${partOfMonth(departure)} ${MONTH_NAMES[depMonth]}, not ${requirement.monthLabel}`);
    } else {
      score += 4;
      tradeoffs.push(`Departs ${formatShortDate(departure)} — ${monthsApart} months from the ${requirement.monthLabel} preference`);
    }
  } else {
    score += 15;
    missing.push("Preferred travel month");
  }

  /* 3. Seats (gated) — 10 */
  score += 10;
  reasons.push(`Supports ${numberWord(requirement.travellers)} traveller${requirement.travellers === 1 ? "" : "s"}`);
  if (facts.availableSeats - requirement.travellers <= 2) {
    tradeoffs.push(`Limited availability — only ${facts.availableSeats} seats left`);
  }

  /* 4. Party fit — 8 */
  if (requirement.children > 0 && facts.childPrice === null) {
    score += 3;
    missing.push("Child price is not set for this group — children priced at the adult rate");
  } else if (requirement.children > 0) {
    score += 8;
    reasons.push("Child pricing available");
  } else {
    score += 8;
  }
  if (requirement.infants > 0 && facts.infantPrice === null) {
    missing.push("Infant price is not set for this group");
  }

  /* 5. Room — 12 */
  if (!room.assumed) {
    score += 12;
    reasons.push(`${OCCUPANCY_LABELS[room.room].replace(" Sharing", "")} accommodation available`);
  } else {
    score += 6;
    missing.push(`Room occupancy not confirmed — priced as ${OCCUPANCY_LABELS[room.room]}`);
  }

  /* Pricing (cents-safe) */
  const unit = facts.occupancyPrices[room.room] ?? 0;
  const childUnit = facts.childPrice ?? unit;
  const infantUnit = facts.infantPrice ?? 0;
  const totalCents = sumCents([
    toCents(unit) * requirement.adults,
    toCents(childUnit) * requirement.children,
    toCents(infantUnit) * requirement.infants,
  ]);
  const payers = requirement.adults + requirement.children;
  const depositPerPerson = facts.depositPerPerson ?? undefined;
  const totalDeposit =
    depositPerPerson === undefined ? undefined : fromCents(Math.min(toCents(depositPerPerson) * payers, totalCents));

  /* 6. Budget — 15 */
  const offerTier = tierOf(facts);
  if (requirement.budgetPerPerson !== null) {
    if (unit <= requirement.budgetPerPerson) {
      score += 15;
      reasons.push(`Within the stated budget of ${formatMoney(requirement.budgetPerPerson, facts.currency)} per person`);
    } else {
      const over = Math.round(((unit - requirement.budgetPerPerson) / requirement.budgetPerPerson) * 100);
      score += over <= 10 ? 8 : 0;
      tradeoffs.push(`${formatMoney(unit, facts.currency)} per person — about ${over}% above the stated budget`);
    }
  } else {
    const wanted = intent?.commercialSignals.budgetRange;
    if (wanted && wanted !== "UNKNOWN" && offerTier) {
      const gap = TIER_RANK[offerTier] - TIER_RANK[wanted];
      score += gap === 0 ? 12 : gap < 0 ? 10 : 4;
      if (gap > 0) tradeoffs.push(`${offerTier.toLowerCase()} tier — above the ${wanted.toLowerCase()} budget signal`);
      if (gap === 0) reasons.push(`Matches the ${wanted.toLowerCase()} budget range`);
    } else {
      score += 7;
      missing.push("Maximum budget per person");
    }
  }

  /* 7. Hotel tier / distance — 10 */
  const wantedDistance = intent?.accommodationPreferences.hotelDistancePreference;
  const wantedTier = intent?.accommodationPreferences.hotelTier;
  const metres = makkahDistanceMetres(facts);
  if (wantedDistance === "VERY_CLOSE" || wantedDistance === "WALKABLE") {
    const limit = wantedDistance === "VERY_CLOSE" ? 500 : 1000;
    if (metres !== null && metres <= limit) {
      score += 6;
      reasons.push(
        wantedDistance === "VERY_CLOSE"
          ? "Hotel standard matches close-to-Haram preference"
          : "Hotel is within walking distance of the Haram",
      );
    } else if (metres !== null) {
      score += 1;
      tradeoffs.push(`Makkah hotel is about ${metres >= 1000 ? `${metres / 1000} km` : `${metres} m`} from the Haram`);
    } else {
      score += 3;
      missing.push("Hotel distance to the Haram is not stated in the package");
    }
  } else {
    score += 6;
  }
  if (wantedTier && wantedTier !== "UNKNOWN" && offerTier) {
    const gap = TIER_RANK[offerTier] - TIER_RANK[wantedTier];
    score += gap >= 0 ? 4 : 1;
    if (gap < 0) tradeoffs.push(`Hotel standard is below the ${wantedTier.toLowerCase()} preference`);
  } else {
    score += 3;
  }

  /* 8. Flight — 5 */
  const wantedFlight = intent?.travelPreferences.flightPreference;
  if (wantedFlight === "DIRECT" || wantedFlight === "MINIMAL_TRANSIT") {
    if (facts.confirmedFlights.length > 0) {
      score += 4;
      reasons.push(`Flights confirmed with ${facts.confirmedFlights[0].airline}`);
    } else {
      score += 2;
      tradeoffs.push("Flight routing is not confirmed yet");
    }
  } else {
    score += 5;
  }

  /* 9. Payment plan — 5 */
  const plan = paymentPlanSummary(facts);
  if (intent?.commercialSignals.instalmentInterest) {
    if (plan.supportsInstalments) {
      score += 5;
      reasons.push("Instalment plan is supported");
    } else {
      tradeoffs.push("No instalment schedule — full payment is required");
    }
  } else {
    score += 5;
  }

  /* 10. Operational readiness — internal, secondary, can only lower */
  score += internal.hasCriticalBlock ? 0 : internal.readinessStatus === "READY" ? 3 : 2;

  if (lead.packageId && facts.packageTemplateId === lead.packageId) {
    reasons.push("Matches the package already noted on the lead");
  }

  const fitScore = Math.min(100, Math.round(score));
  const fitLevel: OfferMatch["fitLevel"] =
    fitScore >= 80 ? "STRONG" : fitScore >= 65 ? "GOOD" : fitScore >= 45 ? "PARTIAL" : "WEAK";

  const offer: OfferMatch = {
    id: `${facts.groupId}:${room.room}`,
    leadId: lead.id,
    packageTemplateId: facts.packageTemplateId,
    departureGroupId: facts.groupId,
    groupName: facts.groupName,
    packageName: facts.packageName,
    departureDate: facts.departureDate,
    returnDate: facts.returnDate,
    durationDays: facts.durationDays,
    availableSeats: facts.availableSeats,
    roomType: room.room,
    pricePerPerson: unit,
    totalPrice: fromCents(totalCents),
    depositPerPerson,
    totalDeposit,
    hotelStandard: hotelStandardLabel(facts),
    transportStandard: facts.transportStandard ?? undefined,
    majorInclusions: facts.inclusions.slice(0, 5),
    fitLevel,
    fitScore,
    matchReasons: reasons,
    tradeoffs,
    missingInformation: missing,
    isRecommended: false,
    currency: facts.currency,
    adults: requirement.adults,
    children: requirement.children,
    infants: requirement.infants,
    paymentPlanSummary: plan.summary,
    roomTypeAssumed: room.assumed,
  };

  return {
    offer,
    candidate,
    distanceFromTarget: Math.abs(daysBetween(targetDate(requirement, intent, now), departure)),
  };
}

/* ── Explanations ─────────────────────────────────────────────────────────── */

export function explainRecommendation(recommended: OfferMatch, others: OfferMatch[], requirement: OfferRequirement): string {
  if (others.length === 0) return "It is the only viable option for this enquiry right now.";
  const clauses: string[] = [];
  const cheapest = others.every((other) => recommended.pricePerPerson <= other.pricePerPerson);
  if (requirement.budgetPerPerson !== null && recommended.pricePerPerson <= requirement.budgetPerPerson) {
    clauses.push("matches the stated budget");
  } else if (cheapest) {
    clauses.push("is the most affordable viable option");
  }
  if (recommended.children > 0 || recommended.infants > 0) {
    clauses.push("supports the requested family arrangement");
  } else if (!recommended.roomTypeAssumed && recommended.roomType) {
    clauses.push(`supports the requested ${OCCUPANCY_LABELS[recommended.roomType].toLowerCase()}`);
  }
  if (others.every((other) => recommended.availableSeats >= other.availableSeats)) {
    clauses.push("has more suitable availability");
  }
  if (recommended.matchReasons.some((reason) => /preference|window/i.test(reason)) && clauses.length < 3) {
    clauses.push("fits the preferred travel dates best");
  }
  if (clauses.length === 0) return "It has the strongest overall fit across dates, rooms, price and availability.";
  const text = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
  return `It ${text}.`;
}

function noMatchReason(requirement: OfferRequirement, stats: { journey: number; seats: number; room: number }): string {
  const journey = JOURNEY_LABEL[requirement.journeyType];
  const party = `${numberWord(requirement.travellers)} traveller${requirement.travellers === 1 ? "" : "s"}`;
  const month = requirement.monthLabel ? `${requirement.monthLabel} travel preference` : "this enquiry";
  if (stats.journey === 0) return `No active ${journey} Departure Group is open for sale.`;
  if (stats.seats === 0) return `No active ${journey} Departure Group has enough seats for ${party}.`;
  if (stats.room === 0 && requirement.roomType) {
    return `No active ${journey} Departure Group offers ${OCCUPANCY_LABELS[requirement.roomType].toLowerCase()} for ${party}.`;
  }
  return `No active ${journey} Departure Group matches ${month} for ${party}.`;
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

const MAX_OFFERS = 5;

export function matchOffers(input: OfferMatchingInput): OfferMatchingResult {
  const requirement = resolveRequirement(input.lead, input.intent, input.now);
  const stats = { journey: 0, seats: 0, room: 0 };
  const waitlistOptions: WaitlistOption[] = [];
  const scored: Scored[] = [];

  for (const candidate of input.candidates) {
    const { facts, internal } = candidate;
    if (facts.journeyType !== requirement.journeyType || !internal.packagePublished) continue;
    stats.journey += 1;

    if (!internal.isSellable || facts.availableSeats < requirement.travellers) {
      if (facts.waitlistEnabled) {
        waitlistOptions.push({
          groupId: facts.groupId,
          groupName: facts.groupName,
          departureDate: facts.departureDate,
          returnDate: facts.returnDate,
        });
      }
      continue;
    }
    stats.seats += 1;

    const room = chooseRoom(facts, requirement);
    if (!room) continue;
    stats.room += 1;

    scored.push(scoreCandidate(candidate, room, requirement, input.intent, input.lead, input.now));
  }

  scored.sort(
    (a, b) =>
      b.offer.fitScore - a.offer.fitScore ||
      a.distanceFromTarget - b.distanceFromTarget ||
      String(a.offer.departureDate).localeCompare(String(b.offer.departureDate)),
  );

  // Never recommend a group with a critical operational block when a
  // comparable safe group exists (within 10 points).
  if (scored.length > 1 && scored[0].candidate.internal.hasCriticalBlock) {
    const topScore = scored[0].offer.fitScore;
    const safeIndex = scored.findIndex(
      (entry) => !entry.candidate.internal.hasCriticalBlock && entry.offer.fitScore >= topScore - 10,
    );
    if (safeIndex > 0) scored.unshift(...scored.splice(safeIndex, 1));
  }

  const offers = scored.slice(0, MAX_OFFERS).map((entry, index) => ({ ...entry.offer, isRecommended: index === 0 }));

  return {
    requirement,
    offers,
    recommendationReason: offers.length > 0 ? explainRecommendation(offers[0], offers.slice(1, 3), requirement) : null,
    noMatch: offers.length === 0 ? { reason: noMatchReason(requirement, stats), waitlistOptions } : null,
  };
}

export const ruleBasedOfferMatching: OfferMatchingService = { match: matchOffers };
