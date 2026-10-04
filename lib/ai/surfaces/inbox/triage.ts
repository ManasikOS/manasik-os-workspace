/**
 * S1 triage — MI2.4 of docs/inbox/implementation-plan.md (Architecture §6 S1).
 *
 * ONE `generateStructured({ tier: "classify" })` call per enriched conversation, answering the closed-enum shape:
 * intent, urgency, sentiment, language. The model reads the rolling digest (`digest.ts`), never the whole thread.
 *
 * Whenever the model cannot answer — no key, budget refused, an error, malformed JSON, or a value outside the enums
 * (which `generateStructured` reports as a validation failure) — the rule-based reading from `triage-lexicon.ts`
 * is returned with `source = 'RULES'` and a `note` saying why. This function never throws and never returns nothing:
 * staff always see an honest reading, labelled with where it came from.
 *
 * A model verdict of SPAM is checked against the message itself: a message about Umrah, visas or bookings is not
 * spam, whatever the model says (`shouldOverrideSpam`).
 */

import "server-only";

import { z } from "zod";

import type { Db } from "@/lib/ai/db";
import { generateStructured } from "@/lib/ai/provider";
import {
  INTENT_CODES,
  SENTIMENTS,
  URGENCIES,
  intentCodeSchema,
  sentimentSchema,
  urgencySchema,
  confidenceSchema,
  type IntentCode,
  type ReasoningSource,
  type Sentiment,
  type Urgency,
} from "@/lib/inbox/intelligence/contracts";
import { shouldOverrideSpam, triageByRules, detectLanguage, type TriageReading } from "@/lib/inbox/intelligence/triage-lexicon";

export const INBOX_TRIAGE_SURFACE = "INBOX_TRIAGE";

const SYSTEM_PROMPT = `You triage one inbound customer conversation for a Hajj/Umrah travel agency in Sri Lanka. Staff will read your answer next to the conversation, so be accurate rather than confident.

You are given a short digest of the conversation ("C:" is the customer, "T:" is the agency team) and the customer's newest message. Customers write in English, Sinhala, Tamil, or a mix, sometimes in Latin letters ("Singlish").

Return exactly:
- intent: the customer's main purpose right now. PACKAGE_ENQUIRY (asking what is on offer), PRICE_REQUEST (asking a price), BOOKING_REQUEST (wants to book or hold seats), PAYMENT_CLAIM (says they paid or sent proof), DOCUMENT_ISSUE (passport, photos, forms), VISA_QUERY, ITINERARY_QUERY (dates, hotels, flights, schedule), COMPLAINT, CANCELLATION (cancel or refund), GROUP_ENQUIRY (a group or several people), FAQ (a general question), SPAM (unrelated promotion, scam or bot text), OTHER.
- intentConfidence: 0 to 1. Use below 0.6 when you are guessing.
- urgency: LOW, NORMAL, HIGH (a deadline or "today/tomorrow"), or CRITICAL (an emergency, a stranded or hospitalised traveller).
- sentiment: POSITIVE, NEUTRAL, CONCERNED, ANGRY, or DISTRESSED.
- languageCode: "en", "si" or "ta" — the language the customer mainly writes in.

Rules: a message about Umrah, Hajj, packages, visas, flights, hotels or bookings is never SPAM. Do not answer the customer and do not invent facts; classify only.`;

const RESPONSE_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    intent: { type: "string", enum: [...INTENT_CODES] },
    intentConfidence: { type: "number" },
    urgency: { type: "string", enum: [...URGENCIES] },
    sentiment: { type: "string", enum: [...SENTIMENTS] },
    languageCode: { type: "string", enum: ["en", "si", "ta"] },
  },
  required: ["intent", "intentConfidence", "urgency", "sentiment", "languageCode"],
  additionalProperties: false,
};

const triageAnswerSchema = z.object({
  intent: intentCodeSchema,
  intentConfidence: confidenceSchema,
  urgency: urgencySchema,
  sentiment: sentimentSchema,
  languageCode: z.enum(["en", "si", "ta"]),
});

export interface TriageOutcome {
  intentCode: IntentCode;
  intentConfidence: number;
  urgency: Urgency;
  sentiment: Sentiment;
  languageCode: string;
  source: ReasoningSource;
  /** Why a rule answered when a model was expected; null when the model answered cleanly. */
  note: string | null;
  aiRunId: string | null;
}

function fromRules(reading: TriageReading, note: string, aiRunId: string | null): TriageOutcome {
  return { ...reading, source: "RULES", note, aiRunId };
}

export async function triageConversation(input: {
  agencyId: string;
  conversationId: string;
  digest: string | null;
  latestMessage: string;
  db: Db;
}): Promise<TriageOutcome> {
  const ruleReading = triageByRules(input.latestMessage);

  const result = await generateStructured({
    tier: "classify",
    system: SYSTEM_PROMPT,
    instruction: `Conversation digest:\n${input.digest ?? "(no earlier messages)"}\n\nNewest customer message:\n${input.latestMessage}`,
    jsonSchema: RESPONSE_JSON_SCHEMA,
    schema: triageAnswerSchema,
    surface: INBOX_TRIAGE_SURFACE,
    agencyId: input.agencyId,
    subjectType: "CONVERSATION",
    subjectId: input.conversationId,
    maxTokens: 400,
    db: input.db,
  });

  if (!result.value) {
    return fromRules(ruleReading, result.note ?? "The model returned no answer, so a keyword reading was used.", result.runId);
  }

  const answer = result.value;
  if (answer.intent === "SPAM" && shouldOverrideSpam(input.latestMessage)) {
    return fromRules(ruleReading, "The model called this message spam, but it is about the agency's own services, so a keyword reading was used instead.", result.runId);
  }

  return {
    intentCode: answer.intent,
    intentConfidence: Math.round(answer.intentConfidence * 100) / 100,
    urgency: answer.urgency,
    sentiment: answer.sentiment,
    languageCode: answer.languageCode ?? detectLanguage(input.latestMessage),
    source: "LLM",
    note: null,
    aiRunId: result.runId,
  };
}
