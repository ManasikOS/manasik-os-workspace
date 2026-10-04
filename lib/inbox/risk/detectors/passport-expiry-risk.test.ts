import { describe, expect, it } from "vitest";

import { facts } from "../fixtures";
import { detectPassportExpiryRisk } from "./passport-expiry-risk";

const traveller = (name: string, passportExpiry: string | null) => ({ name, passportExpiry, dateOfBirth: null });

describe("PASSPORT_EXPIRY_RISK", () => {
  it("fires when a passport expires before departure plus the agency's validity months", () => {
    const finding = detectPassportExpiryRisk(facts({ departureDate: "2026-11-12", passengers: [traveller("Fathima", "2027-03-01")] }));
    expect(finding).toMatchObject({ code: "PASSPORT_EXPIRY_RISK", messageId: null });
    expect(finding?.evidence[0].snippet).toContain("Fathima");
    expect(finding?.evidence[0].snippet).toContain("2027-05-12");
  });

  it("uses the agency's own threshold", () => {
    const base = { departureDate: "2026-11-12", passengers: [traveller("A", "2027-03-01")] };
    expect(detectPassportExpiryRisk(facts({ ...base, passportValidityMonths: 3 }))).toBeNull();
    expect(detectPassportExpiryRisk(facts({ ...base, passportValidityMonths: 6 }))).not.toBeNull();
  });

  it("near-miss: valid exactly to the required date is fine", () => {
    expect(detectPassportExpiryRisk(facts({ departureDate: "2026-11-12", passengers: [traveller("A", "2027-05-12")] }))).toBeNull();
  });

  it("names only the travellers who fall short", () => {
    const finding = detectPassportExpiryRisk(facts({ departureDate: "2026-11-12", passengers: [traveller("Short", "2027-01-01"), traveller("Fine", "2030-01-01")] }));
    expect(finding?.evidence[0].snippet).toContain("Short");
    expect(finding?.evidence[0].snippet).not.toContain("Fine");
  });

  it("negative: no expiry on file, no departure date, or no travellers is not a risk signal", () => {
    expect(detectPassportExpiryRisk(facts({ departureDate: "2026-11-12", passengers: [traveller("A", null)] }))).toBeNull();
    expect(detectPassportExpiryRisk(facts({ passengers: [traveller("A", "2026-01-01")] }))).toBeNull();
    expect(detectPassportExpiryRisk(facts({ departureDate: "2026-11-12" }))).toBeNull();
  });
});
