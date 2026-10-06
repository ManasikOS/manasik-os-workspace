import { describe, expect, it } from "vitest";

import {
  checkBookingCommercialTerms,
  type BookingCommercialTermsInput,
} from "./departure-groups-booking-terms";
import type { DepartureGroupPricingRow } from "@/lib/types/departure-groups";

const pricing: DepartureGroupPricingRow = {
  departure_group_id: "g1",
  currency: "LKR",
  quad_price: 500000,
  triple_price: 550000,
  double_price: 600000,
  single_price: 800000,
  child_price: 300000,
  infant_price: 50000,
  early_bird_price: 450000,
  early_bird_valid_until: "2026-12-31T00:00:00Z",
  advance_deposit: null,
  payment_milestones: [],
  price_source: "TEMPLATE",
  priced_by: null,
  priced_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const sales = { overrideCapacityAndPrice: false, recordPayments: false };
const finance = { overrideCapacityAndPrice: false, recordPayments: true };
const admin = { overrideCapacityAndPrice: true, recordPayments: true };
const now = new Date("2026-10-06T00:00:00Z");

function terms(overrides: Partial<BookingCommercialTermsInput> = {}): BookingCommercialTermsInput {
  return {
    bookingStatus: "HELD",
    roomOccupancyPreference: "QUAD",
    packagePricePerPerson: 500000,
    amountPaid: 0,
    ...overrides,
  };
}

describe("checkBookingCommercialTerms", () => {
  it("accepts a hold at the published tier price for a sales role", () => {
    expect(checkBookingCommercialTerms(terms(), pricing, sales, now).ok).toBe(true);
  });

  it("refuses a lowered price for a sales role", () => {
    const outcome = checkBookingCommercialTerms(terms({ packagePricePerPerson: 0 }), pricing, sales, now);
    expect(outcome).toMatchObject({ ok: false, field: "packagePricePerPerson" });
  });

  it("refuses a price that matches a different room tier", () => {
    const outcome = checkBookingCommercialTerms(
      terms({ roomOccupancyPreference: "SINGLE", packagePricePerPerson: 500000 }),
      pricing,
      sales,
      now,
    );
    expect(outcome.ok).toBe(false);
  });

  it("accepts a live early-bird price and rejects an expired one", () => {
    const early = terms({ packagePricePerPerson: 450000 });
    expect(checkBookingCommercialTerms(early, pricing, sales, now).ok).toBe(true);
    expect(
      checkBookingCommercialTerms(early, pricing, sales, new Date("2027-02-01T00:00:00Z")).ok,
    ).toBe(false);
  });

  it("accepts child and infant rates per traveller but not an arbitrary one", () => {
    const ok = terms({ travellers: [{ pricePerPerson: 300000 }, { pricePerPerson: 50000 }] });
    expect(checkBookingCommercialTerms(ok, pricing, sales, now).ok).toBe(true);
    const bad = terms({ travellers: [{ pricePerPerson: 1 }] });
    expect(checkBookingCommercialTerms(bad, pricing, sales, now).ok).toBe(false);
  });

  it("refuses to sell when the group has no published prices", () => {
    expect(checkBookingCommercialTerms(terms(), null, sales, now).ok).toBe(false);
  });

  it("refuses any paid amount without recordPayments", () => {
    const outcome = checkBookingCommercialTerms(terms({ amountPaid: 1000 }), pricing, sales, now);
    expect(outcome).toMatchObject({ ok: false, field: "amountPaid" });
  });

  it("refuses CONFIRMED and CANCELLED starting statuses without recordPayments", () => {
    for (const bookingStatus of ["CONFIRMED", "CANCELLED"] as const) {
      const outcome = checkBookingCommercialTerms(terms({ bookingStatus }), pricing, sales, now);
      expect(outcome).toMatchObject({ ok: false, field: "bookingStatus" });
    }
  });

  it("lets finance confirm and take a deposit at the published price, but not reprice", () => {
    const paid = terms({ bookingStatus: "CONFIRMED", amountPaid: 100000 });
    expect(checkBookingCommercialTerms(paid, pricing, finance, now).ok).toBe(true);
    expect(
      checkBookingCommercialTerms(terms({ packagePricePerPerson: 1 }), pricing, finance, now).ok,
    ).toBe(false);
  });

  it("lets an administrator set any price", () => {
    const outcome = checkBookingCommercialTerms(
      terms({ packagePricePerPerson: 123, bookingStatus: "CONFIRMED", amountPaid: 100 }),
      null,
      admin,
      now,
    );
    expect(outcome.ok).toBe(true);
  });
});
