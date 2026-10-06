"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { canRoleOpenGroup } from "@/lib/access/departure-groups-access";
import { requireUser } from "@/lib/dal";
import {
  getCurrentDepartureCapabilities,
  getCurrentStaffRole,
  getDepartureGroupDetail,
} from "@/lib/data/departure-groups";
import { loadAssignedGroupIds } from "@/lib/data/team-repository";
import { detectBookingInconsistencies, type BookingInconsistency } from "@/lib/bookings/inconsistencies";
import { identifyBookingBlockers } from "@/lib/bookings/blockers";
import { explainBookingAnalysis } from "@/lib/ai/surfaces/bookings/workflows";
import { consumeInboxRateLimit } from "@/lib/inbox/rate-limit/limiter";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

import { resolveGroupIdForBooking } from "./load-booking-detail";

export interface AnalyzeBookingResult {
  ok: boolean;
  inconsistencies?: BookingInconsistency[];
  resolutionSequence?: string;
  inconsistencyNotes?: string;
  error?: string;
}

const analyzeBookingSchema = z.object({
  bookingId: z.uuid({ error: "That booking reference is invalid." }),
});

/**
 * The AI Analysis tab's one Server Action (plan §4.5 Copilot).
 *
 * The browser sends only a booking id. The blockers, traveller count and booking
 * total are recomputed here from the stored booking - anything the client could
 * send is text that would end up in the model prompt, and a figure the person
 * could fake to get a favourable-sounding explanation. The caller must be able to
 * open the booking's group, and each call is counted against a per-person and
 * per-agency limit before the model is reached (the agency's monthly AI budget is
 * checked inside the model call itself).
 *
 * What still needs a fresh read here is the originating quote's traveller count
 * and the booking's invoiced total, which the page never loads.
 */
export async function analyzeBookingAction(input: unknown): Promise<AnalyzeBookingResult> {
  const user = await requireUser();

  const parsed = analyzeBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That request is invalid." };
  }
  const { bookingId } = parsed.data;

  const { role, staffId, agencyId } = await getCurrentStaffRole();
  if (!(await getCurrentDepartureCapabilities()).viewModule) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency on this account." };

  const groupId = await resolveGroupIdForBooking(bookingId);
  if (!groupId) return { ok: false, error: "That booking could not be found." };

  const detail = await getDepartureGroupDetail(groupId, role);
  const booking = detail?.bookings.find((row) => row.id === bookingId);
  if (!detail || !booking) return { ok: false, error: "That booking could not be found." };

  const supabase = createClient(await cookies());
  const assignedGroupIds =
    role === "GUIDE" && staffId ? await loadAssignedGroupIds(supabase, staffId) : [];
  if (!canRoleOpenGroup(detail.group, role, assignedGroupIds)) {
    return { ok: false, error: "You do not have access to that departure group." };
  }

  const travellers = detail.manifest.filter((row) => row.bookingId === bookingId);
  const blockers = identifyBookingBlockers(
    {
      outstandingBalance: booking.outstandingBalance,
      nextDueAt: booking.nextDueAt,
      primaryContactName: booking.primaryContactName,
      primaryContactPhone: booking.primaryContactPhone,
      departureDate: detail.group.departureDate,
      travellers: travellers.map((t) => ({
        fullName: t.fullName,
        passportNumber: t.passportNumber,
        visaStatus: t.visaStatus,
        roomAssignmentStatus: t.roomAssignmentStatus,
        flightStatus: t.flightStatus,
      })),
    },
    new Date().toISOString(),
  );

  const [{ data: quoteRow }, { data: invoiceRows }] = await Promise.all([
    supabase.from("lead_quotes").select("adults, children").eq("booking_id", bookingId).maybeSingle(),
    supabase.from("invoices").select("amount").eq("booking_id", bookingId).neq("status", "VOID"),
  ]);

  const quoteTravellerCount = quoteRow ? (quoteRow as { adults: number; children: number }).adults + (quoteRow as { adults: number; children: number }).children : null;
  const invoicedRows = (invoiceRows ?? []) as { amount: number }[];
  const invoicedTotal = invoicedRows.length > 0 ? invoicedRows.reduce((sum, r) => sum + r.amount, 0) : null;

  const inconsistencies = detectBookingInconsistencies({
    bookingTravellerCount: booking.travellerCount,
    quoteTravellerCount,
    bookingTotal: booking.totalBookingValue,
    invoicedTotal,
  });

  // Nothing to explain means no model call and nothing to count.
  if (blockers.length > 0 || inconsistencies.length > 0) {
    const allowance = await consumeInboxRateLimit(createAdminClient(), {
      agencyId,
      userId: user.id,
      action: "ANALYSE_BOOKING",
    });
    if (!allowance.ok) return { ok: false, error: allowance.error, inconsistencies };
  }

  const result = await explainBookingAnalysis({ blockers, inconsistencies }, agencyId, bookingId, supabase);
  if (!result.value) return { ok: false, error: result.note ?? "Could not generate an explanation.", inconsistencies };

  return {
    ok: true,
    inconsistencies,
    resolutionSequence: result.value.resolutionSequence,
    inconsistencyNotes: result.value.inconsistencyNotes,
  };
}
