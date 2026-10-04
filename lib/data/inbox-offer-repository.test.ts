import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ DEAD_GROUP_STATUSES: new Set(["CANCELLED", "COMPLETED", "CLOSED", "DEPARTED"]), loadOfferCandidates: vi.fn() }));

const { checkStoredOffer, loadLiveOfferFacts } = await import("./inbox-offer-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TODAY = "2026-09-20";

interface Tables {
  group: Record<string, unknown> | null;
  pricing: Record<string, unknown> | null;
}

/** A recording stand-in for the two tables the live check reads. */
function fakeDb(tables: Tables) {
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([table, column, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: table === "departure_groups" ? tables.group : tables.pricing, error: null }),
      };
      return chain;
    },
  };
  return { client: client as never, filters };
}

const openGroup = { available_seats: 14, group_status: "OPEN", sales_status: "SELLING", archived: false, departure_date: "2026-11-12" };

describe("loadLiveOfferFacts", () => {
  it("reads the group by agency AND id: another agency's group is simply absent", async () => {
    const { client, filters } = fakeDb({ group: null, pricing: null });
    const live = await loadLiveOfferFacts(client, AGENCY, GROUP, TODAY);
    expect(live).toEqual({ available: false, availableSeats: 0, pricedAt: null, earlyBirdValidUntil: null });
    expect(filters).toContainEqual(["departure_groups", "agency_id", AGENCY]);
    expect(filters).toContainEqual(["departure_groups", "id", GROUP]);
  });

  it("an open group reports its live seats, price date and early-bird end", async () => {
    const { client } = fakeDb({ group: openGroup, pricing: { priced_at: "2026-09-01T08:30:00.000Z", early_bird_valid_until: "2026-10-01" } });
    expect(await loadLiveOfferFacts(client, AGENCY, GROUP, TODAY)).toEqual({ available: true, availableSeats: 14, pricedAt: "2026-09-01T08:30:00.000Z", earlyBirdValidUntil: "2026-10-01" });
  });

  it("is unavailable when archived, closed, sold out, already departed or past its date", async () => {
    for (const change of [{ archived: true }, { group_status: "CANCELLED" }, { group_status: "DEPARTED" }, { sales_status: "WAITLIST" }, { sales_status: "SALES_CLOSED" }, { departure_date: "2026-09-19" }]) {
      const { client } = fakeDb({ group: { ...openGroup, ...change }, pricing: null });
      expect((await loadLiveOfferFacts(client, AGENCY, GROUP, TODAY)).available, JSON.stringify(change)).toBe(false);
    }
  });
});

describe("checkStoredOffer", () => {
  const snapshot = {
    departureGroupId: GROUP,
    packageId: null,
    seatsMatched: 14,
    roomType: "QUAD" as const,
    pricePerPerson: 420000,
    currency: "LKR",
    pricedAt: "2026-09-01T08:30:00.000Z",
    asOf: "2026-09-10T00:00:00.000Z",
    inclusions: [],
    groupName: "",
    departureDate: null,
    returnDate: null,
    durationDays: null,
    totalPrice: null,
    party: { adults: 3, children: 0, infants: 0 },
    fitLevel: null,
    recommendationReason: null,
    reasons: [],
    constraints: [],
    missingInformation: [],
    alternatives: [],
    earlyBirdValidUntil: null,
  };
  const now = `${TODAY}T10:00:00.000Z`;

  it("FRESH against an unchanged group", async () => {
    const { client } = fakeDb({ group: openGroup, pricing: { priced_at: "2026-09-01T08:30:00.000Z", early_bird_valid_until: null } });
    expect(await checkStoredOffer(client, AGENCY, snapshot, now)).toBe("FRESH");
  });

  it("PRICE_CHANGED after a reprice, and NO_LONGER_AVAILABLE for a group this agency does not have", async () => {
    const repriced = fakeDb({ group: openGroup, pricing: { priced_at: "2026-09-15T00:00:00.000Z", early_bird_valid_until: null } });
    expect(await checkStoredOffer(repriced.client, AGENCY, snapshot, now)).toBe("PRICE_CHANGED");
    const foreign = fakeDb({ group: null, pricing: null });
    expect(await checkStoredOffer(foreign.client, AGENCY, snapshot, now)).toBe("NO_LONGER_AVAILABLE");
  });
});
