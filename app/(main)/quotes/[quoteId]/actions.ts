"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForQuotes } from "@/lib/access/quotes-access";
import { loadQuotePack } from "@/lib/agent/kernel/proposals/quote-pack";
import { explainQuoteRisk } from "@/lib/ai/surfaces/quotes/workflows";
import { createGroupBooking, getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  cancelQuoteInStore,
  createQuoteRevisionInStore,
  extendQuoteValidityInStore,
  linkQuoteToBookingInStore,
  markLeadBookedInStore,
  updateQuoteStatusInStore,
  type MutationOutcome,
} from "@/lib/data/leads";
import {
  loadLeadStore,
  persistLeadStore,
  snapshotLeadStore,
} from "@/lib/data/leads-repository";
import type { QuoteStatus } from "@/lib/copilot/sales/types";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

async function db() {
  return createClient(await cookies());
}

/** Same posture as `app/(main)/leads/actions.ts`'s own `mutate()` — the leads module is small enough that a whole-store load/diff/write is cheaper than a scoped query layer. */
async function mutate<T extends { ok: boolean }>(run: (store: Awaited<ReturnType<typeof loadLeadStore>>, actorName: string) => T): Promise<T> {
  const supabase = await db();
  const { name } = await getCurrentStaffRole();
  const actorName = name ?? "Staff";

  const store = await loadLeadStore(supabase);
  const before = snapshotLeadStore(store);

  const outcome = run(store, actorName);
  if (!outcome.ok) return outcome;

  await persistLeadStore(supabase, before, store);
  return outcome;
}

function revalidateQuote(quoteId: string) {
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/leads");
}

export async function updateQuoteStatusFromDetailAction(input: { quoteId: string; status: QuoteStatus }): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForQuotes(role);
  if (input.status === "ACCEPTED" && !can.acceptOnBehalf) return { ok: false, error: "Your role cannot accept a quote on the customer's behalf." };
  if (input.status === "DECLINED" && !can.rejectQuote) return { ok: false, error: "Your role cannot reject a quote." };
  if (!can.editQuote && input.status !== "ACCEPTED" && input.status !== "DECLINED") {
    return { ok: false, error: "Your role cannot change this quote's status." };
  }

  const result = await mutate((store, actorName) =>
    updateQuoteStatusInStore(store, { quoteId: input.quoteId, status: input.status, actorName }, new Date().toISOString()),
  );
  if (result.ok) revalidateQuote(input.quoteId);
  return result;
}

export interface CreateRevisionResult extends MutationOutcome {
  quoteId?: string;
}

export async function createQuoteRevisionAction(sourceQuoteId: string): Promise<CreateRevisionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForQuotes(role).createQuote) return { ok: false, error: "Your role cannot draft a quote revision." };

  const result = await mutate((store, actorName) =>
    createQuoteRevisionInStore(store, { sourceQuoteId, actorName }, new Date().toISOString()),
  );
  if (result.ok) revalidateQuote(sourceQuoteId);
  return result;
}

export async function cancelQuoteAction(input: { quoteId: string; reason: string }): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForQuotes(role).editQuote) return { ok: false, error: "Your role cannot cancel a quote." };
  if (!input.reason.trim()) return { ok: false, error: "A reason is required to cancel a quote." };

  const result = await mutate((store, actorName) =>
    cancelQuoteInStore(store, { quoteId: input.quoteId, reason: input.reason.trim(), actorName }, new Date().toISOString()),
  );
  if (result.ok) revalidateQuote(input.quoteId);
  return result;
}

export async function extendQuoteValidityAction(input: { quoteId: string; days: number }): Promise<MutationOutcome> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForQuotes(role).sendQuote) return { ok: false, error: "Your role cannot extend a quote's validity." };

  const result = await mutate((store, actorName) =>
    extendQuoteValidityInStore(store, { quoteId: input.quoteId, days: input.days, actorName }, new Date().toISOString()),
  );
  if (result.ok) revalidateQuote(input.quoteId);
  return result;
}

export interface ExplainQuoteRiskResult {
  ok: boolean;
  summary?: string;
  error?: string;
}

export async function explainQuoteRiskAction(quoteId: string): Promise<ExplainQuoteRiskResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!capabilitiesForQuotes(role).viewModule) return { ok: false, error: "Not permitted." };
  if (!agencyId) return { ok: false, error: "No agency on this account." };

  const supabase = await db();
  const pack = await loadQuotePack(quoteId, agencyId, supabase);
  if (!pack) return { ok: false, error: "That quote no longer exists." };

  const result = await explainQuoteRisk(pack, agencyId, supabase);
  if (!result.value) return { ok: false, error: result.note ?? "Could not generate an explanation." };
  return { ok: true, summary: result.value.summary };
}

export interface ConvertQuoteToBookingResult extends MutationOutcome {
  bookingId?: string;
  bookingReference?: string;
}

/**
 * "Accept → booking without re-entry" — plan §4.4 gap 8. Reads every
 * traveller/price figure from the quote's own snapshot (never re-typed by a
 * human), calls the same `createGroupBooking` mutator the lead-based
 * convert flow uses, then links the quote to the new booking. Idempotent:
 * a quote that already has `booking_id` set returns that booking instead
 * of creating a second one.
 */
export async function convertQuoteToBookingAction(input: {
  quoteId: string;
  primaryContactName: string;
  primaryContactPhone: string;
}): Promise<ConvertQuoteToBookingResult> {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  if (!capabilitiesForQuotes(role).convertToBooking) {
    return { ok: false, error: "Your role cannot convert quotes to bookings." };
  }

  const supabase = await db();
  const store = await loadLeadStore(supabase);
  const quote = store.quotes.find((q) => q.id === input.quoteId);
  if (!quote) return { ok: false, error: "That quote no longer exists." };

  if (quote.booking_id) {
    const { data: existingBooking } = await supabase
      .from("departure_group_bookings")
      .select("booking_reference")
      .eq("id", quote.booking_id)
      .maybeSingle();
    return { ok: true, bookingId: quote.booking_id, bookingReference: existingBooking?.booking_reference ?? undefined };
  }

  if (quote.status !== "ACCEPTED") return { ok: false, error: "Only an accepted quote can be converted to a booking." };
  if (!quote.departure_group_id) return { ok: false, error: "This quote has no departure group selected." };

  const travellerCount = quote.adults + quote.children;
  const roomType = quote.room_preference === "UNDECIDED" ? "TRIPLE" : quote.room_preference;
  const pricePerPerson = quote.price_per_person ?? (travellerCount > 0 ? quote.total_lkr / travellerCount : quote.total_lkr);
  const bookingReference = `QT-${quote.reference.replace(/^QT-/, "")}`;

  const bookingOutcome = await createGroupBooking({
    departureGroupId: quote.departure_group_id,
    leadId: quote.lead_id,
    bookingReference,
    bookingStatus: "DEPOSIT_PENDING",
    primaryContactName: input.primaryContactName,
    primaryContactPhone: input.primaryContactPhone,
    travellerCount,
    roomOccupancyPreference: roomType,
    packagePricePerPerson: pricePerPerson,
    amountPaid: 0,
  });
  if (!bookingOutcome.ok) return bookingOutcome;

  const before = snapshotLeadStore(store);
  const actorName = name ?? "Staff";
  const nowIso = new Date().toISOString();

  const linkOutcome = linkQuoteToBookingInStore(
    store,
    { quoteId: input.quoteId, bookingId: bookingOutcome.result.bookingId, actorName },
    nowIso,
  );
  if (!linkOutcome.ok) return linkOutcome;

  markLeadBookedInStore(
    store,
    { leadId: quote.lead_id, bookingId: bookingOutcome.result.bookingId, bookingReference: bookingOutcome.result.bookingReference, actorName },
    nowIso,
  );

  await persistLeadStore(supabase, before, store);
  revalidateQuote(input.quoteId);
  revalidatePath("/departure-groups");

  return { ok: true, bookingId: bookingOutcome.result.bookingId, bookingReference: bookingOutcome.result.bookingReference };
}
