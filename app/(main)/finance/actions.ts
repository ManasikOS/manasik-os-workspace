"use server";

/**
 * Finance Overview's one Server Action — generates the AI cash-risk
 * briefing on demand (a button click, like the AI Insights page's
 * "Refresh insights"), never automatically on every page load. Class 0
 * only: this reads and narrates, it writes nothing.
 */

import { cookies } from "next/headers";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  loadFinanceInvoices,
  loadFinancePayments,
  loadFinanceReceivables,
  loadFinanceSupplierPayables,
  loadRefundRequests,
} from "@/lib/data/finance-repository";
import { listGroupProfitability } from "@/lib/data/profitability-repository";
import { buildFinancePeriodPack } from "@/lib/ai/surfaces/finance/pack";
import { cashRiskBriefing } from "@/lib/ai/surfaces/finance/workflows";
import { createClient } from "@/utils/supabase/server";

export interface CashRiskBriefingActionResult {
  ok: boolean;
  summary?: string;
  risks?: string[];
  source?: "RULES" | "LLM";
  note?: string | null;
  error?: string;
}

export async function generateCashRiskBriefingAction(): Promise<CashRiskBriefingActionResult> {
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "No active agency for your account." };

  const can = capabilitiesForFinance(role);
  if (!can.viewModule || !can.viewLedger) {
    return { ok: false, error: "Your role cannot view the finance ledger." };
  }

  const supabase = createClient(await cookies());
  const [receivables, payments, invoices, supplierPayables, refundRequests, groupProfitability] = await Promise.all([
    can.viewReceivables ? loadFinanceReceivables(supabase, can) : Promise.resolve([]),
    can.viewLedger ? loadFinancePayments(supabase) : Promise.resolve([]),
    can.viewInvoices ? loadFinanceInvoices(supabase) : Promise.resolve([]),
    can.viewSupplierPayables ? loadFinanceSupplierPayables(supabase, can) : Promise.resolve([]),
    can.viewRefunds ? loadRefundRequests(supabase) : Promise.resolve([]),
    can.viewSupplierPayables ? listGroupProfitability(supabase) : Promise.resolve([]),
  ]);

  const pack = buildFinancePeriodPack(agencyId, {
    receivables,
    payments,
    invoices,
    supplierPayables,
    refundRequests,
    groupProfitability,
    nowIso: new Date().toISOString(),
  });

  const result = await cashRiskBriefing(pack, supabase);
  if (!result.value) {
    return { ok: false, source: result.source, note: result.note, error: result.note ?? "No briefing available." };
  }

  return { ok: true, summary: result.value.summary, risks: result.value.risks, source: result.source, note: result.note };
}
