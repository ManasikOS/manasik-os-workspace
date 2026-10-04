/**
 * Payment Plans Copilot — Class 0 only (plan §4.14). The deterministic
 * scorer in `lib/finance/collection-risk.ts` already produced the risk
 * score and its factors before either function here is ever called; the
 * model's only job is narrating that score and drafting reminder wording —
 * it never produces a number of its own. Every amount either function
 * states is checked by `verifyClaims` against the booking pack before being
 * shown, same posture as `lib/ai/surfaces/finance/workflows.ts`.
 */

import "server-only";

import { z } from "zod";

import { generateStructured, type AiResult } from "@/lib/ai/provider";
import { verifyClaims } from "@/lib/ai/trust/claim-verifier";
import type { Db } from "@/lib/ai/db";
import type { BookingContextPack } from "@/lib/agent/kernel/proposals/booking-pack";

const RISK_SYSTEM_PROMPT = `You are Manasik Copilot, explaining one booking's payment-collection risk score to finance staff at a Hajj & Umrah travel agency.

The score and every factor behind it were computed deterministically before you were called — you narrate what the numbers mean and suggest a next step, you never state a risk score, percentage, or probability of your own. Never invent an amount, date, or name not present in the data you were given.

Rules:
1. Reference only the score, band, and factors given to you — never a "predicted" number.
2. Suggest one concrete next step appropriate to the band (e.g. LOW: no action; CRITICAL: escalate to finance owner).
3. Two to three sentences. No greeting, no sign-off.`;

const RISK_RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    explanation: { type: "string" },
    suggestedAction: { type: "string" },
  },
  required: ["explanation", "suggestedAction"],
  additionalProperties: false,
};

const RiskResponseSchema = z.object({
  explanation: z.string(),
  suggestedAction: z.string(),
});

export interface CollectionRiskExplanation {
  explanation: string;
  suggestedAction: string;
}

/** Explains a booking's already-computed `pack.facts.collectionRisk` — never recomputes it. */
export async function explainCollectionRisk(
  pack: BookingContextPack,
  agencyId: string,
  db: Db,
  surface = "FINANCE",
): Promise<AiResult<CollectionRiskExplanation>> {
  const result = await generateStructured({
    tier: "reason",
    system: RISK_SYSTEM_PROMPT,
    instruction: `Booking ${pack.facts.bookingReference} (${pack.facts.contactName}), currency ${pack.facts.currency}:\n${JSON.stringify(
      { collectionRisk: pack.facts.collectionRisk, outstandingBalance: pack.facts.outstandingBalance, overdueMilestoneCount: pack.facts.overdueMilestoneCount },
      null,
      2,
    )}`,
    jsonSchema: RISK_RESPONSE_SCHEMA,
    schema: RiskResponseSchema,
    surface,
    agencyId,
    subjectType: "BOOKING",
    subjectId: pack.facts.bookingId,
    db,
  });

  if (!result.value) return result;

  const draftText = `${result.value.explanation} ${result.value.suggestedAction}`;
  const verification = verifyClaims(draftText, pack.facts);
  if (!verification.ok) {
    return {
      value: null,
      source: "RULES",
      note: `AI Analysis withheld — it stated a figure not present in the booking data (${verification.violations
        .map((v) => v.span)
        .join(", ")}).`,
      runId: result.runId,
    };
  }

  return result;
}

const REMINDER_SYSTEM_PROMPT = `You are Manasik Copilot, drafting a payment reminder message on behalf of a Hajj & Umrah travel agency's finance team, in the language requested.

The amount, due date, and booking reference are already fixed — copy them exactly as given, in the currency given. Never invent, round, or translate a number into words. Keep the tone respectful and calm; this is a routine instalment reminder, not a collections notice, unless told the milestone is significantly overdue.

Rules:
1. State the exact amount and due date from the data given, in the language requested.
2. One short paragraph — no greeting boilerplate beyond a brief opening, no sign-off block.
3. Never mention the collection-risk score or any internal-only figure — this message goes to the traveller.`;

const REMINDER_RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
};

const ReminderResponseSchema = z.object({ message: z.string() });

export interface DraftReminderInput {
  milestoneLabel: string;
  amount: number;
  currency: string;
  dueAt: string;
  language: string;
}

export interface DraftedReminder {
  message: string;
}

/** Drafts reminder wording for an already-queued `payment_reminders` row — never decides whether to send it. */
export async function draftReminder(
  pack: BookingContextPack,
  input: DraftReminderInput,
  agencyId: string,
  db: Db,
  surface = "FINANCE",
): Promise<AiResult<DraftedReminder>> {
  const result = await generateStructured({
    tier: "draft",
    system: REMINDER_SYSTEM_PROMPT,
    instruction: `Draft a payment reminder in ${input.language} for ${pack.facts.contactName} (booking ${pack.facts.bookingReference}):\n${JSON.stringify(
      input,
      null,
      2,
    )}`,
    jsonSchema: REMINDER_RESPONSE_SCHEMA,
    schema: ReminderResponseSchema,
    surface,
    agencyId,
    subjectType: "BOOKING",
    subjectId: pack.facts.bookingId,
    db,
  });

  if (!result.value) return result;

  const verification = verifyClaims(result.value.message, {
    amount: input.amount,
    dueAt: input.dueAt,
    milestoneLabel: input.milestoneLabel,
    bookingReference: pack.facts.bookingReference,
  });
  if (!verification.ok) {
    return {
      value: null,
      source: "RULES",
      note: `Reminder draft withheld — it stated a figure not present in the instalment data (${verification.violations
        .map((v) => v.span)
        .join(", ")}).`,
      runId: result.runId,
    };
  }

  return result;
}
