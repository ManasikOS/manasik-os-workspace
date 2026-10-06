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

/* ── The capability matrix ────────────────────────────────────────────────── */
// An explicit table of who may do the sensitive things. If a role gains or loses one of these, this test fails and
// the change has to be made on purpose - the way it would otherwise slip through is a one-word edit in the access file.

import { MODULE_CAPABILITY_KEYS } from "./module-capability-keys";
import { STAFF_ROLES, capabilitiesFor, visibleTabsFor, type DepartureGroupCapabilities, type StaffRole } from "./departure-groups-access";

const ALLOWED: Partial<Record<keyof DepartureGroupCapabilities, StaffRole[]>> = {
  recordPayments: ["ADMIN", "FINANCE"],
  cancelBookings: ["ADMIN", "FINANCE", "OPERATIONS"],
  overrideCapacityAndPrice: ["ADMIN"],
  eraseTravellerData: ["ADMIN"],
  cancelOrArchiveGroup: ["ADMIN"],
  unlockRoomAssignments: ["ADMIN"],
  approveDiscounts: ["ADMIN", "FINANCE"],
  createGroup: ["ADMIN", "OPERATIONS"],
  addBookings: ["ADMIN", "MARKETING", "OPERATIONS"],
  viewFinance: ["ADMIN", "CEO", "FINANCE"],
  viewSupplierCosts: ["ADMIN", "CEO", "FINANCE", "OPERATIONS"],
  viewSensitiveTravellerData: ["ADMIN", "CEO", "OPERATIONS", "VISA"],
  restrictedToAssignedGroups: ["GUIDE"],
};

describe("capability matrix", () => {
  for (const [capability, roles] of Object.entries(ALLOWED) as [keyof DepartureGroupCapabilities, StaffRole[]][]) {
    it(`${capability}: only ${roles.join(", ")}`, () => {
      const holders = STAFF_ROLES.filter((role) => capabilitiesFor(role)[capability]);
      expect(holders).toEqual(STAFF_ROLES.filter((role) => roles.includes(role)));
    });
  }

  it("a guide can do nothing but see the module and work tasks on assigned groups", () => {
    const granted = Object.entries(capabilitiesFor("GUIDE"))
      .filter(([, value]) => value)
      .map(([key]) => key)
      .sort();
    expect(granted).toEqual(["manageTasks", "restrictedToAssignedGroups", "viewModule"]);
  });

  it("the permission editor lists exactly the capabilities the code defines", () => {
    const defined = Object.keys(capabilitiesFor("ADMIN")).sort();
    expect([...MODULE_CAPABILITY_KEYS.departure_groups].sort()).toEqual(defined);
  });

  it("every role can open the module, and no capability is missing from any role's set", () => {
    const keys = Object.keys(capabilitiesFor("ADMIN")).sort();
    for (const role of STAFF_ROLES) {
      expect(capabilitiesFor(role).viewModule, role).toBe(true);
      expect(Object.keys(capabilitiesFor(role)).sort(), role).toEqual(keys);
    }
  });
});

describe("visible tabs", () => {
  it("shows Payments only to roles that can view finance", () => {
    for (const role of STAFF_ROLES) {
      expect(visibleTabsFor(role).includes("payments"), role).toBe(capabilitiesFor(role).viewFinance);
    }
  });

  it("hides the activity trail from Marketing and Guide, which replays money changes", () => {
    expect(visibleTabsFor("MARKETING")).not.toContain("activity");
    expect(visibleTabsFor("GUIDE")).not.toContain("activity");
    expect(visibleTabsFor("ADMIN")).toContain("activity");
  });

  it("shows Documents only to roles that handle documents or sensitive traveller data", () => {
    expect(visibleTabsFor("GUIDE")).not.toContain("documents");
    expect(visibleTabsFor("MARKETING")).not.toContain("documents");
    expect(visibleTabsFor("VISA")).toContain("documents");
  });
});
