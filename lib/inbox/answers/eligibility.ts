import type { IntentCode } from "@/lib/inbox/intelligence/contracts";

export const CACHEABLE_INTENTS = ["FAQ", "ITINERARY_QUERY", "DOCUMENT_ISSUE"] as const satisfies readonly IntentCode[];

export const NEVER_CACHEABLE = [
  "PRICE_OR_AVAILABILITY",
  "VISA_OUTCOME_OR_ELIGIBILITY",
  "PAYMENT_OR_REFUND",
  "MEDICAL_ADVICE",
  "RELIGIOUS_RULING",
  "NAMED_TRAVELLER",
] as const;
export type NeverCacheableClass = (typeof NEVER_CACHEABLE)[number];

const BLOCKERS: Readonly<Record<NeverCacheableClass, RegExp>> = {
  PRICE_OR_AVAILABILITY: /(?:\b(?:price|cost|fare|available|availability|seats?|lkr|usd|sar)\b|[$€£]|\b\d[\d,.]*\s*(?:lkr|usd|sar)\b)/iu,
  VISA_OUTCOME_OR_ELIGIBILITY: /\bvisa\b.*\b(?:approved?|eligible|guarantee|outcome|reject)/iu,
  PAYMENT_OR_REFUND: /\b(?:payment|paid|refund|chargeback|money back)\b/iu,
  MEDICAL_ADVICE: /\b(?:medical|medicine|doctor|vaccine|vaccination|health advice)\b/iu,
  RELIGIOUS_RULING: /\b(?:fatwa|halal|haram|religious ruling|permissible)\b/iu,
  NAMED_TRAVELLER: /\b(?:mr|mrs|ms|miss|brother|sister)\.?\s+[\p{L}][\p{L}'-]+/iu,
};

export interface AnswerCacheEligibility {
  eligible: boolean;
  blockers: NeverCacheableClass[];
}

export function answerCacheEligibility(input: { intentCode: IntentCode; question: string; answer: string }): AnswerCacheEligibility {
  const text = `${input.question}\n${input.answer}`;
  const blockers = NEVER_CACHEABLE.filter((kind) => BLOCKERS[kind].test(text));
  return { eligible: CACHEABLE_INTENTS.includes(input.intentCode as (typeof CACHEABLE_INTENTS)[number]) && blockers.length === 0, blockers };
}
