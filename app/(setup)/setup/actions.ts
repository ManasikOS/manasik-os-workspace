"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updatePasswordAction } from "@/app/(auth)/actions";
import { updateOrganisationSettingsAction } from "@/app/(main)/management/settings/actions";
import { addApprovedPaymentAccountAction } from "@/app/(main)/management/settings/finance/payment-accounts-actions";
import { inviteTeamMemberAction } from "@/app/(main)/management/team/actions";
import { requireUser } from "@/lib/dal";
import { mergeBasicsIntoOrganisationSettings } from "@/lib/setup/locale-detection";
import { loadBasicsStepData, loadPrimaryBranchId, loadSeatCapacity } from "@/lib/setup/setup-essentials-data";
import { loadSetupProgress, readStoredSetupSteps } from "@/lib/setup/setup-progress";
import { requireSetupAdmin } from "@/lib/setup/setup-guard";
import { recordOnboardingEvent } from "@/lib/setup/setup-events-server";
import { withSetupStepSkipped } from "@/lib/setup/setup-steps";
import { agencyBasicsSchema, setupPasswordSchema, setupStepSkipSchema, setupTeamInviteSchema } from "@/lib/validations/setup";
import { createClient } from "@/utils/supabase/server";

/**
 * "Do this later". Records the skip (never a warning, never a confirmation),
 * then moves on to the next open step, or to the finish screen when none is left.
 */
export async function markSetupStepSkippedAction(formData: FormData): Promise<void> {
  await requireUser();
  const { agencyId } = await requireSetupAdmin();

  const parsed = setupStepSkipSchema.safeParse({ stepId: formData.get("stepId") });
  if (!parsed.success) redirect("/setup");

  const { stepId } = parsed.data;
  const supabase = createClient(await cookies());
  const steps = withSetupStepSkipped(await readStoredSetupSteps(), stepId);

  const { error } = await supabase
    .from("agency_onboarding_state")
    .upsert({ agency_id: agencyId, steps, last_step: stepId }, { onConflict: "agency_id" });

  if (error) {
    console.error("[setup] markSetupStepSkippedAction failed", { message: error.message });
    redirect(`/setup?step=${stepId}&notice=save_failed`);
  }

  revalidatePath("/setup");
  revalidatePath("/dashboard");
  await recordOnboardingEvent({ agencyId, event: "STEP_SKIPPED", step: stepId });

  const { nextOpenStepId } = await loadSetupProgress();
  redirect(`/setup?step=${nextOpenStepId && nextOpenStepId !== stepId ? nextOpenStepId : "finish"}`);
}

/** Hides the dashboard's setup card. The guide stays reachable from Settings. */
export async function dismissSetupGuideAction(): Promise<void> {
  await requireUser();
  const { agencyId } = await requireSetupAdmin();

  const supabase = createClient(await cookies());
  const { error } = await supabase
    .from("agency_onboarding_state")
    .upsert({ agency_id: agencyId, guide_dismissed_at: new Date().toISOString() }, { onConflict: "agency_id" });

  if (error) {
    console.error("[setup] dismissSetupGuideAction failed", { message: error.message });
    return;
  }

  revalidatePath("/dashboard");
}

/* ── Essentials steps (docs/onboarding/plan.md §12 Slice 5) ────────────────────
 * Each of these delegates to the action the normal Settings/Team screen already
 * uses, so the same validation, access checks and audit trail apply and the
 * values appear in those screens. They add only what setup needs on top: the
 * administrator gate, the "confirmed" markers, and the seat guard. */

export type SetupActionResult = { ok: true; message?: string } | { ok: false; error: string; expiredLink?: boolean };

async function markSetupFact(agencyId: string, fact: "password_set_at" | "basics_confirmed_at"): Promise<boolean> {
  const supabase = createClient(await cookies());
  const { error } = await supabase
    .from("agency_onboarding_state")
    .upsert({ agency_id: agencyId, [fact]: new Date().toISOString() }, { onConflict: "agency_id" });
  if (error) console.error("[setup] markSetupFact failed", { fact, message: error.message });
  return !error;
}

function refreshSetupViews() {
  revalidatePath("/setup");
  revalidatePath("/dashboard");
}

/** Step 1. Same rules as the reset-password screen, including the 15-minute window after the email link. */
export async function setAccountPasswordAction(input: unknown): Promise<SetupActionResult> {
  await requireUser();
  const { agencyId } = await requireSetupAdmin();

  const parsed = setupPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the password and try again." };

  const result = await updatePasswordAction(parsed.data);
  if (result.status !== "success") {
    const expired = /expired/i.test(result.message ?? "");
    return {
      ok: false,
      error: expired
        ? "For your security, you can only set a password soon after opening your email link. Send yourself a fresh link to continue."
        : (result.message ?? "We couldn't set your password."),
      expiredLink: expired,
    };
  }

  if (!(await markSetupFact(agencyId, "password_set_at"))) {
    return { ok: false, error: "Your password was changed, but we couldn't record it. Please refresh the page." };
  }
  refreshSetupViews();
  await recordOnboardingEvent({ agencyId, event: "STEP_COMPLETED", step: "account" });
  return { ok: true, message: "Your password is set." };
}

/** Step 2. Confirms country, currency, timezone and language by writing them through the Organisation settings action. */
export async function confirmAgencyBasicsAction(input: unknown): Promise<SetupActionResult> {
  await requireUser();
  const { agencyId } = await requireSetupAdmin();

  const parsed = agencyBasicsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the highlighted details." };

  const { settings } = await loadBasicsStepData();
  const saved = await updateOrganisationSettingsAction(mergeBasicsIntoOrganisationSettings(settings, parsed.data));
  if (!saved.ok) return { ok: false, error: saved.error ?? "We couldn't save your agency details." };

  if (!(await markSetupFact(agencyId, "basics_confirmed_at"))) {
    return { ok: false, error: "Your details were saved, but we couldn't record it. Please refresh the page." };
  }
  refreshSetupViews();
  await recordOnboardingEvent({ agencyId, event: "STEP_COMPLETED", step: "agency" });
  return { ok: true, message: "Your agency details are saved." };
}

/** Step 3. Invites one teammate by email at head office, refusing when the plan's seats are all taken. */
export async function inviteSetupTeamMemberAction(input: unknown): Promise<SetupActionResult> {
  await requireUser();
  const { agencyId } = await requireSetupAdmin();

  const parsed = setupTeamInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };

  const capacity = await loadSeatCapacity();
  if (capacity.atLimit) {
    return { ok: false, error: "All of your plan's team seats are in use. Upgrade your plan or remove someone to invite more people." };
  }

  const branchId = await loadPrimaryBranchId();
  if (!branchId) return { ok: false, error: "We couldn't find your head-office branch. Add a branch in Settings first." };

  const result = await inviteTeamMemberAction({
    ...parsed.data,
    branchId,
    employmentType: "PERMANENT",
    sendVia: ["EMAIL"],
  });
  if (!result.ok) return { ok: false, error: result.error ?? "We couldn't send that invitation." };

  refreshSetupViews();
  await recordOnboardingEvent({ agencyId, event: "STEP_COMPLETED", step: "team" });
  return { ok: true, message: `Invitation sent to ${parsed.data.email}.` };
}

/** Step 5. Adds one approved bank account through the Finance settings action. */
export async function addSetupPaymentAccountAction(input: unknown): Promise<SetupActionResult> {
  await requireUser();
  const { agencyId } = await requireSetupAdmin();

  const result = await addApprovedPaymentAccountAction(input);
  if (!result.ok) return { ok: false, error: result.error ?? "We couldn't add that account." };

  refreshSetupViews();
  await recordOnboardingEvent({ agencyId, event: "STEP_COMPLETED", step: "payments" });
  return { ok: true, message: "Bank account added." };
}
