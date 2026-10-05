import { describe, expect, it } from "vitest";

import { decideExistingBookingForLead, deriveBookingFromLead, type ConversationBookingLead } from "./conversation-booking";

function readyLead(overrides: Partial<ConversationBookingLead> = {}): ConversationBookingLead {
  return {
    booking_id: null,
    selected_departure_group_id: "group-1",
    adults: 2,
    children: 0,
    room_preference: "DOUBLE",
    ...overrides,
  };
}

describe("deriveBookingFromLead", () => {
  it("rejects when the linked lead no longer exists", () => {
    const outcome = deriveBookingFromLead(null);
    expect(outcome).toEqual({ ok: false, error: "The linked lead is no longer available." });
  });

  it("rejects a lead that already has a booking", () => {
    const outcome = deriveBookingFromLead(readyLead({ booking_id: "booking-1" }));
    expect(outcome.ok).toBe(false);
  });

  it("rejects a lead with no departure group selected — the 'no matching package' case surfaces earlier, at selection time", () => {
    const outcome = deriveBookingFromLead(readyLead({ selected_departure_group_id: null }));
    expect(outcome).toEqual({
      ok: false,
      error: "Select a departure group for this lead before creating a booking.",
    });
  });

  it("rejects a lead with zero travellers", () => {
    const outcome = deriveBookingFromLead(readyLead({ adults: 0, children: 0 }));
    expect(outcome.ok).toBe(false);
  });

  it("sums adults and children into the traveller count", () => {
    const outcome = deriveBookingFromLead(readyLead({ adults: 2, children: 1 }));
    expect(outcome).toEqual({ ok: true, result: { travellerCount: 3, roomOccupancyPreference: "DOUBLE" } });
  });

  it("falls back an UNDECIDED room preference to TRIPLE rather than guessing further", () => {
    const outcome = deriveBookingFromLead(readyLead({ room_preference: "UNDECIDED" }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.roomOccupancyPreference).toBe("TRIPLE");
  });

  it("passes through a decided room preference unchanged", () => {
    const outcome = deriveBookingFromLead(readyLead({ room_preference: "SINGLE" }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.roomOccupancyPreference).toBe("SINGLE");
  });
});

describe("decideExistingBookingForLead", () => {
  const existing = { id: "bk-1", booking_reference: "LD-0042", booking_status: "DEPOSIT_PENDING", departure_group_id: "group-1" };
  it("creates when there is nothing there", () => {
    expect(decideExistingBookingForLead({ existing: null, selectedDepartureGroupId: "group-1" })).toEqual({ kind: "CREATE" });
  });
  it("links an active booking in the group the person chose", () => {
    for (const booking_status of ["HELD", "DEPOSIT_PENDING", "CONFIRMED", "WAITLIST"]) {
      expect(decideExistingBookingForLead({ existing: { ...existing, booking_status }, selectedDepartureGroupId: "group-1" })).toEqual({ kind: "ADOPT", bookingId: "bk-1", bookingReference: "LD-0042" });
    }
  });
  it("hands a cancelled booking, or one in another group, to a person, naming the booking", () => {
    const cancelled = decideExistingBookingForLead({ existing: { ...existing, booking_status: "CANCELLED" }, selectedDepartureGroupId: "group-1" });
    const elsewhere = decideExistingBookingForLead({ existing, selectedDepartureGroupId: "group-2" });
    expect(cancelled).toMatchObject({ kind: "BLOCKED", error: expect.stringContaining("LD-0042") });
    expect(elsewhere).toMatchObject({ kind: "BLOCKED", error: expect.stringContaining("LD-0042") });
  });
});
