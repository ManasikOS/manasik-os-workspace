import { describe, expect, it } from "vitest";

import { baseDashboardCapabilities, visibleBlocks } from "@/lib/access/dashboard-access";
import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import { DASHBOARD_KPI_ORDER, DASHBOARD_LAYOUTS, type DashboardPanelId } from "./dashboard-layout";
import { planDashboardFetch } from "./dashboard-fetch-plan";

const WHO = { staffId: "staff-1", agencyId: "agency-1" };

function planFor(role: (typeof STAFF_ROLES)[number], who = WHO) {
  const caps = baseDashboardCapabilities(role);
  return planDashboardFetch(visibleBlocks(DASHBOARD_LAYOUTS[role], caps), caps, who, DASHBOARD_KPI_ORDER[role]);
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
      overview: false,
      visaQueue: false,
      documents: false,
      suppliers: false,
      quotes: false,
      campaigns: false,
      inboxSla: false,
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

  describe("KPI-driven reads", () => {
    const caps = baseDashboardCapabilities("ADMIN");
    const kpisOnly: DashboardPanelId[] = ["kpis"];

    it("reads the Reports overview only when the role's row lists revenue or gross margin and Reports overview is allowed", () => {
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["revenue"]).overview).toBe(true);
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["gross-margin"]).overview).toBe(true);
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["departing-30"]).overview).toBe(false);
      expect(planFor("CEO").overview).toBe(true);
      expect(planFor("FINANCE").overview).toBe(false);
      expect(planFor("GUIDE").overview).toBe(false);
    });

    it("never reads the overview for a role without Reports overview, even if the tile is listed", () => {
      const guide = baseDashboardCapabilities("GUIDE");
      expect(planDashboardFetch(kpisOnly, guide, WHO, ["revenue"]).overview).toBe(false);
    });

    it("reads My tasks for the KPI alone when My Day is not shown", () => {
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["my-open-tasks"]).myTasks).toBe(true);
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["departing-30"]).myTasks).toBe(false);
    });

    it("reads pending refunds for the KPI alone when Collections and the rail are not shown", () => {
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["refunds-pending"]).refunds).toBe(true);
      expect(planDashboardFetch(kpisOnly, caps, WHO, ["departing-30"]).refunds).toBe(false);
    });
  });

  describe("visa queue", () => {
    it("is read for VISA, whose preset shows the block and whose row lists the visa tile", () => {
      expect(planFor("VISA").visaQueue).toBe(true);
    });

    it("is read for OPERATIONS (block) and not for roles without the block or the tile", () => {
      expect(planFor("OPERATIONS").visaQueue).toBe(true);
      expect(planFor("GUIDE").visaQueue).toBe(false);
      expect(planFor("MARKETING").visaQueue).toBe(false);
    });

    it("is never read for a role limited to payment blockers, even if the block is asked for", () => {
      const caps = baseDashboardCapabilities("FINANCE");
      expect(planDashboardFetch(["visa-queue"], caps, WHO, ["visa-pending"]).visaQueue).toBe(false);
    });

    it("is read for the KPI alone when the block is not shown", () => {
      const caps = baseDashboardCapabilities("VISA");
      expect(planDashboardFetch(["kpis"], caps, WHO, ["visa-pending"]).visaQueue).toBe(true);
      expect(planDashboardFetch(["kpis"], caps, WHO, ["departing-30"]).visaQueue).toBe(false);
    });
  });

  describe("document review", () => {
    it("is read for VISA, whose preset shows the block and whose row lists the tile", () => {
      expect(planFor("VISA").documents).toBe(true);
    });

    it("is not read for roles without the block or the tile", () => {
      for (const role of ["ADMIN", "CEO", "FINANCE", "MARKETING", "GUIDE"] as const) {
        expect(planFor(role).documents).toBe(false);
      }
    });

    it("is never read for a role limited to payment proofs, even if asked for", () => {
      const caps = { ...baseDashboardCapabilities("VISA"), documents: { ...baseDashboardCapabilities("VISA").documents, scopedToPaymentProof: true } };
      expect(planDashboardFetch(["document-review"], caps, WHO, ["docs-awaiting-review"]).documents).toBe(false);
    });

    it("is read for the KPI alone when the block is not shown", () => {
      const caps = baseDashboardCapabilities("VISA");
      expect(planDashboardFetch(["kpis"], caps, WHO, ["docs-awaiting-review"]).documents).toBe(true);
      expect(planDashboardFetch(["kpis"], caps, WHO, ["departing-30"]).documents).toBe(false);
    });
  });

  describe("supplier payables", () => {
    it("is read for ADMIN, CEO and FINANCE", () => {
      for (const role of ["ADMIN", "CEO", "FINANCE"] as const) {
        expect(planFor(role).suppliers).toBe(true);
      }
    });

    it("is not read for roles that may not see supplier payments", () => {
      for (const role of ["OPERATIONS", "MARKETING", "VISA", "GUIDE"] as const) {
        expect(planFor(role).suppliers).toBe(false);
      }
    });

    it("is never read without payments access, even if the block and tile are asked for", () => {
      const base = baseDashboardCapabilities("FINANCE");
      const caps = { ...base, suppliers: { ...base.suppliers, viewPayments: false } };
      expect(planDashboardFetch(["supplier-payables"], caps, WHO, ["supplier-payments-due"]).suppliers).toBe(false);
    });

    it("is read for the KPI alone when the block is not shown", () => {
      const caps = baseDashboardCapabilities("FINANCE");
      expect(planDashboardFetch(["kpis"], caps, WHO, ["supplier-payments-due"]).suppliers).toBe(true);
      expect(planDashboardFetch(["kpis"], caps, WHO, ["departing-30"]).suppliers).toBe(false);
    });
  });

  describe("quotes pending", () => {
    it("is read for ADMIN, MARKETING, CEO and FINANCE", () => {
      for (const role of ["ADMIN", "MARKETING", "CEO", "FINANCE"] as const) {
        expect(planFor(role).quotes).toBe(true);
      }
    });

    it("is not read for roles without the Quotes module", () => {
      for (const role of ["OPERATIONS", "VISA", "GUIDE"] as const) {
        expect(planFor(role).quotes).toBe(false);
      }
    });

    it("is read for the quote tiles alone when the block is not shown", () => {
      const caps = baseDashboardCapabilities("MARKETING");
      expect(planDashboardFetch(["kpis"], caps, WHO, ["open-quotes"]).quotes).toBe(true);
      expect(planDashboardFetch(["kpis"], caps, WHO, ["quote-booking-rate"]).quotes).toBe(true);
      expect(planDashboardFetch(["kpis"], caps, WHO, ["departing-30"]).quotes).toBe(false);
    });

    it("is never read without the Quotes module, even if the block is asked for", () => {
      expect(planDashboardFetch(["quotes-pending"], baseDashboardCapabilities("GUIDE"), WHO, []).quotes).toBe(false);
    });
  });

  describe("campaign pulse", () => {
    it("is read for MARKETING and ADMIN, whose presets show the block", () => {
      expect(planFor("MARKETING").campaigns).toBe(true);
      expect(planFor("ADMIN").campaigns).toBe(true);
    });

    it("is not read for any other role, even those with the Marketing module (CEO, FINANCE, OPERATIONS)", () => {
      for (const role of ["CEO", "FINANCE", "OPERATIONS", "VISA", "GUIDE"] as const) {
        expect(planFor(role).campaigns).toBe(false);
      }
    });

    it("is never read without the Marketing module, even if the block is asked for", () => {
      expect(planDashboardFetch(["campaign-pulse"], baseDashboardCapabilities("GUIDE"), WHO, []).campaigns).toBe(false);
    });
  });

  describe("inbox SLA", () => {
    it("is read for ADMIN and MARKETING, whose presets show the block", () => {
      expect(planFor("ADMIN").inboxSla).toBe(true);
      expect(planFor("MARKETING").inboxSla).toBe(true);
    });

    it("is not read for roles whose page does not show it", () => {
      for (const role of ["CEO", "FINANCE", "OPERATIONS", "VISA", "GUIDE"] as const) {
        expect(planFor(role).inboxSla).toBe(false);
      }
    });

    it("is never read without the Inbox module, even if the block is asked for", () => {
      expect(planDashboardFetch(["inbox-sla"], baseDashboardCapabilities("GUIDE"), WHO, []).inboxSla).toBe(false);
    });
  });
});
