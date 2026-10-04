/**
 * Cross-record inconsistency detection — plan §4.5 Copilot
 * "detectInconsistencies": code diffs the quote snapshot, the booking, and
 * invoice totals against each other; the AI layer only ever explains the
 * probable cause and names the right owner, it never decides whether a
 * mismatch exists.
 */

export interface BookingInconsistency {
  id: string;
  message: string;
}

export interface InconsistencyCheckInput {
  bookingTravellerCount: number;
  /** The originating quote's adults+children, or null when this booking wasn't converted from a quote. */
  quoteTravellerCount: number | null;
  bookingTotal: number;
  /** Sum of this booking's invoice line totals, or null when no invoice has been issued yet. */
  invoicedTotal: number | null;
}

const AMOUNT_TOLERANCE = 0.01;

export function detectBookingInconsistencies(input: InconsistencyCheckInput): BookingInconsistency[] {
  const inconsistencies: BookingInconsistency[] = [];

  if (input.quoteTravellerCount !== null && input.quoteTravellerCount !== input.bookingTravellerCount) {
    inconsistencies.push({
      id: "traveller-count-mismatch",
      message: `${input.bookingTravellerCount} traveller${input.bookingTravellerCount === 1 ? "" : "s"} on this booking, but the originating quote was for ${input.quoteTravellerCount}.`,
    });
  }

  if (input.invoicedTotal !== null && Math.abs(input.invoicedTotal - input.bookingTotal) > AMOUNT_TOLERANCE) {
    inconsistencies.push({
      id: "invoice-total-mismatch",
      message: `Invoiced total (${input.invoicedTotal.toFixed(2)}) does not match the booking total (${input.bookingTotal.toFixed(2)}).`,
    });
  }

  return inconsistencies;
}
