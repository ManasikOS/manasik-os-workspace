/**
 * The rule-based S1 triage — MI2.4 of docs/inbox/implementation-plan.md (Architecture §6 S1).
 *
 * This is what answers when the model cannot: no API key, budget refused, a model error, or an answer outside the
 * closed enums. It is also the safety net around the model — a model that calls a genuine Umrah enquiry "SPAM" is
 * overruled here (`shouldOverrideSpam`), because a wrongly-spammed customer is a lost booking. Staff always see
 * `source = 'RULES'` on what it produces; nothing rule-derived pretends to be AI.
 *
 * Pure and client-safe. Vocabulary is English (including common Sri Lankan usage), Sinhala and Tamil — the agency's
 * customers write in all three, often in one message. Patterns are matched on lower-cased, NFKC-normalised text.
 * Confidence is deliberately modest (≤ 0.75): a keyword match is a hint, not a reading.
 */

import { detectRedFlags } from "@/lib/inbox/intelligence/gate";
import type { IntentCode, Sentiment, Urgency } from "@/lib/inbox/intelligence/contracts";

export interface TriageReading {
  intentCode: IntentCode;
  intentConfidence: number;
  urgency: Urgency;
  sentiment: Sentiment;
  languageCode: "en" | "si" | "ta";
}

/* ── Language ─────────────────────────────────────────────────────────────── */

const SINHALA = /[඀-෿]/gu;
const TAMIL = /[஀-௿]/gu;

/** The dominant script wins; Latin-script "Singlish" and "Tanglish" count as English (the closest supported code). */
export function detectLanguage(text: string): "en" | "si" | "ta" {
  const sinhala = (text.match(SINHALA) ?? []).length;
  const tamil = (text.match(TAMIL) ?? []).length;
  if (sinhala === 0 && tamil === 0) return "en";
  return sinhala >= tamil ? "si" : "ta";
}

/* ── Intents ──────────────────────────────────────────────────────────────── */

interface IntentRule {
  intent: Exclude<IntentCode, "OTHER" | "SPAM">;
  patterns: RegExp[];
}

/** Listed in tie-break priority: when two intents score equally, the earlier one wins (the costlier miss goes first). */
const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: "COMPLAINT",
    patterns: [/complain|disappointed|bad service|worst|unacceptable|not happy|no response|nobody (replied|answered)|cheated|scam|ignored|terrible|pathetic|hari naha|reply (ekak )?nane|reply nae/u, /පැමිණිල්ල|කේන්ති|කලකිරී|පිළිතුරක් නැ/u, /புகார்|ஏமாற்று|மோசம்|பதில் இல்லை/u],
  },
  {
    intent: "CANCELLATION",
    patterns: [/cancel|refund|withdraw|pull out|call off|money back/u, /අවලංගු|මුදල් ආපසු/u, /ரத்து|பணம் திருப்பி|திரும்பப்/u],
  },
  {
    intent: "PAYMENT_CLAIM",
    patterns: [
      /\b(i|we) (have )?(already )?(paid|transferred|deposited|sent the money)|payment (done|made|sent)|bank slip|deposit slip|receipt|gewwa|gewuwa|slip eka|transfer(red)? (to|the)|paid (the )?(advance|balance|deposit)/u,
      /ගෙවුවා|ගෙවා ඇත|බැංකුවට|රිසිට්පත/u,
      /செலுத்தினேன்|செலுத்தி|பணம் அனுப்பினேன்|ரசீது/u,
    ],
  },
  { intent: "VISA_QUERY", patterns: [/\bvisa\b|e-?visa|nusuk|entry permit/u, /වීසා/u, /விசா/u] },
  {
    intent: "DOCUMENT_ISSUE",
    patterns: [/passport|\bnic\b|birth certificate|documents?\b|photo(graph)?s? (for|of)|scan(ned)?\b|vaccin|meningitis|police report/u, /ගමන් බලපත්‍ර|ලේඛන|ජාතික හැඳුනුම්පත/u, /பாஸ்போர்ட்|ஆவணம்|கடவுச்சீட்டு/u],
  },
  {
    intent: "BOOKING_REQUEST",
    patterns: [/\b(book|reserve|register|enrol+)\b|confirm my seat|sign me up|i want to join|hold (a )?seats?|\bseats? for\b|i('| a)?m interested in joining/u, /වෙන් කරන්න|ලියාපදිංචි|බුක් කරන්න/u, /பதிவு செய்|புக் செய்|இடம் ஒதுக்/u],
  },
  {
    intent: "GROUP_ENQUIRY",
    patterns: [/group of \d+|\b\d{2,} (people|persons|pax|members|pilgrims)\b|our group|family of \d+|for \d+ of us|corporate group|mosque group|jamaath?|group (booking|trip|package|umrah|hajj)/u, /කණ්ඩායම|පවුලේ .*දෙනා/u, /குழு|குடும்பம்/u],
  },
  {
    intent: "PRICE_REQUEST",
    patterns: [/\b(price|prices|cost|rate|rates|how much|charges?|fee|fees|quotation|quote|per person)\b|kiyada|monawada gaana/u, /මිල|කීයද|ගාන|වියදම/u, /விலை|எவ்வளவு|கட்டணம்/u],
  },
  {
    intent: "ITINERARY_QUERY",
    patterns: [/itinerary|schedule|flight (time|details)|which hotel|hotel (in|near)|departure date|days in (makkah|mecca|madinah|medina)|how many days|distance from (the )?haram|meals?\b|\bhotels?\b/u, /කාලසටහන|හෝටලය|ගුවන් ගමන/u, /பயண அட்டவணை|ஹோட்டல்|விமான/u],
  },
  {
    intent: "PACKAGE_ENQUIRY",
    patterns: [/umra+h?|umrah|\bhajj?\b|hajj|ziyarah|ziyara|package|packages|\btour\b|\btrip\b|pilgrimage|makkah|mecca|madinah|medina|ramadan|ramazan/u, /උම්රා|හජ්|පැකේජ|මක්කම|මදීනා/u, /உம்ரா|ஹஜ்|பேக்கேஜ்|மக்கா|மதீனா/u],
  },
  {
    intent: "FAQ",
    patterns: [/\bdo you (provide|have|offer|arrange)|\bcan (i|women|ladies|we)\b|\bis (it|there)\b|\bhow (do|can|long)\b|what (is|are|time)|requirements?|age limit|mahram|office (hours|time|address)|where (is|are) you|located|open (on|from)/u, /ඔබට .*පුළුවන්ද|කොහෙද|මොකක්ද/u, /எங்கே|என்ன|முடியுமா/u],
  },
];

const SPAM_MARKERS =
  /\b(you('|’)?ve? won|claim your (prize|reward)|click (here|the link)|guaranteed (profit|returns?)|earn \$?\d+|make money (fast|online)|crypto|bitcoin|forex|casino|betting|loan (offer|approval)|adult|seo services|buy followers|investment opportunity|lottery|whatsapp (gold|plus)|limited time offer|act now)\b/iu;
const LINK = /https?:\/\/|www\./iu;

/** Any of the agency's own subject matter. A message that mentions these is not spam, whatever else it contains. */
const TRAVEL_SUBJECT =
  /umra+h?|hajj?|ziyar|package|\btour\b|\btrip\b|pilgrim|makkah|mecca|madinah|medina|visa|passport|flight|hotel|booking|\bbook\b|seat|departure|ramadan|itinerary|travel|උම්රා|හජ්|පැකේජ|වීසා|உம்ரா|ஹஜ்|விசா|பேக்கேஜ்/iu;

export function looksLikeSpam(text: string): boolean {
  const normalised = text.normalize("NFKC");
  if (TRAVEL_SUBJECT.test(normalised)) return false;
  return SPAM_MARKERS.test(normalised) || (LINK.test(normalised) && /\b(win|prize|free|offer|earn|profit|discount)\b/iu.test(normalised));
}

/** A model said SPAM about a message that plainly concerns the agency's business: do not believe it. */
export function shouldOverrideSpam(text: string): boolean {
  return TRAVEL_SUBJECT.test(text.normalize("NFKC")) && !SPAM_MARKERS.test(text.normalize("NFKC"));
}

/**
 * The same English/Sinhala/Tamil patterns `scoreIntents` matches an intent with, keyed by intent — for callers
 * outside triage that need to detect one of these topics without maintaining a second, drifting keyword list
 * (e.g. the L3 bounded intake's forbidden-topic detector, `lib/inbox/autonomy/intake-deny-topics.ts`).
 */
export function patternsForIntent(intent: IntentRule["intent"]): readonly RegExp[] {
  return INTENT_RULES.find((rule) => rule.intent === intent)?.patterns ?? [];
}

function scoreIntents(text: string): { intent: IntentCode; hits: number } {
  let best: { intent: IntentCode; hits: number } = { intent: "OTHER", hits: 0 };
  for (const rule of INTENT_RULES) {
    const hits = rule.patterns.filter((pattern) => pattern.test(text)).length;
    if (hits > best.hits) best = { intent: rule.intent, hits };
  }
  return best;
}

/* ── Urgency and sentiment ────────────────────────────────────────────────── */

const CRITICAL_URGENCY = /\b(emergency|stranded|lost (my )?passport|hospital|missed (my )?flight|flight (is )?(today|tonight|in \d+ hours?))\b|ඉක්මනින්ම අවශ්‍ය.*අද|அவசரம்.*இன்று/u;
const HIGH_URGENCY = /\b(urgent|urgently|asap|immediately|today|tonight|tomorrow|deadline|last date|right now)\b|හදිසි|ඉක්මනින්|අද|හෙට|அவசர|உடனே|இன்று|நாளை/u;
const LOW_URGENCY = /\b(no hurry|whenever|just (asking|checking|curious)|next year|not urgent|in the future)\b|ඉක්මන් නැහැ|அவசரம் இல்லை/u;

function detectUrgency(text: string): Urgency {
  if (CRITICAL_URGENCY.test(text) || detectRedFlags(text).includes("DISTRESS_LANGUAGE")) return "CRITICAL";
  if (HIGH_URGENCY.test(text)) return "HIGH";
  if (LOW_URGENCY.test(text)) return "LOW";
  return "NORMAL";
}

const ANGRY = /\b(worst|unacceptable|disgusting|pathetic|terrible|furious|angry|fed up|cheated|ridiculous)\b|!{3,}|කේන්ති|මෝඩ|கோபம்|மோசம்/u;
const CONCERNED = /\b(worried|worry|concern(ed)?|not sure|problem|issue|delay(ed)?|no reply|still waiting|confused)\b|කනගාටු|බය|கவலை|பிரச்சினை|தாமதம்/u;
const POSITIVE = /\b(thanks?|thank you|jazak(a|al)lah|excellent|great|happy|alhamdulillah|masha ?allah|appreciate|wonderful)\b|ස්තුති|நன்றி/u;

function detectSentiment(text: string): Sentiment {
  if (detectRedFlags(text).includes("DISTRESS_LANGUAGE")) return "DISTRESSED";
  if (ANGRY.test(text)) return "ANGRY";
  if (CONCERNED.test(text)) return "CONCERNED";
  if (POSITIVE.test(text)) return "POSITIVE";
  return "NEUTRAL";
}

/* ── The reading ──────────────────────────────────────────────────────────── */

/** Confidence for a rule reading: one hit is a hint (0.55), two independent hits agree (0.7), never more than 0.75. */
const CONFIDENCE_BY_HITS = [0.3, 0.55, 0.7, 0.75] as const;

export function triageByRules(text: string): TriageReading {
  const normalised = text.normalize("NFKC").toLowerCase();
  const languageCode = detectLanguage(normalised);
  const urgency = detectUrgency(normalised);
  const sentiment = detectSentiment(normalised);

  if (looksLikeSpam(normalised)) return { intentCode: "SPAM", intentConfidence: 0.7, urgency: "LOW", sentiment: "NEUTRAL", languageCode };

  const { intent, hits } = scoreIntents(normalised);
  return { intentCode: intent, intentConfidence: CONFIDENCE_BY_HITS[Math.min(hits, CONFIDENCE_BY_HITS.length - 1)], urgency, sentiment, languageCode };
}
