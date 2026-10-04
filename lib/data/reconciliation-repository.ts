/**
 * Bank reconciliation (M8 of docs/architecture/remaining-modules-master-plan.md).
 *
 * `bank_transactions` holds one row per pasted bank statement line;
 * `reconciliation_matches` links a line to the `payments` or
 * `supplier_payments` row it settles. Matching is one-line-to-one-payment for
 * v1 — a bulk transfer covering several bookings is reconciled as several
 * separate bank lines pasted in, not modelled as a many-match here.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { findDuplicateTransaction, type DuplicateCheckTransaction } from "@/lib/finance/duplicate-transaction";
import { evaluatePeriodCloseChecklist, type PeriodCloseChecklistResult } from "@/lib/finance/period-close-checklist";
import { rankCandidates, type RankableCandidate, type RankedCandidate } from "@/lib/finance/reconciliation-candidates";
import type { ParsedBankLine } from "./bank-statement-csv";

export { parseBankStatementCsv, type ParsedBankLine, type ParseBankStatementResult } from "./bank-statement-csv";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ReconciliationPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Reconciliation: ${operation} on ${table} failed — ${detail}`);
    this.name = "ReconciliationPersistenceError";
  }
}

export interface ReconciliationActor {
  id: string | null;
  name: string;
}

export interface BankTransactionRow {
  id: string;
  bank_account_label: string;
  statement_date: string;
  description: string;
  reference: string | null;
  amount: number;
  currency: string;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  import_batch_id: string;
  imported_by_name: string | null;
  duplicate_of_id: string | null;
  created_at: string;
}

export interface ReconciliationMatchRow {
  id: string;
  bank_transaction_id: string;
  matched_type: "PAYMENT" | "SUPPLIER_PAYMENT";
  matched_id: string;
  matched_amount: number;
  matched_label: string;
  matched_by_name: string | null;
  created_at: string;
}

/* ── CSV import ───────────────────────────────────────────────────────────── */

export interface ImportBankTransactionsResult {
  imported: number;
  skippedDuplicates: number;
  /** Rows inserted that were flagged against an existing row via `findDuplicateTransaction` — a different-looking line that still shares a reference/amount/near date, not the exact re-paste `skippedDuplicates` already catches. */
  flaggedPossibleDuplicates: number;
}

/**
 * Inserts parsed bank lines, silently skipping exact duplicates (the same
 * date/description/amount/reference pasted twice) via the table's own unique
 * constraint rather than a pre-check round trip.
 */
export async function importBankTransactions(
  db: Db,
  bankAccountLabel: string,
  rows: ParsedBankLine[],
  actor: ReconciliationActor,
): Promise<ImportBankTransactionsResult> {
  if (rows.length === 0) return { imported: 0, skippedDuplicates: 0, flaggedPossibleDuplicates: 0 };

  const payload = rows.map((r) => ({
    bank_account_label: bankAccountLabel,
    statement_date: r.statementDate,
    description: r.description,
    reference: r.reference,
    amount: r.amount,
    imported_by_name: actor.name,
  }));

  const { data, error } = await db
    .from("bank_transactions")
    .upsert(payload, {
      onConflict: "agency_id,bank_account_label,statement_date,amount,description,reference",
      ignoreDuplicates: true,
    })
    .select("id, reference, amount, statement_date");
  if (error) throw new ReconciliationPersistenceError("bank_transactions", "insert", error);

  const imported = (data ?? []).length;
  const flaggedPossibleDuplicates = await flagPossibleDuplicates(db, bankAccountLabel, toDuplicateCheckRows(data));

  return { imported, skippedDuplicates: rows.length - imported, flaggedPossibleDuplicates };
}

interface RawTransactionRow {
  id: string;
  reference: string | null;
  amount: number;
  statement_date: string;
}

function toDuplicateCheckRows(rows: RawTransactionRow[] | null): DuplicateCheckTransaction[] {
  return (rows ?? []).map((r) => ({ id: r.id, reference: r.reference, amount: r.amount, statementDate: r.statement_date }));
}

/**
 * "Same transaction reference imported twice" (plan §4.19 system signal) —
 * catches a near-duplicate the exact-match unique constraint above lets
 * through (different description text, e.g. two overlapping statement
 * exports). Flags on `bank_transactions.duplicate_of_id`; never merges or
 * deletes a row, a human decides via `setBankTransactionStatus`.
 */
async function flagPossibleDuplicates(
  db: Db,
  bankAccountLabel: string,
  newlyImported: DuplicateCheckTransaction[],
): Promise<number> {
  if (newlyImported.length === 0) return 0;

  const { data: pool, error } = await db
    .from("bank_transactions")
    .select("id, reference, amount, statement_date")
    .eq("bank_account_label", bankAccountLabel)
    .is("duplicate_of_id", null);
  if (error) throw new ReconciliationPersistenceError("bank_transactions", "select", error);

  const existing = toDuplicateCheckRows(pool as RawTransactionRow[] | null);
  let flagged = 0;

  for (const row of newlyImported) {
    const duplicateOfId = findDuplicateTransaction(row, existing);
    if (!duplicateOfId) continue;
    const { error: updateError } = await db
      .from("bank_transactions")
      .update({ duplicate_of_id: duplicateOfId })
      .eq("id", row.id);
    if (updateError) throw new ReconciliationPersistenceError("bank_transactions", "update", updateError);
    flagged += 1;
  }

  return flagged;
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function listBankTransactions(
  db: Db,
  status: BankTransactionRow["status"],
  limit = 300,
): Promise<BankTransactionRow[]> {
  const { data, error } = await db
    .from("bank_transactions")
    .select("*")
    .eq("status", status)
    .order("statement_date", { ascending: false })
    .limit(limit);
  if (error) throw new ReconciliationPersistenceError("bank_transactions", "select", error);
  return (data ?? []) as BankTransactionRow[];
}

export async function listReconciliationMatches(
  db: Db,
  limit = 300,
): Promise<ReconciliationMatchRow[]> {
  const { data, error } = await db
    .from("reconciliation_matches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ReconciliationPersistenceError("reconciliation_matches", "select", error);
  return (data ?? []) as ReconciliationMatchRow[];
}

export type MatchCandidate = RankableCandidate;

const MATCH_WINDOW_DAYS = 10;

function withinWindow(dateA: string, dateB: string): boolean {
  const days = Math.abs(Date.parse(dateA) - Date.parse(dateB)) / 86_400_000;
  return days <= MATCH_WINDOW_DAYS;
}

/**
 * Candidate counterparties for one bank line: same absolute amount, within
 * ±10 days, not already linked to another bank line. A positive bank amount
 * (money in) only ever suggests customer payments; a negative amount (money
 * out) only ever suggests supplier payments — a bank line can't settle both.
 * Ranked and banded by `lib/finance/reconciliation-candidates.ts` — this
 * function's only job is fetching the raw candidate pool; every score comes
 * from that pure module, never computed inline here.
 */
export async function suggestMatchesForTransaction(
  db: Db,
  transaction: BankTransactionRow,
): Promise<RankedCandidate[]> {
  const { candidates, hasPriorConfirmedPattern } = await fetchRawMatchCandidates(db, transaction);
  return rankCandidates(
    { amount: transaction.amount, statementDate: transaction.statement_date, description: transaction.description, reference: transaction.reference },
    candidates,
    { hasPriorConfirmedPattern },
  );
}

export interface RawMatchCandidatePool {
  candidates: MatchCandidate[];
  hasPriorConfirmedPattern: (candidate: RankableCandidate) => boolean;
}

/**
 * The DB-fetch half of `suggestMatchesForTransaction`, split out so the AI
 * layer (`lib/ai/surfaces/reconciliation/workflows.ts`'s
 * `rankCandidatesWithNarration`) can fetch the same pool and rank it with
 * narration-extracted signals added, without duplicating these queries.
 */
export async function fetchRawMatchCandidates(db: Db, transaction: BankTransactionRow): Promise<RawMatchCandidatePool> {
  const amount = Math.abs(transaction.amount);
  const alreadyMatched = await db
    .from("reconciliation_matches")
    .select("matched_type, matched_id, matched_label");
  if (alreadyMatched.error) {
    throw new ReconciliationPersistenceError("reconciliation_matches", "select", alreadyMatched.error);
  }
  const matchedRows = (alreadyMatched.data ?? []) as { matched_type: string; matched_id: string; matched_label: string }[];
  const matchedIds = new Set(matchedRows.map((m) => `${m.matched_type}:${m.matched_id}`));
  // Deterministic "prior confirmed pattern" lookup (plan §4.19): every label
  // ever confirmed for this bank line's counterparty type, so a candidate
  // whose own label recurs among past confirmations gets a boost — never a
  // model guess, just a lookup over `reconciliation_matches`.
  const confirmedLabelsByType = new Map<string, string[]>();
  for (const m of matchedRows) {
    const list = confirmedLabelsByType.get(m.matched_type) ?? [];
    list.push(m.matched_label);
    confirmedLabelsByType.set(m.matched_type, list);
  }

  const candidates: MatchCandidate[] = [];

  if (transaction.amount > 0) {
    const { data, error } = await db
      .from("payments")
      .select("id, payment_reference, amount, paid_at, status, booking_id, departure_group_bookings:booking_id (primary_contact_name)")
      .eq("status", "COMPLETED")
      .gte("amount", amount - 0.01)
      .lte("amount", amount + 0.01);
    if (error) throw new ReconciliationPersistenceError("payments", "select", error);

    for (const row of (data ?? []) as unknown as {
      id: string;
      payment_reference: string;
      amount: number;
      paid_at: string;
      booking_id: string;
      departure_group_bookings: { primary_contact_name: string } | null;
    }[]) {
      if (matchedIds.has(`PAYMENT:${row.id}`)) continue;
      if (!withinWindow(row.paid_at, transaction.statement_date)) continue;
      const counterpartyName = row.departure_group_bookings?.primary_contact_name ?? null;
      candidates.push({
        type: "PAYMENT",
        id: row.id,
        label: `${row.payment_reference} · ${counterpartyName ?? "—"}`,
        amount: Number(row.amount),
        date: row.paid_at,
        counterpartyName,
      });
    }
  } else {
    const { data, error } = await db
      .from("supplier_payments")
      .select(
        "id, amount, paid_at, reference, commitment_id, supplier_commitments:commitment_id (reference_code, suppliers:supplier_id (name))",
      )
      .gte("amount", amount - 0.01)
      .lte("amount", amount + 0.01);
    if (error) throw new ReconciliationPersistenceError("supplier_payments", "select", error);

    for (const row of (data ?? []) as unknown as {
      id: string;
      amount: number;
      paid_at: string;
      reference: string | null;
      supplier_commitments: { reference_code: string; suppliers: { name: string } | null } | null;
    }[]) {
      if (matchedIds.has(`SUPPLIER_PAYMENT:${row.id}`)) continue;
      if (!withinWindow(row.paid_at, transaction.statement_date)) continue;
      const supplierName = row.supplier_commitments?.suppliers?.name ?? "Supplier";
      const reference = row.supplier_commitments?.reference_code ?? row.reference ?? "";
      candidates.push({
        type: "SUPPLIER_PAYMENT",
        id: row.id,
        label: `${supplierName} — ${reference}`,
        amount: Number(row.amount),
        date: row.paid_at,
        counterpartyName: supplierName,
      });
    }
  }

  return {
    candidates,
    hasPriorConfirmedPattern: (candidate) =>
      (confirmedLabelsByType.get(candidate.type) ?? []).some((label) => label === candidate.label),
  };
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

export type ConfirmMatchOutcome = { ok: true } | { ok: false; error: string };

export async function confirmMatch(
  db: Db,
  input: {
    bankTransactionId: string;
    matchedType: "PAYMENT" | "SUPPLIER_PAYMENT";
    matchedId: string;
    matchedAmount: number;
    matchedLabel: string;
  },
  actor: ReconciliationActor,
): Promise<ConfirmMatchOutcome> {
  const { data: existing, error: fetchError } = await db
    .from("bank_transactions")
    .select("id, status")
    .eq("id", input.bankTransactionId)
    .maybeSingle();
  if (fetchError) throw new ReconciliationPersistenceError("bank_transactions", "select", fetchError);
  if (!existing) return { ok: false, error: "That bank line no longer exists." };
  if (existing.status !== "UNMATCHED") {
    return { ok: false, error: "That bank line is no longer unmatched." };
  }

  const { error: insertError } = await db.from("reconciliation_matches").insert({
    bank_transaction_id: input.bankTransactionId,
    matched_type: input.matchedType,
    matched_id: input.matchedId,
    matched_amount: input.matchedAmount,
    matched_label: input.matchedLabel,
    matched_by_name: actor.name,
  });
  if (insertError) {
    if (insertError.code === "23505") {
      return { ok: false, error: "That bank line already has a match." };
    }
    throw new ReconciliationPersistenceError("reconciliation_matches", "insert", insertError);
  }

  const { error: updateError } = await db
    .from("bank_transactions")
    .update({ status: "MATCHED" })
    .eq("id", input.bankTransactionId);
  if (updateError) throw new ReconciliationPersistenceError("bank_transactions", "update", updateError);

  return { ok: true };
}

export interface SplitMatchLine {
  targetType: "PAYMENT" | "SUPPLIER_PAYMENT";
  targetId: string;
  amount: number;
  label: string;
}

export type ConfirmSplitMatchOutcome = { ok: true } | { ok: false; error: string };

/**
 * Many-to-many allocation (plan §4.19 gap 2) — one bank line settling
 * several payments/invoices. The header row's `matched_*` columns keep
 * summarising the first line (so the existing "Recently matched" list needs
 * no rewrite); `reconciliation_match_lines` is the actual allocation. Lines
 * plus any residual must sum to the transaction's absolute amount — a
 * mismatch is rejected before anything is written, not silently allowed to
 * drift from the bank line's real amount.
 */
export async function confirmSplitMatch(
  db: Db,
  input: {
    bankTransactionId: string;
    lines: SplitMatchLine[];
    residualAmount?: number;
    residualType?: "UNALLOCATED_CREDIT" | "BANK_CHARGE";
    residualReason?: string;
  },
  actor: ReconciliationActor,
): Promise<ConfirmSplitMatchOutcome> {
  if (input.lines.length === 0) return { ok: false, error: "At least one allocation line is required." };

  const { data: existing, error: fetchError } = await db
    .from("bank_transactions")
    .select("id, status, amount")
    .eq("id", input.bankTransactionId)
    .maybeSingle();
  if (fetchError) throw new ReconciliationPersistenceError("bank_transactions", "select", fetchError);
  if (!existing) return { ok: false, error: "That bank line no longer exists." };
  if (existing.status !== "UNMATCHED") return { ok: false, error: "That bank line is no longer unmatched." };

  const residualAmount = input.residualAmount ?? 0;
  const linesTotal = input.lines.reduce((sum, l) => sum + l.amount, 0);
  const transactionAbsAmount = Math.abs(existing.amount as number);
  if (Math.abs(linesTotal + residualAmount - transactionAbsAmount) > 0.01) {
    return {
      ok: false,
      error: `Allocation lines (${linesTotal.toFixed(2)}) plus residual (${residualAmount.toFixed(2)}) must sum to the bank line's amount (${transactionAbsAmount.toFixed(2)}).`,
    };
  }
  if (residualAmount !== 0 && !input.residualType) {
    return { ok: false, error: "A residual amount needs a type — unallocated credit or bank charge." };
  }

  const first = input.lines[0];
  const { data: match, error: insertError } = await db
    .from("reconciliation_matches")
    .insert({
      bank_transaction_id: input.bankTransactionId,
      matched_type: first.targetType,
      matched_id: first.targetId,
      matched_amount: first.amount,
      matched_label: input.lines.length > 1 ? `${first.label} +${input.lines.length - 1} more` : first.label,
      matched_by_name: actor.name,
      residual_amount: residualAmount,
      residual_type: input.residualType ?? null,
      residual_reason: input.residualReason ?? null,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return { ok: false, error: "That bank line already has a match." };
    throw new ReconciliationPersistenceError("reconciliation_matches", "insert", insertError);
  }

  const { error: linesError } = await db.from("reconciliation_match_lines").insert(
    input.lines.map((line) => ({
      match_id: (match as { id: string }).id,
      target_type: line.targetType,
      target_id: line.targetId,
      amount: line.amount,
      label: line.label,
    })),
  );
  if (linesError) throw new ReconciliationPersistenceError("reconciliation_match_lines", "insert", linesError);

  const { error: updateError } = await db
    .from("bank_transactions")
    .update({ status: "MATCHED" })
    .eq("id", input.bankTransactionId);
  if (updateError) throw new ReconciliationPersistenceError("bank_transactions", "update", updateError);

  return { ok: true };
}

export interface ReconciliationMatchLineRow {
  id: string;
  match_id: string;
  target_type: "PAYMENT" | "SUPPLIER_PAYMENT";
  target_id: string;
  amount: number;
  label: string;
}

export async function listMatchLines(db: Db, matchId: string): Promise<ReconciliationMatchLineRow[]> {
  const { data, error } = await db
    .from("reconciliation_match_lines")
    .select("*")
    .eq("match_id", matchId);
  if (error) throw new ReconciliationPersistenceError("reconciliation_match_lines", "select", error);
  return (data ?? []) as ReconciliationMatchLineRow[];
}

export type UndoMatchOutcome = { ok: true } | { ok: false; error: string };

export async function undoMatch(
  db: Db,
  bankTransactionId: string,
): Promise<UndoMatchOutcome> {
  const { error: deleteError } = await db
    .from("reconciliation_matches")
    .delete()
    .eq("bank_transaction_id", bankTransactionId);
  if (deleteError) throw new ReconciliationPersistenceError("reconciliation_matches", "select", deleteError);

  const { error: updateError } = await db
    .from("bank_transactions")
    .update({ status: "UNMATCHED" })
    .eq("id", bankTransactionId);
  if (updateError) throw new ReconciliationPersistenceError("bank_transactions", "update", updateError);

  return { ok: true };
}

export async function setBankTransactionStatus(
  db: Db,
  bankTransactionId: string,
  status: "UNMATCHED" | "IGNORED",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db
    .from("bank_transactions")
    .update({ status })
    .eq("id", bankTransactionId)
    .eq("status", status === "IGNORED" ? "UNMATCHED" : "IGNORED");
  if (error) throw new ReconciliationPersistenceError("bank_transactions", "update", error);
  return { ok: true };
}

/* ── Period close (plan §4.19 gap 4) ─────────────────────────────────────────
 * Reuses the existing `manageReconciliation` capability for open/close/reopen
 * rather than introduce a new `finance.closePeriod` capability (which the
 * plan names but which would need its own RBAC migration + seed rows) —
 * this module already gates the closer, riskier reconciliation writes
 * behind that one capability, and a period close is exactly that kind of
 * write. Revisit if a future slice needs a narrower carve-out. */

export interface ReconciliationPeriodRow {
  id: string;
  bank_account_label: string;
  period_from: string;
  period_to: string;
  opening_balance: number;
  closing_balance: number | null;
  status: "OPEN" | "IN_REVIEW" | "CLOSED";
  closed_by_name: string | null;
  closed_at: string | null;
}

export async function listReconciliationPeriods(db: Db, bankAccountLabel?: string): Promise<ReconciliationPeriodRow[]> {
  let query = db.from("reconciliation_periods").select("*").order("period_from", { ascending: false });
  if (bankAccountLabel) query = query.eq("bank_account_label", bankAccountLabel);
  const { data, error } = await query;
  if (error) throw new ReconciliationPersistenceError("reconciliation_periods", "select", error);
  return (data ?? []) as ReconciliationPeriodRow[];
}

export type CreatePeriodOutcome = { ok: true; periodId: string } | { ok: false; error: string };

export async function createReconciliationPeriod(
  db: Db,
  input: { bankAccountLabel: string; periodFrom: string; periodTo: string; openingBalance: number },
): Promise<CreatePeriodOutcome> {
  const { data, error } = await db
    .from("reconciliation_periods")
    .insert({
      bank_account_label: input.bankAccountLabel,
      period_from: input.periodFrom,
      period_to: input.periodTo,
      opening_balance: input.openingBalance,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A period already exists for that account and date range." };
    throw new ReconciliationPersistenceError("reconciliation_periods", "insert", error);
  }
  return { ok: true, periodId: (data as { id: string }).id };
}

export type ClosePeriodOutcome =
  | { ok: true }
  | { ok: false; error: string; checklist?: PeriodCloseChecklistResult };

/**
 * Runs the plan §4.19 checklist server-side before allowing CLOSED — never
 * trusts a client-computed "all clear". `cashCounted` is the one item this
 * function cannot verify itself (there is no ledger row for "cash counted"
 * yet); the caller attests it via `input.cashCounted`, same posture as a
 * physical sign-off a human is asserting happened.
 */
export async function closeReconciliationPeriod(
  db: Db,
  periodId: string,
  input: { closingBalance: number; cashCounted: boolean },
  actor: ReconciliationActor,
): Promise<ClosePeriodOutcome> {
  const { data: period, error: fetchError } = await db
    .from("reconciliation_periods")
    .select("id, bank_account_label, period_from, period_to, status")
    .eq("id", periodId)
    .maybeSingle();
  if (fetchError) throw new ReconciliationPersistenceError("reconciliation_periods", "select", fetchError);
  if (!period) return { ok: false, error: "That period no longer exists." };
  if (period.status === "CLOSED") return { ok: false, error: "That period is already closed." };

  const { count: unmatchedCount, error: unmatchedError } = await db
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("bank_account_label", period.bank_account_label as string)
    .eq("status", "UNMATCHED")
    .gte("statement_date", period.period_from as string)
    .lte("statement_date", period.period_to as string);
  if (unmatchedError) throw new ReconciliationPersistenceError("bank_transactions", "select", unmatchedError);

  const { count: pendingVerificationCount, error: pendingError } = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "PENDING_VERIFICATION");
  if (pendingError) throw new ReconciliationPersistenceError("payments", "select", pendingError);

  const checklist = evaluatePeriodCloseChecklist({
    unmatchedCount: unmatchedCount ?? 0,
    pendingVerificationCount: pendingVerificationCount ?? 0,
    cashCounted: input.cashCounted,
  });
  if (!checklist.ok) {
    return { ok: false, error: "The period-close checklist is not complete yet.", checklist };
  }

  const { error: updateError } = await db
    .from("reconciliation_periods")
    .update({
      status: "CLOSED",
      closing_balance: input.closingBalance,
      closed_by_name: actor.name,
      closed_at: new Date().toISOString(),
    })
    .eq("id", periodId);
  if (updateError) throw new ReconciliationPersistenceError("reconciliation_periods", "update", updateError);

  return { ok: true };
}

export async function reopenReconciliationPeriod(db: Db, periodId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db
    .from("reconciliation_periods")
    .update({ status: "OPEN", closed_by_name: null, closed_at: null })
    .eq("id", periodId)
    .eq("status", "CLOSED");
  if (error) throw new ReconciliationPersistenceError("reconciliation_periods", "update", error);
  return { ok: true };
}
