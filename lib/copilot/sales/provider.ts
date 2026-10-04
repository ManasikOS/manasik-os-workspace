/**
 * The reasoning-provider boundary.
 *
 * Every step that could benefit from a language model goes through this
 * interface. The deterministic provider is always available; the OpenRouter
 * provider (`llm/openrouter-provider.ts`, server-only) is used when
 * `OPENROUTER_API_KEY` is set and falls back to this one on any failure. The
 * result always says which produced it — nothing pretends to be AI.
 */

import type { ScopedCopilotContext } from "./ask-manasik";
import { extractTravelIntent, type IntentExtractionInput } from "./intent-extraction";
import type { ReasoningSource, ReplyLanguage, ReplyTone, TravelIntent } from "./types";

export interface IntentExtractionOutcome {
  intent: TravelIntent;
  source: ReasoningSource;
  /** Set when the LLM was unavailable and rules were used instead. */
  note: string | null;
}

export interface CopilotReasoningProvider {
  readonly source: ReasoningSource;
  extractIntent(input: IntentExtractionInput): Promise<IntentExtractionOutcome>;
  /** Free-form question about one lead. Null when this provider cannot answer. */
  answerFreeform(input: { question: string; context: ScopedCopilotContext }): Promise<string | null>;
  /** Tone/language rewrite of a template draft. Null when unavailable. */
  polishReply(input: { draft: string; tone: ReplyTone; language: ReplyLanguage }): Promise<string | null>;
}

export const deterministicProvider: CopilotReasoningProvider = {
  source: "RULES",
  async extractIntent(input) {
    return { intent: extractTravelIntent(input), source: "RULES", note: null };
  },
  async answerFreeform() {
    return null;
  },
  async polishReply() {
    return null;
  },
};
