import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn(() => ({})) }));

const buildOperationsSnapshot = vi.fn();
const loadAssignedGroupIds = vi.fn();
const loadTasksForStaff = vi.fn();
const loadLeadDashboardFacts = vi.fn();
const listAgencyOpenProposals = vi.fn();
const getCopilotDailySummary = vi.fn();
const loadFinanceReceivables = vi.fn();
const loadFinancePayments = vi.fn();
const loadRefundsPendingSummary = vi.fn();
const loadReportsFinanceSnapshot = vi.fn();
const loadReportsSalesSnapshot = vi.fn();

vi.mock("@/lib/data/operations-repository", () => ({ buildOperationsSnapshot: (...a: unknown[]) => buildOperationsSnapshot(...a) }));
vi.mock("@/lib/data/team-repository", () => ({
  loadAssignedGroupIds: (...a: unknown[]) => loadAssignedGroupIds(...a),
  loadTasksForStaff: (...a: unknown[]) => loadTasksForStaff(...a),
}));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadDashboardFacts: (...a: unknown[]) => loadLeadDashboardFacts(...a) }));
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
}));

import { STAFF_ROLES } from "@/lib/access/departure-groups-access";
import { baseDashboardCapabilities, visibleBlocks, type DashboardCapabilities } from "@/lib/access/dashboard-access";
import { DASHBOARD_LAYOUTS, type DashboardPanelId } from "@/lib/data/dashboard-layout";

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
