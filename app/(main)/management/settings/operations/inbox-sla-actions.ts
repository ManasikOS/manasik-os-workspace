"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { saveSlaPolicy } from "@/lib/data/inbox-sla-repository";
import { WEEKDAY_KEYS } from "@/lib/inbox/sla/business-hours";
import { formTextToWorkingHours } from "@/lib/inbox/sla/working-hours-form";
import { slaPolicyInputSchema } from "@/lib/inbox/sla/policies";
import { createClient } from "@/utils/supabase/server";
import { z } from "zod";

const workingHoursFormSchema = z.object({
  days: z.object(Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, z.string().max(200)]))),
  holidays: z.string().max(4000),
});

export interface InboxSlaActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Both actions start with `requireUser()`, check the Settings capability, validate at the boundary, and write through
 * the signed-in client so the table's own policy (ADMIN and CEO only) is the backstop. The agency comes from the session,
 * never from the request.
 */
async function actingStaff() {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  return { role, staffId, agencyId };
}

export async function saveInboxSlaPolicyAction(input: unknown): Promise<InboxSlaActionResult> {
  const { role, staffId, agencyId } = await actingStaff();
  if (!capabilitiesForSettings(role).editOperations) return { ok: false, error: "Your role cannot change reply targets." };
  if (!agencyId || !staffId) return { ok: false, error: "Your account is not linked to an agency." };

  const parsed = slaPolicyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reply targets." };
  }
  try {
    await saveSlaPolicy(createClient(await cookies()), agencyId, staffId, parsed.data);
  } catch (cause) {
    console.error("saveInboxSlaPolicyAction failed", cause);
    return { ok: false, error: "The reply targets could not be saved. Please try again." };
  }
  revalidatePath("/management/settings/operations");
  return { ok: true };
}

export async function saveInboxWorkingHoursAction(input: unknown): Promise<InboxSlaActionResult> {
  const { role, agencyId } = await actingStaff();
  if (!capabilitiesForSettings(role).editOperations) return { ok: false, error: "Your role cannot change working hours." };
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };

  const form = workingHoursFormSchema.safeParse(input);
  if (!form.success) return { ok: false, error: "The working hours were not in the expected format." };
  const result = formTextToWorkingHours(form.data as Parameters<typeof formTextToWorkingHours>[0]);
  if (!result.ok) return { ok: false, error: "Check the highlighted days.", fieldErrors: result.fieldErrors };

  const { error } = await createClient(await cookies())
    .from("ai_settings")
    .upsert({ agency_id: agencyId, working_hours: result.value }, { onConflict: "agency_id" });
  if (error) {
    console.error("saveInboxWorkingHoursAction failed", error.message);
    return { ok: false, error: "The working hours could not be saved. Please try again." };
  }
  revalidatePath("/management/settings/operations");
  return { ok: true };
}
