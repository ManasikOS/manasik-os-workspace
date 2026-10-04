"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { capabilitiesForInsights } from "@/lib/access/insights-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { approveInboxAnswerSchema } from "@/lib/validations/inbox-answers";
import { createClient } from "@/utils/supabase/server";
import { answerCacheEligibility } from "@/lib/inbox/answers/eligibility";
import type { IntentCode } from "@/lib/inbox/intelligence/contracts";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { resolveInboxFeatureAvailability } from "@/lib/inbox/feature-availability";

export async function reviewInboxApprovedAnswerAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = approveInboxAnswerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the answer and try again." };
  const { role, roleId, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "No agency is selected." };
  const db = createClient(await cookies());
  const capabilities = await loadDynamicCapabilities(db, roleId, "insights", capabilitiesForInsights(role));
  if (!capabilities.approveInboxAnswer) return { ok: false, error: "Your role cannot approve repeated Inbox answers." };
  const availability = resolveInboxFeatureAvailability({ entitlements: await resolveEntitlements(db, agencyId), inboxQueuesV2: false });
  if (!availability.answerCache) return { ok: false, error: "Approved Inbox answers are not included in this plan." };
  const { data: candidate } = await db.from("conversation_answer_cache")
    .select("normalized_question, answer_text, intent_code, rejection_count, occurrence_count")
    .eq("id", parsed.data.answerId).eq("agency_id", agencyId).eq("status", "CANDIDATE").maybeSingle();
  if (!candidate) return { ok: false, error: "This candidate is no longer waiting for review." };
  if (parsed.data.decision === "APPROVE") {
    const eligibility = answerCacheEligibility({
      intentCode: candidate.intent_code as IntentCode,
      question: candidate.normalized_question as string,
      answer: candidate.answer_text as string,
    });
    if (!eligibility.eligible || Number(candidate.occurrence_count) < 3) {
      return { ok: false, error: "This answer is not eligible for approval." };
    }
  }
  const rejectionCount = Number(candidate.rejection_count ?? 0) + 1;
  const update = parsed.data.decision === "APPROVE"
    ? { status: "APPROVED", approved_by: user.id, retired_reason: null }
    : { status: rejectionCount >= 2 ? "RETIRED" : "CANDIDATE", rejection_count: rejectionCount, retired_reason: rejectionCount >= 2 ? parsed.data.reason : null, approved_by: null };
  const { data, error } = await db.from("conversation_answer_cache").update(update).eq("id", parsed.data.answerId).eq("agency_id", agencyId).eq("status", "CANDIDATE").select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "This candidate is no longer waiting for review." };
  revalidatePath("/management/ai-agent/knowledge");
  return { ok: true };
}
