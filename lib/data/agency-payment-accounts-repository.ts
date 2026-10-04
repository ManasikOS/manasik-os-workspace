/**
 * The agency's approved bank accounts (MI4.1) — the locked list `BANK_DETAIL_MISMATCH` compares customer-quoted account numbers
 * against. Reads and writes run through the signed-in client, so the table's policy (read: sales/ops/finance/admin; write: ADMIN
 * and FINANCE only) backs the role check the action makes. Every query still names the agency.
 */

import "server-only";

import { z } from "zod";

import type { Db } from "@/lib/ai/db";

export interface ApprovedPaymentAccount {
  id: string;
  label: string;
  bankName: string;
  /** Only the last four digits ever leave the server: the full number is a bank detail, and staff can read it at the bank. */
  maskedAccount: string;
  active: boolean;
  createdAt: string;
}

/** "1234 5678" and "12345678" are the same account, so only the digits are kept. */
export function accountDigitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

export const approvedPaymentAccountInputSchema = z.object({
  label: z.string().trim().min(1, "Give the account a name your team will recognise.").max(120, "Keep the name under 120 characters."),
  bankName: z.string().trim().max(120, "Keep the bank name under 120 characters.").default(""),
  accountNumber: z
    .string()
    .transform(accountDigitsOf)
    .pipe(z.string().regex(/^[0-9]{6,20}$/, "An account number has 6 to 20 digits.")),
});
export type ApprovedPaymentAccountInput = z.input<typeof approvedPaymentAccountInputSchema>;

type Row = Record<string, unknown>;

const maskAccount = (digits: string) => `•••• ${digits.slice(-4)}`;

function toAccount(row: Row): ApprovedPaymentAccount {
  return {
    id: String(row.id),
    label: String(row.label),
    bankName: String(row.bank_name ?? ""),
    maskedAccount: maskAccount(String(row.account_digits ?? "")),
    active: row.active !== false,
    createdAt: String(row.created_at),
  };
}

export async function listApprovedPaymentAccounts(db: Db, agencyId: string): Promise<ApprovedPaymentAccount[]> {
  const { data, error } = await db
    .from("agency_payment_accounts")
    .select("id, label, bank_name, account_digits, active, created_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the approved accounts: ${error.message}`);
  return ((data ?? []) as Row[]).map(toAccount);
}

/** Adds an account. Listing the same number twice is refused with a plain message, not a database error. */
export async function addApprovedPaymentAccount(db: Db, agencyId: string, createdBy: string, input: z.output<typeof approvedPaymentAccountInputSchema>): Promise<void> {
  const { error } = await db.from("agency_payment_accounts").insert({
    agency_id: agencyId,
    label: input.label,
    bank_name: input.bankName,
    account_digits: input.accountNumber,
    created_by: createdBy,
  });
  if (error?.code === "23505") throw new Error("That account number is already on the list.");
  if (error) throw new Error(`Could not add the account: ${error.message}`);
}

/**
 * Turns an account off or back on. Nothing is deleted: a switched-off account stays on record, but a customer quoting it is
 * flagged again, which is what a closed or compromised account should do.
 */
export async function setApprovedPaymentAccountActive(db: Db, agencyId: string, accountId: string, active: boolean): Promise<void> {
  const { data, error } = await db.from("agency_payment_accounts").update({ active }).eq("agency_id", agencyId).eq("id", accountId).select("id").maybeSingle();
  if (error) throw new Error(`Could not update the account: ${error.message}`);
  if (!data) throw new Error("That account could not be found.");
}
