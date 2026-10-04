import { describe, expect, it } from "vitest";

import { detectBookingInconsistencies, type InconsistencyCheckInput } from "./inconsistencies";

function baseInput(overrides: Partial<InconsistencyCheckInput> = {}): InconsistencyCheckInput {
  return { bookingTravellerCount: 3, quoteTravellerCount: 3, bookingTotal: 300000, invoicedTotal: 300000, ...overrides };
}

describe("detectBookingInconsistencies", () => {
  it("finds nothing when everything agrees", () => {
    expect(detectBookingInconsistencies(baseInput())).toEqual([]);
  });

  it("flags a traveller count mismatch against the originating quote", () => {
    const result = detectBookingInconsistencies(baseInput({ bookingTravellerCount: 4, quoteTravellerCount: 3 }));
    expect(result.some((i) => i.id === "traveller-count-mismatch")).toBe(true);
  });

  it("does not flag traveller count when there's no originating quote", () => {
    const result = detectBookingInconsistencies(baseInput({ bookingTravellerCount: 4, quoteTravellerCount: null }));
    expect(result.some((i) => i.id === "traveller-count-mismatch")).toBe(false);
  });

  it("flags an invoice total that doesn't match the booking total", () => {
    const result = detectBookingInconsistencies(baseInput({ invoicedTotal: 250000 }));
    expect(result.some((i) => i.id === "invoice-total-mismatch")).toBe(true);
  });

  it("does not flag when no invoice has been issued yet", () => {
    const result = detectBookingInconsistencies(baseInput({ invoicedTotal: null }));
    expect(result.some((i) => i.id === "invoice-total-mismatch")).toBe(false);
  });

  it("tolerates cents-level float drift on the invoice total", () => {
    const result = detectBookingInconsistencies(baseInput({ bookingTotal: 300000, invoicedTotal: 300000.005 }));
    expect(result.some((i) => i.id === "invoice-total-mismatch")).toBe(false);
  });
});
