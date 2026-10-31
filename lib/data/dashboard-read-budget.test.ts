/**
 * Read budget for the Dashboard (docs/progress/2026-10-13-dashboard-v2-performance.md).
 *
 * The Dashboard's cost is dominated by how many reads one render fans out
 * to, and that is a property of the code that can be checked without a
 * database. This pins the number per role so that adding a block or a tile
 * that quietly adds a read shows up as a deliberate change to this table in
 * review, instead of as a slower landing page weeks later.
 *
 * It counts loader calls, not milliseconds - wall-clock needs a seeded
 * agency and a signed-in session (see the results file for the procedure).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/observability/report-error", () => ({ reportHandledError: vi.fn() }));

const loaders = {
  snapshot: vi.fn(),
  assignedGroupIds: vi.fn(),
  tasks: vi.fn(),
  leadFacts: vi.fn(),
  quoteFacts: vi.fn(),
  proposals: vi.fn(),
  copilot: vi.fn(),
  receivables: vi.fn(),
  payments: vi.fn(),
  refunds: vi.fn(),
  financeReport: vi.fn(),
  salesReport: vi.fn(),
  overview: vi.fn(),
  visaQueue: vi.fn(),
  documentQueue: vi.fn(),
  supplierDirectory: vi.fn(),
  campaigns: vi.fn(),
  queueCounts: vi.fn(),
  entitlements: vi.fn(),
};

vi.mock("@/lib/data/operations-repository", () => ({ buildOperationsSnapshot: (...a: unknown[]) => loaders.snapshot(...a) }));
vi.mock("@/lib/data/team-repository", () => ({
  loadAssignedGroupIds: (...a: unknown[]) => loaders.assignedGroupIds(...a),
  loadTasksForStaff: (...a: unknown[]) => loaders.tasks(...a),
}));
vi.mock("@/lib/data/leads-repository", () => ({
  loadLeadDashboardFacts: (...a: unknown[]) => loaders.leadFacts(...a),
  loadQuoteDashboardFacts: (...a: unknown[]) => loaders.quoteFacts(...a),
}));
vi.mock("@/lib/data/departure-groups-agent", () => ({
  listAgencyOpenProposals: (...a: unknown[]) => loaders.proposals(...a),
  getCopilotDailySummary: (...a: unknown[]) => loaders.copilot(...a),
}));
vi.mock("@/lib/data/finance-repository", () => ({
  loadFinanceReceivables: (...a: unknown[]) => loaders.receivables(...a),
  loadFinancePayments: (...a: unknown[]) => loaders.payments(...a),
  loadRefundsPendingSummary: (...a: unknown[]) => loaders.refunds(...a),
}));
vi.mock("@/lib/data/reports-repository", () => ({
  loadReportsFinanceSnapshot: (...a: unknown[]) => loaders.financeReport(...a),
  loadReportsSalesSnapshot: (...a: unknown[]) => loaders.salesReport(...a),
  loadReportsOverviewSnapshot: (...a: unknown[]) => loaders.overview(...a),
}));
vi.mock("@/lib/data/visa-repository", () => ({ loadVisaQueue: (...a: unknown[]) => loaders.visaQueue(...a) }));
vi.mock("@/lib/data/documents-repository", () => ({ loadDocumentQueue: (...a: unknown[]) => loaders.documentQueue(...a) }));
vi.mock("@/lib/data/suppliers-repository", () => ({ loadSupplierDirectory: (...a: unknown[]) => loaders.supplierDirectory(...a) }));
vi.mock("@/lib/data/campaigns-repository", () => ({ listCampaignsWithMetrics: (...a: unknown[]) => loaders.campaigns(...a) }));
vi.mock("@/lib/data/inbox-queue-repository", () => ({ loadQueueCounts: (...a: unknown[]) => loaders.queueCounts(...a) }));
vi.mock("@/lib/billing/entitlements", () => ({ resolveEntitlements: (...a: unknown[]) => loaders.entitlements(...a) }));

import { baseDashboardCapabilities, visibleBlocks } from "@/lib/access/dashboard-access";
import { STAFF_ROLES } from "@/lib/access/departure-groups-access";

import { DASHBOARD_LAYOUTS } from "./dashboard-layout";
import { loadDashboardData } from "./dashboard-repository";

type Role = (typeof STAFF_ROLES)[number];
type LoaderName = keyof typeof loaders;

function seedLoaders() {
  vi.clearAllMocks();
  loaders.snapshot.mockResolvedValue({
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
  loaders.assignedGroupIds.mockResolvedValue([]);
  loaders.tasks.mockResolvedValue([]);
  loaders.leadFacts.mockResolvedValue([]);
  loaders.quoteFacts.mockResolvedValue([]);
  loaders.proposals.mockResolvedValue([]);
  loaders.copilot.mockResolvedValue(null);
  loaders.receivables.mockResolvedValue([]);
  loaders.payments.mockResolvedValue([]);
  loaders.refunds.mockResolvedValue({ count: 0 });
  loaders.financeReport.mockResolvedValue({ bookings: [], payments: [], groups: [], milestones: [] });
  loaders.salesReport.mockResolvedValue({ leads: [] });
  loaders.overview.mockResolvedValue({ bookingsCurrent: [], bookingsPrevious: [], paymentsCurrent: [], paymentsPrevious: [], groups: [] });
  loaders.visaQueue.mockResolvedValue([]);
  loaders.documentQueue.mockResolvedValue([]);
  loaders.supplierDirectory.mockResolvedValue([]);
  loaders.campaigns.mockResolvedValue([]);
  loaders.queueCounts.mockResolvedValue({});
  loaders.entitlements.mockResolvedValue({ features: {} });
}

beforeEach(seedLoaders);

async function readsFor(role: Role): Promise<{ total: number; calls: Partial<Record<LoaderName, number>> }> {
  seedLoaders();
  const caps = baseDashboardCapabilities(role);
  const blocks = visibleBlocks(DASHBOARD_LAYOUTS[role], caps);
  await loadDashboardData(role, "staff-1", "agency-1", "THIS_QUARTER", caps, blocks);

  const calls: Partial<Record<LoaderName, number>> = {};
  let total = 0;
  for (const [name, fn] of Object.entries(loaders) as [LoaderName, ReturnType<typeof vi.fn>][]) {
    const n = fn.mock.calls.length;
    if (n > 0) calls[name] = n;
    total += n;
  }
  return { total, calls };
}

/**
 * Reads per render, by role, pinned EXACTLY: the Operations snapshot (always)
 * plus every optional read the role's blocks and KPI row ask for. Exact, not
 * a ceiling, so that a read quietly *disappearing* is noticed too. Changing a
 * number here is allowed - it just has to be a decision someone reviewed.
 */
const READS_PER_RENDER: Record<Role, number> = {
  ADMIN: 15,
  CEO: 10,
  FINANCE: 9,
  MARKETING: 8,
  OPERATIONS: 6,
  VISA: 5,
  GUIDE: 3,
};

describe("Dashboard read budget", () => {
  it.each(STAFF_ROLES)("%s makes exactly its budgeted reads", async (role) => {
    const { total } = await readsFor(role);
    expect(total).toBe(READS_PER_RENDER[role]);
  });

  it.each(STAFF_ROLES)("%s makes no read twice in one render", async (role) => {
    const { calls } = await readsFor(role);
    for (const [name, n] of Object.entries(calls)) {
      expect({ name, n }).toEqual({ name, n: 1 });
    }
  });

  it("runs the heaviest read (campaign metrics) only for roles whose page shows the block", async () => {
    const withCampaigns: Role[] = [];
    for (const role of STAFF_ROLES) {
      const { calls } = await readsFor(role);
      if (calls.campaigns) withCampaigns.push(role);
    }
    expect(withCampaigns).toEqual(["ADMIN", "MARKETING"]);
  });
});
