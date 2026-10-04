/**
 * Context Pack loader for `subjectType: "INVOICE"` — Phase 1 (P1.6). Backs
 * `INVOICE_SEND_REMINDER` in `kinds/invoices.ts`.
 */

import "server-only";

import { hashObject } from "@/lib/agent/kernel/hash";
import { buildContextPack, type ContextPack, type Db } from "@/lib/agent/kernel/proposals/context-pack";
import { isDraftStale, isIssuedUnsent } from "@/lib/invoices/signals";

export interface InvoiceFacts {
  invoiceId: string;
  invoiceNumber: string;
  partyName: string;
  amount: number;
  currency: string;
  status: string;
  dueAt: string | null;
  issuedAt: string | null;
  sentAt: string | null;
  bookingId: string | null;
  issuedUnsent: boolean;
  draftStale: boolean;
}

export type InvoiceContextPack = ContextPack<InvoiceFacts>;

interface InvoiceRow {
  id: string;
  invoice_number: string;
  party_name: string;
  amount: number;
  currency: string;
  status: string;
  due_at: string | null;
  issued_at: string | null;
  sent_at: string | null;
  booking_id: string | null;
  created_at: string;
}

export async function loadInvoicePack(subjectId: string, _agencyId: string, db: Db): Promise<InvoiceContextPack | null> {
  const { data, error } = await db
    .from("invoices")
    .select("id, invoice_number, party_name, amount, currency, status, due_at, issued_at, sent_at, booking_id, created_at")
    .eq("id", subjectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as InvoiceRow;

  const nowIso = new Date().toISOString();
  const facts: InvoiceFacts = {
    invoiceId: row.id,
    invoiceNumber: row.invoice_number,
    partyName: row.party_name,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    dueAt: row.due_at,
    issuedAt: row.issued_at,
    sentAt: row.sent_at,
    bookingId: row.booking_id,
    issuedUnsent: isIssuedUnsent(row.status, row.issued_at, row.sent_at, nowIso),
    draftStale: isDraftStale(row.status, row.created_at, nowIso),
  };

  return buildContextPack<InvoiceFacts>({
    subject: { type: "INVOICE", id: subjectId, label: `${row.invoice_number} (${row.party_name})`, href: `/finance/invoices/${subjectId}` },
    facts,
    fingerprint: hashObject(facts),
  });
}
