import { describe, expect, it } from "vitest";

import { canBeVisaOfficer, VISA_OFFICER_ROLES } from "./visa-officer";

describe("VISA_OFFICER_ROLES", () => {
  it("is exactly the roles canBeVisaOfficer accepts, so the officer query and the check cannot disagree", () => {
    expect([...VISA_OFFICER_ROLES].sort()).toEqual(["ADMIN", "OPERATIONS", "VISA"]);
    for (const role of VISA_OFFICER_ROLES) expect(canBeVisaOfficer({ role, status: "ACTIVE" })).toBe(true);
  });
});

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
