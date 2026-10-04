"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  changeMilestoneDueDate,
  createCreditNote,
  createInvoice,
  createRefundRequest,
  decideRefund,
  issueInvoice,
  loadBookingMilestones,
  payRefund,
  recordPayment,
  reversePayment,
  sendInvoice,
  verifyPayment,
  voidInvoice,
  type FinanceActor,
} from "@/lib/data/finance-repository";
import {
  closeReconciliationPeriod,
  confirmMatch,
  confirmSplitMatch,
  createReconciliationPeriod,
  fetchRawMatchCandidates,
  importBankTransactions,
  listBankTransactions,
  listMatchLines,
  listReconciliationMatches,
  listReconciliationPeriods,
  parseBankStatementCsv,
  reopenReconciliationPeriod,
  setBankTransactionStatus,
  suggestMatchesForTransaction,
  undoMatch,
  type BankTransactionRow,
  type MatchCandidate,
  type ReconciliationMatchLineRow,
  type ReconciliationMatchRow,
  type ReconciliationPeriodRow,
} from "@/lib/data/reconciliation-repository";
import { rankCandidatesWithNarration } from "@/lib/ai/surfaces/reconciliation/workflows";
import type { RankedCandidate } from "@/lib/finance/reconciliation-candidates";
import type { BookingPaymentMilestoneRow } from "@/lib/types/finance";
import { recordSupplierPaymentAction as recordSupplierPaymentActionForCommitment } from "@/app/(main)/suppliers/actions";
import { requireUser } from "@/lib/dal";
import {
  bankTransactionIdSchema,
  changeMilestoneDueDateSchema,
  closeReconciliationPeriodSchema,
  confirmReconciliationMatchSchema,
  confirmSplitMatchSchema,
  createInvoiceSchema,
  createReconciliationPeriodSchema,
  decideRefundSchema,
  dismissFinanceEvidenceSchema,
  importBankTransactionsSchema,
  matchFinanceEvidenceSchema,
  payRefundSchema,
  recordPaymentSchema,
  refundRequestSchema,
  reversePaymentSchema,
  sendInvoiceSchema,
  toFinanceFieldErrors,
  verifyPaymentSchema,
  voidInvoiceSchema,
} from "@/lib/validations/finance";
import { createClient } from "@/utils/supabase/server";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { createSupabaseFinanceEvidenceRepository } from "@/lib/data/finance-evidence-repository";
import {
  canDecideFinanceEvidence,
  canReviewFinanceEvidence,
  toFinanceEvidenceIntakeItem,
  type FinanceEvidenceIntakeItem,
} from "@/lib/finance/evidence-matching";

export interface FinanceActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function db() {
  return createClient(await cookies());
}

function revalidateFinance(bookingId?: string | null, departureGroupId?: string | null) {
  revalidatePath("/finance/payments");
  revalidatePath("/finance/payment-plans");
  revalidatePath("/dashboard");
  if (departureGroupId) revalidatePath(`/departure-groups/${departureGroupId}`);
  if (bookingId) revalidatePath(`/pilgrims`);
}

async function currentActor(): Promise<{ actor: FinanceActor; role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"] }> {
  const user = await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { actor: { id: user.id, name: name ?? "Staff" }, role };
}

/* ── Payments ─────────────────────────────────────────────────────────────── */

export interface RecordPaymentResult extends FinanceActionResult {
  paymentReference?: string;
}

export async function recordPaymentAction(input: unknown): Promise<RecordPaymentResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.recordPayments) return { ok: false, error: "Your role cannot record payments." };

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await recordPayment(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance(parsed.data.bookingId, parsed.data.departureGroupId);
  return { ok: true, paymentReference: result.paymentReference };
}

export async function verifyPaymentAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.verifyPayments) return { ok: false, error: "Your role cannot verify payments." };

  const parsed = verifyPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await verifyPayment(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function getBookingMilestonesAction(
  bookingId: string,
): Promise<{ ok: true; milestones: BookingPaymentMilestoneRow[] } | { ok: false; error: string }> {
  const { role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.recordPayments && !can.viewReceivables) return { ok: false, error: "Your role cannot view payment milestones." };

  const supabase = await db();
  const milestones = await loadBookingMilestones(supabase, bookingId);
  return { ok: true, milestones };
}

export async function reversePaymentAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.reversePayments) return { ok: false, error: "Your role cannot reverse payments." };

  const parsed = reversePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await reversePayment(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

/* ── Refunds ──────────────────────────────────────────────────────────────── */

export interface CreateRefundRequestResult extends FinanceActionResult {
  reference?: string;
}

export async function createRefundRequestAction(input: unknown): Promise<CreateRefundRequestResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.requestRefunds) return { ok: false, error: "Your role cannot request refunds." };

  const parsed = refundRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await createRefundRequest(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance(parsed.data.bookingId, parsed.data.departureGroupId);
  return { ok: true, reference: result.reference };
}

export async function decideRefundAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.approveRefunds) return { ok: false, error: "Your role cannot approve or reject refunds." };

  const parsed = decideRefundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await decideRefund(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export interface PayRefundResult extends FinanceActionResult {
  paymentReference?: string;
}

export async function payRefundAction(input: unknown): Promise<PayRefundResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.approveRefunds) return { ok: false, error: "Your role cannot pay out refunds." };

  const parsed = payRefundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await payRefund(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true, paymentReference: result.paymentReference };
}

/* ── Milestones ───────────────────────────────────────────────────────────── */

export async function changeMilestoneDueDateAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.changeMilestoneDueDates) return { ok: false, error: "Your role cannot change a payment due date." };

  const parsed = changeMilestoneDueDateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await changeMilestoneDueDate(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

/* ── Invoices ─────────────────────────────────────────────────────────────── */

export interface CreateInvoiceResult extends FinanceActionResult {
  invoiceId?: string;
  invoiceNumber?: string;
}

export async function createInvoiceAction(input: unknown): Promise<CreateInvoiceResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.createInvoices) return { ok: false, error: "Your role cannot create invoices." };

  const parsed = createInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await createInvoice(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance(parsed.data.bookingId);
  return { ok: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber };
}

export async function issueInvoiceAction(invoiceId: string): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.createInvoices) return { ok: false, error: "Your role cannot issue invoices." };

  const supabase = await db();
  const result = await issueInvoice(supabase, invoiceId, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function sendInvoiceAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.sendInvoices) return { ok: false, error: "Your role cannot send invoices." };

  const parsed = sendInvoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await sendInvoice(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function voidInvoiceAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.voidInvoices) return { ok: false, error: "Your role cannot void invoices." };

  const parsed = voidInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await voidInvoice(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function createCreditNoteAction(invoiceId: string): Promise<CreateInvoiceResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.voidInvoices) return { ok: false, error: "Your role cannot create a credit note." };

  const supabase = await db();
  const result = await createCreditNote(supabase, invoiceId, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber };
}

/* ── Supplier payables ────────────────────────────────────────────────────── */

/**
 * Thin wrapper over the Suppliers module's own action (plan §4.8) — the
 * trigger on `supplier_payments` already keeps `supplier_commitments`
 * correct. This module adds a surface, never a second payable model.
 */
export async function recordSupplierPaymentFromFinanceAction(
  input: unknown,
): Promise<FinanceActionResult> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).recordSupplierPayments) {
    return { ok: false, error: "Your role cannot record supplier payments." };
  }
  const result = await recordSupplierPaymentActionForCommitment(input);
  revalidateFinance();
  return result;
}

/* ── Bank reconciliation ──────────────────────────────────────────────────── */

export interface ImportBankTransactionsResult extends FinanceActionResult {
  imported?: number;
  skippedDuplicates?: number;
  flaggedPossibleDuplicates?: number;
}

export async function importBankTransactionsAction(
  input: unknown,
): Promise<ImportBankTransactionsResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.manageReconciliation) {
    return { ok: false, error: "Your role cannot import bank statements." };
  }

  const parsed = importBankTransactionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const { rows, errors } = parseBankStatementCsv(parsed.data.csv);
  if (rows.length === 0) {
    return { ok: false, error: errors[0] ?? "Nothing could be read from that paste." };
  }

  const supabase = await db();
  const result = await importBankTransactions(supabase, parsed.data.bankAccountLabel, rows, actor);
  revalidateFinance();
  return {
    ok: true,
    imported: result.imported,
    skippedDuplicates: result.skippedDuplicates,
    flaggedPossibleDuplicates: result.flaggedPossibleDuplicates,
    error: errors.length > 0 ? `${errors.length} line(s) could not be read and were skipped.` : undefined,
  };
}

export async function listUnmatchedBankTransactionsAction(): Promise<
  { ok: true; transactions: BankTransactionRow[] } | { ok: false; error: string }
> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const supabase = await db();
  const transactions = await listBankTransactions(supabase, "UNMATCHED");
  return { ok: true, transactions };
}

export async function listIgnoredBankTransactionsAction(): Promise<
  { ok: true; transactions: BankTransactionRow[] } | { ok: false; error: string }
> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const supabase = await db();
  const transactions = await listBankTransactions(supabase, "IGNORED");
  return { ok: true, transactions };
}

export async function listReconciliationMatchesAction(): Promise<
  { ok: true; matches: ReconciliationMatchRow[] } | { ok: false; error: string }
> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const supabase = await db();
  const matches = await listReconciliationMatches(supabase);
  return { ok: true, matches };
}

export async function suggestMatchesAction(
  bankTransactionId: string,
): Promise<{ ok: true; candidates: MatchCandidate[] } | { ok: false; error: string }> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const supabase = await db();
  const transactions = await listBankTransactions(supabase, "UNMATCHED");
  const transaction = transactions.find((t) => t.id === bankTransactionId);
  if (!transaction) return { ok: false, error: "That bank line is no longer unmatched." };

  const candidates = await suggestMatchesForTransaction(supabase, transaction);
  return { ok: true, candidates };
}

export interface SuggestMatchesWithAiResult {
  ok: boolean;
  candidates?: RankedCandidate[];
  extractedPayerName?: string | null;
  aiNote?: string | null;
  error?: string;
}

/**
 * Same ranked candidates as `suggestMatchesAction`, boosted by whatever
 * Manasik Copilot could extract from the bank narration (plan §4.19) — the
 * model reads only the fenced, untrusted narration text and returns a
 * payer name / reference candidates; `rankCandidatesWithNarration` feeds
 * those into the same deterministic scorer, it never asks the model for a
 * score or a decision.
 */
export async function suggestMatchesWithAiAction(bankTransactionId: string): Promise<SuggestMatchesWithAiResult> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "No agency on this account." };

  const supabase = await db();
  const transactions = await listBankTransactions(supabase, "UNMATCHED");
  const transaction = transactions.find((t) => t.id === bankTransactionId);
  if (!transaction) return { ok: false, error: "That bank line is no longer unmatched." };

  const { candidates, hasPriorConfirmedPattern } = await fetchRawMatchCandidates(supabase, transaction);
  const { ranked, extraction, note } = await rankCandidatesWithNarration(
    { amount: transaction.amount, statementDate: transaction.statement_date, description: transaction.description, reference: transaction.reference },
    candidates,
    agencyId,
    supabase,
    hasPriorConfirmedPattern,
  );

  return { ok: true, candidates: ranked, extractedPayerName: extraction?.payerName ?? null, aiNote: note };
}

export async function confirmReconciliationMatchAction(
  input: unknown,
): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.manageReconciliation) {
    return { ok: false, error: "Your role cannot confirm a reconciliation match." };
  }

  const parsed = confirmReconciliationMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await confirmMatch(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function undoReconciliationMatchAction(
  input: unknown,
): Promise<FinanceActionResult> {
  const { role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.manageReconciliation) {
    return { ok: false, error: "Your role cannot undo a reconciliation match." };
  }

  const parsed = bankTransactionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await undoMatch(supabase, parsed.data.bankTransactionId);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function ignoreBankTransactionAction(input: unknown): Promise<FinanceActionResult> {
  const { role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.manageReconciliation) {
    return { ok: false, error: "Your role cannot ignore a bank line." };
  }

  const parsed = bankTransactionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await setBankTransactionStatus(supabase, parsed.data.bankTransactionId, "IGNORED");
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function restoreBankTransactionAction(input: unknown): Promise<FinanceActionResult> {
  const { role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.manageReconciliation) {
    return { ok: false, error: "Your role cannot restore a bank line." };
  }

  const parsed = bankTransactionIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await setBankTransactionStatus(supabase, parsed.data.bankTransactionId, "UNMATCHED");
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function confirmSplitMatchAction(input: unknown): Promise<FinanceActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForFinance(role);
  if (!can.manageReconciliation) {
    return { ok: false, error: "Your role cannot confirm a reconciliation match." };
  }

  const parsed = confirmSplitMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await confirmSplitMatch(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export async function listMatchLinesAction(
  matchId: string,
): Promise<{ ok: true; lines: ReconciliationMatchLineRow[] } | { ok: false; error: string }> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const supabase = await db();
  const lines = await listMatchLines(supabase, matchId);
  return { ok: true, lines };
}

/* ── Period close ─────────────────────────────────────────────────────────── */

export async function listReconciliationPeriodsAction(
  bankAccountLabel?: string,
): Promise<{ ok: true; periods: ReconciliationPeriodRow[] } | { ok: false; error: string }> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).viewReconciliation) {
    return { ok: false, error: "Your role cannot view reconciliation." };
  }
  const supabase = await db();
  const periods = await listReconciliationPeriods(supabase, bankAccountLabel);
  return { ok: true, periods };
}

export async function createReconciliationPeriodAction(input: unknown): Promise<FinanceActionResult> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).manageReconciliation) {
    return { ok: false, error: "Your role cannot open a reconciliation period." };
  }
  const parsed = createReconciliationPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }
  const supabase = await db();
  const result = await createReconciliationPeriod(supabase, parsed.data);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

export interface ClosePeriodActionResult extends FinanceActionResult {
  checklist?: { key: string; label: string; done: boolean }[];
}

export async function closeReconciliationPeriodAction(input: unknown): Promise<ClosePeriodActionResult> {
  const { actor, role } = await currentActor();
  if (!capabilitiesForFinance(role).manageReconciliation) {
    return { ok: false, error: "Your role cannot close a reconciliation period." };
  }
  const parsed = closeReconciliationPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toFinanceFieldErrors(parsed.error) };
  }
  const supabase = await db();
  const { periodId, ...rest } = parsed.data;
  const result = await closeReconciliationPeriod(supabase, periodId, rest, actor);
  if (!result.ok) return { ok: false, error: result.error, checklist: result.checklist?.items };

  revalidateFinance();
  return { ok: true };
}

export async function reopenReconciliationPeriodAction(periodId: string): Promise<FinanceActionResult> {
  const { role } = await currentActor();
  if (!capabilitiesForFinance(role).manageReconciliation) {
    return { ok: false, error: "Your role cannot reopen a reconciliation period." };
  }
  const supabase = await db();
  const result = await reopenReconciliationPeriod(supabase, periodId);
  if (!result.ok) return result;

  revalidateFinance();
  return { ok: true };
}

/* ── Receipt evidence intake (FIN-05) ─────────────────────────────────────── */

export type FinanceEvidenceIntakeLoadResult =
  | { ok: true; canDecide: boolean; items: FinanceEvidenceIntakeItem[] }
  | { ok: false; error: string };

export type FinanceEvidenceDecisionResult = { ok: true; message: string } | { ok: false; error: string };

const FINANCE_EVIDENCE_FAILURE = "Could not complete that review. Try again.";

/**
 * Lists receipt evidence waiting for Finance with deterministic payment candidates. Read-only: nothing is applied, and
 * the caller's agency comes from their session, never from the request.
 */
export async function loadFinanceEvidenceIntakeAction(): Promise<FinanceEvidenceIntakeLoadResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your agency could not be identified." };
  if (!capabilitiesForFinance(role).viewLedger || !canReviewFinanceEvidence(role)) {
    return { ok: false, error: "Finance review access is required to see receipt evidence." };
  }

  try {
    const repository = createSupabaseFinanceEvidenceRepository(await db());
    const items = await repository.listUnmatchedEvidenceWithCandidates({ agencyId, viewerRole: role });
    const canOpenInbox = capabilitiesForInbox(role).viewModule;
    return { ok: true, canDecide: canDecideFinanceEvidence(role), items: items.map((item) => toFinanceEvidenceIntakeItem(item, canOpenInbox)) };
  } catch (cause) {
    console.error("Finance evidence intake failed to load:", cause instanceof Error ? cause.message : cause);
    return { ok: false, error: "Could not load receipt evidence. Try again." };
  }
}

async function decideFinanceEvidence(
  run: (input: { agencyId: string; actor: { id: string | null; name: string; role: string } }) => Promise<
    { ok: true } | { ok: false; error: string }
  >,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { actor, role } = await currentActor();
  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your agency could not be identified." };
  if (!capabilitiesForFinance(role).viewLedger || !canDecideFinanceEvidence(role)) {
    return { ok: false, error: "Your role cannot review receipt evidence." };
  }

  try {
    const result = await run({ agencyId, actor: { id: actor.id, name: actor.name, role } });
    if (!result.ok) return result;
    revalidatePath("/finance");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (cause) {
    console.error("Finance evidence review failed:", cause instanceof Error ? cause.message : cause);
    return { ok: false, error: FINANCE_EVIDENCE_FAILURE };
  }
}

/** Links one receipt to one ranked candidate payment. It never verifies, allocates, or edits the payment. */
export async function matchFinanceEvidenceAction(input: unknown): Promise<FinanceEvidenceDecisionResult> {
  await requireUser();
  const parsed = matchFinanceEvidenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid receipt and payment." };

  const outcome = await decideFinanceEvidence(async ({ agencyId, actor }) => {
    const repository = createSupabaseFinanceEvidenceRepository(await db());
    const result = await repository.matchEvidenceToPayment({ agencyId, actor, ...parsed.data });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
  return outcome.ok
    ? { ok: true, message: "Receipt matched to the payment. The payment itself was not verified or changed." }
    : outcome;
}

/** Closes a receipt as not payment proof. A reason is required and audited. */
export async function dismissFinanceEvidenceAction(input: unknown): Promise<FinanceEvidenceDecisionResult> {
  await requireUser();
  const parsed = dismissFinanceEvidenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the receipt and reason." };

  const outcome = await decideFinanceEvidence(async ({ agencyId, actor }) => {
    const repository = createSupabaseFinanceEvidenceRepository(await db());
    const result = await repository.dismissFinanceEvidence({ agencyId, actor, ...parsed.data });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
  return outcome.ok ? { ok: true, message: "Receipt dismissed. No payment was created or changed." } : outcome;
}
