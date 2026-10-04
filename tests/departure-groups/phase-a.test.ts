import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingFixture, operationalFixture, NOW, SCENARIOS, schedule, TENANTS } from "./fixtures";
import { deriveReadinessStatuses } from "@/lib/data/departure-groups-readiness";
import { cancelGroupBookingInStore, recordBookingPaymentInStore, reverseBookingPaymentInStore } from "@/lib/data/departure-groups-bookings";
import { derivePaymentStatus, resolveNextMilestoneDueDate, sumBillableChargeLines } from "@/lib/data/departure-groups-money";
import { buildPaymentMilestonesForBooking } from "@/lib/data/pilgrims";
import { buildReceivablesAging } from "@/lib/data/reports-finance";
import { formatExactCurrency } from "@/app/(main)/departure-groups/utils";
import type { ReportMilestoneFact } from "@/lib/types/reports";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => vi.useRealTimers());

describe("Phase A: existing invariants", () => {
  it.each(["GROUP", "OWN_FLIGHT", "LAND_ONLY"] as const)("builds the %s operational fixture", (mode) => {
    const { data, pilgrim } = operationalFixture(mode);
    expect(data.accommodations.map((a) => a.city)).toEqual(["MAKKAH", "MADINAH"]);
    expect(data.roomAssignments).toHaveLength(1);
    expect(pilgrim.excluded_from_group_flight).toBe(mode !== "GROUP");
    expect(data.flights).toHaveLength(2);
  });
  it.each(SCENARIOS)("$name preserves billable value and seat accounting", (s) => {
    const { data, group, booking } = bookingFixture({ ...s, fares: [...s.fares] });
    expect(booking.total_booking_value).toBe(s.fares.reduce((a, b) => a + b, 0));
    expect(sumBillableChargeLines(data.pilgrimCharges)).toBe(booking.total_booking_value);
    expect(booking.outstanding_balance).toBe(booking.total_booking_value - s.paid);
    const consumes = booking.booking_status !== "WAITLIST";
    expect(group.booked_seats + group.held_seats).toBe(consumes ? s.fares.length : 0);
    expect(group.available_seats).toBe(group.capacity - group.booked_seats - group.held_seats);
  });

  it("keeps two tenant fixtures independent (not an RLS test)", () => {
    const a = bookingFixture();
    const b = bookingFixture({ tenant: "b", currency: "USD" });
    expect(a.group.agency_id).toBe(TENANTS.a);
    expect(b.group.agency_id).toBe(TENANTS.b);
    expect(a.data.bookings.some((row) => row.id === b.booking.id)).toBe(false);
    expect(b.data.pricing[0].currency).toBe("USD");
    a.booking.amount_paid = 25;
    expect(b.booking.amount_paid).toBe(0);
  });

  it("excludes unapproved and voided lines but retains an approved discount", () => {
    const { data } = bookingFixture();
    const base = data.pilgrimCharges[0];
    expect(sumBillableChargeLines([
      base, { ...base, amount: 200, requires_approval: true },
      { ...base, amount: 300, voided_at: NOW }, { ...base, amount: -100 },
    ])).toBe(900);
  });

  it("rejects overpayment without mutating the store", () => {
    const { data, booking, actor, group } = bookingFixture({ paid: 900 });
    const before = structuredClone(data);
    expect(recordBookingPaymentInStore(data, { bookingId: booking.id, departureGroupId: group.id, amount: 101 }, actor, NOW).ok).toBe(false);
    expect(data).toEqual(before);
  });

  it("cancellation releases family seats and preserves collected money", () => {
    const { data, booking, actor, group } = bookingFixture({ fares: [1000, 600], paid: 500 });
    const result = cancelGroupBookingInStore(data, { bookingId: booking.id, departureGroupId: group.id, reason: "Test cancellation", refundAmount: 200 }, actor, NOW);
    expect(result.ok).toBe(true);
    expect(booking.outstanding_balance).toBe(0);
    expect(booking.amount_paid).toBe(500);
    expect(group.available_seats).toBe(group.capacity);
    expect(data.pilgrims.every((p) => p.seat_status === "CANCELLED")).toBe(true);
  });
});

describe("Phase A: fixed regression coverage", () => {
  it("DG-20 one city's assignment does not complete two-city rooming", () => {
    const { data, group, readiness } = operationalFixture();
    deriveReadinessStatuses(data, group.id);
    expect(readiness.status).not.toBe("COMPLETE");
  });
  it("DG-21 cancellation removes a traveller from ticketed counts", () => {
    const { data, group, booking, actor, pilgrim } = operationalFixture();
    pilgrim.flight_status = "TICKETED";
    data.flights.forEach((f) => { f.seats_ticketed = 1; });
    expect(cancelGroupBookingInStore(data, { bookingId: booking.id, departureGroupId: group.id, reason: "Cancellation", refundAmount: 0 }, actor, NOW).ok).toBe(true);
    expect(data.flights.map((f) => f.seats_ticketed)).toEqual([0, 0]);
  });
  it("DG-04 unpaid debt past due is overdue", () => {
    expect(derivePaymentStatus(1000, 0, "2026-09-01T00:00:00Z", Date.parse(NOW))).toBe("OVERDUE");
  });
  it("DG-04 zero obligation is settled", () => {
    expect(derivePaymentStatus(0, 0, null, Date.parse(NOW))).toBe("PAID_IN_FULL");
  });
  it("DG-04 one cent short does not advance the installment", () => {
    expect(resolveNextMilestoneDueDate(schedule(), 1000, 299.99, "2026-10-15", NOW)).toBe(NOW);
  });
  it("DG-04 partial settlement advances next due date", () => {
    const { data, booking, actor, group } = bookingFixture();
    const result = recordBookingPaymentInStore(data, { bookingId: booking.id, departureGroupId: group.id, amount: 300 }, actor, NOW);
    expect(result.ok).toBe(true);
    expect(booking.next_due_at).toBe("2026-09-20T17:00:00.000Z");
  });
  it("DG-04 reversal restores a settled booking's due date", () => {
    const { data, booking, actor, group } = bookingFixture({ paid: 1000 });
    const result = reverseBookingPaymentInStore(data, { bookingId: booking.id, departureGroupId: group.id, amount: 100, reason: "Correction" }, actor, NOW);
    expect(result.ok).toBe(true);
    expect(booking.next_due_at).toBe("2026-10-01T17:00:00.000Z");
  });
  it("DG-09 paying cancellation refund does not recreate a debt", () => {
    const { data, booking, actor, group } = bookingFixture({ paid: 1000 });
    expect(cancelGroupBookingInStore(data, { bookingId: booking.id, departureGroupId: group.id, reason: "Cancellation", refundAmount: 200 }, actor, NOW).ok).toBe(true);
    expect(reverseBookingPaymentInStore(data, { bookingId: booking.id, departureGroupId: group.id, amount: 200, reason: "Refund", resolvesRefund: true }, actor, NOW).ok).toBe(true);
    expect(booking.outstanding_balance).toBe(0);
  });
  it("DG-03 percentage projection reconciles to the fare", () => {
    // Reproduces the projection input supplied by seedPilgrimPaymentMilestones.
    const rows = buildPaymentMilestonesForBooking("booking", ["traveller"], [
      { id: "30", label: "30%", amount: 30, amountType: "Percentage", dueDate: null },
      { id: "70", label: "70%", amount: 70, amountType: "Percentage", dueDate: null },
    ], 1000, NOW);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(1000);
  });
  it("DG-11 a USD group's base fare keeps USD", () => {
    const { data } = bookingFixture({ currency: "USD" });
    expect(data.pilgrimCharges[0].currency).toBe("USD");
  });
  it("DG-14 exact invoice formatting preserves cents", () => {
    expect(formatExactCurrency(1250.50, "LKR")).toBe("LKR 1,250.50");
  });
  for (const days of [0.5, 7.5, 30.5]) {
    it(`DG-18 aging includes a balance ${days} days overdue exactly once`, () => {
      const row = { due_at: new Date(Date.parse(NOW) - days * 86400000).toISOString(), outstanding_amount: 100 } as ReportMilestoneFact;
      const buckets = buildReceivablesAging([row], NOW);
      expect(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(100);
      expect(buckets.reduce((sum, bucket) => sum + bucket.milestoneCount, 0)).toBe(1);
    });
  }
});
