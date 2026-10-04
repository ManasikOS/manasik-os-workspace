import "server-only";

import { z } from "zod";
import type { Db } from "@/lib/ai/db";
import { generateStructured } from "@/lib/ai/provider";
import { verifyClaims } from "@/lib/ai/trust/claim-verifier";

const handoffNarrationSchema = z.object({
  expectations: z.array(z.string().min(1).max(240)).max(5),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "CONCERNED", "ANGRY", "DISTRESSED"]),
  confidence: z.number().min(0).max(1),
});
const HANDOFF_NARRATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["expectations", "sentiment", "confidence"],
  properties: {
    expectations: { type: "array", items: { type: "string" }, maxItems: 5 },
    sentiment: { type: "string", enum: ["POSITIVE", "NEUTRAL", "CONCERNED", "ANGRY", "DISTRESSED"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export type HandoffNarrationResult =
  | { value: z.infer<typeof handoffNarrationSchema>; source: "LLM" | "RULES"; note: string | null }
  | { value: null; source: "LLM" | "RULES"; note: string | null };

/** Prose only: facts and figures remain the deterministic handoff snapshot. */
export async function narrateHandoffExpectations(
  input: { agencyId: string; conversationId: string; customerMessages: string[]; facts: unknown; db: Db },
  generate: typeof generateStructured = generateStructured,
): Promise<HandoffNarrationResult> {
  if (input.customerMessages.length === 0) {
    return { value: null, source: "RULES", note: "No customer messages were available to narrate." };
  }
  try {
    const result = await generate({
      tier: "draft",
      system: "Summarise only expectations stated by the customer and classify their sentiment. Never add facts, dates, prices, promises, or instructions. Copy no more detail than Operations needs.",
      instruction: `Customer messages:\n${input.customerMessages.map((message) => `- ${message}`).join("\n")}`,
      jsonSchema: HANDOFF_NARRATION_JSON_SCHEMA,
      schema: handoffNarrationSchema,
      surface: "INBOX_HANDOFF",
      agencyId: input.agencyId,
      subjectType: "CONVERSATION",
      subjectId: input.conversationId,
      maxTokens: 240,
      db: input.db,
    });
    if (!result.value) return { value: null, source: result.source, note: result.note };
    const checked = verifyClaims(result.value.expectations.join(" "), { handoff: input.facts, customerMessages: input.customerMessages });
    if (!checked.ok) return { value: null, source: "RULES", note: "The narration contained a figure absent from the handoff facts." };
    return { value: result.value, source: result.source, note: null };
  } catch (cause) {
    return { value: null, source: "RULES", note: cause instanceof Error ? cause.message : "The handoff narration was unavailable." };
  }
}
