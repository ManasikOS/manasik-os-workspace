import { describe, expect, it } from "vitest";

import { baseDashboardCapabilities, visibleBlocks } from "@/lib/access/dashboard-access";
import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import { DASHBOARD_LAYOUTS, type DashboardPanelId } from "./dashboard-layout";
import { planDashboardFetch } from "./dashboard-fetch-plan";

const WHO = { staffId: "staff-1", agencyId: "agency-1" };

function planFor(role: (typeof STAFF_ROLES)[number], who = WHO) {
  const caps = baseDashboardCapabilities(role);
  return planDashboardFetch(visibleBlocks(DASHBOARD_LAYOUTS[role], caps), caps, who);
}

describe("planDashboardFetch", () => {
  it("runs nothing optional for a GUIDE except their own tasks", () => {
    expect(planFor("GUIDE")).toEqual({
      leads: false,
      receivables: false,
      payments: false,
      refunds: false,
      proposals: false,
      financeReport: false,
      salesReport: false,
      myTasks: true,
    });
  });

  it("reads no sales report and no proposals for FINANCE, but does read the ledger and the finance report", () => {
    const plan = planFor("FINANCE");
    expect(plan.salesReport).toBe(false);
    expect(plan.proposals).toBe(false);
    expect(plan.receivables && plan.payments && plan.refunds && plan.financeReport).toBe(true);
  });

  it("reads proposals only where the approvals block is visible", () => {
    for (const role of STAFF_ROLES) {
      const caps = baseDashboardCapabilities(role);
      const blocks = visibleBlocks(DASHBOARD_LAYOUTS[role], caps);
      expect(planDashboardFetch(blocks, caps, WHO).proposals).toBe(blocks.includes("approvals"));
    }
  });

  it("reads the finance report only for revenue-trend, and the sales report only for pipeline or team-performance", () => {
    const caps = baseDashboardCapabilities("ADMIN");
    const without = (ids: DashboardPanelId[]) =>
      planDashboardFetch(DASHBOARD_LAYOUTS.ADMIN.filter((b) => !ids.includes(b)), caps, WHO);
    expect(without(["revenue-trend"]).financeReport).toBe(false);
    expect(without(["pipeline"]).salesReport).toBe(true); // team-performance still needs it
    expect(without(["pipeline", "team-performance"]).salesReport).toBe(false);
  });

  it("skips My Day's task read without a block or without a signed-in staff member", () => {
    const caps = baseDashboardCapabilities("ADMIN");
    expect(planDashboardFetch(DASHBOARD_LAYOUTS.ADMIN.filter((b) => b !== "my-day"), caps, WHO).myTasks).toBe(false);
    expect(planDashboardFetch(DASHBOARD_LAYOUTS.ADMIN, caps, { staffId: null, agencyId: "a" }).myTasks).toBe(false);
  });

  it("never plans a read the capabilities forbid, whatever blocks were asked for", () => {
    const caps = baseDashboardCapabilities("GUIDE");
    const plan = planDashboardFetch([...DASHBOARD_LAYOUTS.ADMIN], caps, WHO);
    expect(plan.receivables || plan.payments || plan.refunds || plan.leads).toBe(false);
    expect(plan.financeReport || plan.salesReport).toBe(false);
  });

  it("needs an agency to read proposals", () => {
    const caps = baseDashboardCapabilities("ADMIN");
    expect(planDashboardFetch(DASHBOARD_LAYOUTS.ADMIN, caps, { staffId: "s", agencyId: null }).proposals).toBe(false);
  });
});
