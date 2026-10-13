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
});
