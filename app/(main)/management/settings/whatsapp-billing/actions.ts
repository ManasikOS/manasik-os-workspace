"use server";

/**
 * WhatsApp billing budget editing — §5 E10 layer 3 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md. Alerting only;
 * the opt-in marketing-send block lives on the send path, never here.
 */

import { revalidatePath } from "next/cache";

import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { requireUser } from "@/lib/dal";
import { upsertBillingBudget } from "@/lib/data/whatsapp-billing-repository";
import { createAdminClient } from "@/utils/supabase/admin";

export type BudgetActionResult = { ok: true } | { ok: false; error: string };

export async function saveBillingBudget(input: {
  monthlyBudget: number | null;
  currency: string;
  blockMarketingAt100: boolean;
}): Promise<BudgetActionResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForSettings(role).editFinance) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency resolved for your account." };

  try {
    const admin = createAdminClient();
    await upsertBillingBudget(admin, agencyId, {
      monthly_budget: input.monthlyBudget,
      currency: input.currency,
      block_marketing_at_100: input.blockMarketingAt100,
    });
    revalidatePath("/management/settings/whatsapp-billing");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to save the budget." };
  }
}
