"use server";

import { cookies } from "next/headers";

import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { detectBookingInconsistencies, type BookingInconsistency } from "@/lib/bookings/inconsistencies";
import type { BookingBlocker } from "@/lib/bookings/blockers";
import { explainBookingAnalysis } from "@/lib/ai/surfaces/bookings/workflows";
import { createClient } from "@/utils/supabase/server";

export interface AnalyzeBookingResult {
  ok: boolean;
  inconsistencies?: BookingInconsistency[];
  resolutionSequence?: string;
  inconsistencyNotes?: string;
  error?: string;
}

/**
 * The AI Analysis tab's one Server Action (plan §4.5 Copilot). Blockers are
 * computed client-side from props the page already loaded
 * (`lib/bookings/blockers.ts` is pure and needs nothing this action would
 * have to re-fetch); this action only does the two things that genuinely
 * need a fresh DB read — the originating quote's traveller count and the
 * booking's invoiced total — then asks Manasik Copilot to sequence and
 * explain what was found.
 */
export async function analyzeBookingAction(input: {
  bookingId: string;
  bookingTravellerCount: number;
  bookingTotal: number;
  blockers: BookingBlocker[];
}): Promise<AnalyzeBookingResult> {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesFor(role);
  if (!can.viewModule) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency on this account." };

  const supabase = createClient(await cookies());

  const [{ data: quoteRow }, { data: invoiceRows }] = await Promise.all([
    supabase.from("lead_quotes").select("adults, children").eq("booking_id", input.bookingId).maybeSingle(),
    supabase.from("invoices").select("amount").eq("booking_id", input.bookingId).neq("status", "VOID"),
  ]);

  const quoteTravellerCount = quoteRow ? (quoteRow as { adults: number; children: number }).adults + (quoteRow as { adults: number; children: number }).children : null;
  const invoicedRows = (invoiceRows ?? []) as { amount: number }[];
  const invoicedTotal = invoicedRows.length > 0 ? invoicedRows.reduce((sum, r) => sum + r.amount, 0) : null;

  const inconsistencies = detectBookingInconsistencies({
    bookingTravellerCount: input.bookingTravellerCount,
    quoteTravellerCount,
    bookingTotal: input.bookingTotal,
    invoicedTotal,
  });

  const result = await explainBookingAnalysis({ blockers: input.blockers, inconsistencies }, agencyId, input.bookingId, supabase);
  if (!result.value) return { ok: false, error: result.note ?? "Could not generate an explanation.", inconsistencies };

  return {
    ok: true,
    inconsistencies,
    resolutionSequence: result.value.resolutionSequence,
    inconsistencyNotes: result.value.inconsistencyNotes,
  };
}
