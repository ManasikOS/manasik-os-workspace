/**
 * FIX4 (docs/inbox/fixing-plan.md) — the forbidden-topic lexicon the L3 bounded intake hands over on, extracted
 * into one tested constant so it can be checked on every customer message, including the first, in English,
 * Sinhala, Tamil and common Singlish/Tanglish forms.
 *
 * Reused, not duplicated: price, booking, payment, refund/cancellation and visa keywords are the exact same
 * multilingual patterns `lib/inbox/intelligence/triage-lexicon.ts` already matches those intents with
 * (`patternsForIntent`) — this file does not maintain a second, competing list for meanings that already exist
 * there. Medical and religious topics have no equivalent triage intent, so they are defined here directly,
 * matched to the categories `lib/inbox/risk/never-promise.ts` already refuses an automated reply from claiming
 * (`HEALTH_OR_SAFETY_ADVICE`, `RELIGIOUS_RULING`) — this intake detector looks for the *customer asking about*
 * the topic, which is a different (broader, keyword-based) match than never-promise's phrase-level claim
 * patterns, so the pattern lists are not shared line-for-line, only the category id and its meaning are.
 *
 * Bounded intake is a four-question form, nothing more: any of these topics means a person must take over,
 * whatever step the form is on and whatever language the question arrived in.
 */

import { patternsForIntent } from "@/lib/inbox/intelligence/triage-lexicon";

export const INTAKE_DENY_TOPIC_IDS = [
  "PRICE_OR_BOOKING_REQUEST",
  "CONFIRM_PAYMENT",
  "COMMIT_REFUND_OR_CANCELLATION",
  "PROMISE_VISA_APPROVAL",
  "HEALTH_OR_SAFETY_ADVICE",
  "RELIGIOUS_RULING",
] as const;
export type IntakeDenyTopicId = (typeof INTAKE_DENY_TOPIC_IDS)[number];

interface IntakeDenyTopicEntry {
  id: IntakeDenyTopicId;
  /** In words a person reads on the handed-over conversation. */
  label: string;
  patterns: readonly RegExp[];
}

// Loanwords from Arabic ("fatwa", "halal", "haram") are the terms Sri Lankan Sinhala- and Tamil-speaking
// Muslims actually type for these topics, in Latin script, even inside an otherwise Sinhala/Tamil message —
// they are not translated into native-script equivalents in everyday use, so the English forms below already
// cover Sinhala/Tamil messages that raise the topic.
const RELIGIOUS_RULING_PATTERNS: readonly RegExp[] = [
  /\b(fatwa|fatwah|halal|haram|makruh|mustahabb|is (it|this) (permissible|allowed|haram|halal)|religious ruling|islamically (correct|valid)|valid in islam)\b/iu,
];

const HEALTH_OR_SAFETY_ADVICE_PATTERNS: readonly RegExp[] = [
  /\b(medical|medicine|medication|tablets?|pills?|doctor|hospital|illness|ill|sick(ness)?|allerg(y|ies)|pregnan(t|cy)|wheelchair|disabilit(y|ies)|insulin|diabet(es|ic)|vaccin(e|ation)s?)\b/iu,
  // Sinhala: vedya (doctor/medical), beheth (medicine), rohala (hospital), asaneepa (sick/illness).
  /වෛද්‍ය|බෙහෙත්|රෝහල|අසනීප/u,
  // Tamil: maruthuva (medical), marundhu (medicine), maruthuvamanai (hospital), udalnalam (health).
  /மருத்துவ|மருந்து|மருத்துவமனை|உடல்நலம்/u,
];

export const INTAKE_DENY_TOPICS: readonly IntakeDenyTopicEntry[] = [
  {
    id: "PRICE_OR_BOOKING_REQUEST",
    label: "asked about price, discount or booking",
    patterns: [...patternsForIntent("PRICE_REQUEST"), ...patternsForIntent("BOOKING_REQUEST")],
  },
  {
    id: "CONFIRM_PAYMENT",
    label: "asked about a payment",
    patterns: patternsForIntent("PAYMENT_CLAIM"),
  },
  {
    id: "COMMIT_REFUND_OR_CANCELLATION",
    label: "asked about a refund or cancellation",
    patterns: patternsForIntent("CANCELLATION"),
  },
  {
    id: "PROMISE_VISA_APPROVAL",
    label: "asked about a visa",
    patterns: patternsForIntent("VISA_QUERY"),
  },
  {
    id: "HEALTH_OR_SAFETY_ADVICE",
    label: "asked a medical or health question",
    patterns: HEALTH_OR_SAFETY_ADVICE_PATTERNS,
  },
  {
    id: "RELIGIOUS_RULING",
    label: "asked a religious ruling question",
    patterns: RELIGIOUS_RULING_PATTERNS,
  },
];

export interface IntakeDenyTopicMatch {
  id: IntakeDenyTopicId;
  label: string;
  span: string;
}

/** The reused `triage-lexicon` patterns are matched against lower-cased text there, so this does the same. */
export function findIntakeDenyTopic(text: string): IntakeDenyTopicMatch | null {
  const normalised = text.normalize("NFKC").toLowerCase();
  for (const entry of INTAKE_DENY_TOPICS) {
    for (const pattern of entry.patterns) {
      const match = pattern.exec(normalised);
      if (match) return { id: entry.id, label: entry.label, span: match[0].slice(0, 120) };
    }
  }
  return null;
}
