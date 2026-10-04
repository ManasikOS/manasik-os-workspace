/**
 * Quotes Intelligence — Class 0 only (plan §4.4). Narrates signals already
 * decided deterministically by `lib/quotes/signals.ts` and carried on the
 * quote's own Context Pack (`lib/agent/kernel/proposals/quote-pack.ts`);
 * never recomputes expiry, discount-band, or price-drift itself. Every
 * number in the output is checked against the pack before being shown —
 * same "never fabricate a number" posture as
 * `lib/ai/surfaces/finance/workflows.ts`.
 */

import "server-only";

import { z } from "zod";

import { generateStructured, type AiResult } from "@/lib/ai/provider";
import { verifyClaims } from "@/lib/ai/trust/claim-verifier";
import type { Db } from "@/lib/ai/db";
import type { QuoteContextPack } from "@/lib/agent/kernel/proposals/quote-pack";

const SYSTEM_PROMPT = `You are Manasik Copilot, explaining one sales quote's risk to a travel agency's sales or finance staff.

Every fact you have (status, totals, discount, expiry, and the two flags "discountOutsideBand" and "expiringWithoutFollowUp") was computed by the application before you were called — you narrate it, you never invent a number, a date, or a probability of your own.

Rules:
1. Reference only the figures given to you, in the currency implied (LKR unless stated otherwise).
2. If neither flag is set, say plainly that nothing looks risky — that is a correct answer, not a missed finding.
3. Two to three sentences. No greeting, no sign-off.`;

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};

const ResponseSchema = z.object({ summary: z.string() });

export interface QuoteRiskExplanation {
  summary: string;
}

export async function explainQuoteRisk(
  pack: QuoteContextPack,
  agencyId: string,
  db: Db,
  surface = "SALES",
): Promise<AiResult<QuoteRiskExplanation>> {
  const result = await generateStructured({
    tier: "reason",
    system: SYSTEM_PROMPT,
    instruction: `Quote ${pack.facts.reference} (${pack.facts.contactName}):\n${JSON.stringify(pack.facts, null, 2)}`,
    jsonSchema: RESPONSE_SCHEMA,
    schema: ResponseSchema,
    surface,
    agencyId,
    subjectType: "QUOTE",
    subjectId: pack.facts.quoteId,
    db,
  });

  if (!result.value) return result;

  const verification = verifyClaims(result.value.summary, pack.facts);
  if (!verification.ok) {
    return {
      value: null,
      source: "RULES",
      note: `AI Analysis withheld — it stated a figure not present in the quote data (${verification.violations
        .map((v) => v.span)
        .join(", ")}).`,
      runId: result.runId,
    };
  }

  return result;
}
