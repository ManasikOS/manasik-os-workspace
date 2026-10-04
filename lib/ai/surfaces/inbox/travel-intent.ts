/**
 * S2 — structured travel intent, the model half. MI3.1 of docs/inbox/implementation-plan.md (Architecture §6 S2).
 *
 * Rules run first (`lib/inbox/intelligence/travel-intent.ts`). The model is asked ONLY about the fields the rules left
 * unresolved, in ONE `generateStructured({ tier: "classify" })` call — and not at all when the rules resolved everything.
 * Going through `generateStructured` (rather than the lead-side OpenRouter provider) is what puts the call in `ai_runs`,
 * under the surface's budget check and `ai_usage_daily`: the programme's rule that every model call is metered.
 *
 * Whatever the model returns is guarded: each field must quote the customer verbatim and is dropped otherwise
 * (`mergeModelAnswer`). If the model cannot answer, the rule readings stand and the note says why. Never throws.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { generateStructured } from "@/lib/ai/provider";
import type { TravelIntent } from "@/lib/copilot/sales/types";
import type { TravelIntentEvidence, TravelIntentField } from "@/lib/inbox/intelligence/contracts";
import {
  TRAVEL_MODEL_JSON_SCHEMA,
  mergeModelAnswer,
  runRulePass,
  travelModelAnswerSchema,
  type CustomerMessage,
} from "@/lib/inbox/intelligence/travel-intent";

export const INBOX_INTENT_SURFACE = "INBOX_INTENT";

const FIELD_HELP: Record<TravelIntentField, string> = {
  journey: "journey: UMRAH, HAJJ or EARLY_REGISTRATION",
  travellers: "travellers: how many adults, children and infants are travelling",
  window: "window: the month they want to travel (full English month name)",
  room: "room: the room occupancy they want (QUAD, TRIPLE, DOUBLE or SINGLE)",
  hotelDistance: "hotelDistance: how close to the Haram they want the hotel (VERY_CLOSE, WALKABLE, FLEXIBLE)",
  budget: "budget: what they say they can spend PER PERSON in LKR (\"4 lakh\" = 400000; divide a group total by the traveller count)",
  origin: "origin: the town or city they are travelling from",
};

const SYSTEM_PROMPT = `You read a Hajj/Umrah travel agency customer's messages (English, Sinhala, Tamil or mixed) and fill in a few travel details.

You are told which details to look for. For each one:
- Fill it ONLY if the customer states it or clearly implies it. Otherwise return null. Never guess, never invent a number, date, budget or place.
- "quote" must be the customer's own words copied exactly from their messages, as short as possible, that show the detail. A detail without an exact quote will be discarded.
- Details you are not asked about must be null.
Return the JSON object only.`;

export interface TravelIntentReading {
  intent: TravelIntent;
  readings: TravelIntentEvidence;
  /** LLM when the model contributed at least one field, otherwise RULES. */
  source: "RULES" | "LLM";
  /** Why the model was not used or a field was dropped; null on a clean run. */
  note: string | null;
  modelCalls: number;
  aiRunId: string | null;
}

export async function readTravelIntent(input: {
  agencyId: string;
  conversationId: string;
  customerMessages: readonly CustomerMessage[];
  now: string;
  db: Db;
}): Promise<TravelIntentReading> {
  const pass = runRulePass(input.customerMessages, input.now);
  const rulesOnly: TravelIntentReading = { intent: pass.intent, readings: pass.readings, source: "RULES", note: null, modelCalls: 0, aiRunId: null };

  // Everything the rules could read: no model call at all.
  if (pass.unresolved.length === 0) return rulesOnly;

  const transcript = input.customerMessages.map((message) => `- ${message.text.replace(/\s+/g, " ").trim()}`).join("\n");
  const result = await generateStructured({
    tier: "classify",
    system: SYSTEM_PROMPT,
    instruction: `Details to look for:\n${pass.unresolved.map((field) => `- ${FIELD_HELP[field]}`).join("\n")}\n\nCustomer messages (oldest first):\n${transcript}`,
    jsonSchema: TRAVEL_MODEL_JSON_SCHEMA,
    schema: travelModelAnswerSchema,
    surface: INBOX_INTENT_SURFACE,
    agencyId: input.agencyId,
    subjectType: "CONVERSATION",
    subjectId: input.conversationId,
    maxTokens: 500,
    db: input.db,
  });

  // The call was attempted even when it failed (a run is recorded when it reached the model).
  const modelCalls = result.runId ? 1 : 0;
  if (!result.value) {
    return { ...rulesOnly, note: result.note ?? "The model returned no answer, so only keyword readings are shown.", modelCalls, aiRunId: result.runId };
  }

  const merged = mergeModelAnswer(pass, result.value, pass.unresolved, input.customerMessages);
  const contributed = Object.values(merged.readings).some((reading) => reading?.source === "LLM");
  return {
    intent: merged.intent,
    readings: merged.readings,
    source: contributed ? "LLM" : "RULES",
    note: merged.rejected.length > 0 ? `Left out ${merged.rejected.length} detail${merged.rejected.length === 1 ? "" : "s"} the model gave without a matching quote from the customer.` : null,
    modelCalls,
    aiRunId: result.runId,
  };
}
