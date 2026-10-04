import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForQuotes } from "@/lib/access/quotes-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadLeadStore } from "@/lib/data/leads-repository";
import { isDiscountOutsideBand, isExpiringWithoutFollowUp, snapshotPriceDiffersFromCurrent } from "@/lib/quotes/signals";
import { createClient } from "@/utils/supabase/server";

import QuoteDetailView, { type QuoteDetailData } from "./components/quote-detail-view";

/** Placeholder default until agency-configurable discount bands (plan §4.4 gap 4) exist per role. */
const DEFAULT_DISCOUNT_BAND_PERCENT = 15;

const ROOM_PRICE_COLUMN = {
  QUAD: "quad_price",
  TRIPLE: "triple_price",
  DOUBLE: "double_price",
  SINGLE: "single_price",
} as const;

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForQuotes(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const store = await loadLeadStore(supabase, { only: ["leads", "quotes", "activity"] });

  const quote = store.quotes.find((q) => q.id === quoteId);
  if (!quote) notFound();

  const lead = store.leads.find((l) => l.id === quote.lead_id) ?? null;
  const leadActivity = store.activity.filter((a) => a.lead_id === quote.lead_id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const revisions = store.quotes.filter((q) => q.supersedes_quote_id === quote.id);
  const supersedes = quote.supersedes_quote_id ? store.quotes.find((q) => q.id === quote.supersedes_quote_id) ?? null : null;

  let currentPricePerPerson: number | null = null;
  if (quote.departure_group_id && quote.room_preference !== "UNDECIDED") {
    const column = ROOM_PRICE_COLUMN[quote.room_preference];
    const { data: pricingRow } = await supabase
      .from("departure_group_pricing")
      .select(column)
      .eq("departure_group_id", quote.departure_group_id)
      .maybeSingle();
    const raw = (pricingRow as Record<string, number | null> | null)?.[column];
    currentPricePerPerson = typeof raw === "number" ? raw : null;
  }

  let bookingReference: string | null = null;
  if (quote.booking_id) {
    const { data: bookingRow } = await supabase
      .from("departure_group_bookings")
      .select("booking_reference")
      .eq("id", quote.booking_id)
      .maybeSingle();
    bookingReference = bookingRow?.booking_reference ?? null;
  }

  const nowIso = new Date().toISOString();
  const hasFollowUpSinceSent =
    quote.sent_at !== null &&
    leadActivity.some(
      (a) => (a.type === "CONTACT_LOGGED" || a.type === "FOLLOW_UP_COMPLETED") && Date.parse(a.created_at) > Date.parse(quote.sent_at as string),
    );

  const totalBeforeDiscount = quote.total_lkr + quote.discount_amount;

  const signals = {
    expiringWithoutFollowUp: isExpiringWithoutFollowUp({ status: quote.status, validUntil: quote.valid_until }, nowIso, hasFollowUpSinceSent),
    discountOutsideBand: isDiscountOutsideBand(quote.discount_amount, totalBeforeDiscount, DEFAULT_DISCOUNT_BAND_PERCENT),
    priceDiffersFromCurrent:
      currentPricePerPerson !== null && quote.price_per_person !== null
        ? snapshotPriceDiffersFromCurrent(quote.price_per_person, currentPricePerPerson)
        : false,
  };

  const data: QuoteDetailData = {
    quote,
    lead,
    activity: leadActivity,
    revisions,
    supersedes,
    currentPricePerPerson,
    bookingReference,
    signals,
    discountBandPercent: DEFAULT_DISCOUNT_BAND_PERCENT,
  };

  return <QuoteDetailView data={data} can={can} />;
}
