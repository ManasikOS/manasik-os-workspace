import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";
import { DASHBOARD_LAYOUTS, DASHBOARD_PANEL_IDS, type DashboardPanelId } from "@/lib/data/dashboard-layout";

import { BLOCK_GATES, baseDashboardCapabilities, visibleBlocks, type DashboardCapabilities } from "./dashboard-access";

function withOverrides(
  role: (typeof STAFF_ROLES)[number],
  overrides: { [K in keyof DashboardCapabilities]?: Partial<DashboardCapabilities[K]> },
): DashboardCapabilities {
  const base = baseDashboardCapabilities(role);
  return {
    finance: { ...base.finance, ...overrides.finance },
    leads: { ...base.leads, ...overrides.leads },
    operations: { ...base.operations, ...overrides.operations },
    reports: { ...base.reports, ...overrides.reports },
    departureGroups: { ...base.departureGroups, ...overrides.departureGroups },
    inbox: { ...base.inbox, ...overrides.inbox },
    visa: { ...base.visa, ...overrides.visa },
    documents: { ...base.documents, ...overrides.documents },
    suppliers: { ...base.suppliers, ...overrides.suppliers },
    quotes: { ...base.quotes, ...overrides.quotes },
    marketing: { ...base.marketing, ...overrides.marketing },
  };
}

const ALL_IDS = [...DASHBOARD_PANEL_IDS] as DashboardPanelId[];

describe("BLOCK_GATES", () => {
  it("has exactly one gate per panel id — a new block cannot ship ungated", () => {
    expect(Object.keys(BLOCK_GATES).sort()).toEqual([...DASHBOARD_PANEL_IDS].sort());
  });
});

describe("visibleBlocks", () => {
  it("keeps the preset's order", () => {
    const caps = baseDashboardCapabilities("ADMIN");
    const preset: DashboardPanelId[] = ["collections", "my-day", "pipeline"];
    expect(visibleBlocks(preset, caps)).toEqual(["collections", "my-day", "pipeline"]);
  });

  it("shows a GUIDE no finance, sales, team or approvals block even if the preset asked for every block", () => {
    const visible = visibleBlocks(ALL_IDS, baseDashboardCapabilities("GUIDE"));
    for (const id of ["collections", "revenue-trend", "pipeline", "team-performance"] as const) {
      expect(visible).not.toContain(id);
    }
  });

  it("removes finance blocks when a custom role has switched the ledger off, even on an ADMIN base", () => {
    const caps = withOverrides("ADMIN", { finance: { viewLedger: false } });
    const visible = visibleBlocks(DASHBOARD_LAYOUTS.ADMIN, caps);
    expect(visible).not.toContain("collections");
    expect(visible).toContain("my-day");
  });

  it("removes revenue-trend when reports.viewFinance is off, and pipeline/team when reports.viewSales is off", () => {
    const caps = withOverrides("ADMIN", { reports: { viewFinance: false, viewSales: false } });
    const visible = visibleBlocks(DASHBOARD_LAYOUTS.ADMIN, caps);
    expect(visible).not.toContain("revenue-trend");
    expect(visible).not.toContain("pipeline");
    expect(visible).not.toContain("team-performance");
  });

  it("removes agent approvals when Operations is off", () => {
    const caps = withOverrides("ADMIN", { operations: { viewModule: false } });
    expect(visibleBlocks(DASHBOARD_LAYOUTS.ADMIN, caps)).not.toContain("approvals");
  });

  it("removes departure-driven blocks when Departure Groups is off", () => {
    const caps = withOverrides("ADMIN", { departureGroups: { viewModule: false } });
    const visible = visibleBlocks(DASHBOARD_LAYOUTS.ADMIN, caps);
    for (const id of ["upcoming-departures", "seat-fill-pace", "readiness-heatmap"] as const) {
      expect(visible).not.toContain(id);
    }
  });

  it("keeps the briefing and KPI row for every role — they are not module-gated", () => {
    for (const role of STAFF_ROLES) {
      const visible = visibleBlocks(["ai-briefing", "kpis"], baseDashboardCapabilities(role));
      expect(visible).toEqual(["ai-briefing", "kpis"]);
    }
  });

  it("removes the inbox owner panel when a custom role has Inbox switched off, even on an ADMIN base", () => {
    const caps = withOverrides("ADMIN", { inbox: { viewModule: false } });
    expect(visibleBlocks(DASHBOARD_LAYOUTS.ADMIN, caps)).not.toContain("inbox-owner");
    expect(visibleBlocks(DASHBOARD_LAYOUTS.ADMIN, baseDashboardCapabilities("ADMIN"))).toContain("inbox-owner");
  });

  it("shows the visa queue only to a role with the Visa module and more than payment blockers", () => {
    const base = baseDashboardCapabilities("VISA");
    expect(visibleBlocks(["visa-queue"], base)).toEqual(["visa-queue"]);
    expect(visibleBlocks(["visa-queue"], withOverrides("VISA", { visa: { viewModule: false } }))).toEqual([]);
    expect(visibleBlocks(["visa-queue"], withOverrides("VISA", { visa: { viewPaymentBlockersOnly: true } }))).toEqual([]);
    expect(visibleBlocks(["visa-queue"], baseDashboardCapabilities("FINANCE"))).toEqual([]);
  });

  it("shows document review only to a role with the Documents module that is not limited to payment proofs", () => {
    const base = baseDashboardCapabilities("VISA");
    expect(visibleBlocks(["document-review"], base)).toEqual(["document-review"]);
    expect(visibleBlocks(["document-review"], withOverrides("VISA", { documents: { viewModule: false } }))).toEqual([]);
    expect(visibleBlocks(["document-review"], withOverrides("VISA", { documents: { scopedToPaymentProof: true } }))).toEqual([]);
    expect(visibleBlocks(["document-review"], baseDashboardCapabilities("GUIDE"))).toEqual([]);
  });

  it("shows supplier payables only to a role that may see supplier costs and payments", () => {
    for (const role of ["ADMIN", "CEO", "FINANCE"] as const) {
      expect(visibleBlocks(["supplier-payables"], baseDashboardCapabilities(role))).toEqual(["supplier-payables"]);
    }
    for (const role of ["OPERATIONS", "MARKETING", "VISA", "GUIDE"] as const) {
      expect(visibleBlocks(["supplier-payables"], baseDashboardCapabilities(role))).toEqual([]);
    }
  });

  it("removes supplier payables when a custom role loses payments or costs, even on an ADMIN base", () => {
    expect(visibleBlocks(["supplier-payables"], withOverrides("ADMIN", { suppliers: { viewPayments: false } }))).toEqual([]);
    expect(visibleBlocks(["supplier-payables"], withOverrides("ADMIN", { suppliers: { viewCosts: false } }))).toEqual([]);
    expect(visibleBlocks(["supplier-payables"], withOverrides("ADMIN", { suppliers: { viewModule: false } }))).toEqual([]);
  });

  it("shows quotes pending to ADMIN, MARKETING, CEO and FINANCE - the roles with the Quotes module", () => {
    for (const role of ["ADMIN", "MARKETING", "CEO", "FINANCE"] as const) {
      expect(visibleBlocks(["quotes-pending"], baseDashboardCapabilities(role))).toEqual(["quotes-pending"]);
    }
    for (const role of ["OPERATIONS", "VISA", "GUIDE"] as const) {
      expect(visibleBlocks(["quotes-pending"], baseDashboardCapabilities(role))).toEqual([]);
    }
  });

  it("removes quotes pending when a custom role has the Quotes module off, even on an ADMIN base", () => {
    expect(visibleBlocks(["quotes-pending"], withOverrides("ADMIN", { quotes: { viewModule: false } }))).toEqual([]);
  });

  it("shows campaign pulse to a role with the Marketing module, and removes it when a custom role loses it", () => {
    expect(visibleBlocks(["campaign-pulse"], baseDashboardCapabilities("MARKETING"))).toEqual(["campaign-pulse"]);
    expect(visibleBlocks(["campaign-pulse"], baseDashboardCapabilities("ADMIN"))).toEqual(["campaign-pulse"]);
    expect(visibleBlocks(["campaign-pulse"], baseDashboardCapabilities("GUIDE"))).toEqual([]);
    expect(visibleBlocks(["campaign-pulse"], withOverrides("ADMIN", { marketing: { viewModule: false } }))).toEqual([]);
  });
});
