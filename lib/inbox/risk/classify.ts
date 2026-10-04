/**
 * The four judgement-dependent risk flags (plus distress) — MI4.3 of docs/inbox/implementation-plan.md (Architecture §6 S4:
 * "complaint vs frustration, fraud concern, medical urgency, and religious-ruling requests"). Pure.
 *
 * Rules first, the model only when the rules cannot decide. For one customer message the lexicon gives one of three answers:
 *   - CONCLUSIVE   a strong phrase for a flag ("I will take legal action", "is it haram", "chest pain") — recorded at once, no model;
 *   - QUIET        no cue at all — routine, no model;
 *   - INCONCLUSIVE only weak cues ("not happy", "sick", "is this genuine") or a Sinhala/Tamil message the English lexicon cannot
 *                  read — this is where a model's judgement earns its cost, in ONE batched call for every flag.
 * If that call fails, the lexicon's weak cues are reported at low confidence instead of "no risk": a model outage must never
 * make a distressed customer look routine.
 *
 * The model is never trusted on its own: each flag must quote the customer verbatim and be at least 60 % sure, else it is dropped.
 */

import { z } from "zod";

import type { SignalCode } from "@/lib/inbox/intelligence/contracts";
import { normaliseForMatching } from "./never-promise";

export const RISK_FLAGS = ["COMPLAINT", "FRAUD_CONCERN", "MEDICAL_URGENCY", "RELIGIOUS_RULING", "DISTRESS"] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

export const FLAG_SIGNAL: Readonly<Record<RiskFlag, SignalCode>> = {
  COMPLAINT: "COMPLAINT_ESCALATION",
  FRAUD_CONCERN: "FRAUD_CONCERN",
  MEDICAL_URGENCY: "MEDICAL_URGENCY",
  RELIGIOUS_RULING: "RELIGIOUS_RULING_REQUEST",
  DISTRESS: "DISTRESS_LANGUAGE",
};

/** A model answer below this is dropped. */
export const MODEL_MIN_CONFIDENCE = 0.6;
export const STRONG_CONFIDENCE = 0.9;
export const WEAK_CONFIDENCE = 0.5;

export interface RiskReading {
  flag: RiskFlag;
  confidence: number;
  /** The customer's own words that show it. */
  snippet: string;
  /** RULE = a strong phrase; MODEL = the classifier, quoted verbatim; RULE_FALLBACK = a weak cue, reported because the model failed. */
  source: "RULE" | "MODEL" | "RULE_FALLBACK";
}

/* ── The lexicon ──────────────────────────────────────────────────────────── */

const STRONG: Readonly<Record<RiskFlag, readonly RegExp[]>> = {
  COMPLAINT: [
    /\b(i|we)( will|'ll| am going to| are going to| shall| intend to)? (complain|report you|sue you|take (legal|further) action|go to (the )?(police|media|consumer|newspapers?))\b/,
    /\b(consumer (affairs|authority)|legal action|my lawyer|our lawyer|an attorney|file a complaint|formal complaint|take you to court)\b/,
    /\bworst (service|experience|agency|company|travel)\b/,
    /\b(terrible|horrible|awful|disgusting|shameful|unacceptable) (service|experience|behaviou?r|treatment|staff|management)\b/,
    /\b(very |extremely |totally )?(disappointed|dissatisfied|unhappy) (with|about|in) (your|the) (service|agency|company|staff|arrangements?|hotel|management)\b/,
    /පැමිණිල්ල|පැමිණිලි/u,
    /புகார்/u,
  ],
  FRAUD_CONCERN: [
    /\b(is|are) (this|you|u|your (company|agency|website|page)) (a |an )?(scam|fraud|fake|genuine|legit|legitimate|real|registered)\b/,
    /\b(scam|scammer|scammers|fraud|fraudulent|fake (agency|company|website|account|page|number|receipt)|con artist|conned|cheated|cheating)\b/,
    /\b(can i|can we|how can i|how do i) trust (you|this|your)\b/,
    /\b(someone|somebody|a person|they) (asked|told|sent|tricked) me\b.*\b(money|pay|transfer|account)\b/,
    /වංචා/u,
    /ஏமாற்று|மோசடி/u,
  ],
  MEDICAL_URGENCY: [
    /\b(heart attack|chest pain|collapsed|unconscious|cannot breathe|can't breathe|difficulty breathing|seizure|stroke|bleeding|severe pain|fainted|passed out|dialysis|oxygen)\b/,
    /\b(admitted|rushed) (to|in) (the )?(hospital|icu|emergency)\b/,
    /\b(is|was|got|been) (very |seriously |critically )?(ill|sick|unwell)\b.*\b(travel|flight|departure|umrah|hajj|tomorrow|today)\b/,
    /හදිසි රෝග|හෘද ආබාධ|மாரடைப்பு|மயங்கி/u,
  ],
  RELIGIOUS_RULING: [
    /\b(is it|is that|are we|am i|can i|can we|may i|do i have to|must i|do we have to) (permissible|allowed|halal|haram|valid|sinful|makruh|acceptable in islam)\b/,
    /\b(what is|what's|any) (the )?(ruling|fatwa|hukm)\b/,
    /\b(fatwa|fatwah|fidyah|fidya|kaffarah|kaffara)\b/,
    /\b(is|will) my (umrah|hajj|ihram|tawaf|sai|prayer|fast) (be )?(valid|invalid|accepted|broken|void)\b/,
    /\b(do|must) (i|we) (have to )?(pay|give|offer|sacrifice) (a )?(dam|damm)\b/,
    /හරාම්|හලාල්/u,
    /ஹராம்|ஹலால்|மார்க்க தீர்ப்பு/u,
  ],
  DISTRESS: [
    /\b(i am desperate|we are desperate|i'm desperate|don't know what to do|do not know what to do|stranded|abandoned)\b/,
    /\b(nobody|no one) (is |are )?(answering|responding|helping|replying|picking)\b/,
    /\b(i|we) (am|are|'m|'re) (stuck|lost|trapped|alone) (at|in|here|there)\b/,
    /\b(very )?(urgent|emergency) (help|situation|matter)\b/,
    /උදව් කරන්න.*(හදිසි|බය)|பயமாக இருக்கிறது|உதவி செய்யுங்கள்/u,
  ],
};

const WEAK: Readonly<Record<RiskFlag, readonly RegExp[]>> = {
  COMPLAINT: [
    /\b(not happy|unhappy|upset|angry|annoyed|frustrated|disappointed|ignored|no response|nobody (replied|replies|responded|called)|no one (replied|replies|responded|called)|waiting for (days|weeks|a long time)|still waiting|bad experience|poor (service|response)|mistake|problem with|issue with|let down|not satisfied)\b/,
  ],
  FRAUD_CONCERN: [/\b(trust|suspicious|doubt|worried about (the )?(payment|money|advance)|is it safe to pay|safe to pay|real company|genuine|legit|verify|proof of)\b/],
  MEDICAL_URGENCY: [/\b(sick|ill|unwell|fever|pain|doctor|medicine|medication|tablets?|injection|blood pressure|diabetes|diabetic|heart|surgery|operation|pregnant|pregnancy|elderly|health)\b/],
  RELIGIOUS_RULING: [/\b(islam|islamic|sharia|shariah|scholar|mufti|ustad|ulama|permitted|forbidden|ihram rules?|rules of (umrah|hajj|ihram))\b/],
  DISTRESS: [/\b(help me|urgent|worried|scared|afraid|stuck|lost|desperate|crying|in tears|panic(king)?|what should i do)\b/],
};

/** Sinhala and Tamil script: the English lexicon is weak here, so a non-trivial message with no strong hit is left to the model. */
const NON_LATIN = /[඀-෿஀-௿]/u;
const MIN_JUDGEMENT_LENGTH = 12;

export interface LexiconResult {
  strong: RiskReading[];
  weak: RiskReading[];
  /** Sinhala or Tamil text with no strong hit: cannot be called routine by an English lexicon. */
  unreadable: boolean;
}

/**
 * Tries the accent-stripped text (for the English phrases) and the plain composed text (Sinhala and Tamil vowel signs would be
 * split apart by the accent-stripping normal form, so their patterns are written composed and matched against this one).
 */
function firstMatch(texts: readonly string[], patterns: readonly RegExp[]): string | null {
  for (const text of texts) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) return match[0].slice(0, 200);
    }
  }
  return null;
}

export function lexiconReadings(text: string): LexiconResult {
  const normalised = [normaliseForMatching(text), text.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'")];
  const strong: RiskReading[] = [];
  const weak: RiskReading[] = [];
  for (const flag of RISK_FLAGS) {
    const hit = firstMatch(normalised, STRONG[flag]);
    if (hit) {
      strong.push({ flag, confidence: STRONG_CONFIDENCE, snippet: hit, source: "RULE" });
      continue;
    }
    const cue = firstMatch(normalised, WEAK[flag]);
    if (cue) weak.push({ flag, confidence: WEAK_CONFIDENCE, snippet: cue, source: "RULE_FALLBACK" });
  }
  const unreadable = strong.length === 0 && NON_LATIN.test(text) && text.trim().length >= MIN_JUDGEMENT_LENGTH;
  return { strong, weak, unreadable };
}

export type Verdict = "CONCLUSIVE" | "QUIET" | "INCONCLUSIVE";

/** Should the model be asked? Only when the rules cannot decide: weak cues or unreadable script, and no flag already settled. */
export function verdictOf(result: LexiconResult): Verdict {
  const unsettledWeak = result.weak.filter((cue) => !result.strong.some((hit) => hit.flag === cue.flag));
  if (unsettledWeak.length > 0 || result.unreadable) return "INCONCLUSIVE";
  return result.strong.length > 0 ? "CONCLUSIVE" : "QUIET";
}

/* ── The model's answer ───────────────────────────────────────────────────── */

const flagAnswerSchema = z.object({
  present: z.boolean(),
  confidence: z.number().min(0).max(1),
  /** The customer's own words, copied exactly. */
  quote: z.string().max(300),
});

export const riskModelAnswerSchema = z.object({
  complaint: flagAnswerSchema,
  fraudConcern: flagAnswerSchema,
  medicalUrgency: flagAnswerSchema,
  religiousRuling: flagAnswerSchema,
  distress: flagAnswerSchema,
});
export type RiskModelAnswer = z.infer<typeof riskModelAnswerSchema>;

const flagJson = { type: "object" as const, properties: { present: { type: "boolean" }, confidence: { type: "number" }, quote: { type: "string" } }, required: ["present", "confidence", "quote"], additionalProperties: false };
export const RISK_MODEL_JSON_SCHEMA = {
  type: "object" as const,
  properties: { complaint: flagJson, fraudConcern: flagJson, medicalUrgency: flagJson, religiousRuling: flagJson, distress: flagJson },
  required: ["complaint", "fraudConcern", "medicalUrgency", "religiousRuling", "distress"],
  additionalProperties: false,
};

const ANSWER_KEY: Readonly<Record<RiskFlag, keyof RiskModelAnswer>> = {
  COMPLAINT: "complaint",
  FRAUD_CONCERN: "fraudConcern",
  MEDICAL_URGENCY: "medicalUrgency",
  RELIGIOUS_RULING: "religiousRuling",
  DISTRESS: "distress",
};

const collapse = (text: string) => normaliseForMatching(text).replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Keeps only what the customer can be seen to have said: a flag the model raised with at least 60 % confidence AND a quote that
 * is really in their message. Everything else is dropped and counted.
 */
export function verifyModelAnswer(answer: RiskModelAnswer, customerText: string): { readings: RiskReading[]; rejected: number; rejectedFlags: RiskFlag[] } {
  const haystack = collapse(customerText);
  const readings: RiskReading[] = [];
  let rejected = 0;
  const rejectedFlags: RiskFlag[] = [];
  for (const flag of RISK_FLAGS) {
    const item = answer[ANSWER_KEY[flag]];
    if (!item.present) continue;
    const quote = collapse(item.quote);
    if (item.confidence < MODEL_MIN_CONFIDENCE || quote.length === 0 || !haystack.includes(quote)) {
      rejected += 1;
      rejectedFlags.push(flag);
      continue;
    }
    readings.push({ flag, confidence: Math.round(item.confidence * 100) / 100, snippet: item.quote.trim().slice(0, 200), source: "MODEL" });
  }
  return { readings, rejected, rejectedFlags };
}

/** Merge readings for the same flag, keeping the most confident one. */
export function mergeReadings(...lists: ReadonlyArray<readonly RiskReading[]>): RiskReading[] {
  const best = new Map<RiskFlag, RiskReading>();
  for (const reading of lists.flat()) {
    const current = best.get(reading.flag);
    if (!current || reading.confidence > current.confidence) best.set(reading.flag, reading);
  }
  return RISK_FLAGS.flatMap((flag) => (best.has(flag) ? [best.get(flag) as RiskReading] : []));
}

/** What a failed or unavailable model leaves: the strong hits AND the weak cues, never nothing when there was a cue. */
export function fallbackReadings(result: LexiconResult): RiskReading[] {
  return mergeReadings(result.strong, result.weak);
}
