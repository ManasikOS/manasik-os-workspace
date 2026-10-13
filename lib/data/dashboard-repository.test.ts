import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn(() => ({})) }));

const buildOperationsSnapshot = vi.fn();
const loadAssignedGroupIds = vi.fn();
const loadTasksForStaff = vi.fn();
const loadLeadDashboardFacts = vi.fn();
const loadQuoteDashboardFacts = vi.fn();
const listCampaignsWithMetrics = vi.fn();
const listAgencyOpenProposals = vi.fn();
const getCopilotDailySummary = vi.fn();
const loadFinanceReceivables = vi.fn();
const loadFinancePayments = vi.fn();
const loadRefundsPendingSummary = vi.fn();
const loadReportsFinanceSnapshot = vi.fn();
const loadReportsSalesSnapshot = vi.fn();
const loadReportsOverviewSnapshot = vi.fn();
const reportHandledError = vi.fn();
const loadVisaQueue = vi.fn();
const loadDocumentQueue = vi.fn();
const loadSupplierDirectory = vi.fn();

vi.mock("@/lib/observability/report-error", () => ({ reportHandledError: (...a: unknown[]) => reportHandledError(...a) }));
vi.mock("@/lib/data/visa-repository", () => ({ loadVisaQueue: (...a: unknown[]) => loadVisaQueue(...a) }));
vi.mock("@/lib/data/documents-repository", () => ({ loadDocumentQueue: (...a: unknown[]) => loadDocumentQueue(...a) }));
vi.mock("@/lib/data/suppliers-repository", () => ({ loadSupplierDirectory: (...a: unknown[]) => loadSupplierDirectory(...a) }));
vi.mock("@/lib/data/campaigns-repository", () => ({ listCampaignsWithMetrics: (...a: unknown[]) => listCampaignsWithMetrics(...a) }));
vi.mock("@/lib/data/operations-repository", () => ({ buildOperationsSnapshot: (...a: unknown[]) => buildOperationsSnapshot(...a) }));
vi.mock("@/lib/data/team-repository", () => ({
  loadAssignedGroupIds: (...a: unknown[]) => loadAssignedGroupIds(...a),
  loadTasksForStaff: (...a: unknown[]) => loadTasksForStaff(...a),
}));
vi.mock("@/lib/data/leads-repository", () => ({
  loadLeadDashboardFacts: (...a: unknown[]) => loadLeadDashboardFacts(...a),
  loadQuoteDashboardFacts: (...a: unknown[]) => loadQuoteDashboardFacts(...a),
}));
vi.mock("@/lib/data/departure-groups-agent", () => ({
  listAgencyOpenProposals: (...a: unknown[]) => listAgencyOpenProposals(...a),
  getCopilotDailySummary: (...a: unknown[]) => getCopilotDailySummary(...a),
}));
vi.mock("@/lib/data/finance-repository", () => ({
  loadFinanceReceivables: (...a: unknown[]) => loadFinanceReceivables(...a),
  loadFinancePayments: (...a: unknown[]) => loadFinancePayments(...a),
  loadRefundsPendingSummary: (...a: unknown[]) => loadRefundsPendingSummary(...a),
}));
vi.mock("@/lib/data/reports-repository", () => ({
  loadReportsFinanceSnapshot: (...a: unknown[]) => loadReportsFinanceSnapshot(...a),
  loadReportsSalesSnapshot: (...a: unknown[]) => loadReportsSalesSnapshot(...a),
  loadReportsOverviewSnapshot: (...a: unknown[]) => loadReportsOverviewSnapshot(...a),
}));

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";
import { baseDashboardCapabilities, visibleBlocks, type DashboardCapabilities } from "@/lib/access/dashboard-access";
import { DASHBOARD_KPI_CAP, DASHBOARD_KPI_ORDER, DASHBOARD_LAYOUTS, type DashboardPanelId } from "@/lib/data/dashboard-layout";

import { loadDashboardData } from "./dashboard-repository";

type Role = (typeof STAFF_ROLES)[number];

const FINANCE_LOADERS = [loadFinanceReceivables, loadFinancePayments, loadRefundsPendingSummary];

function caps(role: Role, overrides: { [K in keyof DashboardCapabilities]?: Partial<DashboardCapabilities[K]> } = {}): DashboardCapabilities {
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

/** `blocks` defaults to what the role's page would actually render. */
function load(role: Role, c: DashboardCapabilities, blocks: DashboardPanelId[] = visibleBlocks(DASHBOARD_LAYOUTS[role], c)) {
  return loadDashboardData(role, "staff-1", "agency-1", "THIS_QUARTER", c, blocks);
}

beforeEach(() => {
  vi.clearAllMocks();
  buildOperationsSnapshot.mockResolvedValue({
    nowIso: new Date().toISOString(),
    groups: [],
    tasks: [],
    supplierRows: [],
    flights: [],
    accommodations: [],
    transports: [],
    guideBoard: [],
    activity: [],
  });
  loadAssignedGroupIds.mockResolvedValue([]);
  loadTasksForStaff.mockResolvedValue([]);
  loadLeadDashboardFacts.mockResolvedValue([]);
  loadQuoteDashboardFacts.mockResolvedValue([]);
  listCampaignsWithMetrics.mockResolvedValue([]);
  listAgencyOpenProposals.mockResolvedValue([]);
  getCopilotDailySummary.mockResolvedValue(null);
  loadFinanceReceivables.mockResolvedValue([
    {
      booking_id: "b1",
      primary_contact_name: "A. Pilgrim",
      primary_contact_phone: "0700000000",
      group_name: "Umrah Dec",
      outstanding_balance: 100000,
      next_due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      next_milestone_amount: 50000,
    },
  ]);
  loadFinancePayments.mockResolvedValue([]);
  loadRefundsPendingSummary.mockResolvedValue({ count: 0 });
  loadReportsFinanceSnapshot.mockResolvedValue({ bookings: [], payments: [], groups: [], milestones: [] });
  loadReportsSalesSnapshot.mockResolvedValue({ leads: [] });
  loadVisaQueue.mockResolvedValue([]);
  loadDocumentQueue.mockResolvedValue([]);
  loadSupplierDirectory.mockResolvedValue([]);
  loadReportsOverviewSnapshot.mockResolvedValue({
    bookingsCurrent: [],
    bookingsPrevious: [],
    paymentsCurrent: [],
    paymentsPrevious: [],
    groups: [],
  });
});

describe("loadDashboardData — gating follows the capability bundle it is given", () => {
  it("builds every finance-flavoured section for an ADMIN with the built-in set", async () => {
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.collections).not.toBeNull();
    expect(data.businessHealth).not.toBeNull();
    expect(data.pipeline).not.toBeNull();
    expect(data.approvals).not.toBeNull();
  });

  it("omits collections and never calls a finance loader when a custom role has switched the ledger off — even on an ADMIN base", async () => {
    const data = await load("ADMIN", caps("ADMIN", { finance: { viewLedger: false } }));
    expect(data.collections).toBeNull();
    for (const loader of FINANCE_LOADERS) expect(loader).not.toHaveBeenCalled();
    expect(data.kpis.map((k) => k.id)).not.toContain("outstanding-balance");
    expect(data.kpis.map((k) => k.id)).not.toContain("collections-period");
  });

  it("omits Business Health and does not read the finance report when reports.viewFinance is off", async () => {
    const data = await load("ADMIN", caps("ADMIN", { reports: { viewFinance: false } }));
    expect(data.businessHealth).toBeNull();
    expect(loadReportsFinanceSnapshot).not.toHaveBeenCalled();
  });

  it("omits Pipeline and Team Performance and does not read the sales report when reports.viewSales is off", async () => {
    const data = await load("ADMIN", caps("ADMIN", { reports: { viewSales: false } }));
    expect(data.pipeline).toBeNull();
    expect(data.teamPerformance).toBeNull();
    expect(loadReportsSalesSnapshot).not.toHaveBeenCalled();
  });

  it("omits agent approvals and does not read proposals when Operations is off", async () => {
    const data = await load("ADMIN", caps("ADMIN", { operations: { viewModule: false } }));
    expect(data.approvals).toBeNull();
    expect(listAgencyOpenProposals).not.toHaveBeenCalled();
    expect(getCopilotDailySummary).not.toHaveBeenCalled();
  });

  it("does not read lead facts when Leads is off", async () => {
    const data = await load("ADMIN", caps("ADMIN", { leads: { viewModule: false } }));
    expect(loadLeadDashboardFacts).not.toHaveBeenCalled();
    expect(data.kpis.map((k) => k.id)).not.toContain("new-inquiries");
  });

  it.each(STAFF_ROLES)("built-in %s: which sections exist follows exactly that role's own capabilities", async (role) => {
    const c = caps(role);
    const data = await load(role, c);
    const blocks = visibleBlocks(DASHBOARD_LAYOUTS[role], c);
    const has = (id: DashboardPanelId) => blocks.includes(id);
    expect(data.collections !== null).toBe(c.finance.viewLedger && has("collections"));
    expect(data.businessHealth !== null).toBe(c.reports.viewFinance && has("revenue-trend"));
    expect(data.pipeline !== null).toBe(c.reports.viewSales && (has("pipeline") || has("team-performance")));
    expect(data.approvals !== null).toBe(c.operations.viewModule && has("approvals"));
  });

  it("gives a GUIDE no finance, sales or team sections", async () => {
    const data = await load("GUIDE", caps("GUIDE"));
    expect(data.collections).toBeNull();
    expect(data.businessHealth).toBeNull();
    expect(data.pipeline).toBeNull();
    expect(data.teamPerformance).toBeNull();
  });
});

describe("loadDashboardData — a block that is not shown is not fetched", () => {
  const finance = [loadFinanceReceivables, loadFinancePayments, loadRefundsPendingSummary];
  const reports = [loadReportsFinanceSnapshot, loadReportsSalesSnapshot];
  const proposals = [listAgencyOpenProposals, getCopilotDailySummary];

  it("runs no finance, leads, reports or proposals loader for a GUIDE", async () => {
    await load("GUIDE", caps("GUIDE"));
    for (const loader of [...finance, ...reports, ...proposals, loadLeadDashboardFacts]) {
      expect(loader).not.toHaveBeenCalled();
    }
  });

  it("runs no sales-report and no proposals loader for FINANCE", async () => {
    await load("FINANCE", caps("FINANCE"));
    expect(loadReportsSalesSnapshot).not.toHaveBeenCalled();
    for (const loader of proposals) expect(loader).not.toHaveBeenCalled();
    expect(loadFinanceReceivables).toHaveBeenCalled();
  });

  it("skips the task read when My Day is not in the block list", async () => {
    await load("ADMIN", caps("ADMIN"), DASHBOARD_LAYOUTS.ADMIN.filter((b) => b !== "my-day"));
    expect(loadTasksForStaff).not.toHaveBeenCalled();
  });

  it("skips the finance report when revenue-trend is not in the block list", async () => {
    const data = await load("ADMIN", caps("ADMIN"), DASHBOARD_LAYOUTS.ADMIN.filter((b) => b !== "revenue-trend"));
    expect(loadReportsFinanceSnapshot).not.toHaveBeenCalled();
    expect(data.businessHealth).toBeNull();
  });
});

describe("loadDashboardData — skipped reads are 'unknown', never zero", () => {
  it("names the overdue balance in the status line when the ledger is read", async () => {
    loadFinanceReceivables.mockResolvedValue([
      {
        booking_id: "b1",
        primary_contact_name: "A",
        primary_contact_phone: "0",
        group_name: "G",
        outstanding_balance: 2_000_000,
        next_due_at: new Date(Date.now() - 86_400_000).toISOString(),
        next_milestone_amount: 1_000_000,
      },
    ]);
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.statusLine.message).toContain("overdue");
    expect(data.statusLine.message).not.toContain("All clear");
  });

  it("produces no NaN and no finance figures when every optional read is skipped", async () => {
    const data = await load("ADMIN", caps("ADMIN"), ["upcoming-departures"]);
    expect(data.collections).toBeNull();
    expect(data.statusLine.message).not.toMatch(/NaN|undefined/);
    expect(data.kpis.every((k) => !/NaN|undefined/.test(`${k.value}${k.trend ?? ""}`))).toBe(true);
    expect(data.kpis.map((k) => k.id)).not.toContain("outstanding-balance");
  });
});

describe("loadDashboardData — the KPI row is the role's own", () => {
  it.each(STAFF_ROLES)("%s: tiles come only from its list, in its order, within the cap", async (role) => {
    const data = await load(role, caps(role));
    const order = DASHBOARD_KPI_ORDER[role];
    const ids = data.kpis.map((k) => k.id);
    expect(ids.length).toBeLessThanOrEqual(DASHBOARD_KPI_CAP);
    for (const id of ids) expect(order).toContain(id);
    expect(ids).toEqual(order.filter((id) => ids.includes(id)));
  });

  it("shows a CEO the collections and outstanding tiles but not the pilgrim-count tiles", async () => {
    const ids = (await load("CEO", caps("CEO"))).kpis.map((k) => k.id);
    expect(ids).toContain("collections-period");
    expect(ids).not.toContain("active-pilgrims");
  });

  it("lets a custom role with the ledger off lose the finance tiles even though its base role lists them", async () => {
    const ids = (await load("FINANCE", caps("FINANCE", { finance: { viewLedger: false } }))).kpis.map((k) => k.id);
    expect(ids).not.toContain("collections-period");
    expect(ids).not.toContain("outstanding-balance");
  });
});

describe("loadDashboardData - the new tiles read only what they need", () => {
  it("reads the Reports overview for a CEO, whose row lists revenue and gross margin", async () => {
    const data = await load("CEO", caps("CEO"));
    expect(loadReportsOverviewSnapshot).toHaveBeenCalledOnce();
    const ids = data.kpis.map((k) => k.id);
    expect(ids).toContain("revenue");
    expect(ids).toContain("gross-margin");
  });

  it("shows an unknown margin as an em dash for a CEO with no revenue booked yet", async () => {
    const data = await load("CEO", caps("CEO"));
    expect(data.kpis.find((k) => k.id === "gross-margin")?.value).toBe("\u2014");
  });

  it("reads no overview for FINANCE, MARKETING, OPERATIONS, VISA or GUIDE", async () => {
    for (const role of ["FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const) {
      vi.clearAllMocks();
      await load(role, caps(role));
      expect(loadReportsOverviewSnapshot).not.toHaveBeenCalled();
    }
  });

  it("drops gross margin but keeps revenue when a custom role may not see cost and margin", async () => {
    const data = await load("CEO", caps("CEO", { reports: { viewCostAndMargin: false } }));
    const ids = data.kpis.map((k) => k.id);
    expect(ids).toContain("revenue");
    expect(ids).not.toContain("gross-margin");
  });

  it("drops both Reports tiles and skips the read when a custom role has the overview switched off", async () => {
    const data = await load("CEO", caps("CEO", { reports: { viewOverview: false } }));
    expect(loadReportsOverviewSnapshot).not.toHaveBeenCalled();
    const ids = data.kpis.map((k) => k.id);
    expect(ids).not.toContain("revenue");
    expect(ids).not.toContain("gross-margin");
  });

  it("counts a GUIDE's own open tasks", async () => {
    loadTasksForStaff.mockResolvedValue([{ id: "t1", title: "a", due_at: new Date().toISOString(), departure_group_id: "g", group_name: "G" }, { id: "t2", title: "b", due_at: new Date().toISOString(), departure_group_id: "g", group_name: "G" }]);
    const data = await load("GUIDE", caps("GUIDE"));
    expect(data.kpis.find((k) => k.id === "my-open-tasks")?.value).toBe("2");
  });

  it("shows FINANCE the overdue balance and pending refunds from the reads it already makes", async () => {
    loadRefundsPendingSummary.mockResolvedValue({ count: 4 });
    const data = await load("FINANCE", caps("FINANCE"));
    expect(data.kpis.find((k) => k.id === "refunds-pending")?.value).toBe("4");
    expect(data.kpis.find((k) => k.id === "overdue-balance")).toBeDefined();
  });
});

describe("loadDashboardData - one failed read degrades one block, not the page", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports no block errors and no notice when every read succeeds", async () => {
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.blockErrors).toEqual({});
    expect(data.statusLine.message).not.toContain("couldn't be loaded");
  });

  it("marks only Collections when the receivables read throws, and still builds every other block", async () => {
    loadFinanceReceivables.mockRejectedValue(new Error("db down"));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.blockErrors).toEqual({ collections: true });
    expect(data.collections).toBeNull();
    expect(data.businessHealth).not.toBeNull();
    expect(data.pipeline).not.toBeNull();
    expect(data.approvals).not.toBeNull();
  });

  it("marks Collections when the refunds read throws, rather than showing 0 pending refunds", async () => {
    loadRefundsPendingSummary.mockRejectedValue(new Error("db down"));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.blockErrors.collections).toBe(true);
    expect(data.collections).toBeNull();
  });

  it("never lets a failed ledger read look like All clear", async () => {
    loadFinanceReceivables.mockRejectedValue(new Error("db down"));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.statusLine.message).toContain("couldn't be loaded");
    expect(data.statusLine.message).not.toContain("All clear");
    expect(data.statusLine.tone).not.toBe("success");
  });

  it("marks Agent approvals when proposals cannot be read", async () => {
    listAgencyOpenProposals.mockRejectedValue(new Error("db down"));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.blockErrors).toEqual({ approvals: true });
    expect(data.approvals).toBeNull();
  });

  it("marks Revenue trend when the finance report cannot be read", async () => {
    loadReportsFinanceSnapshot.mockRejectedValue(new Error("db down"));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.blockErrors).toEqual({ "revenue-trend": true });
    expect(data.businessHealth).toBeNull();
  });

  it("marks Pipeline and Team performance when the sales report cannot be read", async () => {
    loadReportsSalesSnapshot.mockRejectedValue(new Error("db down"));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.blockErrors).toEqual({ pipeline: true, "team-performance": true });
  });

  it("marks My Day, not an empty list, when the person's tasks cannot be read", async () => {
    loadTasksForStaff.mockRejectedValue(new Error("db down"));
    const data = await load("GUIDE", caps("GUIDE"));
    expect(data.blockErrors).toEqual({ "my-day": true });
    expect(data.kpis.map((k) => k.id)).not.toContain("my-open-tasks");
  });

  it("drops only the Revenue and Margin tiles, with a notice, when the overview cannot be read", async () => {
    loadReportsOverviewSnapshot.mockRejectedValue(new Error("db down"));
    const data = await load("CEO", caps("CEO"));
    const ids = data.kpis.map((k) => k.id);
    expect(ids).not.toContain("revenue");
    expect(ids).not.toContain("gross-margin");
    expect(ids.length).toBeGreaterThan(0);
    expect(data.blockErrors).toEqual({});
    expect(data.statusLine.message).toContain("couldn't be loaded");
  });

  it("logs each failure and reports it as handled", async () => {
    loadReportsFinanceSnapshot.mockRejectedValue(new Error("db down"));
    await load("ADMIN", caps("ADMIN"));
    expect(console.error).toHaveBeenCalled();
    expect(reportHandledError).toHaveBeenCalledWith("dashboard.financeReport", expect.any(Error), expect.anything());
  });

  it("still fails the page when the Operations snapshot - what every block builds on - cannot be read", async () => {
    buildOperationsSnapshot.mockRejectedValue(new Error("db down"));
    await expect(load("ADMIN", caps("ADMIN"))).rejects.toThrow("db down");
  });

  it("does not mark a block the role does not render", async () => {
    loadReportsSalesSnapshot.mockRejectedValue(new Error("db down"));
    const data = await load("FINANCE", caps("FINANCE"));
    expect(loadReportsSalesSnapshot).not.toHaveBeenCalled();
    expect(data.blockErrors).toEqual({});
  });
});

describe("loadDashboardData - Recent Activity", () => {
  const NOW = Date.now();
  function activity(id: string, entityType: string, minutesAgo = 5) {
    return {
      id,
      groupId: `g-${id}`,
      groupName: `Group ${id}`,
      groupCode: id,
      actorName: "Aisha Khan",
      actionType: "X",
      entityType,
      message: `did ${entityType}`,
      isHighImpact: false,
      isSystem: false,
      createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
    };
  }

  function withActivity(rows: ReturnType<typeof activity>[]) {
    buildOperationsSnapshot.mockResolvedValue({
      nowIso: new Date().toISOString(),
      groups: [],
      tasks: [],
      supplierRows: [],
      flights: [],
      accommodations: [],
      transports: [],
      guideBoard: [],
      activity: rows,
    });
  }

  it("types each row from its entity instead of calling everything operations", async () => {
    withActivity([activity("1", "PAYMENT"), activity("2", "DOCUMENT"), activity("3", "VISA"), activity("4", "FLIGHT")]);
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.recentActivities.map((a) => a.type)).toEqual(["payment", "document", "visa", "operations"]);
  });

  it("links each row to its departure group", async () => {
    withActivity([activity("1", "VISA")]);
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.recentActivities[0].destination).toBe("/departure-groups/g-1");
  });

  it("caps the feed at 8 rows, newest first", async () => {
    withActivity(Array.from({ length: 12 }, (_, i) => activity(String(i), "TASK", i + 1)));
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.recentActivities).toHaveLength(8);
    expect(data.recentActivities[0].id).toBe("0");
  });

  it("hides payment lines from a role that may not see the ledger, and still fills the feed", async () => {
    withActivity([activity("p1", "PAYMENT"), ...Array.from({ length: 9 }, (_, i) => activity(`t${i}`, "TASK", i + 2))]);
    const visa = await load("VISA", caps("VISA"));
    expect(visa.recentActivities.some((a) => a.type === "payment")).toBe(false);
    expect(visa.recentActivities).toHaveLength(8);
  });

  it("shows payment lines to a role with ledger access", async () => {
    withActivity([activity("p1", "PAYMENT")]);
    const finance = await load("FINANCE", caps("FINANCE"));
    expect(finance.recentActivities.map((a) => a.type)).toEqual(["payment"]);
  });

  it("never reads a person's own security log - the feed comes from the already-scoped group activity", async () => {
    withActivity([activity("1", "GROUP")]);
    const data = await load("ADMIN", caps("ADMIN"));
    expect(data.recentActivities.every((a) => a.destination.startsWith("/departure-groups/"))).toBe(true);
  });
});

describe("loadDashboardData - the visa queue", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the visa queue for VISA and builds the block and the tile", async () => {
    const data = await load("VISA", caps("VISA"));
    expect(loadVisaQueue).toHaveBeenCalledOnce();
    expect(data.visaQueue).not.toBeNull();
    expect(data.kpis.map((k) => k.id)).toContain("visa-pending");
  });

  it("does not read it for ADMIN, CEO, FINANCE, MARKETING or GUIDE", async () => {
    for (const role of ["ADMIN", "CEO", "FINANCE", "MARKETING", "GUIDE"] as const) {
      vi.clearAllMocks();
      const data = await load(role, caps(role));
      expect(loadVisaQueue).not.toHaveBeenCalled();
      expect(data.visaQueue).toBeNull();
    }
  });

  it("does not read it when a custom role has the Visa module switched off", async () => {
    const data = await load("VISA", caps("VISA", { visa: { viewModule: false } }));
    expect(loadVisaQueue).not.toHaveBeenCalled();
    expect(data.visaQueue).toBeNull();
  });

  it("marks the block, not the page, when the queue cannot be read", async () => {
    loadVisaQueue.mockRejectedValue(new Error("db down"));
    const data = await load("VISA", caps("VISA"));
    expect(data.blockErrors["visa-queue"]).toBe(true);
    expect(data.visaQueue).toBeNull();
    expect(data.kpis.map((k) => k.id)).not.toContain("visa-pending");
  });
});

describe("loadDashboardData - document review", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the document queue for VISA and builds the block and the tile", async () => {
    const data = await load("VISA", caps("VISA"));
    expect(loadDocumentQueue).toHaveBeenCalledOnce();
    expect(data.documentReview).not.toBeNull();
    expect(data.kpis.map((k) => k.id)).toContain("docs-awaiting-review");
  });

  it("does not read it for ADMIN, CEO, FINANCE, MARKETING, OPERATIONS or GUIDE", async () => {
    for (const role of ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "GUIDE"] as const) {
      vi.clearAllMocks();
      const data = await load(role, caps(role));
      expect(loadDocumentQueue).not.toHaveBeenCalled();
      expect(data.documentReview).toBeNull();
    }
  });

  it("does not read it when a custom role has Documents switched off", async () => {
    const data = await load("VISA", caps("VISA", { documents: { viewModule: false } }));
    expect(loadDocumentQueue).not.toHaveBeenCalled();
    expect(data.documentReview).toBeNull();
  });

  it("marks the block, not the page, when the queue cannot be read", async () => {
    loadDocumentQueue.mockRejectedValue(new Error("db down"));
    const data = await load("VISA", caps("VISA"));
    expect(data.blockErrors["document-review"]).toBe(true);
    expect(data.documentReview).toBeNull();
    expect(data.kpis.map((k) => k.id)).not.toContain("docs-awaiting-review");
  });
});

describe("loadDashboardData - supplier payables", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the supplier directory for FINANCE, ADMIN and CEO and builds the block", async () => {
    for (const role of ["FINANCE", "ADMIN", "CEO"] as const) {
      vi.clearAllMocks();
      loadSupplierDirectory.mockResolvedValue([]);
      const data = await load(role, caps(role));
      expect(loadSupplierDirectory).toHaveBeenCalledOnce();
      expect(data.supplierPayables).not.toBeNull();
    }
  });

  it("passes the person's own supplier capabilities so the loader strips amounts they may not see", async () => {
    await load("FINANCE", caps("FINANCE"));
    const passed = loadSupplierDirectory.mock.calls[0][1];
    expect(passed).toMatchObject({ viewCosts: true, viewPayments: true });
  });

  it("shows FINANCE the supplier payments tile", async () => {
    const data = await load("FINANCE", caps("FINANCE"));
    expect(data.kpis.map((k) => k.id)).toContain("supplier-payments-due");
  });

  it("never reads the directory for OPERATIONS, MARKETING, VISA or GUIDE", async () => {
    for (const role of ["OPERATIONS", "MARKETING", "VISA", "GUIDE"] as const) {
      vi.clearAllMocks();
      const data = await load(role, caps(role));
      expect(loadSupplierDirectory).not.toHaveBeenCalled();
      expect(data.supplierPayables).toBeNull();
    }
  });

  it("does not read it when a custom role has supplier payments switched off", async () => {
    const data = await load("FINANCE", caps("FINANCE", { suppliers: { viewPayments: false } }));
    expect(loadSupplierDirectory).not.toHaveBeenCalled();
    expect(data.supplierPayables).toBeNull();
  });

  it("marks the block, not the page, when the directory cannot be read", async () => {
    loadSupplierDirectory.mockRejectedValue(new Error("db down"));
    const data = await load("FINANCE", caps("FINANCE"));
    expect(data.blockErrors["supplier-payables"]).toBe(true);
    expect(data.supplierPayables).toBeNull();
    expect(data.kpis.map((k) => k.id)).not.toContain("supplier-payments-due");
  });
});

describe("loadDashboardData - quotes pending", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads quotes for MARKETING, ADMIN, CEO and FINANCE and builds the block", async () => {
    for (const role of ["MARKETING", "ADMIN", "CEO", "FINANCE"] as const) {
      vi.clearAllMocks();
      loadQuoteDashboardFacts.mockResolvedValue([]);
      const data = await load(role, caps(role));
      expect(loadQuoteDashboardFacts).toHaveBeenCalledOnce();
      expect(data.quotePipeline).not.toBeNull();
    }
  });

  it("never reads quotes for OPERATIONS, VISA or GUIDE", async () => {
    for (const role of ["OPERATIONS", "VISA", "GUIDE"] as const) {
      vi.clearAllMocks();
      const data = await load(role, caps(role));
      expect(loadQuoteDashboardFacts).not.toHaveBeenCalled();
      expect(data.quotePipeline).toBeNull();
    }
  });

  it("builds the open-quotes tile for MARKETING from the module's open statuses", async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    loadQuoteDashboardFacts.mockResolvedValue([
      { id: "a", reference: "Q-A", status: "SENT", valid_until: soon, sent_at: null, created_at: soon },
      { id: "b", reference: "Q-B", status: "DRAFT", valid_until: soon, sent_at: null, created_at: soon },
      { id: "c", reference: "Q-C", status: "ACCEPTED", valid_until: soon, sent_at: null, created_at: soon },
    ]);
    const data = await load("MARKETING", caps("MARKETING"));
    expect(data.kpis.find((k) => k.id === "open-quotes")?.value).toBe("2");
  });

  it("does not read quotes when a custom role has the Quotes module switched off", async () => {
    const data = await load("MARKETING", caps("MARKETING", { quotes: { viewModule: false } }));
    expect(loadQuoteDashboardFacts).not.toHaveBeenCalled();
    expect(data.quotePipeline).toBeNull();
  });

  it("marks the block, not the page, when quotes cannot be read", async () => {
    loadQuoteDashboardFacts.mockRejectedValue(new Error("db down"));
    const data = await load("MARKETING", caps("MARKETING"));
    expect(data.blockErrors["quotes-pending"]).toBe(true);
    expect(data.quotePipeline).toBeNull();
    expect(data.kpis.map((k) => k.id)).not.toContain("open-quotes");
  });
});

describe("loadDashboardData - campaign pulse", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads campaigns for MARKETING and ADMIN and builds the block", async () => {
    for (const role of ["MARKETING", "ADMIN"] as const) {
      vi.clearAllMocks();
      listCampaignsWithMetrics.mockResolvedValue([]);
      const data = await load(role, caps(role));
      expect(listCampaignsWithMetrics).toHaveBeenCalledOnce();
      expect(data.campaignPulse).not.toBeNull();
    }
  });

  it("never reads campaigns for roles whose page does not show the block", async () => {
    for (const role of ["CEO", "FINANCE", "OPERATIONS", "VISA", "GUIDE"] as const) {
      vi.clearAllMocks();
      const data = await load(role, caps(role));
      expect(listCampaignsWithMetrics).not.toHaveBeenCalled();
      expect(data.campaignPulse).toBeNull();
    }
  });

  it("does not read campaigns when a custom role has the Marketing module switched off", async () => {
    const data = await load("MARKETING", caps("MARKETING", { marketing: { viewModule: false } }));
    expect(listCampaignsWithMetrics).not.toHaveBeenCalled();
    expect(data.campaignPulse).toBeNull();
  });

  it("marks the block, not the page, when campaigns cannot be read", async () => {
    listCampaignsWithMetrics.mockRejectedValue(new Error("db down"));
    const data = await load("MARKETING", caps("MARKETING"));
    expect(data.blockErrors["campaign-pulse"]).toBe(true);
    expect(data.campaignPulse).toBeNull();
  });
});
