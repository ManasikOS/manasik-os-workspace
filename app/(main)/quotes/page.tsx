import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForQuotes } from "@/lib/access/quotes-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadLeadStore } from "@/lib/data/leads-repository";
import { createClient } from "@/utils/supabase/server";

import QuotesListView, { type QuoteListRow } from "./components/quotes-list-view";

/**
 * Quotes already exist as `lead_quotes` with a full lifecycle
 * (`QuoteStatus`: DRAFT/PENDING_APPROVAL/SENT/VIEWED/EXPIRED/ACCEPTED/
 * DECLINED/SUPERSEDED/CANCELLED) and are created today from a lead's "Send
 * Quote" sheet (`app/(main)/leads/components/send-quote-sheet.tsx`). This
 * page reads the same tenant-scoped `loadLeadStore()` every leads page
 * already uses, joins quotes to their lead's contact details, and links
 * each row to `/quotes/[quoteId]` — Phase 1 (P1.4)'s real detail page.
 *
 * Gated on `capabilitiesForQuotes` (registered Phase 0, wired in Phase 1)
 * rather than the leads module's `viewQuotes` this page originally used —
 * the two capability sets are seeded independently, so an agency that has
 * customised one does not silently affect the other.
 */
export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForQuotes(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const store = await loadLeadStore(supabase, { only: ["leads", "quotes"] });

  const leadsById = new Map(store.leads.map((l) => [l.id, l]));
  const quotes: QuoteListRow[] = store.quotes
    .map((q) => {
      const lead = leadsById.get(q.lead_id);
      return {
        id: q.id,
        leadId: q.lead_id,
        reference: q.reference,
        contactName: lead?.full_name ?? "—",
        contactPhone: lead?.mobile ?? "",
        status: q.status,
        packageName: q.pricing_snapshot.packageName,
        groupLabel: q.pricing_snapshot.groupLabel,
        adults: q.adults,
        children: q.children,
        totalLkr: q.total_lkr,
        depositLkr: q.deposit_lkr,
        currency: q.pricing_snapshot.currency,
        validUntil: q.valid_until,
        sentAt: q.sent_at,
        createdAt: q.created_at,
        createdByName: q.created_by_name,
      } satisfies QuoteListRow;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return <QuotesListView quotes={quotes} canManage={can.acceptOnBehalf || can.rejectQuote} />;
}
