"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createStaffAvailability, deleteStaffAvailability, saveRoutingPolicy } from "@/lib/data/inbox-routing-repository";
import { staffAvailabilityInputSchema } from "@/lib/inbox/routing/availability";
import { routingPolicyInputSchema } from "@/lib/inbox/routing/policy";
import { createClient } from "@/utils/supabase/server";

export interface InboxRoutingActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Starts with `requireUser()`, checks the Settings capability, validates at the boundary, and writes through the signed-in
 * client so the table's own policy (ADMIN and CEO only) is the backstop. The agency comes from the session, never the request.
 * Saving creates the agency's routing policy: that is what turns automatic assignment on.
 */
export async function saveInboxRoutingPolicyAction(input: unknown): Promise<InboxRoutingActionResult> {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editOperations) return { ok: false, error: "Your role cannot change how conversations are assigned." };
  if (!agencyId || !staffId) return { ok: false, error: "Your account is not linked to an agency." };

  const parsed = routingPolicyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the assignment settings." };
  try {
    await saveRoutingPolicy(createClient(await cookies()), agencyId, staffId, parsed.data);
  } catch (cause) {
    console.error("saveInboxRoutingPolicyAction failed", cause);
    return { ok: false, error: "The assignment settings could not be saved. Please try again." };
  }
  revalidatePath("/management/settings/operations");
  return { ok: true };
}

export async function createInboxStaffAvailabilityAction(input: unknown): Promise<InboxRoutingActionResult> {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editOperations) return { ok: false, error: "Your role cannot set staff availability." };
  if (!agencyId || !staffId) return { ok: false, error: "Your account is not linked to an agency." };
  const parsed = staffAvailabilityInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the availability times." };
  try {
    await createStaffAvailability(createClient(await cookies()), agencyId, staffId, parsed.data);
  } catch (cause) {
    console.error("createInboxStaffAvailabilityAction failed", cause);
    return { ok: false, error: "The availability could not be saved. Please try again." };
  }
  revalidatePath("/management/settings/operations");
  return { ok: true };
}

export async function removeInboxStaffAvailabilityAction(input: unknown): Promise<InboxRoutingActionResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editOperations) return { ok: false, error: "Your role cannot change staff availability." };
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  const parsed = z.string().uuid().safeParse(input);
  if (!parsed.success) return { ok: false, error: "That availability entry is invalid." };
  try {
    await deleteStaffAvailability(createClient(await cookies()), agencyId, parsed.data);
  } catch (cause) {
    console.error("removeInboxStaffAvailabilityAction failed", cause);
    return { ok: false, error: "The availability could not be removed. Please try again." };
  }
  revalidatePath("/management/settings/operations");
  return { ok: true };
}
