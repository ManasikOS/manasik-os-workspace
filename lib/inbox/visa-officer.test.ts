import { describe, expect, it } from "vitest";

import { canBeVisaOfficer } from "./visa-officer";

describe("canBeVisaOfficer", () => {
  it("allows active staff whose role does visa work", () => {
    for (const role of ["ADMIN", "OPERATIONS", "VISA", "visa"]) {
      expect(canBeVisaOfficer({ role, status: "ACTIVE" })).toBe(true);
    }
  });

  it("refuses roles that cannot work visas", () => {
    for (const role of ["FINANCE", "MARKETING", "CEO", "GUIDE"]) {
      expect(canBeVisaOfficer({ role, status: "ACTIVE" })).toBe(false);
    }
  });

  it("refuses inactive staff and unknown or missing roles", () => {
    expect(canBeVisaOfficer({ role: "VISA", status: "SUSPENDED" })).toBe(false);
    expect(canBeVisaOfficer({ role: "VISA", status: null })).toBe(false);
    expect(canBeVisaOfficer({ role: "WIZARD", status: "ACTIVE" })).toBe(false);
    expect(canBeVisaOfficer({ role: undefined, status: "ACTIVE" })).toBe(false);
  });
});
