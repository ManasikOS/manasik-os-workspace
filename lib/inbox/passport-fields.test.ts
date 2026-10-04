import { describe, expect, it } from "vitest";

import { parsePassportDetails, passportFormDefaults } from "./passport-fields";

describe("passportFormDefaults", () => {
  it("pre-fills the read number (tidied) and a valid expiry date", () => {
    expect(passportFormDefaults({ passportNumber: " n 1234567 ", expiryDate: "2031-03-12" })).toEqual({ passportNumber: "N1234567", expiryDate: "2031-03-12" });
  });

  it("drops an expiry that is not a real ISO date instead of guessing", () => {
    for (const expiryDate of ["12 Mar 2031", "2031-13-40", "2031-02-30", "", 42]) {
      expect(passportFormDefaults({ passportNumber: "N1234567", expiryDate }).expiryDate).toBe("");
    }
  });

  it("starts empty when nothing was read", () => {
    expect(passportFormDefaults({})).toEqual({ passportNumber: "", expiryDate: "" });
  });
});

describe("parsePassportDetails", () => {
  it("accepts a tidy number and a real date", () => {
    expect(parsePassportDetails({ passportNumber: "n 123 4567", expiryDate: "2031-03-12" })).toEqual({ ok: true, passportNumber: "N1234567", passportExpiry: "2031-03-12" });
  });

  it("refuses a number that is too short, too long or has symbols", () => {
    for (const passportNumber of ["N12", "N".repeat(21), "N-1234567", ""]) {
      expect(parsePassportDetails({ passportNumber, expiryDate: "2031-03-12" }).ok).toBe(false);
    }
  });

  it("refuses a missing or impossible date", () => {
    for (const expiryDate of ["", "12/03/2031", "2031-02-30"]) {
      expect(parsePassportDetails({ passportNumber: "N1234567", expiryDate }).ok).toBe(false);
    }
  });
});
