import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listDepartureGroups = vi.fn();
const getGroupPricingRow = vi.fn();
vi.mock("@/lib/data/departure-groups", () => ({
  listDepartureGroups: (...args: unknown[]) => listDepartureGroups(...args),
  getPackageSnapshotRow: async () => null,
  getGroupPricingRow: (...args: unknown[]) => getGroupPricingRow(...args),
  listConfirmedHotels: async () => [],
  listConfirmedFlights: async () => [],
}));
vi.mock("@/lib/data/leads-copilot", () => ({ copilotContextFor: () => null, toLeadFacts: () => ({}) }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: async () => ({}) }));

const { loadOfferCandidates } = await import("./knowledge-context");

const AGENCY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENCY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const group = (id: string, agencyId: string | null) => ({
  id,
  agencyId,
  archived: false,
  daysUntilDeparture: 40,
  groupStatus: "OPEN",
  salesStatus: "SELLING",
  waitlistEnabled: false,
  journeyType: "UMRAH",
  packageTemplateId: "tpl-1",
  packageTemplateName: "10-day Umrah",
  groupName: `Group ${id}`,
  groupCode: id.toUpperCase(),
  departureDate: "2026-11-12",
  returnDate: "2026-11-22",
  durationDays: 10,
  durationNights: 9,
  availableSeats: 12,
  readinessStatus: "READY",
});

const db = { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }) } as never;

describe("loadOfferCandidates — agency scope", () => {
  const groups = [group("a1", AGENCY_A), group("b1", AGENCY_B), group("orphan", null)];

  it("with an agency, another agency's group is never a candidate (the service-role client is not filtered by RLS)", async () => {
    listDepartureGroups.mockResolvedValue(groups);
    getGroupPricingRow.mockResolvedValue(null);
    const candidates = await loadOfferCandidates(db, "UMRAH", [], { agencyId: AGENCY_A });
    expect(candidates.map((entry) => entry.facts.groupId)).toEqual(["a1"]);
  });

  it("scopes even a group explicitly asked for by id", async () => {
    listDepartureGroups.mockResolvedValue(groups);
    getGroupPricingRow.mockResolvedValue(null);
    const candidates = await loadOfferCandidates(db, "UMRAH", ["b1"], { agencyId: AGENCY_A });
    expect(candidates.map((entry) => entry.facts.groupId)).toEqual(["a1"]);
  });

  it("without an agency (the RLS-scoped Leads drawer) nothing is filtered, exactly as before", async () => {
    listDepartureGroups.mockResolvedValue(groups);
    getGroupPricingRow.mockResolvedValue(null);
    const candidates = await loadOfferCandidates(db, "UMRAH");
    expect(candidates.map((entry) => entry.facts.groupId).sort()).toEqual(["a1", "b1", "orphan"]);
  });

  it("carries the price date and the early-bird end the Inbox compares later", async () => {
    listDepartureGroups.mockResolvedValue([group("a1", AGENCY_A)]);
    getGroupPricingRow.mockResolvedValue({
      currency: "LKR",
      quad_price: 420000,
      triple_price: null,
      double_price: null,
      single_price: null,
      child_price: null,
      infant_price: null,
      early_bird_price: null,
      early_bird_valid_until: "2026-10-01",
      advance_deposit: null,
      price_source: "OVERRIDDEN",
      priced_at: "2026-09-01T08:30:00.000Z",
    });
    const [candidate] = await loadOfferCandidates(db, "UMRAH", [], { agencyId: AGENCY_A });
    expect(candidate.internal).toMatchObject({ pricedAt: "2026-09-01T08:30:00.000Z", earlyBirdValidUntil: "2026-10-01" });
    expect(candidate.facts.occupancyPrices).toEqual({ QUAD: 420000 });
  });
});
