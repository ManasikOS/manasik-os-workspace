import { describe, expect, it } from "vitest";

import { departureGroupStatusFor, paymentStatusLabel } from "./departure-group-status";

const recommended = { departureGroupId: "g1", title: "December 15 Umrah Group" };

describe("departureGroupStatusFor", () => {
  it("shows nothing chosen when there is no group, no booking and no recommendation", () => {
    expect(departureGroupStatusFor({ selectedDepartureGroupId: null, booking: null, recommended: null })).toMatchObject({ kind: "NONE", headline: "No departure selected" });
  });

  it("labels Copilot's match as a recommendation, not a choice", () => {
    expect(departureGroupStatusFor({ selectedDepartureGroupId: null, booking: null, recommended })).toMatchObject({ kind: "RECOMMENDED", label: "Recommended", headline: "December 15 Umrah Group" });
  });

  it("labels a staff choice as a preference and names it when the recommendation is the same group", () => {
    expect(departureGroupStatusFor({ selectedDepartureGroupId: "g1", booking: null, recommended })).toMatchObject({ kind: "PREFERENCE", label: "Lead preference", headline: "December 15 Umrah Group" });
    expect(departureGroupStatusFor({ selectedDepartureGroupId: "g9", booking: null, recommended })).toMatchObject({ kind: "PREFERENCE", headline: "A departure group is chosen" });
  });

  it("puts a real booking first, whatever else is set", () => {
    const status = departureGroupStatusFor({ selectedDepartureGroupId: "g1", booking: { reference: "B-2026-0142", status: "DEPOSIT_PENDING" }, recommended });
    expect(status).toMatchObject({ kind: "BOOKED", label: "Booked", headline: "Booking B-2026-0142", detail: "Status: deposit pending" });
  });

  it("never gives two states the same label", () => {
    const labels = [
      departureGroupStatusFor({ selectedDepartureGroupId: null, booking: null, recommended: null }),
      departureGroupStatusFor({ selectedDepartureGroupId: null, booking: null, recommended }),
      departureGroupStatusFor({ selectedDepartureGroupId: "g1", booking: null, recommended }),
      departureGroupStatusFor({ selectedDepartureGroupId: "g1", booking: { reference: "B1", status: "CONFIRMED" }, recommended }),
    ].map((status) => status.label);
    expect(new Set(labels).size).toBe(4);
  });
});

describe("booked departure detail", () => {
  it("names the group, the booking reference, status and payment", () => {
    const status = departureGroupStatusFor({
      selectedDepartureGroupId: "g1",
      booking: { reference: "B-2026-0142", status: "DEPOSIT_PENDING", groupName: "December 15 Umrah Group", outstandingBalance: 250000 },
      recommended: null,
    });
    expect(status).toMatchObject({ kind: "BOOKED", headline: "December 15 Umrah Group", detail: "Booking B-2026-0142 · Status: deposit pending · Payment: balance due" });
  });

  it("falls back to the reference without a group name, and hides payment when the balance is not shown", () => {
    const status = departureGroupStatusFor({ selectedDepartureGroupId: null, booking: { reference: "B1", status: "CONFIRMED", groupName: "  ", outstandingBalance: null }, recommended: null });
    expect(status).toMatchObject({ headline: "Booking B1", detail: "Status: confirmed" });
  });
});

describe("paymentStatusLabel", () => {
  it("reads the balance in words", () => {
    expect(paymentStatusLabel(0)).toBe("Paid in full");
    expect(paymentStatusLabel(1)).toBe("Balance due");
    expect(paymentStatusLabel(null)).toBeNull();
    expect(paymentStatusLabel(Number.NaN)).toBeNull();
  });
});

describe("seat hold", () => {
  const now = new Date("2026-09-25T10:00:00.000Z");
  const held = (holdExpiresAt: string | null) =>
    departureGroupStatusFor({ selectedDepartureGroupId: "g1", booking: { reference: "B-1", status: "HELD", groupName: "December 15 Umrah Group", holdExpiresAt }, recommended: null, now });

  it("counts down a hold that is still running", () => {
    expect(held("2026-09-25T11:42:00.000Z")).toMatchObject({ kind: "SEAT_HOLD", label: "Seat hold", headline: "December 15 Umrah Group", detail: "Seats are held for the customer. Expires in 1h 42m." });
  });

  it("says so when the hold has run out", () => {
    expect(held("2026-09-25T09:59:00.000Z")).toMatchObject({ kind: "SEAT_HOLD", label: "Hold expired" });
    expect(held("2026-09-25T10:00:00.000Z").label).toBe("Hold expired");
  });

  it("does not invent an expiry", () => {
    expect(held(null)).toMatchObject({ label: "Seat hold", detail: expect.stringContaining("No expiry is recorded") });
    expect(held("not a date").detail).toContain("No expiry is recorded");
  });

  it("is never labelled Booked, and a confirmed booking is never a hold", () => {
    expect(held("2026-09-25T11:00:00.000Z").label).not.toBe("Booked");
    const confirmed = departureGroupStatusFor({ selectedDepartureGroupId: "g1", booking: { reference: "B-1", status: "CONFIRMED", holdExpiresAt: "2026-09-25T11:00:00.000Z" }, recommended: null, now });
    expect(confirmed.kind).toBe("BOOKED");
  });
});
