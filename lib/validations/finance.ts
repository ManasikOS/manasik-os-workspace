import { z } from "zod";

/**
 * Zod schemas for every Finance Server Action input. Mirrors
 * `lib/validations/suppliers.ts` / `lib/validations/pilgrims.ts`.
 */

const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "ONLINE", "CHEQUE", "OTHER"] as const;
const INVOICE_TYPES = [
  "BOOKING",
  "DEPOSIT",
  "INSTALMENT",
  "FINAL_BALANCE",
  "ADJUSTMENT",
  "REFUND_CREDIT_NOTE",
  "SUPPLIER",
] as const;
const SENT_CHANNELS = ["WHATSAPP", "EMAIL", "PORTAL", "MANUAL"] as const;
const REFUND_REASONS = ["CANCELLATION", "OVERPAYMENT", "PACKAGE_CHANGE", "OTHER"] as const;
const ADJUSTMENT_TYPES = [
  "DISCOUNT",
  "ROOM_UPGRADE_CHARGE",
  "GROUP_TRANSFER",
  "PARTIAL_REFUND",
  "CANCELLATION_FEE",
  "PRICE_CORRECTION",
  "MANUAL_CREDIT",
] as const;

const allocationSchema = z.object({
  milestoneId: z.string().uuid(),
  amount: z.number().positive("Enter an amount greater than zero."),
});

export const recordPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  amount: z.number().positive("Enter a payment amount greater than zero."),
  paidAt: z.string().min(1, "Choose the payment date."),
  method: z.enum(PAYMENT_METHODS),
  referenceNumber: z.string().trim().max(120).optional(),
  proofPath: z.string().trim().max(500).optional(),
  allocations: z.array(allocationSchema).default([]),
  internalNote: z.string().trim().max(1000).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const verifyPaymentSchema = z.object({
  paymentId: z.string().uuid(),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const matchFinanceEvidenceSchema = z
  .object({ evidenceId: z.string().uuid(), paymentId: z.string().uuid() })
  .strict();

export const dismissFinanceEvidenceSchema = z
  .object({
    evidenceId: z.string().uuid(),
    reason: z.string().trim().min(1, "Enter a reason before dismissing this receipt.").max(500, "Keep the reason under 500 characters."),
  })
  .strict();

export const reversePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reversal reason is required."),
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

export const createInvoiceSchema = z.object({
  bookingId: z.string().uuid().optional(),
  supplierCommitmentId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  invoiceType: z.enum(INVOICE_TYPES),
  amount: z.number().nonnegative(),
  currency: z.string().trim().default("LKR"),
  dueAt: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
  lineItems: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        quantity: z.number().positive().default(1),
        unitAmount: z.number(),
      }),
    )
    .default([]),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const sendInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  channel: z.enum(SENT_CHANNELS),
});
export type SendInvoiceInput = z.infer<typeof sendInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(1, "A void reason is required."),
  /** A second approver's name, for voids above whatever threshold an agency later configures (plan §4.13 gap 4) — optional today, no threshold workflow enforces it yet. */
  approvedBy: z.string().trim().min(1).optional(),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

export const changeMilestoneDueDateSchema = z.object({
  milestoneId: z.string().uuid(),
  dueAt: z.string().min(1, "Choose the new due date."),
  reason: z.string().trim().min(1, "A reason is required to change a due date."),
});
export type ChangeMilestoneDueDateInput = z.infer<typeof changeMilestoneDueDateSchema>;

export const refundRequestSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  reason: z.enum(REFUND_REASONS),
  reasonNote: z.string().trim().max(1000).optional(),
  amount: z.number().positive("Enter a refund amount greater than zero."),
});
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;

export const decideRefundSchema = z.object({
  refundRequestId: z.string().uuid(),
  approve: z.boolean(),
  decisionNote: z.string().trim().max(1000).optional(),
});
export type DecideRefundInput = z.infer<typeof decideRefundSchema>;

/** Pays out an already-approved refund request — the money actually leaving. */
export const payRefundSchema = z.object({
  refundRequestId: z.string().uuid(),
  method: z.enum(PAYMENT_METHODS),
  referenceNumber: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type PayRefundInput = z.infer<typeof payRefundSchema>;

export const adjustmentSchema = z.object({
  bookingId: z.string().uuid(),
  adjustmentType: z.enum(ADJUSTMENT_TYPES),
  amount: z.number().refine((v) => v !== 0, "Enter a non-zero amount."),
  reason: z.string().trim().min(1, "A reason is required."),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const assignFinanceOwnerSchema = z.object({
  bookingId: z.string().uuid(),
  financeOwnerName: z.string().trim().max(120).nullable(),
});
export type AssignFinanceOwnerInput = z.infer<typeof assignFinanceOwnerSchema>;

export const importBankTransactionsSchema = z.object({
  bankAccountLabel: z.string().trim().min(1).max(80).default("Main"),
  csv: z.string().trim().min(1, "Paste at least a header row and one line."),
});
export type ImportBankTransactionsInput = z.infer<typeof importBankTransactionsSchema>;

export const confirmReconciliationMatchSchema = z.object({
  bankTransactionId: z.string().uuid(),
  matchedType: z.enum(["PAYMENT", "SUPPLIER_PAYMENT"]),
  matchedId: z.string().uuid(),
  matchedAmount: z.number().positive(),
  matchedLabel: z.string().trim().min(1).max(200),
});
export type ConfirmReconciliationMatchInput = z.infer<typeof confirmReconciliationMatchSchema>;

export const bankTransactionIdSchema = z.object({
  bankTransactionId: z.string().uuid(),
});

export const confirmSplitMatchSchema = z.object({
  bankTransactionId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        targetType: z.enum(["PAYMENT", "SUPPLIER_PAYMENT"]),
        targetId: z.string().uuid(),
        amount: z.number().positive(),
        label: z.string().trim().min(1).max(200),
      }),
    )
    .min(1),
  residualAmount: z.number().optional(),
  residualType: z.enum(["UNALLOCATED_CREDIT", "BANK_CHARGE"]).optional(),
  residualReason: z.string().trim().max(300).optional(),
});
export type ConfirmSplitMatchInput = z.infer<typeof confirmSplitMatchSchema>;

export const createReconciliationPeriodSchema = z.object({
  bankAccountLabel: z.string().trim().min(1).max(80),
  periodFrom: z.string(),
  periodTo: z.string(),
  openingBalance: z.number(),
});
export type CreateReconciliationPeriodInput = z.infer<typeof createReconciliationPeriodSchema>;

export const closeReconciliationPeriodSchema = z.object({
  periodId: z.string().uuid(),
  closingBalance: z.number(),
  cashCounted: z.boolean(),
});
export type CloseReconciliationPeriodInput = z.infer<typeof closeReconciliationPeriodSchema>;

export function toFinanceFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
