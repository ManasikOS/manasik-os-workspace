/**
 * Every label, threshold and taxonomy the Finance module uses, in one file —
 * same convention as `suppliers-copy.ts` / `operations-copy.ts`. Nothing
 * else in the module hardcodes one of these values.
 */

export const DUE_SOON_WINDOW_DAYS = 7;
export const SUPPLIER_PAYABLE_WINDOW_DAYS = 14;
export const PRIORITY_QUEUE_CAP = 8;
export const OVERVIEW_GROUP_HEALTH_CAP = 6;
export const MAX_AI_SUGGESTIONS = 5;

/**
 * No monthly collection target exists anywhere in the schema (plan D3). The
 * Overview KPI reports "% of expected revenue" instead of "% of target"
 * until a targets table lands — this constant documents the gap rather than
 * inventing a number.
 */
export const COLLECTION_TARGET_SOURCE = "NOT_CONFIGURED" as const;

export const RECEIVABLE_STATUS_LABELS: Record<string, string> = {
  CANCELLED: "Cancelled",
  REFUND_PENDING: "Refund Pending",
  PAID_IN_FULL: "Paid in Full",
  OVERDUE: "Overdue",
  DUE_SOON: "Due Soon",
  DEPOSIT_PENDING: "Deposit Pending",
  PARTIALLY_PAID: "Partially Paid",
  ON_TRACK: "On Track",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  ONLINE: "Online Payment",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const PAYMENT_RECORD_STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completed",
  PENDING_VERIFICATION: "Pending Verification",
  FAILED: "Failed",
  REVERSED: "Reversed",
  REFUNDED: "Refunded",
  VOIDED: "Voided",
};

export const MILESTONE_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "Booking Deposit",
  INSTALMENT: "Instalment",
  FINAL_BALANCE: "Final Balance",
  ADJUSTMENT: "Adjustment",
  OTHER: "Other",
};

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  BOOKING: "Booking Invoice",
  DEPOSIT: "Deposit Invoice",
  INSTALMENT: "Instalment Invoice",
  FINAL_BALANCE: "Final Balance Invoice",
  ADJUSTMENT: "Adjustment Invoice",
  REFUND_CREDIT_NOTE: "Refund Credit Note",
  SUPPLIER: "Supplier Invoice",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const INVOICE_SENT_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  PORTAL: "Portal",
  MANUAL: "Marked Sent",
};

export const REFUND_REASON_LABELS: Record<string, string> = {
  CANCELLATION: "Cancellation",
  OVERPAYMENT: "Overpayment",
  PACKAGE_CHANGE: "Package Change",
  OTHER: "Other",
};

export const REFUND_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  DISCOUNT: "Discount",
  ROOM_UPGRADE_CHARGE: "Room Upgrade Charge",
  GROUP_TRANSFER: "Group Transfer Adjustment",
  PARTIAL_REFUND: "Partial Refund",
  CANCELLATION_FEE: "Cancellation Fee",
  PRICE_CORRECTION: "Price Correction",
  MANUAL_CREDIT: "Manual Credit",
};

export const SUPPLIER_PAYABLE_STATUS_LABELS: Record<string, string> = {
  NOT_DUE: "Not Due",
  DUE_SOON: "Due Soon",
  OVERDUE: "Overdue",
  PARTIALLY_PAID: "Partially Paid",
  PAID: "Paid",
  DISPUTED: "Disputed",
  CANCELLED: "Cancelled",
};

export const FINANCE_SAVED_VIEWS = [
  "All Receivables",
  "Due Today",
  "Overdue",
  "Deposit Pending",
  "Final Balance Due",
  "Departing in 14 Days",
  "My Collection Queue",
  "Paid in Full",
  "Cancelled Bookings",
] as const;

export type FinanceSavedView = (typeof FINANCE_SAVED_VIEWS)[number];

export const PAYMENT_LEDGER_SAVED_VIEWS = [
  "All",
  "Today",
  "This Month",
  "Pending Verification",
  "Unallocated",
  "Reversed & Voided",
] as const;

export type PaymentLedgerSavedView = (typeof PAYMENT_LEDGER_SAVED_VIEWS)[number];
