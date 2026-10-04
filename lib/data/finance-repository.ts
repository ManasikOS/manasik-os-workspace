/**
 * Server-only read/write access for Payments & Invoices.
 *
 * Same posture as `lib/data/suppliers-repository.ts`: this is the only file
 * that touches Supabase for this module. Capabilities decide what is
 * *fetched*, not merely what is rendered — `stripForCapabilities()` nulls
 * amounts before a row ever reaches a Client Component.
 *
 * Recording a payment never writes `departure_group_bookings` directly — it
 * calls the existing `recordBookingPayment()` from `lib/data/departure-groups.ts`
 * for deferred verification. Evidenced payments use the
 * `record_departure_booking_payment_atomic` RPC, which applies the same
 * projection rules inside the database transaction so Finance and the
 * Departure Group detail page cannot diverge on a committed write.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FinanceCapabilities } from "@/lib/access/finance-access";
import { recordBookingPayment, reverseBookingPayment } from "@/lib/data/departure-groups";
import { money } from "@/lib/data/departure-groups-money";
import { getAgencySettings } from "@/lib/data/settings-repository";
import { defaultChannelForOffset, reminderOffsetsDueOn, scheduledForFromOffset } from "@/lib/finance/reminder-rules";
import type {
  ChangeMilestoneDueDateInput,
  CreateInvoiceInput,
  DecideRefundInput,
  PayRefundInput,
  RecordPaymentInput,
  RefundRequestInput,
  ReversePaymentInput,
  SendInvoiceInput,
  VerifyPaymentInput,
  VoidInvoiceInput,
} from "@/lib/validations/finance";
import type {
  BookingPaymentMilestoneRow,
  FinanceActivityAction,
  FinanceInvoiceRow,
  FinanceMilestoneRow,
  FinancePaymentRow,
  FinanceReceivableRow,
  FinanceRefundRequestRow,
  FinanceSupplierPayableRow,
  InvoiceLineItemRow,
  MilestoneType,
  RefundRequestRow,
} from "@/lib/types/finance";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class FinancePersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Finance: ${operation} on ${table} failed — ${detail}`);
    this.name = "FinancePersistenceError";
  }
}

export interface FinanceActor {
  id: string | null;
  name: string;
}

/**
 * Mirrors a booking's pre-existing paid amount into Finance when a booking is
 * created/imported with money already collected. This is an opening balance,
 * not a new cash receipt, so it is explicitly marked and never re-applied on
 * retries.
 */
export async function recordOpeningBalance(db: Db, bookingId: string, actor: FinanceActor): Promise<void> {
  const { data: booking, error: bookingError } = await db
    .from("departure_group_bookings")
    .select("id, departure_group_id, amount_paid, currency")
    .eq("id", bookingId)
    .single();
  if (bookingError) throw new FinancePersistenceError("departure_group_bookings", "select", bookingError);
  const amount = money(Number(booking.amount_paid ?? 0));
  if (amount <= 0) return;
  const note = "Opening balance mirrored from booking creation";
  const { data: existing, error: existingError } = await db
    .from("payments")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("internal_note", note)
    .limit(1);
  if (existingError) throw new FinancePersistenceError("payments", "select", existingError);
  if ((existing ?? []).length > 0) return;

  const reference = await nextReferenceNumber(db, "payments", "payment_reference", (await getReferencePrefixes(db)).payment);
  const { data: payment, error: insertError } = await db.from("payments").insert({
    payment_reference: reference,
    booking_id: bookingId,
    departure_group_id: booking.departure_group_id,
    amount,
    currency: booking.currency ?? "LKR",
    paid_at: new Date().toISOString(),
    method: "OTHER",
    status: "COMPLETED",
    internal_note: note,
    recorded_by: actor.id,
    recorded_by_name: actor.name,
  }).select("id").single();
  if (insertError) throw new FinancePersistenceError("payments", "insert", insertError);
  await allocateOldestUnsettledFirst(db, payment.id as string, bookingId, amount);
  await logFinanceEvent(db, {
    bookingId,
    departureGroupId: booking.departure_group_id as string,
    paymentId: payment.id as string,
    actor,
    action: "PAYMENT_RECORDED",
    toValue: String(amount),
    note,
    isHighImpact: true,
  });
}

/**
 * Ensures every booking has Finance's booking-grain schedule. This is
 * idempotent so it can be used by booking creation and by a repair job for
 * rows created before Finance milestones existed. Amounts are resolved from
 * the group's current schedule against the booking's agreed total; the final
 * remainder absorbs cent rounding so the schedule reconciles exactly.
 */
export async function ensureBookingPaymentMilestones(db: Db, bookingId: string): Promise<void> {
  const { data: booking, error: bookingError } = await db
    .from("departure_group_bookings")
    .select("id, departure_group_id, total_booking_value, created_at, agency_id")
    .eq("id", bookingId)
    .single();
  if (bookingError) throw new FinancePersistenceError("departure_group_bookings", "select", bookingError);
  const groupId = (booking as { departure_group_id: string }).departure_group_id;
  const { data: groupRow, error: groupRowError } = await db.from("departure_groups").select("id, departure_date, agency_id").eq("id", groupId).single();
  if (groupRowError) throw new FinancePersistenceError("departure_groups", "select", groupRowError);
  const { data: pricingRow, error: pricingRowError } = await db.from("departure_group_pricing").select("payment_milestones").eq("departure_group_id", groupId).maybeSingle();
  if (pricingRowError) throw new FinancePersistenceError("departure_group_pricing", "select", pricingRowError);
  const { data: snapshotRow, error: snapshotError } = await db
    .from("departure_group_package_snapshots")
    .select("payment_schedule_snapshot")
    .eq("departure_group_id", groupId)
    .limit(1)
    .maybeSingle();
  if (snapshotError) throw new FinancePersistenceError("departure_group_package_snapshots", "select", snapshotError);

  const existing = await db.from("booking_payment_milestones").select("id").eq("booking_id", bookingId).limit(1);
  if (existing.error) throw new FinancePersistenceError("booking_payment_milestones", "select", existing.error);
  if ((existing.data ?? []).length > 0) return;

  type ScheduleItem = { label?: string; amount?: number | null; amount_type?: string; due_rule?: string; due_date?: string | null; days_before_departure?: number | null };
  const schedule = (pricingRow?.payment_milestones?.length
    ? pricingRow.payment_milestones
    : snapshotRow?.payment_schedule_snapshot ?? []) as ScheduleItem[];
  const totalCents = Math.max(0, Math.round(Number((booking as { total_booking_value: number }).total_booking_value) * 100));
  const items = schedule.length > 0 ? schedule : [{ label: "Full Balance", amount_type: "Remaining Balance", amount: null, due_rule: "On Booking" }];
  let allocated = 0;
  const rows = items.map((item, index) => {
    const isLast = index === items.length - 1;
    const raw = item.amount_type === "Percentage" ? Math.round(totalCents * Number(item.amount ?? 0) / 100) : item.amount_type === "Remaining Balance" ? totalCents - allocated : Math.round(Number(item.amount ?? 0) * 100);
    const amountCents = isLast ? Math.max(0, totalCents - allocated) : Math.max(0, Math.min(raw, totalCents - allocated));
    allocated += amountCents;
    let dueAt: string | null = null;
    if (item.due_rule === "On Booking") dueAt = (booking as { created_at: string }).created_at;
    if (item.due_rule === "Fixed Date" && item.due_date) dueAt = `${item.due_date}T17:00:00.000Z`;
    if (item.due_rule === "Days Before Departure" && item.days_before_departure != null) {
      const date = new Date(`${(groupRow as { departure_date: string }).departure_date}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() - Number(item.days_before_departure));
      dueAt = `${date.toISOString().slice(0, 10)}T17:00:00.000Z`;
    }
    const type: MilestoneType = index === 0 ? "DEPOSIT" : index === items.length - 1 ? "FINAL_BALANCE" : "INSTALMENT";
    return { booking_id: bookingId, departure_group_id: groupId, agency_id: (groupRow as { agency_id: string }).agency_id, sequence: index + 1, label: item.label?.trim() || `Instalment ${index + 1}`, milestone_type: type, amount: amountCents / 100, due_at: dueAt, paid_amount: 0, waived: false };
  });
  if (allocated !== totalCents) throw new Error(`Finance schedule for booking ${bookingId} does not reconcile to the booking value.`);
  const { error: insertError } = await db.from("booking_payment_milestones").upsert(rows, { onConflict: "booking_id,sequence", ignoreDuplicates: true });
  if (insertError) throw new FinancePersistenceError("booking_payment_milestones", "insert", insertError);
}

/* ── Field stripping — capability decides what is fetched ────────────────── */

function stripReceivable(row: FinanceReceivableRow, can: FinanceCapabilities): FinanceReceivableRow {
  if (!can.viewPaymentStatusOnly) return row;
  return {
    ...row,
    total_booking_value: 0,
    amount_paid: 0,
    outstanding_balance: 0,
    next_milestone_amount: null,
    next_milestone_paid: null,
    overdue_amount: 0,
  };
}

function stripSupplierPayable(row: FinanceSupplierPayableRow, can: FinanceCapabilities): FinanceSupplierPayableRow {
  if (can.viewSupplierPayables) return row;
  return { ...row, amount: null, amount_paid: 0, outstanding_amount: 0 };
}

/* ── Reference number sequences ──────────────────────────────────────────── */

/**
 * Atomic per-agency sequence via `next_finance_reference_number()` (Phase 1,
 * P1.6) — the old implementation computed `(select count(*)...) + 1` in
 * application code, which two concurrent invoices could both read before
 * either committed and so both get the same number. The DB function locks
 * a single counter row for the duration of the transaction instead.
 */
async function nextReferenceNumber(db: Db, table: string, column: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  // `table:column` keeps this independent from `payments.payment_reference`
  // vs `payments.receipt_number` sharing one counter just because they
  // happen to share a table — the counter table has no column of its own,
  // only `(agency_id, kind, prefix, year)`.
  const { data, error } = await db.rpc("next_finance_reference_number", {
    p_kind: `${table}:${column}`,
    p_prefix: prefix,
    p_year: year,
  });
  if (error) throw new FinancePersistenceError(table, "select", error);
  return data as string;
}

/**
 * Prefixes come from Settings (§5.6 of the Settings plan) rather than the
 * literal `"INV"` / `"RCT"` / `"PAY"` this module used to hardcode. The
 * uniqueness scan in `nextReferenceNumber` is already scoped by prefix, so
 * changing a prefix starts a fresh sequence at `00001` without colliding
 * with numbers issued under the old one — existing numbers never change.
 */
async function getReferencePrefixes(db: Db): Promise<{ invoice: string; receipt: string; payment: string }> {
  const settings = await getAgencySettings(db);
  return {
    invoice: settings.invoice_prefix,
    receipt: settings.receipt_prefix,
    payment: settings.payment_prefix,
  };
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function loadFinanceReceivables(db: Db, can: FinanceCapabilities): Promise<FinanceReceivableRow[]> {
  const { data, error } = await db
    .from("finance_receivable_rows")
    .select("*")
    .order("next_milestone_due_at", { ascending: true, nullsFirst: false });
  if (error) throw new FinancePersistenceError("finance_receivable_rows", "select", error);
  return ((data ?? []) as FinanceReceivableRow[]).map((row) => stripReceivable(row, can));
}

export async function loadFinancePayments(db: Db, limit?: number): Promise<FinancePaymentRow[]> {
  const pageSize = 1000;
  const rows: FinancePaymentRow[] = [];
  for (let offset = 0; limit === undefined || offset < limit; offset += pageSize) {
    const end = limit === undefined ? offset + pageSize - 1 : Math.min(offset + pageSize, limit) - 1;
    const { data, error } = await db
      .from("finance_payment_rows")
      .select("*")
      .order("paid_at", { ascending: false })
      .range(offset, end);
    if (error) throw new FinancePersistenceError("finance_payment_rows", "select", error);
    const page = (data ?? []) as FinancePaymentRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return limit === undefined ? rows : rows.slice(0, limit);
}

export async function loadFinanceInvoices(db: Db): Promise<FinanceInvoiceRow[]> {
  const { data, error } = await db
    .from("finance_invoice_rows")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new FinancePersistenceError("finance_invoice_rows", "select", error);
  return (data ?? []) as FinanceInvoiceRow[];
}

export async function getFinanceInvoice(db: Db, invoiceId: string): Promise<FinanceInvoiceRow | null> {
  const { data, error } = await db.from("finance_invoice_rows").select("*").eq("id", invoiceId).maybeSingle();
  if (error) throw new FinancePersistenceError("finance_invoice_rows", "select", error);
  return (data as FinanceInvoiceRow) ?? null;
}

export async function listInvoiceLineItems(db: Db, invoiceId: string): Promise<InvoiceLineItemRow[]> {
  const { data, error } = await db
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sequence", { ascending: true });
  if (error) throw new FinancePersistenceError("invoice_line_items", "select", error);
  return (data ?? []) as InvoiceLineItemRow[];
}

export async function listInvoiceCreditNotes(db: Db, invoiceId: string): Promise<FinanceInvoiceRow[]> {
  const { data, error } = await db.from("finance_invoice_rows").select("*").eq("credit_note_of", invoiceId);
  if (error) throw new FinancePersistenceError("finance_invoice_rows", "select", error);
  return (data ?? []) as FinanceInvoiceRow[];
}

export interface InvoiceAllocationRow {
  paymentId: string;
  paymentReference: string;
  amount: number;
  paidAt: string;
}

/**
 * Payments applied against this invoice's own milestone, when it has one —
 * `payment_allocations` links a payment to a milestone, not to an invoice
 * directly, so an invoice with no `milestone_id` (a whole-booking invoice)
 * has no allocation rows to show here; its payments still show on the
 * booking's own Payments tab.
 */
export async function listInvoiceAllocations(db: Db, milestoneId: string | null): Promise<InvoiceAllocationRow[]> {
  if (!milestoneId) return [];
  const { data, error } = await db
    .from("payment_allocations")
    .select("amount, payments:payment_id ( id, payment_reference, paid_at )")
    .eq("milestone_id", milestoneId);
  if (error) throw new FinancePersistenceError("payment_allocations", "select", error);

  return ((data ?? []) as unknown as { amount: number; payments: { id: string; payment_reference: string; paid_at: string } | null }[])
    .filter((row) => row.payments !== null)
    .map((row) => ({
      paymentId: row.payments!.id,
      paymentReference: row.payments!.payment_reference,
      amount: row.amount,
      paidAt: row.payments!.paid_at,
    }));
}

export interface InvoiceActivityRow {
  id: string;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export async function listInvoiceActivity(db: Db, invoiceId: string): Promise<InvoiceActivityRow[]> {
  const { data, error } = await db
    .from("finance_activity_events")
    .select("id, action, from_value, to_value, note, actor_name, created_at")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  if (error) throw new FinancePersistenceError("finance_activity_events", "select", error);

  return ((data ?? []) as { id: string; action: string; from_value: string | null; to_value: string | null; note: string | null; actor_name: string | null; created_at: string }[]).map(
    (row) => ({
      id: row.id,
      action: row.action,
      fromValue: row.from_value,
      toValue: row.to_value,
      note: row.note,
      actorName: row.actor_name,
      createdAt: row.created_at,
    }),
  );
}

export async function loadFinanceSupplierPayables(
  db: Db,
  can: FinanceCapabilities,
): Promise<FinanceSupplierPayableRow[]> {
  const { data, error } = await db
    .from("finance_supplier_payable_rows")
    .select("*")
    .order("payment_due_at", { ascending: true, nullsFirst: false });
  if (error) throw new FinancePersistenceError("finance_supplier_payable_rows", "select", error);
  return ((data ?? []) as FinanceSupplierPayableRow[]).map((row) => stripSupplierPayable(row, can));
}

export async function loadRefundsPendingSummary(db: Db): Promise<{ count: number; amount: number }> {
  const { data, error } = await db
    .from("refund_requests")
    .select("amount")
    .in("status", ["PENDING_APPROVAL", "APPROVED"]);
  if (error) throw new FinancePersistenceError("refund_requests", "select", error);
  const rows = (data ?? []) as { amount: number }[];
  return { count: rows.length, amount: rows.reduce((sum, r) => sum + r.amount, 0) };
}

type RefundRequestJoinRow = RefundRequestRow & {
  departure_group_bookings: { booking_reference: string; primary_contact_name: string } | null;
  departure_groups: { group_name: string; group_code: string } | null;
};

/** The Refunds tab's own list — every request, newest first. */
export async function loadRefundRequests(db: Db): Promise<FinanceRefundRequestRow[]> {
  const { data, error } = await db
    .from("refund_requests")
    .select(
      "*, departure_group_bookings:booking_id ( booking_reference, primary_contact_name ), departure_groups:departure_group_id ( group_name, group_code )",
    )
    .order("requested_at", { ascending: false });
  if (error) throw new FinancePersistenceError("refund_requests", "select", error);

  return ((data ?? []) as RefundRequestJoinRow[]).map((row) => {
    const { departure_group_bookings, departure_groups, ...rest } = row;
    return {
      ...rest,
      booking_reference: departure_group_bookings?.booking_reference ?? "",
      primary_contact_name: departure_group_bookings?.primary_contact_name ?? "",
      group_name: departure_groups?.group_name ?? "",
      group_code: departure_groups?.group_code ?? "",
    } as FinanceRefundRequestRow;
  });
}

export async function loadBookingMilestones(db: Db, bookingId: string): Promise<BookingPaymentMilestoneRow[]> {
  const { data, error } = await db
    .from("booking_payment_milestones")
    .select("*")
    .eq("booking_id", bookingId)
    .order("sequence", { ascending: true });
  if (error) throw new FinancePersistenceError("booking_payment_milestones", "select", error);
  return (data ?? []) as BookingPaymentMilestoneRow[];
}

/**
 * Every milestone across every booking (deposit + instalments), for
 * `/finance/payment-plans`. Unlike `finance_receivable_rows` (booking-level,
 * next-milestone-only) this is one row per instalment, so a booking with a
 * deposit already paid and a final balance still due shows both.
 *
 * Money is nulled for a role restricted to `viewPaymentStatusOnly` — same
 * posture as `stripReceivable`.
 */
export async function loadPaymentPlanMilestones(
  db: Db,
  can: FinanceCapabilities,
): Promise<FinanceMilestoneRow[]> {
  const { data, error } = await db
    .from("booking_payment_milestones")
    .select(
      `id, booking_id, departure_group_id, sequence, label, milestone_type,
       amount, due_at, paid_amount, paid_at, waived, due_at_previous,
       due_at_changed_at, due_at_change_reason, note,
       departure_group_bookings:booking_id ( booking_reference, primary_contact_name, booking_status ),
       departure_groups:departure_group_id (
         group_name, group_code,
         departure_group_package_snapshots ( pricing_snapshot )
       )`,
    )
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw new FinancePersistenceError("booking_payment_milestones", "select", error);

  interface RawRow {
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
    departure_group_bookings: {
      booking_reference: string;
      primary_contact_name: string;
      booking_status: string;
    } | null;
    departure_groups: {
      group_name: string;
      group_code: string;
      departure_group_package_snapshots: { pricing_snapshot: Record<string, unknown> } | null;
    } | null;
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const booking = row.departure_group_bookings ?? {
      booking_reference: "",
      primary_contact_name: "",
      booking_status: "CONFIRMED",
    };
    const group = row.departure_groups ?? { group_name: "—", group_code: "—", departure_group_package_snapshots: null };
    const currency =
      (group.departure_group_package_snapshots?.pricing_snapshot?.currency as string | undefined) ?? "LKR";

    return {
      id: row.id,
      booking_id: row.booking_id,
      departure_group_id: row.departure_group_id,
      sequence: row.sequence,
      label: row.label,
      milestone_type: row.milestone_type,
      amount: can.viewPaymentStatusOnly ? 0 : Number(row.amount),
      due_at: row.due_at,
      paid_amount: can.viewPaymentStatusOnly ? 0 : Number(row.paid_amount),
      paid_at: row.paid_at,
      waived: row.waived,
      due_at_previous: row.due_at_previous,
      due_at_changed_at: row.due_at_changed_at,
      due_at_change_reason: row.due_at_change_reason,
      note: row.note,
      booking_reference: booking.booking_reference,
      primary_contact_name: booking.primary_contact_name,
      booking_status: booking.booking_status,
      group_name: group.group_name,
      group_code: group.group_code,
      currency,
    } satisfies FinanceMilestoneRow;
  });
}

/** Bookings with an outstanding balance — the Record Payment dialog's picker. */
export async function loadOwingBookingOptions(
  db: Db,
): Promise<{ id: string; booking_reference: string; primary_contact_name: string; outstanding_balance: number; departure_group_id: string }[]> {
  const { data, error } = await db
    .from("departure_group_bookings")
    .select("id, booking_reference, primary_contact_name, outstanding_balance, departure_group_id")
    .gt("outstanding_balance", 0)
    .neq("booking_status", "CANCELLED")
    .order("booking_reference", { ascending: true });
  if (error) throw new FinancePersistenceError("departure_group_bookings", "select", error);
  return data ?? [];
}

/**
 * Bookings with money already collected — the Request Refund dialog's
 * picker. Unlike `loadOwingBookingOptions`, a CANCELLED booking is included
 * (it is the primary refund case — see `cancelGroupBookingInStore`) and
 * `outstanding_balance` is irrelevant; what matters here is `amount_paid`,
 * the ceiling a refund request can ask for.
 */
export async function loadRefundableBookingOptions(
  db: Db,
): Promise<{ id: string; booking_reference: string; primary_contact_name: string; amount_paid: number; departure_group_id: string }[]> {
  const { data, error } = await db
    .from("departure_group_bookings")
    .select("id, booking_reference, primary_contact_name, amount_paid, departure_group_id")
    .gt("amount_paid", 0)
    .order("booking_reference", { ascending: true });
  if (error) throw new FinancePersistenceError("departure_group_bookings", "select", error);
  return data ?? [];
}

/* ── Activity logging ────────────────────────────────────────────────────── */

async function logFinanceEvent(
  db: Db,
  input: {
    bookingId?: string | null;
    departureGroupId?: string | null;
    paymentId?: string | null;
    invoiceId?: string | null;
    actor: FinanceActor;
    action: FinanceActivityAction;
    fromValue?: string | null;
    toValue?: string | null;
    note?: string | null;
    isHighImpact?: boolean;
  },
): Promise<void> {
  const { error } = await db.from("finance_activity_events").insert({
    booking_id: input.bookingId ?? null,
    departure_group_id: input.departureGroupId ?? null,
    payment_id: input.paymentId ?? null,
    invoice_id: input.invoiceId ?? null,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    action: input.action,
    from_value: input.fromValue ?? null,
    to_value: input.toValue ?? null,
    note: input.note ?? null,
    is_high_impact: input.isHighImpact ?? false,
  });
  if (error) throw new FinancePersistenceError("finance_activity_events", "insert", error);
}

/* ── Record payment — the flow §3.4 of the plan hangs on ─────────────────── */

export type RecordPaymentOutcome =
  | { ok: true; paymentId: string; paymentReference: string; outstandingBalance: number }
  | { ok: false; error: string };

/**
 * Maps the finance-side (superset) method vocabulary onto the Departure
 * Groups mutator's five-value one — that mutator only ever uses `method` to
 * compose an activity-log sentence, so `OTHER` is simply omitted there.
 */
function toBookingPaymentMethod(
  method: RecordPaymentInput["method"],
): "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "ONLINE" | undefined {
  return method === "OTHER" ? undefined : method;
}

/**
 * Allocates a payment across a booking's open milestones, oldest-due-first.
 * Mirrors `allocatePaymentToMilestonesInStore()` (lib/data/pilgrims.ts).
 * Used both for a completed payment with no milestone hand-picked, and for a
 * pending payment once `verifyPayment()` confirms it — a pending payment's
 * milestone choice, if any, is not preserved across verification, since
 * `verifyPaymentSchema` carries only the payment id.
 */
async function allocateOldestUnsettledFirst(
  db: Db,
  paymentId: string,
  bookingId: string,
  amount: number,
): Promise<void> {
  const { data: openMilestones, error: msError } = await db
    .from("booking_payment_milestones")
    .select("id, amount, paid_amount")
    .eq("booking_id", bookingId)
    .eq("waived", false)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("sequence", { ascending: true });
  if (msError) throw new FinancePersistenceError("booking_payment_milestones", "select", msError);

  let remaining = amount;
  const rows: { payment_id: string; milestone_id: string; amount: number }[] = [];
  for (const m of (openMilestones ?? []) as { id: string; amount: number; paid_amount: number }[]) {
    if (remaining <= 0) break;
    const due = money(m.amount - m.paid_amount);
    if (due <= 0) continue;
    const applied = money(Math.min(due, remaining));
    rows.push({ payment_id: paymentId, milestone_id: m.id, amount: applied });
    remaining = money(remaining - applied);
  }
  if (rows.length > 0) {
    const { error: allocError } = await db.from("payment_allocations").insert(rows);
    if (allocError) throw new FinancePersistenceError("payment_allocations", "insert", allocError);
  }
}

/**
 * Applies whichever milestone allocation a payment should actually get once
 * it is verified: the choice recorded at `recordPayment()` time
 * (`payments.pending_allocations`), if there was one, or the
 * oldest-unsettled-first fallback otherwise. Reproduces exactly what a
 * `COMPLETED` payment recorded with the same milestone choice would have
 * done immediately, instead of always discarding it — see the migration
 * comment on `pending_allocations`.
 *
 * Falls back to oldest-first if any stored milestone id no longer belongs
 * to this booking (a milestone cannot be deleted once created, so this
 * should not happen in practice) rather than partially applying a stale
 * choice.
 */
async function allocatePendingChoiceOrOldestUnsettled(
  db: Db,
  paymentId: string,
  bookingId: string,
  amount: number,
  pendingAllocations: { milestone_id: string; amount: number }[] | null,
): Promise<void> {
  if (!pendingAllocations || pendingAllocations.length === 0) {
    await allocateOldestUnsettledFirst(db, paymentId, bookingId, amount);
    return;
  }

  const { data: milestones, error: msError } = await db
    .from("booking_payment_milestones")
    .select("id")
    .eq("booking_id", bookingId);
  if (msError) throw new FinancePersistenceError("booking_payment_milestones", "select", msError);
  const validIds = new Set(((milestones ?? []) as { id: string }[]).map((m) => m.id));

  const allValid = pendingAllocations.every((a) => validIds.has(a.milestone_id));
  if (!allValid) {
    await allocateOldestUnsettledFirst(db, paymentId, bookingId, amount);
    return;
  }

  const { error: allocError } = await db.from("payment_allocations").insert(
    pendingAllocations.map((a) => ({
      payment_id: paymentId,
      milestone_id: a.milestone_id,
      amount: money(a.amount),
    })),
  );
  if (allocError) throw new FinancePersistenceError("payment_allocations", "insert", allocError);
}

/**
 * Records a payment against a booking. Ordered per plan §3.4:
 *
 *   1. Insert the `payments` row (ledger first, so a downstream failure
 *      leaves a visible, reconcilable record rather than a silently
 *      increased balance with nothing behind it).
 *   2. Insert `payment_allocations` — the trigger updates each milestone's
 *      `paid_amount`.
 *   3. Call the existing `recordBookingPayment()`, which is the *only*
 *      writer of `amount_paid` / `outstanding_balance` and everything that
 *      follows from it (seat promotion, traveller payment status, group
 *      readiness, the group's own activity log).
 *   4. Issue the receipt number once the payment is `COMPLETED`.
 *   5. Append `finance_activity_events`.
 *
 * A payment with neither a reference number nor proof lands as
 * `PENDING_VERIFICATION` rather than being refused — the queue, not the
 * form, is where evidence gets chased (plan D7).
 *
 * Critically, a `PENDING_VERIFICATION` payment does NOT touch the booking's
 * `amount_paid` / `outstanding_balance` — that only happens once someone
 * with `verifyPayments` confirms the evidence (`verifyPayment()` below).
 * Applying an unevidenced claim immediately would let anyone with
 * `recordPayments` convert held seats to booked and mark a traveller paid in
 * full on nothing more than typing a number in.
 */
export async function recordPayment(
  db: Db,
  input: RecordPaymentInput,
  actor: FinanceActor,
): Promise<RecordPaymentOutcome> {
  const amount = money(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }

  const { data: bookingCurrency, error: currencyError } = await db
    .from("departure_group_bookings")
    .select("currency, outstanding_balance")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (currencyError) throw new FinancePersistenceError("departure_group_bookings", "select", currencyError);
  const currency = (bookingCurrency?.currency as string | null) ?? "LKR";

  const normalizedReference = input.referenceNumber?.trim() || null;
  if (normalizedReference) {
    const { data: duplicate, error: duplicateError } = await db
      .from("payments")
      .select("id, payment_reference, status, booking_id, amount")
      .eq("booking_id", input.bookingId)
      .eq("reference_number", normalizedReference)
      .in("status", ["PENDING_VERIFICATION", "COMPLETED"])
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw new FinancePersistenceError("payments", "select", duplicateError);
    if (duplicate) {
      return {
        ok: true,
        paymentId: duplicate.id as string,
        paymentReference: duplicate.payment_reference as string,
        outstandingBalance: Number(bookingCurrency?.outstanding_balance ?? 0),
      };
    }
  }

  const prefixes = await getReferencePrefixes(db);
  const paymentReference = await nextReferenceNumber(db, "payments", "payment_reference", prefixes.payment);
  const hasEvidence = Boolean(input.referenceNumber?.trim() || input.proofPath);
  const status = hasEvidence ? "COMPLETED" : "PENDING_VERIFICATION";

  // Evidenced payments take the database transaction path. It locks the
  // booking/group, validates and allocates milestones, updates receivables,
  // and promotes held seats atomically. Pending entries intentionally remain
  // on the deferred-verification path below.
  if (status === "COMPLETED") {
    const { data: atomic, error: atomicError } = await db.rpc(
      "record_departure_booking_payment_atomic",
      {
        p_booking_id: input.bookingId,
        p_departure_group_id: input.departureGroupId,
        p_amount: amount,
        p_currency: currency,
        p_method: input.method ?? "OTHER",
        p_payment_reference: paymentReference,
        p_reference_number: normalizedReference,
        p_proof_path: input.proofPath ?? null,
        p_paid_at: input.paidAt,
        p_internal_note: input.internalNote?.trim() || null,
        p_pending_allocations: input.allocations.map((a) => ({
          milestone_id: a.milestoneId,
          amount: money(a.amount),
        })),
        p_actor_id: actor.id,
        p_actor_name: actor.name,
      },
    );
    if (atomicError) throw new FinancePersistenceError("record_departure_booking_payment_atomic", "insert", atomicError);
    const result = atomic as { payment_id?: string; outstanding_balance?: number } | null;
    if (!result?.payment_id) throw new FinancePersistenceError("record_departure_booking_payment_atomic", "insert", { message: "RPC returned no payment id" });

    const receiptNumber = await nextReferenceNumber(db, "payments", "receipt_number", prefixes.receipt);
    const { error: receiptError } = await db
      .from("payments")
      .update({ receipt_number: receiptNumber, receipt_issued_at: new Date().toISOString() })
      .eq("id", result.payment_id);
    if (receiptError) throw new FinancePersistenceError("payments", "update", receiptError);

    await logFinanceEvent(db, {
      bookingId: input.bookingId,
      departureGroupId: input.departureGroupId,
      paymentId: result.payment_id,
      actor,
      action: "PAYMENT_RECORDED",
      toValue: String(amount),
      note: `Receipt ${receiptNumber} issued.`,
      isHighImpact: true,
    });
    return {
      ok: true,
      paymentId: result.payment_id,
      paymentReference,
      outstandingBalance: Number(result.outstanding_balance ?? 0),
    };
  }

  const { data: paymentRow, error: insertError } = await db
    .from("payments")
    .insert({
      payment_reference: paymentReference,
      booking_id: input.bookingId,
      departure_group_id: input.departureGroupId,
      amount,
      currency,
      paid_at: input.paidAt,
      method: input.method,
      reference_number: normalizedReference,
      proof_path: input.proofPath ?? null,
      status,
      internal_note: input.internalNote?.trim() || null,
      recorded_by: actor.id,
      recorded_by_name: actor.name,
      // Carries a hand-picked milestone choice across to `verifyPayment()`
      // for an unevidenced payment — see that column's comment. Null for a
      // `COMPLETED` payment (applied immediately below, nothing to carry)
      // and for one with no allocation ticked (the oldest-unsettled-first
      // fallback applies whenever it eventually completes either way).
      pending_allocations:
        status === "PENDING_VERIFICATION" && input.allocations.length > 0
          ? input.allocations.map((a) => ({ milestone_id: a.milestoneId, amount: money(a.amount) }))
          : null,
    })
    .select("id")
    .single();
  if (insertError) throw new FinancePersistenceError("payments", "insert", insertError);
  const paymentId = paymentRow.id as string;

  // No evidence — only the ledger entry is recorded. Milestone allocation and
  // the booking's own totals are untouched until verifyPayment confirms it.
  const { data: booking, error: bookingError } = await db
    .from("departure_group_bookings")
    .select("outstanding_balance")
    .eq("id", input.bookingId)
    .single();
  if (bookingError) throw new FinancePersistenceError("departure_group_bookings", "select", bookingError);
  const outstandingBalance = Number(booking.outstanding_balance ?? 0);
  const receiptNumber: string | null = null;

  await logFinanceEvent(db, {
    bookingId: input.bookingId,
    departureGroupId: input.departureGroupId,
    paymentId,
    actor,
    action: "PAYMENT_RECORDED",
    toValue: String(amount),
    note: receiptNumber ? `Receipt ${receiptNumber} issued.` : "Pending verification.",
    isHighImpact: true,
  });

  return { ok: true, paymentId, paymentReference, outstandingBalance };
}

/* ── Verify ───────────────────────────────────────────────────────────────── */

export type VerifyPaymentOutcome = { ok: true } | { ok: false; error: string };

/**
 * Confirms a `PENDING_VERIFICATION` payment's evidence, which is the point
 * this money actually applies to the booking (see `recordPayment()` above).
 * Allocates the milestones, moves the booking's `amount_paid` /
 * `outstanding_balance` through `recordBookingPayment()` — the seat
 * promotion, traveller payment status and group readiness that follow from
 * it all happen here, not at record time — and issues the receipt.
 */
export async function verifyPayment(db: Db, input: VerifyPaymentInput, actor: FinanceActor): Promise<VerifyPaymentOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("payments")
    .select("id, status, booking_id, departure_group_id, amount, method, internal_note, pending_allocations")
    .eq("id", input.paymentId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("payments", "select", fetchError);
  if (!existing) return { ok: false, error: "That payment no longer exists." };
  if (existing.status !== "PENDING_VERIFICATION") {
    return { ok: false, error: "Only a payment pending verification can be marked verified." };
  }

  const bookingId = existing.booking_id as string;
  const departureGroupId = existing.departure_group_id as string;
  const amount = money(Number(existing.amount));

  await allocatePendingChoiceOrOldestUnsettled(
    db,
    input.paymentId,
    bookingId,
    amount,
    existing.pending_allocations as { milestone_id: string; amount: number }[] | null,
  );
  // Resolved one way or another — nothing left to carry forward.
  const { error: clearError } = await db
    .from("payments")
    .update({ pending_allocations: null })
    .eq("id", input.paymentId);
  if (clearError) throw new FinancePersistenceError("payments", "update", clearError);

  const outcome = await recordBookingPayment({
    bookingId,
    departureGroupId,
    amount,
    method: toBookingPaymentMethod(existing.method as RecordPaymentInput["method"]),
    note: (existing.internal_note as string | null) ?? undefined,
  });
  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }

  const prefixes = await getReferencePrefixes(db);
  const receiptNumber = await nextReferenceNumber(db, "payments", "receipt_number", prefixes.receipt);

  const { error: updateError } = await db
    .from("payments")
    .update({
      status: "COMPLETED",
      verified_at: new Date().toISOString(),
      verified_by: actor.id,
      verified_by_name: actor.name,
      receipt_number: receiptNumber,
      receipt_issued_at: new Date().toISOString(),
    })
    .eq("id", input.paymentId);
  if (updateError) throw new FinancePersistenceError("payments", "update", updateError);

  await logFinanceEvent(db, {
    bookingId,
    departureGroupId,
    paymentId: input.paymentId,
    actor,
    action: "PAYMENT_VERIFIED",
    note: `Receipt ${receiptNumber} issued.`,
    isHighImpact: true,
  });

  return { ok: true };
}

/* ── Reverse ──────────────────────────────────────────────────────────────── */

export type ReversePaymentOutcome = { ok: true } | { ok: false; error: string };

/**
 * A payment is never deleted (plan F1). This inserts a negative `payments`
 * row naming what it reverses, marks the original `REVERSED`, and calls the
 * new `reverseBookingPayment()` mutator so the booking's own totals stay in
 * step with the ledger — the same one-writer discipline recording a payment
 * follows (§3.4).
 */
export async function reversePayment(
  db: Db,
  input: ReversePaymentInput,
  actor: FinanceActor,
): Promise<ReversePaymentOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("payments")
    .select("id, status, booking_id, departure_group_id, amount, currency, method, payment_reference")
    .eq("id", input.paymentId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("payments", "select", fetchError);
  if (!existing) return { ok: false, error: "That payment no longer exists." };
  if (existing.status === "REVERSED" || existing.status === "VOIDED") {
    return { ok: false, error: "This payment has already been reversed or voided." };
  }
  if (existing.amount <= 0) {
    return { ok: false, error: "A reversal row cannot itself be reversed." };
  }

  // Pending evidence has never affected the booking or its milestones. It is
  // voided in place; treating it as a reversal would subtract unrelated
  // posted money from the booking balance.
  if (existing.status === "PENDING_VERIFICATION") {
    const { error: voidError } = await db
      .from("payments")
      .update({ status: "VOIDED", reversal_reason: input.reason })
      .eq("id", input.paymentId)
      .eq("status", "PENDING_VERIFICATION");
    if (voidError) throw new FinancePersistenceError("payments", "update", voidError);
    await logFinanceEvent(db, {
      bookingId: existing.booking_id as string,
      departureGroupId: existing.departure_group_id as string,
      paymentId: input.paymentId,
      actor,
      action: "PAYMENT_REVERSED",
      note: `Pending payment voided: ${input.reason}`,
      isHighImpact: true,
    });
    return { ok: true };
  }

  const reversalReference = await nextReferenceNumber(
    db,
    "payments",
    "payment_reference",
    (await getReferencePrefixes(db)).payment,
  );

  const outcome = await reverseBookingPayment({
    bookingId: existing.booking_id as string,
    departureGroupId: existing.departure_group_id as string,
    amount: existing.amount as number,
    reason: input.reason,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const { error: reversalInsertError } = await db.from("payments").insert({
    payment_reference: reversalReference,
    booking_id: existing.booking_id,
    departure_group_id: existing.departure_group_id,
    amount: -Math.abs(existing.amount as number),
    currency: existing.currency,
    paid_at: new Date().toISOString(),
    method: existing.method,
    status: "REVERSED",
    reverses_payment_id: existing.id,
    reversal_reason: input.reason,
    recorded_by: actor.id,
    recorded_by_name: actor.name,
  });
  if (reversalInsertError) throw new FinancePersistenceError("payments", "insert", reversalInsertError);

  const { error: updateError } = await db.from("payments").update({ status: "REVERSED" }).eq("id", input.paymentId);
  if (updateError) throw new FinancePersistenceError("payments", "update", updateError);

  await logFinanceEvent(db, {
    bookingId: existing.booking_id as string,
    departureGroupId: existing.departure_group_id as string,
    paymentId: input.paymentId,
    actor,
    action: "PAYMENT_REVERSED",
    note: input.reason,
    isHighImpact: true,
  });

  return { ok: true };
}

/* ── Refunds (plan F8) ────────────────────────────────────────────────────── */

export type CreateRefundRequestOutcome =
  | { ok: true; refundRequestId: string; reference: string }
  | { ok: false; error: string };

/**
 * Opens a refund request against a booking. Never moves money itself — a
 * cancellation flags `REFUND_PENDING` on the traveller (see
 * `cancelGroupBookingInStore` in lib/data/departure-groups-bookings.ts), and
 * this is the first step that turns that intent into a tracked, auditable
 * request: PENDING_APPROVAL until `decideRefund()`, then PAID once
 * `payRefund()` actually pays it out.
 *
 * Capped at what the booking has actually paid, minus anything already
 * requested and not yet rejected/cancelled — so two overlapping requests
 * can never together promise more than the agency actually holds.
 */
export async function createRefundRequest(
  db: Db,
  input: RefundRequestInput,
  actor: FinanceActor,
): Promise<CreateRefundRequestOutcome> {
  const amount = money(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a refund amount greater than zero." };
  }

  const { data: booking, error: bookingError } = await db
    .from("departure_group_bookings")
    .select("id, departure_group_id, amount_paid, currency")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (bookingError) throw new FinancePersistenceError("departure_group_bookings", "select", bookingError);
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That booking does not belong to the selected departure group." };
  }

  const { data: openRequests, error: openError } = await db
    .from("refund_requests")
    .select("amount")
    .eq("booking_id", input.bookingId)
    .in("status", ["PENDING_APPROVAL", "APPROVED"]);
  if (openError) throw new FinancePersistenceError("refund_requests", "select", openError);
  const alreadyRequested = ((openRequests ?? []) as { amount: number }[]).reduce(
    (sum, r) => sum + Number(r.amount),
    0,
  );

  const available = money(Number(booking.amount_paid) - alreadyRequested);
  if (amount > available) {
    return {
      ok: false,
      error: `Cannot request more than the ${available.toLocaleString("en-US")} available to refund on this booking.`,
    };
  }

  const reference = await nextReferenceNumber(db, "refund_requests", "reference", "REF");

  const { data: created, error: insertError } = await db
    .from("refund_requests")
    .insert({
      reference,
      booking_id: input.bookingId,
      departure_group_id: input.departureGroupId,
      reason: input.reason,
      reason_note: input.reasonNote?.trim() || null,
      amount,
      currency: booking.currency ?? "LKR",
      requested_by: actor.id,
      requested_by_name: actor.name,
    })
    .select("id")
    .single();
  if (insertError) throw new FinancePersistenceError("refund_requests", "insert", insertError);

  await logFinanceEvent(db, {
    bookingId: input.bookingId,
    departureGroupId: input.departureGroupId,
    actor,
    action: "REFUND_REQUESTED",
    toValue: String(amount),
    note: input.reasonNote?.trim() || input.reason,
    isHighImpact: true,
  });

  return { ok: true, refundRequestId: created.id as string, reference };
}

export type DecideRefundOutcome = { ok: true } | { ok: false; error: string };

/**
 * Approves or rejects a pending refund request. Approving does not move
 * money — it only clears the request to be paid out by `payRefund()`. Kept
 * as its own step (rather than folded into request or payout) so an Admin
 * can sign off before Finance ever touches the ledger, matching how
 * `capabilitiesForFinance` already separates `requestRefunds` from
 * `approveRefunds`.
 */
export async function decideRefund(
  db: Db,
  input: DecideRefundInput,
  actor: FinanceActor,
): Promise<DecideRefundOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("refund_requests")
    .select("id, status, booking_id, departure_group_id")
    .eq("id", input.refundRequestId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("refund_requests", "select", fetchError);
  if (!existing) return { ok: false, error: "That refund request no longer exists." };
  if (existing.status !== "PENDING_APPROVAL") {
    return { ok: false, error: "Only a refund request pending approval can be decided." };
  }

  const nextStatus = input.approve ? "APPROVED" : "REJECTED";
  const { error: updateError } = await db
    .from("refund_requests")
    .update({
      status: nextStatus,
      decided_by: actor.id,
      decided_by_name: actor.name,
      decided_at: new Date().toISOString(),
      decision_note: input.decisionNote?.trim() || null,
    })
    .eq("id", input.refundRequestId);
  if (updateError) throw new FinancePersistenceError("refund_requests", "update", updateError);

  await logFinanceEvent(db, {
    bookingId: existing.booking_id as string,
    departureGroupId: existing.departure_group_id as string,
    actor,
    action: input.approve ? "REFUND_APPROVED" : "REFUND_REJECTED",
    note: input.decisionNote?.trim() || null,
    isHighImpact: true,
  });

  return { ok: true };
}

export type PayRefundOutcome =
  | { ok: true; paymentId: string; paymentReference: string }
  | { ok: false; error: string };

/**
 * Pays out an approved refund request — the step that actually moves money.
 * Mirrors `reversePayment()` above: inserts a negative, `REFUNDED`-status
 * `payments` row (so the ledger's `SUM(amount)` stays correct with no
 * special-casing) and calls `reverseBookingPayment()` with
 * `resolvesRefund: true` so the booking's `amount_paid` / `outstanding_balance`
 * move and any traveller stuck at `REFUND_PENDING` gets their payment status
 * re-derived — the one case that mutator deliberately leaves untouched
 * otherwise (see its own comment).
 */
export async function payRefund(db: Db, input: PayRefundInput, actor: FinanceActor): Promise<PayRefundOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("refund_requests")
    .select("id, status, booking_id, departure_group_id, amount, currency, reference")
    .eq("id", input.refundRequestId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("refund_requests", "select", fetchError);
  if (!existing) return { ok: false, error: "That refund request no longer exists." };
  if (existing.status !== "APPROVED") {
    return { ok: false, error: "Only an approved refund request can be paid out." };
  }

  const bookingId = existing.booking_id as string;
  const departureGroupId = existing.departure_group_id as string;
  const amount = money(Number(existing.amount));

  const reverseOutcome = await reverseBookingPayment({
    bookingId,
    departureGroupId,
    amount,
    reason: `Refund ${existing.reference as string} paid out.`,
    resolvesRefund: true,
  });
  if (!reverseOutcome.ok) return { ok: false, error: reverseOutcome.error };

  const prefixes = await getReferencePrefixes(db);
  const paymentReference = await nextReferenceNumber(db, "payments", "payment_reference", prefixes.payment);

  const { data: paymentRow, error: insertError } = await db
    .from("payments")
    .insert({
      payment_reference: paymentReference,
      booking_id: bookingId,
      departure_group_id: departureGroupId,
      amount: -amount,
      currency: existing.currency,
      paid_at: new Date().toISOString(),
      method: input.method,
      reference_number: input.referenceNumber?.trim() || null,
      status: "REFUNDED",
      internal_note: input.note?.trim() || null,
      recorded_by: actor.id,
      recorded_by_name: actor.name,
    })
    .select("id")
    .single();
  if (insertError) throw new FinancePersistenceError("payments", "insert", insertError);
  const paymentId = paymentRow.id as string;

  const { error: updateError } = await db
    .from("refund_requests")
    .update({ status: "PAID", payout_payment_id: paymentId })
    .eq("id", input.refundRequestId);
  if (updateError) throw new FinancePersistenceError("refund_requests", "update", updateError);

  await logFinanceEvent(db, {
    bookingId,
    departureGroupId,
    paymentId,
    actor,
    action: "REFUND_PAID",
    toValue: String(amount),
    note: input.note?.trim() || `Refund ${existing.reference as string} paid via ${input.method}.`,
    isHighImpact: true,
  });

  return { ok: true, paymentId, paymentReference };
}

/* ── Milestone due-date change ────────────────────────────────────────────── */

export type ChangeMilestoneDueDateOutcome = { ok: true } | { ok: false; error: string };

export async function changeMilestoneDueDate(
  db: Db,
  input: ChangeMilestoneDueDateInput,
  actor: FinanceActor,
): Promise<ChangeMilestoneDueDateOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("booking_payment_milestones")
    .select("id, due_at, booking_id, departure_group_id")
    .eq("id", input.milestoneId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("booking_payment_milestones", "select", fetchError);
  if (!existing) return { ok: false, error: "That milestone no longer exists." };

  const { error: updateError } = await db
    .from("booking_payment_milestones")
    .update({
      due_at: input.dueAt,
      due_at_previous: existing.due_at,
      due_at_changed_at: new Date().toISOString(),
      due_at_change_reason: input.reason,
    })
    .eq("id", input.milestoneId);
  if (updateError) throw new FinancePersistenceError("booking_payment_milestones", "update", updateError);

  await logFinanceEvent(db, {
    bookingId: existing.booking_id as string,
    departureGroupId: existing.departure_group_id as string,
    actor,
    action: "MILESTONE_DUE_DATE_CHANGED",
    fromValue: existing.due_at as string | null,
    toValue: input.dueAt,
    note: input.reason,
    isHighImpact: true,
  });

  // Structured, queryable form of the same change — see
  // `20261109090000_p1_2_payment_plans_risk.sql`. `finance_activity_events`
  // above stays the human-readable feed; this is what the Σ-milestones
  // invariant and the collection-risk scorer's "rescheduled" factor read.
  const { error: changeEventError } = await db.from("milestone_change_events").insert({
    milestone_id: input.milestoneId,
    booking_id: existing.booking_id as string,
    departure_group_id: existing.departure_group_id as string,
    change_type: "DUE_DATE_CHANGED",
    due_at_from: existing.due_at as string | null,
    due_at_to: input.dueAt,
    reason: input.reason,
    approver_id: actor.id,
    approver_name: actor.name,
  });
  if (changeEventError) throw new FinancePersistenceError("milestone_change_events", "insert", changeEventError);

  return { ok: true };
}

/* ── Payment reminders (P1.2) ─────────────────────────────────────────────── */

export interface GeneratePaymentRemindersOutcome {
  created: number;
}

interface OpenMilestoneForReminderRow {
  id: string;
  booking_id: string;
  departure_group_id: string;
  amount: number;
  paid_amount: number;
  due_at: string;
  departure_group_bookings: { booking_status: string } | null;
}

/**
 * Queues DRAFT reminders per the T-3/T0/T+3/T+10 cadence in
 * `lib/finance/reminder-rules.ts`. Safe to run once per day: the
 * `payment_reminders_milestone_offset_unique` constraint makes a re-run for
 * a day already generated a no-op (caught below, not treated as a failure).
 * Never marks anything beyond DRAFT — sending is a human action or an
 * approved `PAYMENT_REMINDER_SEND` proposal, never this function.
 */
export async function generatePaymentReminders(db: Db, nowIso: string): Promise<GeneratePaymentRemindersOutcome> {
  const { data, error } = await db
    .from("booking_payment_milestones")
    .select(
      `id, booking_id, departure_group_id, amount, paid_amount, due_at,
       departure_group_bookings:booking_id ( booking_status )`,
    )
    .eq("waived", false)
    .not("due_at", "is", null);
  if (error) throw new FinancePersistenceError("booking_payment_milestones", "select", error);

  const rows = (data ?? []) as unknown as OpenMilestoneForReminderRow[];
  let created = 0;

  for (const row of rows) {
    if (row.departure_group_bookings?.booking_status === "CANCELLED") continue;
    if (row.paid_amount >= row.amount) continue;

    for (const offset of reminderOffsetsDueOn(row.due_at, nowIso)) {
      const { error: insertError } = await db.from("payment_reminders").insert({
        milestone_id: row.id,
        booking_id: row.booking_id,
        departure_group_id: row.departure_group_id,
        offset_days: offset,
        channel: defaultChannelForOffset(offset),
        scheduled_for: scheduledForFromOffset(row.due_at, offset),
        status: "DRAFT",
      });
      if (insertError) {
        if (insertError.code === "23505") continue; // already generated for this milestone+offset
        throw new FinancePersistenceError("payment_reminders", "insert", insertError);
      }
      created += 1;
    }
  }

  return { created };
}

export interface PaymentReminderQueueRow {
  id: string;
  milestone_id: string;
  booking_id: string;
  departure_group_id: string;
  offset_days: number;
  channel: string;
  scheduled_for: string;
  status: string;
  message: string | null;
  booking_reference: string;
  primary_contact_name: string;
  milestone_label: string;
}

export async function listPendingPaymentReminders(db: Db): Promise<PaymentReminderQueueRow[]> {
  const { data, error } = await db
    .from("payment_reminders")
    .select(
      `id, milestone_id, booking_id, departure_group_id, offset_days, channel, scheduled_for, status, message,
       departure_group_bookings:booking_id ( booking_reference, primary_contact_name ),
       booking_payment_milestones:milestone_id ( label )`,
    )
    .in("status", ["DRAFT", "APPROVED"])
    .order("scheduled_for", { ascending: true });
  if (error) throw new FinancePersistenceError("payment_reminders", "select", error);

  return ((data ?? []) as unknown as Array<{
    id: string;
    milestone_id: string;
    booking_id: string;
    departure_group_id: string;
    offset_days: number;
    channel: string;
    scheduled_for: string;
    status: string;
    message: string | null;
    departure_group_bookings: { booking_reference: string; primary_contact_name: string } | null;
    booking_payment_milestones: { label: string } | null;
  }>).map((row) => ({
    id: row.id,
    milestone_id: row.milestone_id,
    booking_id: row.booking_id,
    departure_group_id: row.departure_group_id,
    offset_days: row.offset_days,
    channel: row.channel,
    scheduled_for: row.scheduled_for,
    status: row.status,
    message: row.message,
    booking_reference: row.departure_group_bookings?.booking_reference ?? "—",
    primary_contact_name: row.departure_group_bookings?.primary_contact_name ?? "—",
    milestone_label: row.booking_payment_milestones?.label ?? "—",
  }));
}

/* ── Invoices ─────────────────────────────────────────────────────────────── */

export type CreateInvoiceOutcome = { ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; error: string };

function invoiceLinesTotal(input: CreateInvoiceInput): number {
  return money(input.lineItems.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0));
}

export async function createInvoice(db: Db, input: CreateInvoiceInput, actor: FinanceActor): Promise<CreateInvoiceOutcome> {
  if (!input.bookingId && !input.supplierCommitmentId) {
    return { ok: false, error: "An invoice needs either a booking or a supplier commitment." };
  }
  if (input.lineItems.length > 0 && invoiceLinesTotal(input) !== money(input.amount)) {
    return { ok: false, error: "Invoice total must equal the sum of its line items." };
  }

  const invoiceNumber = await nextReferenceNumber(
    db,
    "invoices",
    "invoice_number",
    (await getReferencePrefixes(db)).invoice,
  );

  let partyName = "";
  let departureGroupId: string | null = null;
  if (input.bookingId) {
    const { data: booking, error } = await db
      .from("departure_group_bookings")
      .select("primary_contact_name, departure_group_id, currency")
      .eq("id", input.bookingId)
      .maybeSingle();
    if (error) throw new FinancePersistenceError("departure_group_bookings", "select", error);
    partyName = booking?.primary_contact_name ?? "";
    departureGroupId = (booking?.departure_group_id as string) ?? null;
    if (booking?.currency && booking.currency !== input.currency) {
      return { ok: false, error: `Invoice currency must match the booking currency (${booking.currency}).` };
    }
  } else if (input.supplierCommitmentId) {
    const { data: commitment, error } = await db
      .from("supplier_commitments")
      .select("departure_group_id, suppliers:supplier_id (name)")
      .eq("id", input.supplierCommitmentId)
      .maybeSingle();
    if (error) throw new FinancePersistenceError("supplier_commitments", "select", error);
    departureGroupId = (commitment?.departure_group_id as string) ?? null;
    partyName = ((commitment?.suppliers as { name?: string } | null)?.name as string | undefined) ?? "";
  }

  const { data: invoiceRow, error: insertError } = await db
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      invoice_type: input.invoiceType,
      booking_id: input.bookingId ?? null,
      departure_group_id: departureGroupId,
      supplier_commitment_id: input.supplierCommitmentId ?? null,
      milestone_id: input.milestoneId ?? null,
      party_name: partyName,
      amount: money(input.amount),
      currency: input.currency,
      due_at: input.dueAt ?? null,
      status: "DRAFT",
      notes: input.notes?.trim() || null,
      created_by: actor.id,
      created_by_name: actor.name,
    })
    .select("id")
    .single();
  if (insertError) throw new FinancePersistenceError("invoices", "insert", insertError);
  const invoiceId = invoiceRow.id as string;

  if (input.lineItems.length > 0) {
    const { error: lineError } = await db.from("invoice_line_items").insert(
      input.lineItems.map((item, index) => ({
        invoice_id: invoiceId,
        sequence: index,
        description: item.description,
        quantity: item.quantity,
        unit_amount: money(item.unitAmount),
        line_total: money(item.quantity * item.unitAmount),
      })),
    );
    if (lineError) throw new FinancePersistenceError("invoice_line_items", "insert", lineError);
  }

  await logFinanceEvent(db, {
    bookingId: input.bookingId ?? null,
    departureGroupId,
    invoiceId,
    actor,
    action: "INVOICE_CREATED",
    toValue: invoiceNumber,
  });

  return { ok: true, invoiceId, invoiceNumber };
}

export type IssueInvoiceOutcome = { ok: true } | { ok: false; error: string };

export async function issueInvoice(db: Db, invoiceId: string, actor: FinanceActor): Promise<IssueInvoiceOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("invoices")
    .select("id, status, booking_id, departure_group_id, milestone_id, party_name, party_contact, amount, currency, invoice_type, due_at")
    .eq("id", invoiceId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("invoices", "select", fetchError);
  if (!existing) return { ok: false, error: "That invoice no longer exists." };
  if (existing.status !== "DRAFT") return { ok: false, error: "Only a draft invoice can be issued." };

  const { data: lineItems, error: lineItemsError } = await db
    .from("invoice_line_items")
    .select("description, quantity, unit_amount, line_total")
    .eq("invoice_id", invoiceId)
    .order("sequence", { ascending: true });
  if (lineItemsError) throw new FinancePersistenceError("invoice_line_items", "select", lineItemsError);

  // A point-in-time copy (plan §4.13 gap 5) — a later price edit anywhere
  // upstream can never rewrite what this invoice actually said when it was
  // issued, since the immutability trigger already freezes the row itself
  // from this moment on; this is what a delivery-log/PDF re-render reads
  // instead of re-joining party/line data that could have moved on.
  const issuedSnapshot = {
    partyName: existing.party_name,
    partyContact: existing.party_contact,
    amount: existing.amount,
    currency: existing.currency,
    invoiceType: existing.invoice_type,
    dueAt: existing.due_at,
    lineItems: lineItems ?? [],
  };

  let issueStatus: "ISSUED" | "PAID" = "ISSUED";
  if (existing.milestone_id) {
    const { data: milestone, error: milestoneError } = await db
      .from("booking_payment_milestones")
      .select("amount, paid_amount, waived")
      .eq("id", existing.milestone_id)
      .maybeSingle();
    if (milestoneError) throw new FinancePersistenceError("booking_payment_milestones", "select", milestoneError);
    if (milestone && (milestone.waived || Number(milestone.paid_amount) >= Number(milestone.amount))) issueStatus = "PAID";
  } else if (existing.booking_id) {
    const { data: booking, error: bookingError } = await db
      .from("departure_group_bookings")
      .select("outstanding_balance")
      .eq("id", existing.booking_id)
      .maybeSingle();
    if (bookingError) throw new FinancePersistenceError("departure_group_bookings", "select", bookingError);
    if (booking && Number(booking.outstanding_balance) <= 0) issueStatus = "PAID";
  }

  const { error: updateError } = await db
    .from("invoices")
    .update({ status: issueStatus, issued_at: new Date().toISOString(), issued_snapshot: issuedSnapshot })
    .eq("id", invoiceId);
  if (updateError) throw new FinancePersistenceError("invoices", "update", updateError);

  await logFinanceEvent(db, {
    bookingId: existing.booking_id as string | null,
    departureGroupId: existing.departure_group_id as string | null,
    invoiceId,
    actor,
    action: "INVOICE_ISSUED",
  });

  return { ok: true };
}

export type SendInvoiceOutcome = { ok: true } | { ok: false; error: string };

export async function sendInvoice(db: Db, input: SendInvoiceInput, actor: FinanceActor): Promise<SendInvoiceOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("invoices")
    .select("id, booking_id, departure_group_id")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("invoices", "select", fetchError);
  if (!existing) return { ok: false, error: "That invoice no longer exists." };

  const { error: updateError } = await db
    .from("invoices")
    .update({ sent_channel: input.channel, sent_at: new Date().toISOString() })
    .eq("id", input.invoiceId);
  if (updateError) throw new FinancePersistenceError("invoices", "update", updateError);

  await logFinanceEvent(db, {
    bookingId: existing.booking_id as string | null,
    departureGroupId: existing.departure_group_id as string | null,
    invoiceId: input.invoiceId,
    actor,
    action: "INVOICE_SENT",
    toValue: input.channel,
  });

  return { ok: true };
}

export type VoidInvoiceOutcome = { ok: true } | { ok: false; error: string };

export async function voidInvoice(db: Db, input: VoidInvoiceInput, actor: FinanceActor): Promise<VoidInvoiceOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("invoices")
    .select("id, status, booking_id, departure_group_id")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("invoices", "select", fetchError);
  if (!existing) return { ok: false, error: "That invoice no longer exists." };
  if (existing.status === "VOID") return { ok: false, error: "This invoice is already void." };

  const { error: updateError } = await db
    .from("invoices")
    .update({
      status: "VOID",
      void_reason: input.reason,
      voided_at: new Date().toISOString(),
      void_approved_by: input.approvedBy ?? null,
    })
    .eq("id", input.invoiceId);
  if (updateError) throw new FinancePersistenceError("invoices", "update", updateError);

  await logFinanceEvent(db, {
    bookingId: existing.booking_id as string | null,
    departureGroupId: existing.departure_group_id as string | null,
    invoiceId: input.invoiceId,
    actor,
    action: "INVOICE_VOIDED",
    note: input.reason,
    isHighImpact: true,
  });

  return { ok: true };
}

export async function createCreditNote(
  db: Db,
  invoiceId: string,
  actor: FinanceActor,
): Promise<{ ok: true; invoiceId: string; invoiceNumber: string } | { ok: false; error: string }> {
  const { data: original, error: fetchError } = await db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (fetchError) throw new FinancePersistenceError("invoices", "select", fetchError);
  if (!original) return { ok: false, error: "That invoice no longer exists." };

  const original_row = original as unknown as { booking_id: string | null; departure_group_id: string | null; supplier_commitment_id: string | null; party_name: string; amount: number; currency: string };

  const invoiceNumber = await nextReferenceNumber(
    db,
    "invoices",
    "invoice_number",
    (await getReferencePrefixes(db)).invoice,
  );
  const { data: created, error: insertError } = await db
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      invoice_type: "REFUND_CREDIT_NOTE",
      booking_id: original_row.booking_id,
      departure_group_id: original_row.departure_group_id,
      supplier_commitment_id: original_row.supplier_commitment_id,
      party_name: original_row.party_name,
      amount: original_row.amount,
      currency: original_row.currency,
      status: "ISSUED",
      issued_at: new Date().toISOString(),
      credit_note_of: invoiceId,
      created_by: actor.id,
      created_by_name: actor.name,
    })
    .select("id")
    .single();
  if (insertError) throw new FinancePersistenceError("invoices", "insert", insertError);

  await logFinanceEvent(db, {
    bookingId: original_row.booking_id,
    departureGroupId: original_row.departure_group_id,
    invoiceId: created.id as string,
    actor,
    action: "CREDIT_NOTE_CREATED",
    toValue: invoiceNumber,
  });

  return { ok: true, invoiceId: created.id as string, invoiceNumber };
}
