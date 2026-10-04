/**
 * Hand-maintained row types for the Finance schema.
 *
 * Keep in sync with `supabase/migrations/20260818090000_finance_payments.sql`.
 * Same convention as `lib/types/suppliers.ts`: snake_case, exactly the shape
 * a `select *` (or, for the `*_rows` types, the matching view) returns.
 */

/* ── Enumerations ─────────────────────────────────────────────────────────── */

export type MilestoneType = "DEPOSIT" | "INSTALMENT" | "FINAL_BALANCE" | "ADJUSTMENT" | "OTHER";

export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "ONLINE" | "CHEQUE" | "OTHER";

export type PaymentRecordStatus =
  | "COMPLETED"
  | "PENDING_VERIFICATION"
  | "FAILED"
  | "REVERSED"
  | "REFUNDED"
  | "VOIDED";

export type InvoiceType =
  | "BOOKING"
  | "DEPOSIT"
  | "INSTALMENT"
  | "FINAL_BALANCE"
  | "ADJUSTMENT"
  | "REFUND_CREDIT_NOTE"
  | "SUPPLIER";

export type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | "VOID";

export type InvoiceSentChannel = "WHATSAPP" | "EMAIL" | "PORTAL" | "MANUAL";

export type RefundReason = "CANCELLATION" | "OVERPAYMENT" | "PACKAGE_CHANGE" | "OTHER";

export type RefundRequestStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";

export type AdjustmentType =
  | "DISCOUNT"
  | "ROOM_UPGRADE_CHARGE"
  | "GROUP_TRANSFER"
  | "PARTIAL_REFUND"
  | "CANCELLATION_FEE"
  | "PRICE_CORRECTION"
  | "MANUAL_CREDIT";

export type FinanceActivityAction =
  | "PAYMENT_RECORDED"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_REVERSED"
  | "PAYMENT_VOIDED"
  | "RECEIPT_ISSUED"
  | "INVOICE_CREATED"
  | "INVOICE_ISSUED"
  | "INVOICE_SENT"
  | "INVOICE_VOIDED"
  | "CREDIT_NOTE_CREATED"
  | "MILESTONE_DUE_DATE_CHANGED"
  | "ADJUSTMENT_APPLIED"
  | "ADJUSTMENT_APPROVED"
  | "REFUND_REQUESTED"
  | "REFUND_APPROVED"
  | "REFUND_REJECTED"
  | "REFUND_PAID"
  | "SUPPLIER_PAYMENT_RECORDED"
  | "REMINDER_SENT"
  | "FINANCE_OWNER_ASSIGNED"
  | "NOTE_ADDED";

/** Derived client-side (§4.4) — never a stored column. */
export type ReceivableStatus =
  | "CANCELLED"
  | "REFUND_PENDING"
  | "PAID_IN_FULL"
  | "OVERDUE"
  | "DUE_SOON"
  | "DEPOSIT_PENDING"
  | "PARTIALLY_PAID"
  | "ON_TRACK";

/** One milestone's status — the grain `/finance/payment-plans` filters by. */
export type PaymentPlanStatus =
  | "CANCELLED"
  | "COMPLETED"
  | "WAIVED"
  | "OVERDUE"
  | "DUE_TODAY"
  | "DUE_THIS_WEEK"
  | "UPCOMING"
  | "NO_DUE_DATE";

export type SupplierPayableStatus =
  | "NOT_DUE"
  | "DUE_SOON"
  | "OVERDUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "DISPUTED"
  | "CANCELLED";

/* ── Tables ───────────────────────────────────────────────────────────────── */

/** A. `booking_payment_milestones` — the schedule, at booking grain. */
export interface BookingPaymentMilestoneRow {
  id: string;
  booking_id: string;
  departure_group_id: string;
  sequence: number;
  label: string;
  milestone_type: MilestoneType;
  amount: number;
  due_at: string | null;
  paid_amount: number;
  paid_at: string | null;
  due_at_changed_at: string | null;
  due_at_previous: string | null;
  due_at_change_reason: string | null;
  waived: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** B. `payments` — the immutable ledger. */
export interface PaymentRow {
  id: string;
  payment_reference: string;
  booking_id: string;
  departure_group_id: string;
  amount: number;
  currency: string;
  paid_at: string;
  method: PaymentMethod;
  reference_number: string | null;
  proof_path: string | null;
  status: PaymentRecordStatus;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  reverses_payment_id: string | null;
  reversal_reason: string | null;
  receipt_number: string | null;
  receipt_issued_at: string | null;
  internal_note: string | null;
  recorded_by: string | null;
  recorded_by_name: string;
  created_at: string;
}

/** C. `payment_allocations` — which milestone(s) a payment settles. */
export interface PaymentAllocationRow {
  id: string;
  payment_id: string;
  milestone_id: string;
  amount: number;
  created_at: string;
}

/** D. `invoices`. Exactly one of booking_id / supplier_commitment_id is set. */
export interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_type: InvoiceType;
  booking_id: string | null;
  departure_group_id: string | null;
  supplier_commitment_id: string | null;
  milestone_id: string | null;
  party_name: string;
  party_contact: string | null;
  amount: number;
  currency: string;
  issued_at: string | null;
  due_at: string | null;
  status: InvoiceStatus;
  sent_channel: InvoiceSentChannel | null;
  sent_at: string | null;
  void_reason: string | null;
  voided_at: string | null;
  credit_note_of: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;

  /* Phase 1 (P1.6) — supabase/migrations/20261113090000_p1_6_invoices.sql */
  issued_snapshot: InvoiceIssuedSnapshot | null;
  viewed_at: string | null;
  void_approved_by: string | null;
}

export interface InvoiceIssuedSnapshot {
  partyName: string;
  partyContact: string | null;
  amount: number;
  currency: string;
  invoiceType: InvoiceType;
  dueAt: string | null;
  lineItems: { description: string; quantity: number; unit_amount: number; line_total: number }[];
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  sequence: number;
  description: string;
  quantity: number;
  unit_amount: number;
  line_total: number;
  created_at: string;
}

/** E. Refunds and adjustments — Phase 8. */
export interface RefundRequestRow {
  id: string;
  reference: string;
  booking_id: string;
  departure_group_id: string;
  reason: RefundReason;
  reason_note: string | null;
  amount: number;
  currency: string;
  policy_snapshot: string | null;
  status: RefundRequestStatus;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  payout_payment_id: string | null;
}

export interface FinanceAdjustmentRow {
  id: string;
  reference: string;
  booking_id: string;
  adjustment_type: AdjustmentType;
  amount: number;
  reason: string;
  balance_before: number;
  balance_after: number;
  created_by: string | null;
  created_by_name: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
}

/** F. `finance_activity_events` — append-only. */
export interface FinanceActivityEventRow {
  id: string;
  booking_id: string | null;
  departure_group_id: string | null;
  payment_id: string | null;
  invoice_id: string | null;
  supplier_commitment_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  action: FinanceActivityAction;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  is_high_impact: boolean;
  created_at: string;
}

/* ── Read views (section I) ──────────────────────────────────────────────── */

/** `finance_receivable_rows` — one row per live booking. */
export interface FinanceReceivableRow {
  booking_id: string;
  booking_reference: string;
  primary_contact_name: string;
  primary_contact_phone: string;
  traveller_count: number;
  booking_status: string;
  total_booking_value: number;
  amount_paid: number;
  outstanding_balance: number;
  next_due_at: string | null;
  finance_owner_name: string | null;
  departure_group_id: string;
  group_name: string;
  group_code: string;
  branch: string;
  departure_date: string;
  advance_deposit: number | null;
  currency: string;
  next_milestone_id: string | null;
  next_milestone_label: string | null;
  next_milestone_type: MilestoneType | null;
  next_milestone_amount: number | null;
  next_milestone_paid: number | null;
  next_milestone_due_at: string | null;
  overdue_milestone_count: number;
  overdue_amount: number;
  open_refund_count: number;
}

/**
 * One row per payment-plan instalment (`booking_payment_milestones`), joined
 * with the booking and group it belongs to — the grain the Payment Plans
 * screen needs (a booking's deposit and each instalment are separate rows),
 * unlike `FinanceReceivableRow` which only carries the *next* milestone.
 */
export interface FinanceMilestoneRow {
  id: string;
  booking_id: string;
  departure_group_id: string;
  sequence: number;
  label: string;
  milestone_type: MilestoneType;
  amount: number;
  due_at: string | null;
  paid_amount: number;
  paid_at: string | null;
  waived: boolean;
  due_at_previous: string | null;
  due_at_changed_at: string | null;
  due_at_change_reason: string | null;
  note: string | null;
  booking_reference: string;
  primary_contact_name: string;
  booking_status: string;
  group_name: string;
  group_code: string;
  currency: string;
}

/** `finance_payment_rows` — one row per payment, ledger + reversal linkage. */
export interface FinancePaymentRow extends PaymentRow {
  booking_reference: string;
  primary_contact_name: string;
  group_name: string;
  group_code: string;
  allocated_to: string | null;
  allocated_amount: number;
  reverses_payment_reference: string | null;
}

/** `finance_invoice_rows` — one row per invoice, customer or supplier. */
export interface FinanceInvoiceRow extends InvoiceRow {
  booking_reference: string | null;
  group_name: string | null;
  group_code: string | null;
  supplier_commitment_reference: string | null;
}

/** One refund request, joined with the booking it's against for display. */
export interface FinanceRefundRequestRow extends RefundRequestRow {
  booking_reference: string;
  primary_contact_name: string;
  group_name: string;
  group_code: string;
}

/** `finance_supplier_payable_rows` — read from supplier_commitments (plan F7). */
export interface FinanceSupplierPayableRow {
  commitment_id: string;
  reference_code: string;
  service_category: string;
  service_label: string;
  service_booking_reference: string | null;
  commitment_status: string;
  amount: number | null;
  amount_paid: number;
  outstanding_amount: number;
  currency: string;
  payment_due_at: string | null;
  owner_name: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_code: string;
  departure_group_id: string;
  group_name: string;
  group_code: string;
}
