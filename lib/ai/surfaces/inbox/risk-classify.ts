/**
 * S4 — model-assisted risk classification, the model half. MI4.3 of docs/inbox/implementation-plan.md.
 *
 * The lexicon (lib/inbox/risk/classify.ts) runs first. The model is asked only when the lexicon cannot decide — weak cues, or a
 * Sinhala/Tamil message it cannot read — and then ONCE, for all five flags together, on the `classify` tier through
 * `generateStructured` (so the call is in `ai_runs`, under its own surface's budget, and counted in `ai_usage_daily`).
 *
 * Never a silent "no risk": if the call fails, is refused (surface off, no key, over budget) after a model was wanted, or returns
 * nothing usable, the lexicon's weak cues are reported at low confidence. Nothing here throws.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { generateStructured } from "@/lib/ai/provider";
import {
  fallbackReadings,
  lexiconReadings,
  mergeReadings,
  RISK_MODEL_JSON_SCHEMA,
  riskModelAnswerSchema,
  verdictOf,
  verifyModelAnswer,
  type RiskReading,
} from "@/lib/inbox/risk/classify";

export const INBOX_RISK_MODEL_SURFACE = "INBOX_RISK_MODEL";

const SYSTEM_PROMPT = `You read one message from a customer of a Hajj/Umrah travel agency (English, Sinhala, Tamil or mixed) and decide whether it raises any of five concerns for the staff:
- complaint: the customer is genuinely unhappy with the agency and wants something done (not just asking a question or mildly frustrated).
- fraudConcern: the customer doubts the agency is genuine, or says someone tried to cheat them or asked for money in a suspicious way.
- medicalUrgency: someone travelling is seriously ill, hurt or in a medical emergency, or a medical condition affects the trip.
- religiousRuling: the customer asks whether something is permissible, valid, halal or haram, or asks for a religious ruling.
- distress: the customer is scared, stranded, in trouble or in urgent need of help.

For each concern return present, your confidence from 0 to 1, and a quote. The quote MUST be the customer's own words copied exactly from the message, as short as possible. A concern without an exact quote will be discarded. If the concern is not raised, return present false, confidence 0 and an empty quote.
When you are unsure whether the customer is in distress or a medical emergency, say present. It is better to raise a concern a person can dismiss than to miss one.
Return the JSON object only.`;

export interface RiskClassification {
  readings: RiskReading[];
  /** NONE: nothing to report. RULES: a strong phrase settled it. MODEL: the classifier contributed. FALLBACK: the model was wanted and failed. */
  source: "NONE" | "RULES" | "MODEL" | "FALLBACK";
  note: string | null;
  modelCalls: number;
  aiRunId: string | null;
  /**
   * True when the message could not be read at all (Sinhala or Tamil, no cue) and the model could not either. It is reported, not
   * called routine: the run records a "could not check this message" signal so a person reads it.
   */
  unread: boolean;
}

export async function classifyRisk(input: {
  agencyId: string;
  conversationId: string;
  /** The customer's newest message. */
  text: string;
  /** Earlier customer messages, oldest first, for context only. */
  earlier?: readonly string[];
  /** Is the model allowed (the surface is on)? Off means the lexicon alone, and weak cues are NOT reported. */
  allowModel: boolean;
  db: Db;
}): Promise<RiskClassification> {
  const lexicon = lexiconReadings(input.text);
  const verdict = verdictOf(lexicon);

  if (verdict === "QUIET") return { readings: [], source: "NONE", note: null, modelCalls: 0, aiRunId: null, unread: false };
  if (verdict === "CONCLUSIVE") return { readings: lexicon.strong, source: "RULES", note: null, modelCalls: 0, aiRunId: null, unread: false };

  // Inconclusive. With the model switched off the lexicon speaks only for what it is sure of.
  if (!input.allowModel) return { readings: lexicon.strong, source: lexicon.strong.length > 0 ? "RULES" : "NONE", note: null, modelCalls: 0, aiRunId: null, unread: false };

  const context = (input.earlier ?? []).slice(-3).map((line) => `- ${line.replace(/\s+/g, " ").trim()}`);
  let result;
  try {
    result = await generateStructured({
      tier: "classify",
      system: SYSTEM_PROMPT,
      instruction: `${context.length > 0 ? `Earlier messages from the same customer (context only):\n${context.join("\n")}\n\n` : ""}Message to classify:\n${input.text.replace(/\s+/g, " ").trim()}`,
      jsonSchema: RISK_MODEL_JSON_SCHEMA,
      schema: riskModelAnswerSchema,
      surface: INBOX_RISK_MODEL_SURFACE,
      agencyId: input.agencyId,
      subjectType: "CONVERSATION",
      subjectId: input.conversationId,
      maxTokens: 400,
      db: input.db,
    });
  } catch (cause) {
    const readings = fallbackReadings(lexicon);
    return { readings, source: "FALLBACK", note: `The risk classifier failed (${cause instanceof Error ? cause.message : "unknown error"}); keyword cues are shown instead.`, modelCalls: 0, aiRunId: null, unread: readings.length === 0 && lexicon.unreadable };
  }

  const modelCalls = result.runId ? 1 : 0;
  if (!result.value) {
    const readings = fallbackReadings(lexicon);
    return { readings, source: "FALLBACK", note: result.note ?? "The risk classifier returned no answer; keyword cues are shown instead.", modelCalls, aiRunId: result.runId, unread: readings.length === 0 && lexicon.unreadable };
  }

  const verified = verifyModelAnswer(result.value, input.text);
  // A concern the model raised but could not back with a quote is not thrown away when a keyword cue points the same way.
  const cued = lexicon.weak.filter((cue) => verified.rejectedFlags.includes(cue.flag));
  return {
    readings: mergeReadings(lexicon.strong, verified.readings, cued),
    source: verified.readings.length > 0 ? "MODEL" : lexicon.strong.length > 0 || cued.length > 0 ? "RULES" : "NONE",
    note: verified.rejected > 0 ? `Left out ${verified.rejected} concern${verified.rejected === 1 ? "" : "s"} the model raised without a matching quote or enough confidence.` : null,
    modelCalls,
    aiRunId: result.runId,
    unread: false,
  };
}
