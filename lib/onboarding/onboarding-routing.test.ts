import { describe, expect, it } from "vitest";

import { needsAgencyProvisioning } from "./onboarding-routing";

const membership = { agencyId: "a1", agencyName: "Al-Noor", role: "ADMIN" as const, isDefault: true };

describe("needsAgencyProvisioning", () => {
  it("routes a signed-in user with no profile and no membership to onboarding", () => {
    expect(needsAgencyProvisioning({ activity: null, memberships: [] })).toBe(true);
  });

  it("does not route an invited staff member who already has a profile", () => {
    expect(needsAgencyProvisioning({ activity: { status: "INVITED", lastActiveAt: null }, memberships: [] })).toBe(false);
  });

  it("does not route a user who is an active member of an agency", () => {
    expect(needsAgencyProvisioning({ activity: null, memberships: [membership] })).toBe(false);
  });

  it("does not route a user whose profile exists and who has memberships", () => {
    expect(
      needsAgencyProvisioning({ activity: { status: "ACTIVE", lastActiveAt: "2026-09-01T00:00:00Z" }, memberships: [membership] }),
    ).toBe(false);
  });
});
