"use server";

import { z } from "zod";

import { requireUser } from "@/lib/dal";

import { loadBookingDetailData, resolveGroupIdForBooking } from "./load-booking-detail";

export type BookingDetailPayload = Awaited<ReturnType<typeof loadBookingDetailData>>;

export type LoadBookingDetailResult =
  | { ok: true; data: BookingDetailPayload }
  | { ok: false; error: string };

const loadBookingDetailSchema = z.object({
  bookingId: z.uuid({ error: "That booking reference is invalid." }),
});

/**
 * Loads everything the booking detail dialog shows. Goes through the same
 * `loadBookingDetailData()` the old booking screen used, so the module-access
 * and "can this role open this group" checks are unchanged — a person who
 * could not open the booking before still gets a plain "not available" here.
 */
export async function loadBookingDetailAction(input: unknown): Promise<LoadBookingDetailResult> {
  await requireUser();

  const parsed = loadBookingDetailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That request is invalid." };
  }

  try {
    const groupId = await resolveGroupIdForBooking(parsed.data.bookingId);
    if (!groupId) return { ok: false, error: "This booking could not be found." };
    const data = await loadBookingDetailData(groupId, parsed.data.bookingId);
    return { ok: true, data };
  } catch {
    // `loadBookingDetailData` calls notFound() when the booking is missing or the
    // person has no access to its group; either way the dialog shows one message.
    return { ok: false, error: "This booking is not available to you, or no longer exists in this group." };
  }
}
