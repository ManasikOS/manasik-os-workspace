"use server";

import { cookies } from "next/headers";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadBookingPack } from "@/lib/agent/kernel/proposals/booking-pack";
import { explainCollectionRisk } from "@/lib/ai/surfaces/finance/payment-plan-workflows";
import { createClient } from "@/utils/supabase/server";

export interface ExplainCollectionRiskActionResult {
  ok: boolean;
  explanation?: string;
  suggestedAction?: string;
  source?: string;
  note?: string;
  error?: string;
}

export async function explainCollectionRiskAction(bookingId: string): Promise<ExplainCollectionRiskActionResult> {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForFinance(role);
  if (!can.viewModule || !can.viewReceivables) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency on this account." };

  const supabase = createClient(await cookies());
  const pack = await loadBookingPack(bookingId, agencyId, supabase);
  if (!pack) return { ok: false, error: "That booking no longer exists." };

  const result = await explainCollectionRisk(pack, agencyId, supabase);
  if (!result.value) return { ok: false, error: result.note ?? "Could not generate an explanation.", source: result.source };

  return { ok: true, explanation: result.value.explanation, suggestedAction: result.value.suggestedAction, source: result.source };
}
