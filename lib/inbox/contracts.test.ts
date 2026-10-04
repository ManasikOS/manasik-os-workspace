import { describe, expect, it } from "vitest";

import { derivePilgrimJourneyStage, type JourneySource } from "@/lib/inbox/contracts";
import { normalizeEmail, normalizePhone, toIdentityLookupKey } from "@/lib/inbox/identity";

const baseJourney: JourneySource = {
  leadStage: "NEW_LEAD",
  desiredPackageId: null,
  selectedDepartureGroupId: null,
  bookingStatus: null,
};

describe("derivePilgrimJourneyStage", () => {
  it.each([
    [{ ...baseJourney }, "NEW_ENQUIRY"],
    [{ ...baseJourney, leadStage: "QUALIFIED" }, "QUALIFIED"],
    [{ ...baseJourney, desiredPackageId: "package-1" }, "PACKAGE_SELECTED"],
    [{ ...baseJourney, bookingStatus: "HELD" }, "BOOKING_STARTED"],
    [{ ...baseJourney, bookingStatus: "CONFIRMED" }, "CONFIRMED"],
    [{ ...baseJourney, leadStage: "BOOKED" }, "CONFIRMED"],
  ] as const)("maps %o to %s", (source, expected) => {
    expect(derivePilgrimJourneyStage(source)).toBe(expected);
  });

  it("does not downgrade a confirmed booking when stale lead data says new", () => {
    expect(
      derivePilgrimJourneyStage({
        ...baseJourney,
        bookingStatus: "CONFIRMED",
        desiredPackageId: null,
      }),
    ).toBe("CONFIRMED");
  });
});

describe("identity normalization", () => {
  it("normalizes valid international phone values without guessing a country", () => {
    expect(normalizePhone("+94 (77) 123-4567")).toBe("94771234567");
    expect(normalizePhone("1234")).toBeNull();
  });

  it("normalizes valid email values and rejects malformed values", () => {
    expect(normalizeEmail(" Pilgrim@Example.COM ")).toBe("pilgrim@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("always includes the provider-scoped identity key", () => {
    expect(
      toIdentityLookupKey({
        provider: "INSTAGRAM",
        externalSubjectId: " scoped-user-123 ",
        phone: "+94 77 123 4567",
      }),
    ).toEqual({
      provider: "INSTAGRAM",
      externalSubjectId: "scoped-user-123",
      normalizedPhone: "94771234567",
      normalizedEmail: null,
    });
  });

  it("does not permit an empty provider identity", () => {
    expect(() => toIdentityLookupKey({ provider: "GMAIL", externalSubjectId: " " })).toThrow(
      "external subject ID",
    );
  });
});

