import { describe, expect, it } from "vitest";

import { capabilitiesForVault } from "@/lib/access/vault-access";
import { STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";

const WRITE_ROLES: StaffRole[] = ["ADMIN", "CEO", "OPERATIONS", "VISA", "FINANCE", "MARKETING"];

describe("capabilitiesForVault", () => {
  it.each(WRITE_ROLES)("grants manageVault to %s, matching vault_documents' RLS write policy", (role) => {
    expect(capabilitiesForVault(role).manageVault).toBe(true);
  });

  it.each(STAFF_ROLES.filter((role) => !WRITE_ROLES.includes(role)))("denies manageVault to %s", (role) => {
    expect(capabilitiesForVault(role).manageVault).toBe(false);
  });

  it("covers every known staff role with no gaps", () => {
    for (const role of STAFF_ROLES) {
      expect(() => capabilitiesForVault(role)).not.toThrow();
    }
  });
});
