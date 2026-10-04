"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { addApprovedPaymentAccount, approvedPaymentAccountInputSchema, setApprovedPaymentAccountActive } from "@/lib/data/agency-payment-accounts-repository";
import { createClient } from "@/utils/supabase/server";

export interface PaymentAccountActionResult {
  ok: boolean;
  error?: string;
}

const accountToggleSchema = z.object({ accountId: z.string().uuid(), active: z.boolean() });

async function financeEditor() {
  await requireUser();
  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editFinance) return { error: "Only Finance and admins can change the approved bank accounts." } as const;
  if (!agencyId || !staffId) return { error: "Your account is not linked to an agency." } as const;
  return { agencyId, staffId } as const;
}

/** `requireUser()`, the Finance capability, Zod at the boundary; the agency comes from the session and the table's policy is the backstop. */
export async function addApprovedPaymentAccountAction(input: unknown): Promise<PaymentAccountActionResult> {
  const who = await financeEditor();
  if ("error" in who) return { ok: false, error: who.error };
  const parsed = approvedPaymentAccountInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the account details." };
  try {
    await addApprovedPaymentAccount(createClient(await cookies()), who.agencyId, who.staffId, parsed.data);
  } catch (cause) {
    console.error("addApprovedPaymentAccountAction failed", cause);
    return { ok: false, error: cause instanceof Error && cause.message.includes("already on the list") ? cause.message : "The account could not be added. Please try again." };
  }
  revalidatePath("/management/settings/finance");
  return { ok: true };
}

export async function setApprovedPaymentAccountActiveAction(input: unknown): Promise<PaymentAccountActionResult> {
  const who = await financeEditor();
  if ("error" in who) return { ok: false, error: who.error };
  const parsed = accountToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That account could not be found." };
  try {
    await setApprovedPaymentAccountActive(createClient(await cookies()), who.agencyId, parsed.data.accountId, parsed.data.active);
  } catch (cause) {
    console.error("setApprovedPaymentAccountActiveAction failed", cause);
    return { ok: false, error: "The account could not be updated. Please try again." };
  }
  revalidatePath("/management/settings/finance");
  return { ok: true };
}
