import { cookies } from "next/headers";

import { capabilitiesForFinance, type FinanceCapabilities } from "@/lib/access/finance-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listGroupProfitability } from "@/lib/data/profitability-repository";
import {
  loadFinanceInvoices,
  loadFinancePayments,
  loadPaymentPlanMilestones,
  loadFinanceReceivables,
  loadFinanceSupplierPayables,
  loadOwingBookingOptions,
  loadRefundableBookingOptions,
  loadRefundRequests,
  loadRefundsPendingSummary,
} from "@/lib/data/finance-repository";
import { createClient } from "@/utils/supabase/server";
import { buildFinanceExceptionProjection } from "@/lib/finance/finance-exception-projection";
import { computeDepartureFinancialSafety } from "@/lib/finance/departure-financial-safety";

import type { FinanceSnapshot, OwingBookingOption, RefundableBookingOption } from "./types";

export interface LoadedFinanceSnapshot {
  role: StaffRole;
  can: FinanceCapabilities;
  currentStaffName: string | null;
  snapshot: FinanceSnapshot;
  owingBookings: OwingBookingOption[];
  refundableBookings: RefundableBookingOption[];
}

/**
 * The full Finance workspace load — extracted from `/finance/payments`'s
 * own `page.tsx` (Phase 1, P1.1 of
 * docs/modules/manasik-intelligence-build-roadmap.md) so every dedicated route
 * (`/finance/invoices`, `/finance/payables`, `/finance/reconciliation`,
 * `/finance/refunds-credits`) can render the same `FinanceWorkspace`
 * component, deep-linked to its own tab via `initialTab`, without
 * duplicating this loader five times. Every one of these routes still
 * loads the *same* capability-gated snapshot `/finance/payments` always
 * has — a dedicated route only changes which tab is active and what URL
 * it lives at, never what data is fetched.
 */
export async function loadFinanceSnapshot(): Promise<LoadedFinanceSnapshot | null> {
  const { role, name, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForFinance(role);
  if (!can.viewModule) return null;
  void agencyId;

  const supabase = createClient(await cookies());
  const [
    receivables,
    payments,
    paymentPlanMilestones,
    invoices,
    supplierPayables,
    departureProfitability,
    refunds,
    refundRequests,
    owingBookings,
    refundableBookings,
  ] =
    await Promise.all([
      can.viewReceivables ? loadFinanceReceivables(supabase, can) : Promise.resolve([]),
      can.viewLedger ? loadFinancePayments(supabase) : Promise.resolve([]),
      can.viewReceivables ? loadPaymentPlanMilestones(supabase, can) : Promise.resolve([]),
      can.viewInvoices ? loadFinanceInvoices(supabase) : Promise.resolve([]),
      can.viewSupplierPayables ? loadFinanceSupplierPayables(supabase, can) : Promise.resolve([]),
      can.viewSupplierPayables ? listGroupProfitability(supabase) : Promise.resolve([]),
      can.viewRefunds ? loadRefundsPendingSummary(supabase) : Promise.resolve({ count: 0, amount: 0 }),
      can.viewRefunds ? loadRefundRequests(supabase) : Promise.resolve([]),
      can.recordPayments ? loadOwingBookingOptions(supabase) : Promise.resolve([]),
      can.requestRefunds ? loadRefundableBookingOptions(supabase) : Promise.resolve([]),
    ]);

  const nowIso = new Date().toISOString();
  const exceptions = buildFinanceExceptionProjection({
    receivables,
    supplierPayables,
    refundRequests,
    nowIso,
    includeAmounts: !can.viewPaymentStatusOnly,
  });
  const departureFinancialSafety = can.viewSupplierPayables
    ? computeDepartureFinancialSafety({
        groups: departureProfitability,
        receivables,
        supplierPayables,
      })
    : [];

  return {
    role,
    can,
    currentStaffName: name,
    snapshot: {
      receivables,
      payments,
      paymentPlanMilestones,
      invoices,
      supplierPayables,
      departureProfitability,
      departureFinancialSafety,
      refundRequests,
      exceptions,
      refundsPendingCount: refunds.count,
      refundsPendingAmount: refunds.amount,
      nowIso,
    },
    owingBookings: owingBookings.map((b) => ({
      id: b.id,
      bookingReference: b.booking_reference,
      primaryContactName: b.primary_contact_name,
      outstandingBalance: b.outstanding_balance,
      departureGroupId: b.departure_group_id,
    })),
    refundableBookings: refundableBookings.map((b) => ({
      id: b.id,
      bookingReference: b.booking_reference,
      primaryContactName: b.primary_contact_name,
      amountPaid: b.amount_paid,
      departureGroupId: b.departure_group_id,
    })),
  };
}
