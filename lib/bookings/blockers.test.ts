import { describe, expect, it } from "vitest";

import {
  identifyBookingBlockers,
  isDepositOverdue,
  isPayerMismatchWithoutContact,
  type BookingBlockerInput,
} from "./blockers";

const NOW = "2026-09-15T00:00:00.000Z";

function baseInput(overrides: Partial<BookingBlockerInput> = {}): BookingBlockerInput {
  return {
    outstandingBalance: 0,
    nextDueAt: null,
    primaryContactName: "Jane Doe",
    primaryContactPhone: "0771234567",
    departureDate: "2026-12-01T00:00:00.000Z",
    travellers: [{ fullName: "Jane Doe", passportNumber: "N1234567", visaStatus: "APPROVED", roomAssignmentStatus: "ASSIGNED", flightStatus: "TICKETED" }],
    ...overrides,
  };
}

describe("isDepositOverdue", () => {
  it("is true when there's an outstanding balance past its due date", () => {
    expect(isDepositOverdue(baseInput({ outstandingBalance: 5000, nextDueAt: "2026-09-01T00:00:00.000Z" }), NOW)).toBe(true);
  });

  it("is false when fully paid", () => {
    expect(isDepositOverdue(baseInput({ outstandingBalance: 0, nextDueAt: "2026-09-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("is false when the due date is in the future", () => {
    expect(isDepositOverdue(baseInput({ outstandingBalance: 5000, nextDueAt: "2026-12-01T00:00:00.000Z" }), NOW)).toBe(false);
  });
});

describe("isPayerMismatchWithoutContact", () => {
  it("is true when the payer isn't a traveller and has no phone", () => {
    const input = baseInput({
      primaryContactName: "Someone Else",
      primaryContactPhone: "",
      travellers: [{ fullName: "Jane Doe", passportNumber: "N1", visaStatus: "APPROVED", roomAssignmentStatus: "ASSIGNED", flightStatus: "TICKETED" }],
    });
    expect(isPayerMismatchWithoutContact(input)).toBe(true);
  });

  it("is false when the payer is one of the travellers", () => {
    expect(isPayerMismatchWithoutContact(baseInput())).toBe(false);
  });

  it("is false when a phone is on file even if the payer isn't travelling", () => {
    const input = baseInput({ primaryContactName: "Someone Else", primaryContactPhone: "0771234567" });
    expect(isPayerMismatchWithoutContact(input)).toBe(false);
  });
});

describe("identifyBookingBlockers", () => {
  it("returns nothing for a clean booking", () => {
    expect(identifyBookingBlockers(baseInput(), NOW)).toEqual([]);
  });

  it("flags a traveller missing a passport within 60 days of departure", () => {
    const input = baseInput({
      departureDate: "2026-10-01T00:00:00.000Z",
      travellers: [{ fullName: "Jane Doe", passportNumber: null, visaStatus: "APPROVED", roomAssignmentStatus: "ASSIGNED", flightStatus: "TICKETED" }],
    });
    const blockers = identifyBookingBlockers(input, NOW);
    expect(blockers.some((b) => b.id === "passport-missing")).toBe(true);
  });

  it("does not flag a missing passport when departure is far away", () => {
    const input = baseInput({
      departureDate: "2027-06-01T00:00:00.000Z",
      travellers: [{ fullName: "Jane Doe", passportNumber: null, visaStatus: "APPROVED", roomAssignmentStatus: "ASSIGNED", flightStatus: "TICKETED" }],
    });
    expect(identifyBookingBlockers(input, NOW).some((b) => b.id === "passport-missing")).toBe(false);
  });

  it("flags a visa not submitted within 45 days of departure", () => {
    const input = baseInput({
      departureDate: "2026-10-01T00:00:00.000Z",
      travellers: [{ fullName: "Jane Doe", passportNumber: "N1", visaStatus: "NOT_STARTED", roomAssignmentStatus: "ASSIGNED", flightStatus: "TICKETED" }],
    });
    expect(identifyBookingBlockers(input, NOW).some((b) => b.id === "visa-not-submitted")).toBe(true);
  });

  it("flags a traveller without a room or flight within 21 days of departure", () => {
    const input = baseInput({
      departureDate: "2026-10-01T00:00:00.000Z",
      travellers: [{ fullName: "Jane Doe", passportNumber: "N1", visaStatus: "APPROVED", roomAssignmentStatus: "UNASSIGNED", flightStatus: "TICKETED" }],
    });
    expect(identifyBookingBlockers(input, NOW).some((b) => b.id === "allocation-missing")).toBe(true);
  });

  it("stacks multiple blockers at once", () => {
    const input = baseInput({
      outstandingBalance: 5000,
      nextDueAt: "2026-09-01T00:00:00.000Z",
      departureDate: "2026-09-20T00:00:00.000Z",
      travellers: [{ fullName: "Jane Doe", passportNumber: null, visaStatus: "NOT_STARTED", roomAssignmentStatus: "UNASSIGNED", flightStatus: "PENDING" }],
    });
    const blockers = identifyBookingBlockers(input, NOW);
    expect(blockers.length).toBeGreaterThanOrEqual(4);
  });
});
