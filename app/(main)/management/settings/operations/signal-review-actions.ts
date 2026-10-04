"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { recordSignalVerdict } from "@/lib/data/inbox-signal-review-repository";
import { SIGNAL_REVIEW_ROLES } from "@/lib/inbox/risk/precision";
import { createClient } from "@/utils/supabase/server";

export interface SignalReviewActionResult {
  ok: boolean;
  error?: string;
}

const signalVerdictRequestSchema = z.object({
  signalId: z.string().uuid(),
  verdict: z.enum(["CORRECT", "WRONG"]),
});

/**
 * Starts with `requireUser()`, checks the role, validates at the boundary, and writes through the signed-in client so the
 * table's own update policy (same agency, same roles, once only, reviewer = the caller) is the backstop. The agency and the
 * reviewer come from the session, never from the request.
 */
export async function reviewInboxSignalAction(input: unknown): Promise<SignalReviewActionResult> {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!(SIGNAL_REVIEW_ROLES as readonly string[]).includes(role)) return { ok: false, error: "Your role cannot review Copilot signals." };
  if (!agencyId || !staffId) return { ok: false, error: "Your account is not linked to an agency." };

  const parsed = signalVerdictRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That signal could not be found." };
  try {
    await recordSignalVerdict(createClient(await cookies()), { agencyId, signalId: parsed.data.signalId, verdict: parsed.data.verdict, reviewerId: staffId });
  } catch (cause) {
    console.error("reviewInboxSignalAction failed", cause);
    return { ok: false, error: cause instanceof Error && cause.message.includes("already judged") ? cause.message : "The verdict could not be saved. Please try again." };
  }
  revalidatePath("/management/settings/operations");
  return { ok: true };
}
