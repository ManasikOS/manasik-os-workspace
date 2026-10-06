import { describe, expect, it } from "vitest";

import { canRoleActOnGroup } from "./departure-groups-access";

describe("canRoleActOnGroup", () => {
  it("lets a guide act only on an assigned group", () => {
    expect(canRoleActOnGroup({ id: "g1", sales_status: "SELLING" }, "GUIDE", ["g1"])).toBe(true);
    expect(canRoleActOnGroup({ id: "g2", sales_status: "SELLING" }, "GUIDE", ["g1"])).toBe(false);
    expect(canRoleActOnGroup({ id: "g1", sales_status: "SELLING" }, "GUIDE", [])).toBe(false);
  });

  it("lets marketing act only on groups that are on sale", () => {
    for (const sales_status of ["SELLING", "LIMITED_AVAILABILITY", "WAITLIST"]) {
      expect(canRoleActOnGroup({ id: "g", sales_status }, "MARKETING", [])).toBe(true);
    }
    for (const sales_status of ["SALES_CLOSED", "CANCELLED"]) {
      expect(canRoleActOnGroup({ id: "g", sales_status }, "MARKETING", [])).toBe(false);
    }
  });

  it("does not restrict the other roles", () => {
    for (const role of ["ADMIN", "CEO", "FINANCE", "OPERATIONS", "VISA"] as const) {
      expect(canRoleActOnGroup({ id: "g", sales_status: "CLOSED" }, role, [])).toBe(true);
    }
  });
});
