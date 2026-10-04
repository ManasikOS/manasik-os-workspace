import type { FinanceTabId } from "@/lib/access/finance-access";
import type { FinanceExceptionProjection } from "@/lib/finance/finance-exception-projection";
import type { DepartureFinancialSafetyResult } from "@/lib/finance/departure-financial-safety";
import type { GroupProfitabilityRow } from "@/lib/data/profitability-repository";
import type {
  FinanceInvoiceRow,
  FinanceMilestoneRow,
  FinancePaymentRow,
  FinanceReceivableRow,
  FinanceRefundRequestRow,
  FinanceSupplierPayableRow,
} from "@/lib/types/finance";

export { FINANCE_TAB_IDS, type FinanceTabId } from "@/lib/access/finance-access";
export type { FinanceCapabilities } from "@/lib/access/finance-access";

/** The full page payload — one Server Component read, per the house pattern. */
export interface FinanceSnapshot {
  receivables: FinanceReceivableRow[];
  payments: FinancePaymentRow[];
  paymentPlanMilestones: FinanceMilestoneRow[];
  invoices: FinanceInvoiceRow[];
  supplierPayables: FinanceSupplierPayableRow[];
  departureProfitability: GroupProfitabilityRow[];
  departureFinancialSafety: DepartureFinancialSafetyResult[];
  refundRequests: FinanceRefundRequestRow[];
  exceptions: FinanceExceptionProjection;
  refundsPendingCount: number;
  refundsPendingAmount: number;
  nowIso: string;
}

export interface OwingBookingOption {
  id: string;
  bookingReference: string;
  primaryContactName: string;
  outstandingBalance: number;
  departureGroupId: string;
}

export interface RefundableBookingOption {
  id: string;
  bookingReference: string;
  primaryContactName: string;
  amountPaid: number;
  departureGroupId: string;
}

export const DEFAULT_FINANCE_TAB: FinanceTabId = "overview";
