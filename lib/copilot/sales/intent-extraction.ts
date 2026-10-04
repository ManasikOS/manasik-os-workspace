/**
 * TravelIntentExtractionService — rule-based implementation.
 *
 * Turns an unstructured enquiry (a pasted WhatsApp thread, call notes, an
 * email) into a structured `TravelIntent`. Every extracted value records the
 * sentence it came from in `extractedFacts`, so staff can see *why* a value
 * was inferred and correct it before anything is applied to the lead.
 *
 * Pure and deterministic: same text + same `now` → same intent. The LLM
 * implementation (`llm/openrouter-provider.ts`) returns the same shape and is
 * validated against `travelIntentSchema`; this module is its fallback.
 */

import { MONTH_NAMES, daysBetween } from "./format";
import { formatMoney } from "./money";
import type { TravelIntent } from "./types";

export interface IntentExtractionInput {
  /** The pasted enquiry. Matches here win over matches in `notes`. */
  text: string;
  /** Existing internal notes — read-only supporting context. */
  notes: string[];
  /** ISO instant, for resolving "December" to a year and urgency. */
  now: string;
}

export interface TravelIntentExtractionService {
  extract(input: IntentExtractionInput): TravelIntent;
}

/* ── Lexicon helpers ──────────────────────────────────────────────────────── */

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NUM = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

function toNumber(token: string): number {
  const numeric = Number(token);
  if (Number.isFinite(numeric)) return numeric;
  return WORD_NUMBERS[token.toLowerCase()] ?? 0;
}

/** The sentence around a match, trimmed for display as evidence. */
function snippetAt(text: string, index: number, length: number): string {
  const boundary = /[.!?\n]/;
  let start = index;
  while (start > 0 && !boundary.test(text[start - 1])) start -= 1;
  let end = index + length;
  while (end < text.length && !boundary.test(text[end])) end += 1;
  const sentence = text.slice(start, end).trim().replace(/\s+/g, " ");
  return sentence.length > 110 ? `${sentence.slice(0, 107)}…` : sentence;
}

interface Found {
  match: RegExpExecArray;
  snippet: string;
}

function find(text: string, pattern: RegExp): Found | null {
  const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(text);
  if (!match) return null;
  return { match, snippet: snippetAt(text, match.index, match[0].length) };
}

function findAny(text: string, patterns: RegExp[]): Found | null {
  for (const pattern of patterns) {
    const found = find(text, pattern);
    if (found) return found;
  }
  return null;
}

/* ── Month / date parsing (exported — the matcher reuses it on lead fields) ─ */

const MONTH_TOKEN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function monthFromToken(token: string): number {
  const lower = token.toLowerCase().slice(0, 3);
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(lower);
}

export interface MonthMention {
  month: number;
  year: number | null;
  part: "EARLY" | "MID" | "LATE" | null;
  day: number | null;
  snippet: string;
}

/**
 * The first month the text refers to — "around December", "early Dec 2026",
 * "12th of November", "next month". "May" only counts with a travel cue
 * ("in May", "May 2027") so "may I know the price" is not a month.
 */
export function parseMonthMention(text: string, nowIso: string): MonthMention | null {
  const nextMonth = find(text, /\bnext month\b/i);
  const pattern = new RegExp(
    `(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?)?\\b${MONTH_TOKEN}\\b(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b)?(?:,?\\s+(20\\d{2}))?`,
    "gi",
  );

  let result: MonthMention | null = null;
  for (const match of text.matchAll(pattern)) {
    const token = match[2];
    const index = match.index ?? 0;
    if (token.toLowerCase() === "may") {
      const before = text.slice(Math.max(0, index - 14), index).toLowerCase();
      const hasCue =
        /\b(in|during|around|early|mid|late|end of|this|next|by|of|until|till)\s*$/.test(before) ||
        Boolean(match[1] || match[3] || match[4]);
      if (!hasCue) continue;
    }
    if (token.toLowerCase() === "mar" && !/^mar(ch)?$/i.test(token)) continue;

    const before = text.slice(Math.max(0, index - 20), index).toLowerCase();
    const part: MonthMention["part"] = /\b(early|beginning of|start of|first week of)\s*$/.test(before)
      ? "EARLY"
      : /\b(mid|middle of)\s*-?\s*$/.test(before)
        ? "MID"
        : /\b(late|end of|last week of)\s*$/.test(before)
          ? "LATE"
          : null;

    const dayToken = match[1] ?? match[3];
    const day = dayToken ? Number(dayToken) : null;
    result = {
      month: monthFromToken(token),
      year: match[4] ? Number(match[4]) : null,
      part,
      day: day !== null && day >= 1 && day <= 31 ? day : null,
      snippet: snippetAt(text, index, match[0].length),
    };
    break;
  }

  if (result) return result;
  if (nextMonth) {
    const now = new Date(nowIso);
    const month = (now.getUTCMonth() + 1) % 12;
    return {
      month,
      year: month === 0 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
      part: null,
      day: null,
      snippet: nextMonth.snippet,
    };
  }
  return null;
}

/** Resolves a month mention to a concrete year: the next occurrence from `now`. */
export function resolveMonthYear(mention: Pick<MonthMention, "month" | "year">, nowIso: string): number {
  if (mention.year) return mention.year;
  const now = new Date(nowIso);
  return mention.month >= now.getUTCMonth() ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
}

const pad = (value: number) => String(value).padStart(2, "0");

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/* ── Budget parsing (exported — also used on the lead's budget field) ─────── */

export interface BudgetMention {
  amount: number;
  basis: "PER_PERSON" | "TOTAL" | "UNCLEAR";
  snippet: string;
}

const UNIT_MULTIPLIER: Record<string, number> = {
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  k: 1_000,
  mn: 1_000_000,
  m: 1_000_000,
  million: 1_000_000,
};

export function parseBudgetMention(text: string): BudgetMention | null {
  const pattern =
    /(lkr|rs\.?|rupees)?\s*(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(lakhs?|lacs?|k|mn|million|m)?\b/gi;

  const amounts: { value: number; index: number; length: number }[] = [];
  for (const match of text.matchAll(pattern)) {
    const currency = match[1];
    const unit = match[3]?.toLowerCase();
    const base = Number(match[2].replace(/[,\s]/g, ""));
    if (!Number.isFinite(base)) continue;
    const value = unit ? base * (UNIT_MULTIPLIER[unit] ?? 1) : base;
    // A bare number counts only when it is clearly money: a currency marker,
    // a unit, or a value no traveller count or date could be.
    if (!currency && !unit && value < 10_000) continue;
    if (!currency && !unit && /^20\d{2}$/.test(match[2])) continue;
    amounts.push({ value, index: match.index ?? 0, length: match[0].length });
  }
  if (amounts.length === 0) return null;

  const first = amounts[0];
  // "400k - 500k" / "400,000 to 450,000": the ceiling is the budget.
  const second = amounts[1];
  const joined =
    second && /^\s*(-|–|to|and)\s*$/i.test(text.slice(first.index + first.length, second.index));
  const chosen = joined ? second : first;

  const around = text
    .slice(Math.max(0, first.index - 30), chosen.index + chosen.length + 30)
    .toLowerCase();
  const basis: BudgetMention["basis"] = /per (person|head|pax|pilgrim)|\beach\b|\bpp\b|p\.p/.test(around)
    ? "PER_PERSON"
    : /\b(total|for (all|everyone|the (whole )?family|us|the group)|altogether|in total)\b/.test(around)
      ? "TOTAL"
      : "UNCLEAR";

  return { amount: chosen.value, basis, snippet: snippetAt(text, first.index, first.length) };
}

type Tier = "ECONOMY" | "STANDARD" | "PREMIUM" | "VIP";

/** Per-person budget → the tier it realistically buys, by journey type. */
export function tierForBudget(perPerson: number, journeyType: TravelIntent["journeyType"]): Tier {
  const bands: [number, number, number] =
    journeyType === "HAJJ" || journeyType === "EARLY_REGISTRATION"
      ? [1_800_000, 2_600_000, 3_500_000]
      : [400_000, 650_000, 1_000_000];
  if (perPerson < bands[0]) return "ECONOMY";
  if (perPerson < bands[1]) return "STANDARD";
  if (perPerson < bands[2]) return "PREMIUM";
  return "VIP";
}

/* ── Extraction ───────────────────────────────────────────────────────────── */

const ROOM_PATTERNS: { room: "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE"; pattern: RegExp }[] = [
  { room: "QUAD", pattern: /\b(quad(?:ruple)?|(?:4|four)[- ]?(?:sharing|share|bed(?:ded)?|person room))\b/gi },
  { room: "TRIPLE", pattern: /\b(triple|(?:3|three)[- ]?(?:sharing|share|bed(?:ded)?|person room))\b/gi },
  { room: "DOUBLE", pattern: /\b(double|twin|(?:2|two)[- ]?(?:sharing|share|bed(?:ded)?)|couple room)\b/gi },
  { room: "SINGLE", pattern: /\b(single (?:room|occupancy)|private room|own room)\b/gi },
];

const ROOM_WORD: Record<"QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE", string> = {
  QUAD: "quad",
  TRIPLE: "triple",
  DOUBLE: "double",
  SINGLE: "single",
};

export function extractTravelIntent(input: IntentExtractionInput): TravelIntent {
  // The pasted enquiry first, so its statements outrank older notes.
  const text = [input.text, ...input.notes].filter((part) => part.trim()).join("\n");
  const facts: string[] = [];
  const questions: string[] = [];
  const fact = (label: string, snippet: string) => facts.push(`${label}: "${snippet}"`);

  /* Journey type */
  let journeyType: TravelIntent["journeyType"];
  const early = find(
    text,
    /\b(early registration|pre-?registration|register (?:for|our names for) (?:the )?hajj|hajj (?:quota|registration))\b/i,
  );
  const hajj = find(text, /\bhajj?\b/i);
  const umrah = find(text, /\bumrah?\b/i);
  if (early) {
    journeyType = "EARLY_REGISTRATION";
    fact("Journey", early.snippet);
  } else if (hajj && (!umrah || hajj.match.index < umrah.match.index)) {
    journeyType = "HAJJ";
    fact("Journey", hajj.snippet);
  } else if (umrah) {
    journeyType = "UMRAH";
    fact("Journey", umrah.snippet);
  }

  /* Travellers */
  const adultsHit = find(text, new RegExp(`\\b${NUM}\\s+adults?\\b`, "i"));
  const childrenHit = find(text, new RegExp(`\\b${NUM}\\s+(?:children|kids?|child)\\b`, "i"));
  const infantsHit = find(text, new RegExp(`\\b${NUM}\\s+(?:infants?|bab(?:y|ies))\\b`, "i"));
  const totalHit = findAny(text, [
    new RegExp(
      `\\b(?:we are|we're|we will be|there are|there will be|group of|family of|party of|total of|altogether)\\s+${NUM}\\b`,
      "i",
    ),
    new RegExp(`\\b${NUM}\\s+(?:people|persons|pax|pilgrims|members|travell?ers|of us)\\b`, "i"),
  ]);
  const coupleHit = find(
    text,
    /\b(my (?:wife|husband|spouse)|me and my (?:wife|husband)|couple|husband and wife|the two of us|both of us)\b/i,
  );
  const soloHit = find(text, /\b(just me|only me|by myself|alone|solo|one person|single person)\b/i);
  const familyHit = find(
    text,
    /\b(family|parents|mother|father|mum|mom|dad|son|daughter|kids|children|grand(?:mother|father|parents))\b/i,
  );
  const babyHit = find(text, /\b(a baby|an infant|with (?:our|my) baby)\b/i);
  const oneChildHit = find(text, /\bwith (?:a|one|our|my) (?:child|kid|son|daughter)\b/i);

  const children = childrenHit ? toNumber(childrenHit.match[1]) : oneChildHit ? 1 : 0;
  const infants = infantsHit ? toNumber(infantsHit.match[1]) : babyHit ? 1 : 0;
  const total = totalHit ? toNumber(totalHit.match[1]) : 0;

  let adults = 0;
  if (adultsHit) {
    adults = toNumber(adultsHit.match[1]);
    fact("Adults", adultsHit.snippet);
  } else if (total > 0) {
    adults = Math.max(total - children - infants, 1);
    fact("Travellers", totalHit?.snippet ?? "");
  } else if (coupleHit) {
    adults = 2;
    fact("Travellers", coupleHit.snippet);
  } else if (soloHit) {
    adults = 1;
    fact("Travellers", soloHit.snippet);
  }
  if (childrenHit || oneChildHit) fact("Children", (childrenHit ?? oneChildHit)?.snippet ?? "");
  if (infantsHit || babyHit) fact("Infants", (infantsHit ?? babyHit)?.snippet ?? "");

  const groupType: TravelIntent["travellers"]["groupType"] =
    children + infants > 0 || familyHit
      ? "FAMILY"
      : coupleHit && adults <= 2
        ? "COUPLE"
        : adults === 1
          ? "SOLO"
          : adults >= 5
            ? "GROUP"
            : "UNKNOWN";
  if (familyHit && groupType === "FAMILY" && children + infants === 0) {
    questions.push("Whether children are travelling");
  }

  /* Travel window */
  const month = parseMonthMention(text, input.now);
  const ramadan = find(text, /\b(ramadan|ramzan|ramazan)\b/i);
  const flexibleHit = find(
    text,
    /\b(flexible|flexibility|around|approximately|roughly|any ?time|or so|give or take|either)\b/i,
  );
  const fixedHit = find(
    text,
    /\b(fixed dates?|exact dates?|only (?:in|on|during)|must (?:be|travel|leave)|cannot change|can't change|strictly)\b/i,
  );

  const travelWindow: TravelIntent["travelWindow"] = {
    flexibility: flexibleHit ? "FLEXIBLE" : fixedHit || month?.day ? "FIXED" : "UNKNOWN",
  };
  if (month) {
    const year = resolveMonthYear(month, input.now);
    const last = lastDayOfMonth(year, month.month);
    const [fromDay, toDay] = month.day
      ? [month.day, month.day]
      : month.part === "EARLY"
        ? [1, 10]
        : month.part === "MID"
          ? [10, 20]
          : month.part === "LATE"
            ? [20, last]
            : [1, last];
    travelWindow.preferredMonth = MONTH_NAMES[month.month];
    travelWindow.earliestDate = `${year}-${pad(month.month + 1)}-${pad(fromDay)}`;
    travelWindow.latestDate = `${year}-${pad(month.month + 1)}-${pad(Math.min(toDay, last))}`;
    fact("Travel window", month.snippet);
    if (!month.day && travelWindow.flexibility !== "FIXED") questions.push("Preferred exact departure date");
  } else if (ramadan) {
    travelWindow.preferredMonth = "Ramadan";
    fact("Travel window", ramadan.snippet);
    questions.push("Exact Ramadan travel dates");
  }
  if (flexibleHit && month) fact("Flexibility", flexibleHit.snippet);

  /* Accommodation */
  const roomHits = ROOM_PATTERNS.flatMap(({ room, pattern }) =>
    [...text.matchAll(pattern)].map((match) => ({ room, index: match.index ?? 0, length: match[0].length })),
  ).sort((a, b) => a.index - b.index);
  const distinctRooms = [...new Set(roomHits.map((hit) => hit.room))];
  const familyRoom = find(text, /\bfamily rooms?\b/i);

  let roomType: TravelIntent["accommodationPreferences"]["roomType"];
  if (roomHits.length > 0) {
    roomType = roomHits[0].room;
    fact("Room", snippetAt(text, roomHits[0].index, roomHits[0].length));
    if (distinctRooms.length > 1) {
      questions.push(`Confirm room occupancy — asked about ${distinctRooms.map((room) => ROOM_WORD[room]).join(" or ")}`);
    } else if (familyRoom) {
      facts.push(`Room: also asked about family rooms`);
    }
  } else if (familyRoom) {
    roomType = "NOT_DECIDED";
    fact("Room", familyRoom.snippet);
    questions.push("Preferred room occupancy (asked about family rooms)");
  }

  const walkable = find(text, /\b(walking distance|walkable)\b/i);
  const veryClose = find(
    text,
    /\b(close to|near(?:by)?|next to|closest to|in front of|right beside)\s+(?:the\s+)?(haram|masjid|kaaba|mosque|haram sharif)\b/i,
  );
  const distanceFlexible = find(
    text,
    /\b(distance (?:is )?(?:not|no) (?:an )?(?:issue|problem)|don'?t mind (?:the )?distance|any hotel|far is (?:ok|fine)|shuttle is fine)\b/i,
  );
  const hotelDistancePreference: TravelIntent["accommodationPreferences"]["hotelDistancePreference"] = veryClose
    ? "VERY_CLOSE"
    : walkable
      ? "WALKABLE"
      : distanceFlexible
        ? "FLEXIBLE"
        : undefined;
  const distanceEvidence = veryClose ?? walkable ?? distanceFlexible;
  if (distanceEvidence) fact("Hotel distance", distanceEvidence.snippet);

  const tierHit: { tier: Tier; found: Found } | null = (() => {
    const checks: [Tier, RegExp][] = [
      ["VIP", /\b(vip|luxury|royal suite)\b/i],
      ["PREMIUM", /\b(5[- ]?star|five[- ]star|premium|deluxe)\b/i],
      ["STANDARD", /\b(4[- ]?star|four[- ]star|mid[- ]range|standard hotel)\b/i],
      ["ECONOMY", /\b(3[- ]?star|three[- ]star|economy|budget hotel|cheapest|basic hotel)\b/i],
    ];
    for (const [tier, pattern] of checks) {
      const found = find(text, pattern);
      if (found) return { tier, found };
    }
    return null;
  })();
  if (tierHit) fact("Hotel tier", tierHit.found.snippet);

  /* Travel preferences */
  const direct = find(text, /\b(direct flights?|non[- ]?stop|no (?:transit|layover|stopover))\b/i);
  const minimal = find(text, /\b(short (?:transit|layover)|one stop|minimal (?:transit|stops?))\b/i);
  const anyFlight = find(text, /\b(any (?:flight|airline)|transit (?:is )?(?:ok|fine))\b/i);
  const flightPreference: TravelIntent["travelPreferences"]["flightPreference"] = direct
    ? "DIRECT"
    : minimal
      ? "MINIMAL_TRANSIT"
      : anyFlight
        ? "FLEXIBLE"
        : undefined;
  const flightEvidence = direct ?? minimal ?? anyFlight;
  if (flightEvidence) fact("Flight", flightEvidence.snippet);

  const meal = find(
    text,
    /\b(vegetarian|vegan|diabetic(?: meals?| diet)?|full board|half board|sri lankan food|indian food|salt[- ]free|low[- ]sugar)\b/i,
  );
  if (meal) fact("Meals", meal.snippet);
  const ziyarah = find(text, /\b(ziyara[ht]?|ziarah|ziyarat|historical (?:places|sites)|taif|badr|uhud)\b/i);
  if (ziyarah) fact("Ziyarah", ziyarah.snippet);

  const accessibilityNeeds: string[] = [];
  const accessChecks: [string, RegExp][] = [
    ["Wheelchair assistance", /\bwheel ?chair\b/i],
    ["Elderly travellers", /\b(elderly|old|aged|senior)\s+(parents?|mother|father|people|pilgrims?)\b/i],
    ["Limited walking ability", /\b(difficult(?:y)? (?:in |to )?walk|can(?:not|'t) walk (?:long|far)|mobility|knee problem|bad back)\b/i],
    ["Medical condition noted", /\b(diabet(?:ic|es)|heart (?:condition|patient)|medical condition|dialysis)\b/i],
  ];
  for (const [label, pattern] of accessChecks) {
    const found = find(text, pattern);
    if (found) {
      accessibilityNeeds.push(label);
      fact(label, found.snippet);
    }
  }

  /* Commercial signals */
  const instalment = find(
    text,
    /\b(instal?l?ments?|monthly (?:payments?|plan)|pay (?:it )?(?:in|by) (?:parts|stages|portions)|payment plan|easy payments?|part payments?|can(?:not|'t) pay (?:everything|all|the (?:full|whole)(?: amount)?|it all)(?: at once)?|pay (?:later|little by little))\b/i,
  );
  if (instalment) fact("Instalments", instalment.snippet);

  const travellerCount = adults + children + infants;
  const budget = parseBudgetMention(text);
  let statedBudget: number | undefined;
  if (budget) {
    fact("Budget", budget.snippet);
    if (budget.basis === "TOTAL" && travellerCount > 0) {
      statedBudget = Math.round(budget.amount / travellerCount);
    } else {
      statedBudget = budget.amount;
      if (budget.basis === "UNCLEAR" && travellerCount !== 1) {
        questions.push(`Whether ${formatMoney(budget.amount)} is per person or for the whole group`);
      }
    }
  }

  const priceObjection = find(
    text,
    /\b(too expensive|expensive|too (?:much|high|costly)|can(?:not|'t) afford|cheaper|any discount|reduce the price|lower (?:the )?price|over (?:our|my) budget)\b/i,
  );
  const budgetWords = find(text, /\b(cheap(?:est)?|affordable|lowest|on a budget|tight budget|low budget|low cost)\b/i);
  const noBudgetLimit = find(
    text,
    /\b(money is not an? (?:issue|problem)|best available|no budget limit|price (?:is )?not an? (?:issue|problem))\b/i,
  );
  const budgetSensitivity: TravelIntent["commercialSignals"]["budgetSensitivity"] =
    priceObjection || budgetWords
      ? "HIGH"
      : noBudgetLimit || tierHit?.tier === "VIP"
        ? "LOW"
        : instalment || statedBudget !== undefined
          ? "MEDIUM"
          : "UNKNOWN";

  const budgetRange: TravelIntent["commercialSignals"]["budgetRange"] =
    statedBudget !== undefined
      ? tierForBudget(statedBudget, journeyType)
      : tierHit
        ? tierHit.tier
        : budgetWords
          ? "ECONOMY"
          : undefined;

  const competitor = find(text, /\b(other agenc(?:y|ies)|another agency|competitor|someone else quoted)\b/i);
  const ready = find(
    text,
    /\b(ready to book|want to (?:book|confirm|reserve)|(?:please )?book (?:us|me|it)|how (?:do|can) (?:i|we) pay|send (?:the )?(?:bank|account) details|confirm (?:the|our|my) (?:booking|seats?)|pay the (?:advance|deposit))\b/i,
  );
  const comparing = find(
    text,
    /\b(compare|comparison|difference between|which (?:one )?is better|other options|cheaper option|versus)\b/i,
  );
  const exploring = find(
    text,
    /\b(looking for|interested|enquir|inquir|details|information|do you have|what is the price|how much|packages? available|planning)\w*/i,
  );
  const decisionStage: TravelIntent["commercialSignals"]["decisionStage"] = ready
    ? "READY_TO_BOOK"
    : comparing || competitor
      ? "COMPARING"
      : exploring
        ? "EXPLORING"
        : "UNKNOWN";
  const stageEvidence = ready ?? comparing ?? competitor ?? exploring;
  if (stageEvidence) fact("Decision stage", stageEvidence.snippet);

  const urgentHit = find(text, /\b(urgent(?:ly)?|asap|as soon as possible|immediately|this week|next week|right away)\b/i);
  const relaxedHit = find(text, /\b(next year|no rush|just (?:asking|checking|enquiring)|thinking about|not sure yet|maybe later)\b/i);
  let urgency: TravelIntent["commercialSignals"]["urgency"] = urgentHit ? "HIGH" : relaxedHit ? "LOW" : "UNKNOWN";
  if (urgency === "UNKNOWN" && typeof travelWindow.earliestDate === "string") {
    const days = daysBetween(input.now, travelWindow.earliestDate);
    urgency = days <= 45 ? "HIGH" : days <= 120 ? "MEDIUM" : "LOW";
  }

  /* Objections */
  const objections: TravelIntent["objections"] = {};
  const other: string[] = [];
  if (priceObjection) {
    objections.price = true;
    fact("Price concern", priceObjection.snippet);
  }
  const datesObjection = find(
    text,
    /\b(can(?:not|'t) (?:travel|go|leave) (?:in|on|during|before|after)|dates? (?:do(?:n't| not)|does(?:n't| not)) (?:suit|work)|only (?:free|available|possible) (?:in|on|during|after)|school (?:holidays|exams)|leave from work)\b/i,
  );
  if (datesObjection) {
    objections.dates = true;
    fact("Date constraint", datesObjection.snippet);
  }
  const hotelObjection = find(text, /\b(hotel (?:is )?(?:too )?far|far from (?:the )?haram|(?:bad|poor|old) hotel|hotel quality)\b/i);
  if (hotelObjection) {
    objections.hotel = true;
    fact("Hotel concern", hotelObjection.snippet);
  }
  const roomObjection = find(text, /\b(do(?:n't| not) want to share|not comfortable sharing|no sharing|without sharing)\b/i);
  if (roomObjection) {
    objections.roomType = true;
    fact("Room concern", roomObjection.snippet);
  }
  const paymentObjection = find(text, /\bcan(?:not|'t) pay (?:everything|all|the (?:full|whole)|it all)/i);
  if (paymentObjection) objections.paymentPlan = true;
  const flightObjection = find(text, /\b(long (?:transit|layover)|too many stops|do(?:n't| not) want (?:a )?transit)\b/i);
  if (flightObjection) objections.flight = true;
  const visaObjection = find(
    text,
    /\b(visa (?:issue|problem|rejected|refused|concern|delay|worr\w*)|worried about (?:the )?visa|previous(?:ly)? (?:refused|rejected))\b/i,
  );
  if (visaObjection) {
    objections.visa = true;
    fact("Visa concern", visaObjection.snippet);
  }
  if (competitor) other.push("Comparing with another agency");
  if (other.length > 0) objections.other = other;

  /* Missing information */
  if (!journeyType) questions.unshift("Journey type (Umrah or Hajj)");
  if (!month && !ramadan) questions.push("Preferred travel month");
  if (adults === 0) questions.push("Number of travellers (adults, children, infants)");
  if (!roomType) questions.push("Preferred room occupancy");
  if (statedBudget === undefined) questions.push("Maximum budget per person");
  if (children > 0) questions.push("Ages of the children (for child pricing)");

  const signals = [
    Boolean(journeyType),
    Boolean(month || ramadan),
    adults > 0,
    roomType !== undefined && roomType !== "NOT_DECIDED",
    statedBudget !== undefined || budgetRange !== undefined,
    Boolean(hotelDistancePreference || tierHit || instalment),
  ];
  const confidence = Math.round((signals.filter(Boolean).length / signals.length) * 100) / 100;

  return {
    journeyType,
    travelWindow,
    travellers: { adults, children, infants, groupType },
    accommodationPreferences: {
      roomType,
      hotelTier: tierHit?.tier,
      hotelDistancePreference,
    },
    travelPreferences: {
      flightPreference,
      mealPreference: meal?.match[0],
      ziyarahInterest: ziyarah ? true : undefined,
      accessibilityNeeds: accessibilityNeeds.length > 0 ? accessibilityNeeds : undefined,
    },
    commercialSignals: {
      statedBudget,
      budgetRange,
      budgetSensitivity,
      instalmentInterest: Boolean(instalment),
      urgency,
      decisionStage,
    },
    objections,
    unansweredQuestions: [...new Set(questions)],
    extractedFacts: facts,
    confidence,
    updatedAt: input.now,
  };
}

export const ruleBasedTravelIntentExtraction: TravelIntentExtractionService = {
  extract: extractTravelIntent,
};
