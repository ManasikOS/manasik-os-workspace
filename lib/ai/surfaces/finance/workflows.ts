/**
 * Finance Intelligence — Class 0 workflows only (Plan §4.12). Reads a
 * `FinancePeriodPack` and explains it; never writes a record, never
 * approves or moves money. Every number in the model's output is checked
 * against the pack by `lib/ai/trust/claim-verifier.ts` before it is ever
 * shown — a violation drops the AI narrative entirely rather than risk
 * showing an invented figure next to real ones.
 */

import "server-only";

import { z } from "zod";

import { generateStructured, type AiResult } from "@/lib/ai/provider";
import { verifyClaims } from "@/lib/ai/trust/claim-verifier";
import type { Db } from "@/lib/ai/db";
import type { FinancePeriodPack } from "@/lib/ai/surfaces/finance/pack";

const FROZEN_SYSTEM_PROMPT = `You are Manasik Copilot, reading a finance snapshot for a Hajj & Umrah travel agency's owner or finance staff.

You explain cash position and risk from the numbers given to you. You never invent a number, a group name, or a currency that is not in the data you were given. Every metric is already computed correctly by the application — you narrate and prioritise, you do not recompute or second-guess a total.

Rules:
1. Every amount you state must come from the metrics object you were given, in the currency it was given in. Never sum across currencies — this agency has no FX conversion configured, so a blended total would be a fabrication, not a shortcut.
2. A metric marked "available": false has no data yet — say so plainly if it matters, never guess a figure for it.
3. Be concise: 2-4 sentences of summary, then up to 4 short risk bullets, each naming the metric and currency it is about.
4. If nothing looks risky, say so — a clean bill of health is a correct, useful answer, not a failure to find something.`;

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "risks"],
  additionalProperties: false,
};

const ResponseSchema = z.object({
  summary: z.string(),
  risks: z.array(z.string()),
});

export interface CashRiskBriefing {
  summary: string;
  risks: string[];
}

/**
 * Narrates the pack's cash-risk picture. Returns `null` in `value` (with a
 * `note`) whenever the model is unconfigured, refuses, fails validation, or
 * — the one check unique to this function — states a number the claim
 * verifier cannot find anywhere in the pack. That last case is logged as a
 * distinct note so a pattern of failures here is itself a signal worth
 * watching, not silently swallowed.
 */
export async function cashRiskBriefing(
  pack: FinancePeriodPack,
  db: Db,
  surface = "FINANCE",
): Promise<AiResult<CashRiskBriefing>> {
  const result = await generateStructured({
    tier: "reason",
    system: FROZEN_SYSTEM_PROMPT,
    instruction: `Finance snapshot as of ${pack.nowIso}:\n${JSON.stringify(pack.metrics, null, 2)}`,
    jsonSchema: RESPONSE_SCHEMA,
    schema: ResponseSchema,
    surface,
    agencyId: pack.agencyId,
    subjectType: "FINANCE_PERIOD",
    db,
  });

  if (!result.value) return result;

  const draftText = `${result.value.summary} ${result.value.risks.join(" ")}`;
  const verification = verifyClaims(draftText, pack.metrics);
  if (!verification.ok) {
    return {
      value: null,
      source: "RULES",
      note: `AI Analysis withheld — it stated a figure not present in the finance data (${verification.violations
        .map((v) => v.span)
        .join(", ")}).`,
      runId: result.runId,
    };
  }

  return result;
}
