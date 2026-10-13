import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import {
  DASHBOARD_BANNER_BLOCKS,
  DASHBOARD_LAYOUTS,
  DASHBOARD_PANEL_IDS,
  resolveDashboardLayout,
  splitDashboardBlocks,
  type DashboardPanelId,
} from "./dashboard-layout";

const KNOWN = new Set<string>(DASHBOARD_PANEL_IDS);

describe("DASHBOARD_LAYOUTS", () => {
  it.each(STAFF_ROLES)("%s: ids are known and unique", (role) => {
    const ids = DASHBOARD_LAYOUTS[role];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(KNOWN.has(id)).toBe(true);
  });

  it.each(STAFF_ROLES.filter((r) => r !== "ADMIN"))(
    "%s: no more than 8 grid blocks (ADMIN, the one role that owns every module, is the documented exception)",
    (role) => {
      expect(splitDashboardBlocks(DASHBOARD_LAYOUTS[role]).panels.length).toBeLessThanOrEqual(8);
    },
  );

  it.each(STAFF_ROLES)("%s: always opens with the briefing and KPI row", (role) => {
    const { banners } = splitDashboardBlocks(DASHBOARD_LAYOUTS[role]);
    expect(banners).toContain("ai-briefing");
    expect(banners).toContain("kpis");
  });

  it("gives a GUIDE no finance, sales, team or approvals block, and no inbox owner panel", () => {
    const ids: DashboardPanelId[] = DASHBOARD_LAYOUTS.GUIDE;
    for (const id of ["collections", "revenue-trend", "pipeline", "team-performance", "approvals", "inbox-owner"] as const) {
      expect(ids).not.toContain(id);
    }
  });

  it("leads a GUIDE's grid with their assigned departures", () => {
    expect(splitDashboardBlocks(DASHBOARD_LAYOUTS.GUIDE).panels[0]).toBe("upcoming-departures");
  });

  it("shows the inbox owner panel to ADMIN and CEO only", () => {
    const holders = STAFF_ROLES.filter((r) => DASHBOARD_LAYOUTS[r].includes("inbox-owner"));
    expect([...holders].sort()).toEqual(["ADMIN", "CEO"]);
  });

  it("resolves an unrecognised role to the least-privileged preset", () => {
    expect(resolveDashboardLayout("SOMETHING_ELSE" as never)).toEqual(DASHBOARD_LAYOUTS.GUIDE);
  });
});

describe("splitDashboardBlocks", () => {
  it("separates full-width banner blocks from grid panels, keeping each group's order", () => {
    const { banners, panels } = splitDashboardBlocks(["kpis", "my-day", "inbox-owner", "pipeline", "ai-briefing"]);
    expect(banners).toEqual(["kpis", "inbox-owner", "ai-briefing"]);
    expect(panels).toEqual(["my-day", "pipeline"]);
  });

  it("treats exactly DASHBOARD_BANNER_BLOCKS as banners", () => {
    const { banners, panels } = splitDashboardBlocks([...DASHBOARD_PANEL_IDS]);
    expect([...banners].sort()).toEqual([...DASHBOARD_BANNER_BLOCKS].sort());
    expect(banners.length + panels.length).toBe(DASHBOARD_PANEL_IDS.length);
  });
});
