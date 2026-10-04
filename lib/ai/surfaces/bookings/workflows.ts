/**
 * Booking Intelligence — Class 0 only (plan §4.5). `lib/bookings/blockers.ts`
 * and `lib/bookings/inconsistencies.ts` already decided what's wrong before
 * this is ever called; the model's only job is ordering the blockers into a
 * resolution sequence (which one to fix first, and why) and explaining the
 * probable cause of an inconsistency — it never invents a blocker, a
 * number, or a cause not implied by what it was given.
 */

import "server-only";

import { z } from "zod";

import { generateStructured, type AiResult } from "@/lib/ai/provider";
import { verifyClaims } from "@/lib/ai/trust/claim-verifier";
import type { Db } from "@/lib/ai/db";
import type { BookingBlocker } from "@/lib/bookings/blockers";
import type { BookingInconsistency } from "@/lib/bookings/inconsistencies";

const SYSTEM_PROMPT = `You are Manasik Copilot, helping a travel agency's operations or sales staff triage one booking.

Every blocker and inconsistency listed below was already found by the application — you never invent one, and you never state a number, date, or count that isn't already in the list given to you.

Your job:
1. Order the blockers into a resolution sequence — which to address first, considering both the commercial impact (money, the traveller relationship) and the operational impact (what else depends on it, how close the deadline is).
2. For each inconsistency, say the most probable cause and which role should own fixing it (Sales, Finance, or Operations).

Two to four sentences total. No greeting, no sign-off.`;

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    resolutionSequence: { type: "string" },
    inconsistencyNotes: { type: "string" },
  },
  required: ["resolutionSequence", "inconsistencyNotes"],
  additionalProperties: false,
};

const ResponseSchema = z.object({
  resolutionSequence: z.string(),
  inconsistencyNotes: z.string(),
});

export interface BookingAnalysisFacts {
  blockers: BookingBlocker[];
  inconsistencies: BookingInconsistency[];
}

export interface BookingAnalysisExplanation {
  resolutionSequence: string;
  inconsistencyNotes: string;
}

export async function explainBookingAnalysis(
  facts: BookingAnalysisFacts,
  agencyId: string,
  bookingId: string,
  db: Db,
  surface = "BOOKING_ADVISOR",
): Promise<AiResult<BookingAnalysisExplanation>> {
  if (facts.blockers.length === 0 && facts.inconsistencies.length === 0) {
    return {
      value: { resolutionSequence: "No blockers found — nothing needs sequencing.", inconsistencyNotes: "No inconsistencies found." },
      source: "RULES",
      note: null,
      runId: null,
    };
  }

  const result = await generateStructured({
    tier: "reason",
    system: SYSTEM_PROMPT,
    instruction: JSON.stringify(facts, null, 2),
    jsonSchema: RESPONSE_SCHEMA,
    schema: ResponseSchema,
    surface,
    agencyId,
    subjectType: "BOOKING",
    subjectId: bookingId,
    db,
  });

  if (!result.value) return result;

  const draftText = `${result.value.resolutionSequence} ${result.value.inconsistencyNotes}`;
  const verification = verifyClaims(draftText, facts);
  if (!verification.ok) {
    return {
      value: null,
      source: "RULES",
      note: `AI Analysis withheld — it stated a figure not present in the blocker/inconsistency data (${verification.violations
        .map((v) => v.span)
        .join(", ")}).`,
      runId: result.runId,
    };
  }

  return result;
}
