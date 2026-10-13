import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import {
  DASHBOARD_BANNER_BLOCKS,
  DASHBOARD_KPI_CAP,
  DASHBOARD_KPI_ORDER,
  DASHBOARD_LAYOUTS,
  DASHBOARD_PANEL_IDS,
  emptyDashboardMessage,
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

describe("DASHBOARD_KPI_ORDER", () => {
  it("caps the row at 6", () => {
    expect(DASHBOARD_KPI_CAP).toBe(6);
  });

  it.each(STAFF_ROLES)("%s: tile ids are unique and the list is no longer than the cap", (role) => {
    const ids = DASHBOARD_KPI_ORDER[role];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(DASHBOARD_KPI_CAP);
  });

  it("gives a GUIDE no finance or sales tile", () => {
    const finance = [
      "revenue",
      "collections-period",
      "outstanding-balance",
      "gross-margin",
      "overdue-balance",
      "refunds-pending",
      "supplier-payments-due",
      "new-inquiries",
      "open-quotes",
      "quote-booking-rate",
    ];
    for (const id of finance) expect(DASHBOARD_KPI_ORDER.GUIDE).not.toContain(id);
  });

  it("leads each role with the number its job runs on (spec section 4)", () => {
    expect(DASHBOARD_KPI_ORDER.CEO[0]).toBe("revenue");
    expect(DASHBOARD_KPI_ORDER.FINANCE[0]).toBe("collections-period");
    expect(DASHBOARD_KPI_ORDER.MARKETING[0]).toBe("new-inquiries");
    expect(DASHBOARD_KPI_ORDER.OPERATIONS[0]).toBe("groups-at-risk");
    expect(DASHBOARD_KPI_ORDER.VISA[0]).toBe("visa-pending");
    expect(DASHBOARD_KPI_ORDER.GUIDE[0]).toBe("my-open-tasks");
  });
});

describe("emptyDashboardMessage", () => {
  it.each(STAFF_ROLES)("names the %s role and tells the person who can fix it", (role) => {
    const message = emptyDashboardMessage(role);
    expect(message.toLowerCase()).toContain(role.toLowerCase());
    expect(message).toMatch(/administrator/i);
  });
});

describe("visa-queue placement", () => {
  it("is shown to VISA (as the first grid panel) and OPERATIONS only", () => {
    const holders = STAFF_ROLES.filter((r) => DASHBOARD_LAYOUTS[r].includes("visa-queue"));
    expect([...holders].sort()).toEqual(["OPERATIONS", "VISA"]);
    expect(splitDashboardBlocks(DASHBOARD_LAYOUTS.VISA).panels[0]).toBe("visa-queue");
  });
});

describe("document-review placement", () => {
  it("is shown to VISA only, directly after the visa queue", () => {
    const holders = STAFF_ROLES.filter((r) => DASHBOARD_LAYOUTS[r].includes("document-review"));
    expect(holders).toEqual(["VISA"]);
    const panels = splitDashboardBlocks(DASHBOARD_LAYOUTS.VISA).panels;
    expect(panels.slice(0, 2)).toEqual(["visa-queue", "document-review"]);
  });
});

describe("supplier-payables placement", () => {
  it("is shown to ADMIN, CEO and FINANCE only", () => {
    const holders = STAFF_ROLES.filter((r) => DASHBOARD_LAYOUTS[r].includes("supplier-payables"));
    expect([...holders].sort()).toEqual(["ADMIN", "CEO", "FINANCE"]);
  });

  it("sits right after Collections for FINANCE, whose job is money in and out", () => {
    const panels = splitDashboardBlocks(DASHBOARD_LAYOUTS.FINANCE).panels;
    expect(panels.indexOf("supplier-payables")).toBe(panels.indexOf("collections") + 1);
  });
});

describe("quotes-pending placement", () => {
  it("is shown to ADMIN, MARKETING, CEO and FINANCE only", () => {
    const holders = STAFF_ROLES.filter((r) => DASHBOARD_LAYOUTS[r].includes("quotes-pending"));
    expect([...holders].sort()).toEqual(["ADMIN", "CEO", "FINANCE", "MARKETING"]);
  });

  it("sits straight after the pipeline for MARKETING, whose job is the sales funnel", () => {
    const panels = splitDashboardBlocks(DASHBOARD_LAYOUTS.MARKETING).panels;
    expect(panels.indexOf("quotes-pending")).toBe(panels.indexOf("pipeline") + 1);
  });
});
