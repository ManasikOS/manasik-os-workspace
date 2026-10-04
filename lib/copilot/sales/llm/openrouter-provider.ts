/**
 * CopilotReasoningProvider backed by OpenRouter.
 *
 * Guardrails:
 *   * Intent extraction is validated against `travelIntentSchema`; any
 *     failure falls back to the rule-based extractor, with a note.
 *   * Free-form answers receive only `ScopedCopilotContext` — one lead's
 *     customer-safe data — and are told to refuse rather than invent.
 *   * Reply polishing may only rephrase; the Server Action re-audits the
 *     result (figures, guarantees, discounts) and discards it on any finding.
 */

import "server-only";

import { z } from "zod";

import type { ScopedCopilotContext } from "../ask-manasik";
import { extractTravelIntent } from "../intent-extraction";
import { deterministicProvider, type CopilotReasoningProvider } from "../provider";
import { travelIntentSchema } from "../schemas";
import type { ReplyLanguage, ReplyTone } from "../types";
import { isOpenRouterConfigured, openRouterChat, openRouterJson } from "./openrouter";

const INTENT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(travelIntentSchema));

const INTENT_SYSTEM = `You extract a structured travel intent from a Hajj/Umrah travel agency enquiry (WhatsApp messages, call notes or an email, often from Sri Lanka).
Rules:
- Use ONLY what the text states or directly implies. Never invent numbers, dates, budgets or preferences.
- Leave optional fields out when unknown. Use "UNKNOWN" / "NOT_DECIDED" / 0 where the schema requires a value.
- statedBudget is PER PERSON in LKR. If the text gives a group total, divide by the traveller count. "4 lakh" = 400000.
- earliestDate / latestDate are ISO dates (yyyy-mm-dd). Resolve a month without a year to its next occurrence after TODAY.
- extractedFacts: short lines like 'Travellers: "We are 4 people from Colombo"' quoting the evidence.
- unansweredQuestions: what a sales agent must still ask before quoting (exact departure date, budget per person, room occupancy, children's ages, ...).
- confidence: 0..1, the share of key facts (journey, dates, travellers, room, budget, hotel/payment preference) that are known.
Reply with ONE JSON object matching this JSON Schema, nothing else:
${INTENT_JSON_SCHEMA}`;

const ANSWER_SYSTEM = `You are Manasik, an internal sales assistant for a Hajj/Umrah travel agency. A staff member is asking about ONE lead.
Answer ONLY from the JSON context provided. If the context does not contain the answer, say exactly what information is missing.
Never invent prices, dates, seat counts, hotel names, flight details, discounts, or visa outcomes. Never promise a seat.
Be direct and practical, in plain text, at most 120 words.`;

const TONE_GUIDE: Record<ReplyTone, string> = {
  WARM: "warm and respectful",
  PROFESSIONAL: "professional and courteous",
  SHORT_WHATSAPP: "short, suitable for a WhatsApp message",
  DETAILED: "detailed and explanatory",
};

const LANGUAGE_NAME: Record<ReplyLanguage, string> = { EN: "English", SI: "Sinhala", TA: "Tamil" };

export const openRouterProvider: CopilotReasoningProvider = {
  source: "LLM",

  async extractIntent(input) {
    try {
      const notes = input.notes.length > 0 ? `\n\nEXISTING INTERNAL NOTES (read-only context):\n${input.notes.join("\n")}` : "";
      const intent = await openRouterJson(
        travelIntentSchema,
        [
          { role: "system", content: INTENT_SYSTEM },
          { role: "user", content: `TODAY: ${input.now.slice(0, 10)}\n\nENQUIRY:\n${input.text}${notes}` },
        ],
        { maxTokens: 1500 },
      );
      return { intent: { ...intent, updatedAt: input.now }, source: "LLM", note: null };
    } catch (error) {
      return {
        intent: extractTravelIntent(input),
        source: "RULES",
        note: `AI extraction unavailable (${error instanceof Error ? error.message : "unknown error"}) — used rule-based extraction.`,
      };
    }
  },

  async answerFreeform({ question, context }: { question: string; context: ScopedCopilotContext }) {
    try {
      return await openRouterChat(
        [
          { role: "system", content: ANSWER_SYSTEM },
          { role: "user", content: `CONTEXT:\n${JSON.stringify(context)}\n\nQUESTION: ${question}` },
        ],
        { maxTokens: 400 },
      );
    } catch {
      return null;
    }
  },

  async polishReply({ draft, tone, language }) {
    try {
      return await openRouterChat(
        [
          {
            role: "system",
            content: `Rewrite the customer message below in ${LANGUAGE_NAME[language]} with a ${TONE_GUIDE[tone]} tone for a Hajj/Umrah travel agency customer.
Keep every name, date, price, amount and number EXACTLY as written. Do not add any fact, price, discount, guarantee, hotel name, flight detail or visa promise that is not in the message.
Keep the Islamic greeting and closing. Output only the rewritten message.`,
          },
          { role: "user", content: draft },
        ],
        { maxTokens: 900, temperature: 0.3 },
      );
    } catch {
      return null;
    }
  },
};

/** The provider to use right now: OpenRouter when configured, otherwise rules. */
export function getReasoningProvider(): CopilotReasoningProvider {
  return isOpenRouterConfigured() ? openRouterProvider : deterministicProvider;
}
