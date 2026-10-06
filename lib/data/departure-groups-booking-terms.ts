/**
 * Server-side check of the commercial terms a caller puts on a NEW booking —
 * the price, the money already paid and the starting status.
 *
 * These three fields arrive from the client, so the role that submits them
 * cannot be trusted to have honest ones. A role without
 * `overrideCapacityAndPrice` may only sell at the group's own published rates,
 * and a role without `recordPayments` may not create a booking that already
 * claims money was received or that is already confirmed.
 *
 * Pure so it can be unit-tested without the Next server runtime.
 */

import type { DepartureGroupPricingRow } from "@/lib/types/departure-groups";
import type { BookingStatus, RoomType } from "@/app/(main)/departure-groups/types";

export interface BookingCommercialTermsInput {
  bookingStatus: BookingStatus;
  roomOccupancyPreference: RoomType;
  packagePricePerPerson: number;
  amountPaid: number;
  travellers?: { pricePerPerson?: number }[];
}

export interface BookingCommercialTermsCaller {
  overrideCapacityAndPrice: boolean;
  recordPayments: boolean;
}

export type BookingCommercialTermsOutcome =
  | { ok: true }
  | { ok: false; error: string; field: "packagePricePerPerson" | "amountPaid" | "bookingStatus" };

/** Statuses a role without `recordPayments` may start a booking in. */
const STATUSES_WITHOUT_PAYMENT_RIGHTS: readonly BookingStatus[] = [
  "HELD",
  "DEPOSIT_PENDING",
  "WAITLIST",
];

const cents = (value: number) => Math.round(value * 100);

function tierPrice(pricing: DepartureGroupPricingRow, roomType: RoomType): number | null {
  switch (roomType) {
    case "TRIPLE":
      return pricing.triple_price;
    case "DOUBLE":
      return pricing.double_price;
    case "SINGLE":
      return pricing.single_price;
    // "OTHER" is priced off the quad rate everywhere else (add-booking sheet).
    case "QUAD":
    case "OTHER":
    default:
      return pricing.quad_price;
  }
}

export function checkBookingCommercialTerms(
  input: BookingCommercialTermsInput,
  pricing: DepartureGroupPricingRow | null,
  caller: BookingCommercialTermsCaller,
  now: Date = new Date(),
): BookingCommercialTermsOutcome {
  if (!caller.recordPayments) {
    if (input.amountPaid > 0) {
      return {
        ok: false,
        field: "amountPaid",
        error: "Your role cannot record a payment. Create the booking without one and ask finance to record it.",
      };
    }
    if (!STATUSES_WITHOUT_PAYMENT_RIGHTS.includes(input.bookingStatus)) {
      return {
        ok: false,
        field: "bookingStatus",
        error: "Your role can place a hold, take a deposit-pending booking or join the waitlist. Finance confirms it once payment is recorded.",
      };
    }
  }

  if (caller.overrideCapacityAndPrice) return { ok: true };

  if (!pricing) {
    return {
      ok: false,
      field: "packagePricePerPerson",
      error: "This group has no published prices yet, so your role cannot sell it. Ask an administrator to set them.",
    };
  }

  const tier = tierPrice(pricing, input.roomOccupancyPreference);
  if (tier === null) {
    return {
      ok: false,
      field: "packagePricePerPerson",
      error: "This group has no published price for that room type.",
    };
  }

  const earlyBirdLive =
    pricing.early_bird_price !== null &&
    (pricing.early_bird_valid_until === null ||
      Date.parse(pricing.early_bird_valid_until) >= now.getTime());

  const allowedBase = new Set<number>([cents(tier)]);
  if (earlyBirdLive) allowedBase.add(cents(pricing.early_bird_price as number));

  const allowedTraveller = new Set<number>(allowedBase);
  if (pricing.child_price !== null) allowedTraveller.add(cents(pricing.child_price));
  if (pricing.infant_price !== null) allowedTraveller.add(cents(pricing.infant_price));

  if (!allowedBase.has(cents(input.packagePricePerPerson))) {
    return {
      ok: false,
      field: "packagePricePerPerson",
      error: "That price does not match this group's published rate. Only an administrator can set a different price.",
    };
  }

  for (const traveller of input.travellers ?? []) {
    if (traveller.pricePerPerson === undefined) continue;
    if (!allowedTraveller.has(cents(traveller.pricePerPerson))) {
      return {
        ok: false,
        field: "packagePricePerPerson",
        error: "A traveller's price does not match this group's published adult, child or infant rate.",
      };
    }
  }

  return { ok: true };
}

/**
 * Who may cancel a booking. Withdrawing a seat needs `cancelBookings`; a
 * booking that already holds money additionally needs `recordPayments`,
 * because cancelling closes its balance and leaves a refund question that only
 * a finance-capable role should be answering.
 */
export function checkBookingCancellationRights(
  caller: { cancelBookings: boolean; recordPayments: boolean },
  amountPaid: number,
): { ok: true } | { ok: false; error: string } {
  if (!caller.cancelBookings) {
    return { ok: false, error: "Your role cannot cancel bookings." };
  }
  if (amountPaid > 0 && !caller.recordPayments) {
    return {
      ok: false,
      error: "This booking has payments recorded against it. Ask finance or an administrator to cancel it.",
    };
  }
  return { ok: true };
}
