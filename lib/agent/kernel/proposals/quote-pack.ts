/**
 * Context Pack loader for `subjectType: "QUOTE"` — Phase 1 (P1.4). Backs
 * the three quote proposal kinds in `kinds/quotes.ts`. Follows the same
 * direct-query shape as `booking-pack.ts`'s `loadBookingPack` rather than
 * the whole-lead-store loader `lib/data/leads-repository.ts` uses — a
 * single quote by id doesn't need the rest of the leads graph.
 */

import "server-only";

import { hashObject } from "@/lib/agent/kernel/hash";
import { buildContextPack, type ContextPack, type Db } from "@/lib/agent/kernel/proposals/context-pack";
import { isDiscountOutsideBand, isExpiringWithoutFollowUp } from "@/lib/quotes/signals";

const DEFAULT_DISCOUNT_BAND_PERCENT = 15;

export interface QuoteFacts {
  quoteId: string;
  reference: string;
  leadId: string;
  contactName: string;
  status: string;
  totalLkr: number;
  depositLkr: number;
  discountAmount: number;
  validUntil: string;
  sentAt: string | null;
  discountOutsideBand: boolean;
  expiringWithoutFollowUp: boolean;
}

export type QuoteContextPack = ContextPack<QuoteFacts>;

interface QuoteRow {
  id: string;
  lead_id: string;
  reference: string;
  status: string;
  total_lkr: number;
  deposit_lkr: number;
  discount_amount: number;
  valid_until: string;
  sent_at: string | null;
  leads: { full_name: string } | null;
}

export async function loadQuotePack(subjectId: string, _agencyId: string, db: Db): Promise<QuoteContextPack | null> {
  const { data, error } = await db
    .from("lead_quotes")
    .select("id, lead_id, reference, status, total_lkr, deposit_lkr, discount_amount, valid_until, sent_at, leads:lead_id ( full_name )")
    .eq("id", subjectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as QuoteRow;

  const nowIso = new Date().toISOString();
  const hasFollowUpSinceSent = false; // conservative default — this pack has no activity feed; the deterministic scan in the detail page has the real signal.

  const facts: QuoteFacts = {
    quoteId: row.id,
    reference: row.reference,
    leadId: row.lead_id,
    contactName: row.leads?.full_name ?? "—",
    status: row.status,
    totalLkr: row.total_lkr,
    depositLkr: row.deposit_lkr,
    discountAmount: row.discount_amount,
    validUntil: row.valid_until,
    sentAt: row.sent_at,
    discountOutsideBand: isDiscountOutsideBand(row.discount_amount, row.total_lkr + row.discount_amount, DEFAULT_DISCOUNT_BAND_PERCENT),
    expiringWithoutFollowUp: isExpiringWithoutFollowUp({ status: row.status, validUntil: row.valid_until }, nowIso, hasFollowUpSinceSent),
  };

  return buildContextPack<QuoteFacts>({
    subject: { type: "QUOTE", id: subjectId, label: `${row.reference} (${facts.contactName})`, href: `/quotes/${subjectId}` },
    facts,
    fingerprint: hashObject(facts),
  });
}
