import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for Payments & Invoices.
 *
 * Same posture as `suppliers-access.ts`: pure functions over a role string,
 * usable from Server and Client Components. Capabilities decide what is
 * *fetched*, not merely what is rendered — `finance-repository.ts` nulls out
 * amounts, costs and internal notes for roles without the matching
 * capability before a row ever reaches a Client Component.
 */

export interface FinanceCapabilities {
  viewModule: boolean;

  viewReceivables: boolean;
  viewLedger: boolean;
  viewInvoices: boolean;
  viewSupplierPayables: boolean;
  viewRefunds: boolean;
  viewReconciliation: boolean;
  /** Import bank statement lines and confirm/undo a match against a payment or supplier payment. */
  manageReconciliation: boolean;

  recordPayments: boolean;
  verifyPayments: boolean;
  reversePayments: boolean;

  createInvoices: boolean;
  sendInvoices: boolean;
  voidInvoices: boolean;

  recordSupplierPayments: boolean;

  requestRefunds: boolean;
  approveRefunds: boolean;
  applyAdjustments: boolean;
  approveAdjustments: boolean;

  changeMilestoneDueDates: boolean;
  assignFinanceOwner: boolean;
  sendReminders: boolean;
  exportFinanceReport: boolean;

  /** Deposit / paid-in-full only — no amounts, no ledger, no supplier costs. */
  viewPaymentStatusOnly: boolean;
  /** CEO: every figure, no writes anywhere. */
  readOnly: boolean;
}

const NONE: FinanceCapabilities = {
  viewModule: false,
  viewReceivables: false,
  viewLedger: false,
  viewInvoices: false,
  viewSupplierPayables: false,
  viewRefunds: false,
  viewReconciliation: false,
  manageReconciliation: false,
  recordPayments: false,
  verifyPayments: false,
  reversePayments: false,
  createInvoices: false,
  sendInvoices: false,
  voidInvoices: false,
  recordSupplierPayments: false,
  requestRefunds: false,
  approveRefunds: false,
  applyAdjustments: false,
  approveAdjustments: false,
  changeMilestoneDueDates: false,
  assignFinanceOwner: false,
  sendReminders: false,
  exportFinanceReport: false,
  viewPaymentStatusOnly: false,
  readOnly: false,
};

const FULL_FINANCE: FinanceCapabilities = {
  ...NONE,
  viewModule: true,
  viewReceivables: true,
  viewLedger: true,
  viewInvoices: true,
  viewSupplierPayables: true,
  viewRefunds: true,
  viewReconciliation: true,
  manageReconciliation: true,
  recordPayments: true,
  verifyPayments: true,
  reversePayments: true,
  createInvoices: true,
  sendInvoices: true,
  voidInvoices: true,
  recordSupplierPayments: true,
  requestRefunds: true,
  applyAdjustments: true,
  changeMilestoneDueDates: true,
  assignFinanceOwner: true,
  sendReminders: true,
  exportFinanceReport: true,
};

const CAPABILITIES: Record<StaffRole, FinanceCapabilities> = {
  // Everything, including refund/adjustment approval — there is no
  // FINANCE_MANAGER role yet (plan D4).
  ADMIN: { ...FULL_FINANCE, approveRefunds: true, approveAdjustments: true },
  // Full collection, invoice, refund-request and supplier-payable access.
  // Cannot self-approve a refund or adjustment — that needs Admin until a
  // Finance Manager role exists (plan D4).
  FINANCE: { ...FULL_FINANCE, approveRefunds: false, approveAdjustments: false },
  // Full visibility including supplier costs and margins, no writes anywhere.
  CEO: {
    ...NONE,
    viewModule: true,
    viewReceivables: true,
    viewLedger: true,
    viewInvoices: true,
    viewSupplierPayables: true,
    viewRefunds: true,
    viewReconciliation: true,
    exportFinanceReport: true,
    readOnly: true,
  },
  // Payment readiness and blockers only — no ledger, no amounts, no supplier
  // costs. The spec's "views payment readiness/blockers only" row.
  OPERATIONS: { ...NONE, viewModule: true, viewReceivables: true, viewPaymentStatusOnly: true },
  // Basic deposit/payment status for their own bookings only. See plan D9 —
  // this renders a near-empty page; flagged rather than turned off, per spec.
  MARKETING: { ...NONE, viewModule: true, viewReceivables: true, viewPaymentStatusOnly: true },
  // The spec's "configured payment threshold status" lives on the Visa
  // screen itself, not a Finance page.
  VISA: { ...NONE },
  GUIDE: { ...NONE },
};

export function capabilitiesForFinance(role: StaffRole): FinanceCapabilities {
  return CAPABILITIES[role];
}

export const FINANCE_TAB_IDS = [
  "overview",
  "receivables",
  "payments",
  "invoices",
  "supplier-payables",
  "refunds",
  "reconciliation",
] as const;

export type FinanceTabId = (typeof FINANCE_TAB_IDS)[number];

/** Hides whole tabs a role may not see at all. */
export function visibleFinanceTabs(role: StaffRole): FinanceTabId[] {
  const can = capabilitiesForFinance(role);
  const tabs: FinanceTabId[] = [];

  if (can.viewModule) tabs.push("overview");
  if (can.viewReceivables) tabs.push("receivables");
  if (can.viewLedger) tabs.push("payments");
  if (can.viewInvoices) tabs.push("invoices");
  if (can.viewSupplierPayables) tabs.push("supplier-payables");
  if (can.viewRefunds) tabs.push("refunds");
  if (can.viewReconciliation) tabs.push("reconciliation");

  return tabs;
}
