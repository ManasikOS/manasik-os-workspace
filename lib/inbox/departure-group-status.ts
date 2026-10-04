/**
 * Several different things can sit behind "departure group", and staff must never see one word for all of them:
 * nothing yet, something Copilot recommends, something staff chose, seats held for a while, and a real booking.
 */

import { formatTimeLeft } from "@/lib/inbox/reply-window-notice";

export type DepartureGroupStatusKind = "NONE" | "RECOMMENDED" | "PREFERENCE" | "SEAT_HOLD" | "BOOKED";

export interface DepartureGroupStatus {
  kind: DepartureGroupStatusKind;
  /** The small label above the group name: "Recommended", "Lead preference", "Seat hold", "Hold expired", "Booked" or "Not chosen". */
  label: string;
  /** The line under it. */
  headline: string;
  detail: string | null;
}

/** "Paid in full" or "Balance due"; null when the balance is not known or not the viewer's to see. */
export function paymentStatusLabel(outstandingBalance: number | null): string | null {
  if (outstandingBalance === null || !Number.isFinite(outstandingBalance)) return null;
  return outstandingBalance > 0 ? "Balance due" : "Paid in full";
}

export function departureGroupStatusFor(input: {
  selectedDepartureGroupId: string | null;
  booking: { reference: string; status: string; groupName?: string | null; outstandingBalance?: number | null; holdExpiresAt?: string | null } | null;
  /** The clock the hold countdown is measured against; passed in so the mapper stays pure. */
  now?: Date;
  /** Copilot's best match, if it has one. */
  recommended: { departureGroupId: string; title: string } | null;
}): DepartureGroupStatus {
  const { selectedDepartureGroupId, booking, recommended } = input;
  const now = input.now ?? new Date();

  // A held booking is not a booking yet: the seats are kept for a while, and the hold can lapse.
  if (booking && booking.status === "HELD") {
    const groupName = booking.groupName?.trim() || null;
    const headline = groupName ?? `Booking ${booking.reference}`;
    const expiresAt = booking.holdExpiresAt ? Date.parse(booking.holdExpiresAt) : Number.NaN;
    if (Number.isNaN(expiresAt)) {
      return { kind: "SEAT_HOLD", label: "Seat hold", headline, detail: "Seats are held for the customer. No expiry is recorded." };
    }
    const minutesLeft = (expiresAt - now.getTime()) / 60_000;
    if (minutesLeft <= 0) {
      return { kind: "SEAT_HOLD", label: "Hold expired", headline, detail: "The hold has run out, so the seats may have been released. Check the group before you promise them." };
    }
    return { kind: "SEAT_HOLD", label: "Seat hold", headline, detail: `Seats are held for the customer. Expires in ${formatTimeLeft(minutesLeft)}.` };
  }

  if (booking) {
    // The booking is the truth: name its group when known, else the reference. Payment is shown only when the caller may see balances.
    const payment = paymentStatusLabel(booking.outstandingBalance ?? null);
    const groupName = booking.groupName?.trim() || null;
    const parts = [groupName ? `Booking ${booking.reference}` : null, `Status: ${booking.status.replaceAll("_", " ").toLowerCase()}`, payment ? `Payment: ${payment.toLowerCase()}` : null];
    return {
      kind: "BOOKED",
      label: "Booked",
      headline: groupName ?? `Booking ${booking.reference}`,
      detail: parts.filter(Boolean).join(" · "),
    };
  }

  if (selectedDepartureGroupId) {
    const named = recommended?.departureGroupId === selectedDepartureGroupId ? recommended.title : null;
    return {
      kind: "PREFERENCE",
      label: "Lead preference",
      headline: named ?? "A departure group is chosen",
      detail: "Chosen by staff. No booking has been started.",
    };
  }

  if (recommended) {
    return {
      kind: "RECOMMENDED",
      label: "Recommended",
      headline: recommended.title,
      detail: "Copilot's suggestion. Nobody has chosen it yet.",
    };
  }

  return { kind: "NONE", label: "Not chosen", headline: "No departure selected", detail: null };
}
