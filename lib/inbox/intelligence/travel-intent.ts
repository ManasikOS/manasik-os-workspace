/**
 * S2 — structured travel intent, the deterministic half. MI3.1 of docs/inbox/implementation-plan.md (Architecture §6 S2).
 *
 * Rules FIRST: the existing rule extractor (`lib/copilot/sales/intent-extraction.ts`, the same one the lead-side Copilot
 * uses) reads what it can from the customer's messages, and this file turns its output into per-field readings — a plain
 * value, the sentence it came from, the message that sentence is in, and `source = 'RULES'`. Whatever the rules left
 * unresolved is the ONLY thing the model is asked for (`lib/ai/surfaces/inbox/travel-intent.ts`), in one call.
 *
 * A model answer is never trusted on its word: every field it returns must quote the customer, the quote must actually
 * occur in one of the customer's messages, and values are checked against closed lists and sane ranges. A field that fails
 * is dropped — the rail shows what is evidenced, not what a model asserted.
 *
 * Pure and client-safe: no I/O, no clock (the caller passes `now`), no model.
 */

import { z } from "zod";

import { extractTravelIntent } from "@/lib/copilot/sales/intent-extraction";
import { MONTH_NAMES } from "@/lib/copilot/sales/format";
import type { TravelIntent } from "@/lib/copilot/sales/types";
import type { TravelFieldReading, TravelIntentEvidence, TravelIntentField } from "@/lib/inbox/intelligence/contracts";

export interface CustomerMessage {
  id: string;
  text: string;
}

export interface RulePass {
  intent: TravelIntent;
  readings: TravelIntentEvidence;
  /** Fields no rule could read — the only ones a model is asked about. */
  unresolved: TravelIntentField[];
}

/* ── Where the customer is travelling from ───────────────────────────────── */

const ORIGIN_CITIES = [
  "Colombo", "Kandy", "Galle", "Jaffna", "Negombo", "Matara", "Kurunegala", "Batticaloa", "Trincomalee", "Anuradhapura", "Ratnapura",
  "Badulla", "Kalutara", "Gampaha", "Kalmunai", "Beruwala", "Puttalam", "Vavuniya", "Hambantota", "Nuwara Eliya", "Kegalle", "Matale",
  "Ampara", "Dehiwala", "Mount Lavinia", "Maradana", "Kinniya", "Akurana", "Panadura", "Moratuwa", "Kadawatha", "Kelaniya",
] as const;

const ORIGIN_PATTERN = new RegExp(`\\b(?:from|based in|living in|live in|residing in|we are in|i am in|i'm in)\\s+(${ORIGIN_CITIES.join("|")})\\b`, "i");

function findOrigin(text: string): { city: string; snippet: string } | null {
  const match = ORIGIN_PATTERN.exec(text);
  if (!match) return null;
  const city = ORIGIN_CITIES.find((candidate) => candidate.toLowerCase() === match[1].toLowerCase()) ?? match[1];
  return { city, snippet: sentenceAround(text, match.index, match[0].length) };
}

function sentenceAround(text: string, index: number, length: number): string {
  const boundary = /[.!?\n]/;
  let start = index;
  while (start > 0 && !boundary.test(text[start - 1])) start -= 1;
  let end = index + length;
  while (end < text.length && !boundary.test(text[end])) end += 1;
  const sentence = text.slice(start, end).trim().replace(/\s+/g, " ");
  return sentence.length > 110 ? `${sentence.slice(0, 107)}…` : sentence;
}

/* ── Locating the message a snippet came from ────────────────────────────── */

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The customer message containing `snippet` — the LATEST one when several do, since the newest statement is the one that
 * stands. Null when it cannot be placed (the rail then shows the words without a jump link).
 */
export function locateMessage(snippet: string, messages: readonly CustomerMessage[]): string | null {
  const needle = normalise(snippet.replace(/…$/u, ""));
  if (needle.length === 0) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (normalise(messages[index].text).includes(needle)) return messages[index].id;
  }
  return null;
}

/* ── Rules → readings ─────────────────────────────────────────────────────── */

const FACT_LABEL_FIELD: Record<string, TravelIntentField> = {
  Journey: "journey",
  Adults: "travellers",
  Travellers: "travellers",
  Children: "travellers",
  Infants: "travellers",
  "Travel window": "window",
  Flexibility: "window",
  Room: "room",
  "Hotel distance": "hotelDistance",
  Budget: "budget",
};

const JOURNEY_LABELS: Record<NonNullable<TravelIntent["journeyType"]>, string> = { UMRAH: "Umrah", HAJJ: "Hajj", EARLY_REGISTRATION: "Early Hajj registration" };
const ROOM_LABELS = { QUAD: "Quad room (4 sharing)", TRIPLE: "Triple room (3 sharing)", DOUBLE: "Double room (2 sharing)", SINGLE: "Single room" } as const;
const DISTANCE_LABELS = { VERY_CLOSE: "Very close to the Haram", WALKABLE: "Walking distance", FLEXIBLE: "Distance not a concern" } as const;

const plural = (count: number, singular: string, pluralWord = `${singular}s`) => `${count} ${count === 1 ? singular : pluralWord}`;

export function describeTravellers(travellers: { adults: number; children: number; infants: number }): string {
  return [plural(travellers.adults, "adult"), travellers.children > 0 ? plural(travellers.children, "child", "children") : null, travellers.infants > 0 ? plural(travellers.infants, "infant") : null]
    .filter(Boolean)
    .join(", ");
}

function describeWindow(window: TravelIntent["travelWindow"]): string | null {
  if (!window.preferredMonth) return null;
  const year = typeof window.earliestDate === "string" ? window.earliestDate.slice(0, 4) : null;
  return year && /^\d{4}$/.test(year) ? `${window.preferredMonth} ${year}` : window.preferredMonth;
}

function describeBudget(perPerson: number): string {
  return `LKR ${Math.round(perPerson).toLocaleString("en-US")} per person`;
}

function evidenceFrom(facts: readonly string[], field: TravelIntentField, messages: readonly CustomerMessage[]): TravelFieldReading["evidence"] {
  const seen = new Set<string>();
  const out: TravelFieldReading["evidence"] = [];
  for (const fact of facts) {
    const parsed = /^([A-Za-z ]+): "(.*)"$/u.exec(fact);
    if (!parsed || FACT_LABEL_FIELD[parsed[1]] !== field || !parsed[2] || seen.has(parsed[2])) continue;
    seen.add(parsed[2]);
    out.push({ messageId: locateMessage(parsed[2], messages), snippet: parsed[2] });
  }
  return out.slice(0, 4);
}

/** Runs the rule extractor over the customer's messages and reads out every field it resolved, with evidence. */
export function runRulePass(messages: readonly CustomerMessage[], now: string): RulePass {
  const text = messages.map((message) => message.text).filter((part) => part.trim()).join("\n");
  const intent = extractTravelIntent({ text, notes: [], now });
  const readings: TravelIntentEvidence = {};

  const add = (field: TravelIntentField, value: string | null) => {
    if (!value) return;
    const evidence = evidenceFrom(intent.extractedFacts, field, messages);
    // A value with nothing to point at is not evidence: keep it out of the rail rather than show an unsupported fact.
    if (evidence.length > 0) readings[field] = { source: "RULES", value, evidence };
  };

  if (intent.journeyType) add("journey", JOURNEY_LABELS[intent.journeyType]);
  if (intent.travellers.adults > 0) add("travellers", describeTravellers(intent.travellers));
  add("window", describeWindow(intent.travelWindow));
  const room = intent.accommodationPreferences.roomType;
  if (room && room !== "NOT_DECIDED") add("room", ROOM_LABELS[room]);
  const distance = intent.accommodationPreferences.hotelDistancePreference;
  if (distance && distance !== "UNKNOWN") add("hotelDistance", DISTANCE_LABELS[distance]);
  if (intent.commercialSignals.statedBudget !== undefined) add("budget", describeBudget(intent.commercialSignals.statedBudget));

  const origin = findOrigin(text);
  if (origin) readings.origin = { source: "RULES", value: origin.city, evidence: [{ messageId: locateMessage(origin.snippet, messages), snippet: origin.snippet }] };

  const all: TravelIntentField[] = ["journey", "travellers", "window", "room", "hotelDistance", "budget", "origin"];
  return { intent, readings, unresolved: all.filter((field) => readings[field] === undefined) };
}

/* ── The model's answer, and the guard around it ─────────────────────────── */

const quote = z.string().min(1).max(200);
const asked = <T extends z.ZodType>(value: T) => z.object({ value, quote }).nullable().optional();

export const travelModelAnswerSchema = z.object({
  journey: asked(z.enum(["UMRAH", "HAJJ", "EARLY_REGISTRATION"])),
  travellers: z
    .object({ adults: z.number().int().min(0).max(60), children: z.number().int().min(0).max(60), infants: z.number().int().min(0).max(60), quote })
    .nullable()
    .optional(),
  window: asked(z.enum(MONTH_NAMES as unknown as [string, ...string[]])),
  room: asked(z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE"])),
  hotelDistance: asked(z.enum(["VERY_CLOSE", "WALKABLE", "FLEXIBLE"])),
  budget: asked(z.number().min(1_000).max(50_000_000)),
  origin: asked(z.string().min(2).max(60)),
});
export type TravelModelAnswer = z.infer<typeof travelModelAnswerSchema>;

/** JSON Schema for the model call (`generateStructured` needs a plain one). Every field may be null: "not stated". */
export const TRAVEL_MODEL_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    journey: { anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string", enum: ["UMRAH", "HAJJ", "EARLY_REGISTRATION"] }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false }] },
    travellers: { anyOf: [{ type: "null" }, { type: "object", properties: { adults: { type: "integer" }, children: { type: "integer" }, infants: { type: "integer" }, quote: { type: "string" } }, required: ["adults", "children", "infants", "quote"], additionalProperties: false }] },
    window: { anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string", enum: [...MONTH_NAMES] }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false }] },
    room: { anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string", enum: ["QUAD", "TRIPLE", "DOUBLE", "SINGLE"] }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false }] },
    hotelDistance: { anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string", enum: ["VERY_CLOSE", "WALKABLE", "FLEXIBLE"] }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false }] },
    budget: { anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "number" }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false }] },
    origin: { anyOf: [{ type: "null" }, { type: "object", properties: { value: { type: "string" }, quote: { type: "string" } }, required: ["value", "quote"], additionalProperties: false }] },
  },
  required: ["journey", "travellers", "window", "room", "hotelDistance", "budget", "origin"],
  additionalProperties: false,
};

function groupTypeFor(adults: number, children: number, infants: number): TravelIntent["travellers"]["groupType"] {
  if (children + infants > 0) return "FAMILY";
  if (adults === 1) return "SOLO";
  if (adults === 2) return "COUPLE";
  return adults >= 5 ? "GROUP" : "UNKNOWN";
}

export interface MergeResult {
  intent: TravelIntent;
  readings: TravelIntentEvidence;
  /** Fields the model returned that were dropped, and why — for the note, never shown as facts. */
  rejected: Array<{ field: TravelIntentField; reason: string }>;
}

/**
 * Folds the model's answer into the rule pass. Only fields the rules left unresolved (`asked`) are considered — the model
 * can never overwrite a rule reading — and each must quote the customer, verbatim.
 */
export function mergeModelAnswer(pass: RulePass, answer: TravelModelAnswer, requested: readonly TravelIntentField[], messages: readonly CustomerMessage[]): MergeResult {
  const intent: TravelIntent = structuredClone(pass.intent);
  const readings: TravelIntentEvidence = { ...pass.readings };
  const rejected: MergeResult["rejected"] = [];

  const accept = (field: TravelIntentField, quoteText: string, value: string, apply: () => void, valueMustAppearInQuote?: string) => {
    if (!requested.includes(field) || readings[field]) return;
    const messageId = locateMessage(quoteText, messages);
    if (messageId === null) return void rejected.push({ field, reason: "the quoted words are not in the customer's messages" });
    if (valueMustAppearInQuote && !normalise(quoteText).includes(normalise(valueMustAppearInQuote))) return void rejected.push({ field, reason: "the quote does not contain the value" });
    apply();
    readings[field] = { source: "LLM", value, evidence: [{ messageId, snippet: quoteText.trim().slice(0, 300) }] };
  };

  if (answer.journey) accept("journey", answer.journey.quote, JOURNEY_LABELS[answer.journey.value], () => void (intent.journeyType = answer.journey!.value));
  if (answer.travellers && answer.travellers.adults > 0) {
    const { adults, children, infants, quote: quoteText } = answer.travellers;
    accept("travellers", quoteText, describeTravellers({ adults, children, infants }), () => {
      intent.travellers = { adults, children, infants, groupType: intent.travellers.groupType === "UNKNOWN" ? groupTypeFor(adults, children, infants) : intent.travellers.groupType };
    });
  }
  if (answer.window) accept("window", answer.window.quote, answer.window.value, () => void (intent.travelWindow = { ...intent.travelWindow, preferredMonth: answer.window!.value }));
  if (answer.room) accept("room", answer.room.quote, ROOM_LABELS[answer.room.value], () => void (intent.accommodationPreferences = { ...intent.accommodationPreferences, roomType: answer.room!.value }));
  if (answer.hotelDistance) {
    accept("hotelDistance", answer.hotelDistance.quote, DISTANCE_LABELS[answer.hotelDistance.value], () => void (intent.accommodationPreferences = { ...intent.accommodationPreferences, hotelDistancePreference: answer.hotelDistance!.value }));
  }
  if (answer.budget) accept("budget", answer.budget.quote, describeBudget(answer.budget.value), () => void (intent.commercialSignals = { ...intent.commercialSignals, statedBudget: answer.budget!.value }));
  if (answer.origin) accept("origin", answer.origin.quote, answer.origin.value.trim(), () => undefined, answer.origin.value.trim());

  return { intent, readings, rejected };
}
