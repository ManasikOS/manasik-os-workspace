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
import { baseDashboardCapabilities, type DashboardCapabilities } from "@/lib/access/dashboard-access";

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
  };
}

function load(role: Role, c: DashboardCapabilities) {
  return loadDashboardData(role, "staff-1", "agency-1", "THIS_QUARTER", c);
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
    expect(data.collections !== null).toBe(c.finance.viewLedger);
    expect(data.businessHealth !== null).toBe(c.reports.viewFinance);
    expect(data.pipeline !== null).toBe(c.reports.viewSales);
    expect(data.approvals !== null).toBe(c.operations.viewModule);
  });

  it("gives a GUIDE no finance, sales or team sections", async () => {
    const data = await load("GUIDE", caps("GUIDE"));
    expect(data.collections).toBeNull();
    expect(data.businessHealth).toBeNull();
    expect(data.pipeline).toBeNull();
    expect(data.teamPerformance).toBeNull();
  });
});
