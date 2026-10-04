import "server-only";

import { z } from "zod";

import { generateStructured, type AiResult } from "@/lib/ai/provider";
import type { Db } from "@/lib/ai/db";

export const INBOX_TRANSLATION_SURFACE = "INBOX_TRANSLATION";

const translationSchema = z.object({
  translation: z.string().trim().min(1).max(4_000),
  detectedLanguage: z.string().trim().min(2).max(32),
  confidence: z.number().min(0).max(1),
});
const translationJsonSchema = {
  type: "object", additionalProperties: false, required: ["translation", "detectedLanguage", "confidence"],
  properties: {
    translation: { type: "string" }, detectedLanguage: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export type InboxTranslation = z.infer<typeof translationSchema>;

/** On-demand staff aid only: retains the original, persists no translated customer content. */
export async function translateInboxText(input: {
  agencyId: string;
  conversationId: string;
  text: string;
  targetLanguage: "English" | "Sinhala" | "Tamil";
  db: Db;
}): Promise<AiResult<InboxTranslation>> {
  const text = input.text.trim();
  if (!text) return { value: null, source: "RULES", note: "There is no text to translate. The original remains available.", runId: null };
  const result = await generateStructured({
    tier: "draft",
    system: "Translate for travel-agency staff. Preserve names, numbers, dates, and amounts exactly. Do not add facts, advice, or a reply. Return only the requested translation and confidence.",
    instruction: `Translate this text into ${input.targetLanguage}.\n\nOriginal:\n${text}`,
    jsonSchema: translationJsonSchema,
    schema: translationSchema,
    surface: INBOX_TRANSLATION_SURFACE,
    agencyId: input.agencyId,
    subjectType: "CONVERSATION",
    subjectId: input.conversationId,
    maxTokens: 900,
    db: input.db,
  });
  return result.value ? result : { ...result, note: "Translation is unavailable right now. The original message is still available to review." };
}
