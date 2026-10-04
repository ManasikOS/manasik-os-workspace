/**
 * Ask Manasik — scoped, lead-specific questions.
 *
 * The rule-based path recognises the questions staff actually ask about a
 * lead and answers from the matched offers, the TravelIntent and the lead —
 * nothing else. Anything it does not recognise is returned as FREEFORM; the
 * Server Action hands that to the LLM provider (with the same scoped
 * context) when one is configured, and otherwise says plainly what it can
 * answer instead of guessing.
 */

import { calculateQuote } from "./quote-calculator";
import { toCustomerSafeOffer, type CustomerSafeOffer } from "./content-generation";
import { OCCUPANCY_LABELS, formatDateRange, formatShortDate, numberWord, travellersLabel } from "./format";
import { formatMoney } from "./money";
import type {
  AskIntent,
  CopilotAnswer,
  CustomerSafeOfferFacts,
  LeadFacts,
  OccupancyType,
  OfferMatch,
  OfferMatchingResult,
  ReplyLanguage,
  SalesStrategy,
  TravelIntent,
} from "./types";

export interface AskManasikInput {
  question: string;
  lead: LeadFacts;
  intent: TravelIntent | null;
  result: OfferMatchingResult;
  strategy: SalesStrategy | null;
  /** Customer-safe facts of each offered group, keyed by group id. */
  groupFacts: Record<string, CustomerSafeOfferFacts>;
  now: string;
}

export const SUGGESTED_QUESTIONS = [
  "Why is this the best offer?",
  "Which room option is best for this family?",
  "What should I say about instalments?",
  "Compare Standard and Premium Umrah.",
  "What information is missing before I prepare a quote?",
  "Draft a Tamil response.",
  "Is there a better departure date available?",
] as const;

export function classifyQuestion(question: string): AskIntent {
  const q = question.toLowerCase();
  if (/\b(draft|write|reply|respon[sd]|message)\b/.test(q) && /\b(tamil|sinhala|english)\b/.test(q)) return "DRAFT_LANGUAGE";
  if (/\bwhy\b.*\b(best|recommend)|\bbest offer\b|\bwhy this\b/.test(q)) return "WHY_BEST";
  if (/\broom\b|\boccupancy\b|\bsharing\b/.test(q)) return "ROOM_FOR_FAMILY";
  if (/\binstal|payment plan|deposit|pay in parts/.test(q)) return "INSTALMENTS";
  if (/\bcompare\b|\bvs\.?\b|\bversus\b|\bdifference\b/.test(q)) return "COMPARE";
  if (/\bmissing\b|\bbefore (i|we) (prepare|send|make)\b|\bwhat (else )?do (i|we) need\b|\bquote\b.*\bneed/.test(q)) return "MISSING_INFO";
  if (/\b(better|earlier|later|other|another|closer)\b.*\b(date|departure|group)\b|\bdeparture date\b/.test(q)) return "BETTER_DATE";
  return "FREEFORM";
}

function offerSource(offer: OfferMatch): string {
  const room = offer.roomType ? `${OCCUPANCY_LABELS[offer.roomType]} ${formatMoney(offer.pricePerPerson, offer.currency)} pp` : "";
  return `Departure Group "${offer.groupName}": ${formatShortDate(String(offer.departureDate))}, ${offer.availableSeats} seats available${room ? `, ${room}` : ""}`;
}

function leadSource(input: AskManasikInput): string {
  const r = input.result.requirement;
  const period = r.monthLabel ? `, prefers ${r.monthLabel}` : "";
  return `Lead ${input.lead.reference}: ${travellersLabel(r.adults, r.children, r.infants)}${period}`;
}

function sourcesFor(input: AskManasikInput, offers: OfferMatch[]): string[] {
  const sources = [leadSource(input)];
  if (input.intent) sources.push(`Travel intent (confidence ${Math.round(input.intent.confidence * 100)}%)`);
  for (const offer of offers) sources.push(offerSource(offer));
  return sources;
}

function answer(
  input: AskManasikInput,
  intent: AskIntent,
  text: string,
  offers: OfferMatch[],
  followUps: CopilotAnswer["followUps"],
): CopilotAnswer {
  return { question: input.question, intent, answer: text, sources: sourcesFor(input, offers), followUps, source: "RULES" };
}

function detectLanguage(question: string): ReplyLanguage {
  const q = question.toLowerCase();
  if (q.includes("tamil")) return "TA";
  if (q.includes("sinhala")) return "SI";
  return "EN";
}

const LANGUAGE_NAME: Record<ReplyLanguage, string> = { EN: "English", SI: "Sinhala", TA: "Tamil" };

export function answerWithRules(input: AskManasikInput): CopilotAnswer {
  const kind = classifyQuestion(input.question);
  const { offers, requirement, noMatch } = input.result;
  const best = offers[0];
  const noOffer = noMatch?.reason ?? "No viable offer is available for this lead right now.";

  switch (kind) {
    case "WHY_BEST": {
      if (!best) return answer(input, kind, noOffer, [], [{ action: "BUILD_OFFER", label: "Build Offer" }]);
      const reasons = best.matchReasons.slice(0, 4).join("; ");
      const tradeoff = best.tradeoffs[0] ? ` Trade-off: ${best.tradeoffs[0]}.` : "";
      const why = input.result.recommendationReason ? ` ${input.result.recommendationReason}` : "";
      return answer(
        input,
        kind,
        `${best.groupName} (${formatDateRange(String(best.departureDate), String(best.returnDate))}) is the strongest fit: ${reasons}.${why}${tradeoff}`,
        [best],
        [
          { action: "CREATE_QUOTE", label: "Create Quote", offerId: best.id },
          { action: "USE_IN_REPLY", label: "Use in Reply" },
        ],
      );
    }

    case "ROOM_FOR_FAMILY": {
      if (!best) return answer(input, kind, noOffer, [], [{ action: "BUILD_OFFER", label: "Build Offer" }]);
      const facts = input.groupFacts[best.departureGroupId];
      const party = requirement.adults + requirement.children;
      const options = (Object.entries(facts?.occupancyPrices ?? {}) as [OccupancyType, number][])
        .sort((a, b) => a[1] - b[1])
        .map(([room, price]) => `${OCCUPANCY_LABELS[room]} ${formatMoney(price, best.currency)} pp`);
      const capacity: Record<OccupancyType, number> = { QUAD: 4, TRIPLE: 3, DOUBLE: 2, SINGLE: 1 };
      const exact = (Object.keys(capacity) as OccupancyType[]).find(
        (room) => capacity[room] === party && facts?.occupancyPrices[room] !== undefined,
      );
      const advice = exact
        ? `${OCCUPANCY_LABELS[exact]} keeps all ${numberWord(party)} travellers in one room.`
        : party > 4
          ? `A party of ${party} needs more than one room — combine rooms (for example quad + ${party - 4 === 1 ? "single" : party - 4 === 2 ? "double" : "triple"}) and confirm with the customer.`
          : "Confirm how the party wants to share before quoting.";
      const childNote = requirement.children > 0 && facts?.childPrice === null ? " Child pricing is not set for this group, so children are priced at the adult rate." : "";
      return answer(
        input,
        kind,
        `In ${best.groupName}, available options are: ${options.join(", ") || "no room prices published"}. ${advice}${childNote}`,
        [best],
        [
          { action: "CREATE_QUOTE", label: "Create Quote", offerId: best.id },
          { action: "USE_IN_REPLY", label: "Use in Reply" },
        ],
      );
    }

    case "INSTALMENTS": {
      if (!best) return answer(input, kind, noOffer, [], [{ action: "BUILD_OFFER", label: "Build Offer" }]);
      const facts = input.groupFacts[best.departureGroupId];
      if (!facts || !best.roomType) {
        return answer(input, kind, `Payment plan: ${best.paymentPlanSummary}.`, [best], []);
      }
      const quote = calculateQuote({
        occupancyType: best.roomType,
        adults: requirement.adults,
        children: requirement.children,
        infants: requirement.infants,
        adultPricePerPerson: best.pricePerPerson,
        childPrice: facts.childPrice,
        infantPrice: facts.infantPrice,
        depositPerPerson: facts.depositPerPerson,
        discountAmount: 0,
        schedule: facts.paymentSchedule,
        departureDate: facts.departureDate,
        nowIso: input.now,
      });
      const steps = quote.milestones
        .map((milestone) => `${milestone.label} ${formatMoney(milestone.amount, best.currency)} (${milestone.dueLabel.toLowerCase()})`)
        .join("; ");
      return answer(
        input,
        kind,
        `For ${best.groupName} at ${formatMoney(quote.total, best.currency)} total: ${steps}. Explain only this published schedule — do not promise other terms, and remind the customer that seats are secured once the booking and deposit are confirmed.`,
        [best],
        [
          { action: "USE_IN_REPLY", label: "Use in Reply" },
          { action: "CREATE_QUOTE", label: "Create Quote", offerId: best.id },
        ],
      );
    }

    case "COMPARE": {
      if (offers.length < 2) {
        return answer(
          input,
          kind,
          best ? `Only one viable option exists right now: ${best.groupName}.` : noOffer,
          best ? [best] : [],
          [{ action: "BUILD_OFFER", label: "Build Offer" }],
        );
      }
      const words = input.question.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      const named = offers.filter((offer) =>
        words.some((word) => !["compare", "umrah", "with", "versus"].includes(word) && `${offer.packageName} ${offer.groupName}`.toLowerCase().includes(word)),
      );
      const [a, b] = named.length >= 2 ? named : offers;
      const line = (offer: OfferMatch) =>
        `${offer.packageName} — ${formatShortDate(String(offer.departureDate))}, ${offer.roomType ? OCCUPANCY_LABELS[offer.roomType] : "room TBC"} ${formatMoney(offer.pricePerPerson, offer.currency)} pp (total ${formatMoney(offer.totalPrice, offer.currency)}), ${offer.availableSeats} seats, ${offer.hotelStandard ?? "hotel standard not stated"}`;
      const cheaper = a.pricePerPerson <= b.pricePerPerson ? a : b;
      return answer(
        input,
        kind,
        `${line(a)}.\n${line(b)}.\n${cheaper.packageName} is ${formatMoney(Math.abs(a.totalPrice - b.totalPrice), a.currency)} cheaper in total for this party.`,
        [a, b],
        [{ action: "USE_IN_REPLY", label: "Use in Reply" }],
      );
    }

    case "MISSING_INFO": {
      const confirmed: string[] = [];
      if (requirement.adults > 0) {
        confirmed.push(`Traveller count is ${requirement.usedIntent ? "confirmed" : "recorded"} as ${travellersLabel(requirement.adults, requirement.children, requirement.infants)}`);
      }
      if (requirement.monthLabel) confirmed.push(`preferred month is ${requirement.monthLabel}`);
      if (requirement.roomType) confirmed.push(`room preference is ${OCCUPANCY_LABELS[requirement.roomType].toLowerCase()}`);
      const missing = [
        ...new Set([...(input.strategy?.missingInformationToAsk ?? []), ...(input.intent?.unansweredQuestions ?? []), ...(best?.missingInformation ?? [])]),
      ];
      const availability =
        best?.roomType && !best.roomTypeAssumed
          ? ` ${OCCUPANCY_LABELS[best.roomType]} is currently available in the recommended ${best.groupName}.`
          : "";
      const text =
        (confirmed.length > 0 ? `${confirmed.join("; ")}. ` : "") +
        (missing.length > 0
          ? `Still needed before a quote: ${missing.slice(0, 5).map((line) => line.charAt(0).toLowerCase() + line.slice(1)).join("; ")}.`
          : "Nothing essential is missing — a quote can be prepared.") +
        availability;
      return answer(
        input,
        kind,
        text.charAt(0).toUpperCase() + text.slice(1),
        best ? [best] : [],
        best
          ? [
              { action: "USE_IN_REPLY", label: "Use in Reply" },
              { action: "CREATE_QUOTE", label: "Create Quote", offerId: best.id },
            ]
          : [{ action: "BUILD_OFFER", label: "Build Offer" }],
      );
    }

    case "DRAFT_LANGUAGE": {
      const language = detectLanguage(input.question);
      return answer(
        input,
        kind,
        best
          ? `A ${LANGUAGE_NAME[language]} reply can be drafted from the recommended ${best.groupName} offer, using only confirmed package and group details.`
          : `A ${LANGUAGE_NAME[language]} reply can be drafted, but there is no viable offer to include yet — it will ask the customer for the missing details instead.`,
        best ? [best] : [],
        [{ action: "DRAFT_REPLY", label: `Draft ${LANGUAGE_NAME[language]} Reply`, language }],
      );
    }

    case "BETTER_DATE": {
      if (!best) {
        const waitlist = noMatch?.waitlistOptions.map((option) => option.groupName).join(", ");
        return answer(input, kind, `${noOffer}${waitlist ? ` Waitlist is open on: ${waitlist}.` : ""}`, [], [{ action: "BUILD_OFFER", label: "Build Offer" }]);
      }
      const byDate = [...offers].sort((a, b) => String(a.departureDate).localeCompare(String(b.departureDate)));
      const list = byDate
        .map((offer) => `${formatShortDate(String(offer.departureDate))} — ${offer.groupName} (${offer.availableSeats} seats)`)
        .join("; ");
      const target = requirement.monthLabel ? ` for the ${requirement.monthLabel} preference` : "";
      return answer(
        input,
        kind,
        `The recommended departure${target} is ${formatShortDate(String(best.departureDate))} (${best.groupName}). All viable departures for this party: ${list}.`,
        byDate.slice(0, 3),
        [{ action: "BUILD_OFFER", label: "Build Offer" }],
      );
    }

    case "FREEFORM":
      return answer(
        input,
        kind,
        "I can answer, for this lead: why an offer is recommended, which room option fits, how the instalment plan works, how two options compare, what is missing before a quote, which departure dates are available, and draft replies in English, Sinhala or Tamil.",
        [],
        [],
      );
  }
}

/** The only data an LLM ever sees for this lead — customer-safe and scoped. */
export interface ScopedCopilotContext {
  lead: {
    reference: string;
    firstName: string;
    journeyType: string;
    travellers: string;
    preferredPeriod: string;
    roomPreference: string;
    budgetRange: string;
    stage: string;
  };
  intent: TravelIntent | null;
  offers: (CustomerSafeOffer & { availableSeats: number; matchReasons: string[]; tradeoffs: string[] })[];
  recommendationReason: string | null;
  noMatchReason: string | null;
}

export function buildScopedContext(input: Omit<AskManasikInput, "question" | "groupFacts" | "strategy" | "now">): ScopedCopilotContext {
  const r = input.result.requirement;
  return {
    lead: {
      reference: input.lead.reference,
      firstName: input.lead.firstName,
      journeyType: r.journeyType,
      travellers: travellersLabel(r.adults, r.children, r.infants),
      preferredPeriod: input.lead.preferredPeriod,
      roomPreference: input.lead.roomPreference,
      budgetRange: input.lead.budgetRange,
      stage: input.lead.stage,
    },
    intent: input.intent,
    offers: input.result.offers.slice(0, 3).map((offer) => ({
      ...toCustomerSafeOffer(offer),
      availableSeats: offer.availableSeats,
      matchReasons: offer.matchReasons,
      tradeoffs: offer.tradeoffs,
    })),
    recommendationReason: input.result.recommendationReason,
    noMatchReason: input.result.noMatch?.reason ?? null,
  };
}
