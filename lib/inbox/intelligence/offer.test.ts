import { describe, expect, it } from "vitest";

import type { OfferCandidate, TravelIntent } from "@/lib/copilot/sales/types";

import type { MatchedOfferSnapshot } from "./contracts";
import {
  buildOfferSnapshot,
  composeFollowUp,
  composeOfferReply,
  conversationLeadFacts,
  hasOfferInputs,
  matchConversationOffers,
  partySizeOf,
  revalidateOffer,
  type LiveOfferFacts,
} from "./offer";

const NOW = "2026-09-20T10:00:00.000Z";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const GROUP_A = "aaaaaaaa-0000-4000-8000-000000000001";
const GROUP_B = "aaaaaaaa-0000-4000-8000-000000000002";
const GROUP_C = "aaaaaaaa-0000-4000-8000-000000000003";
const PACKAGE = "bbbbbbbb-0000-4000-8000-000000000001";

/** "Cheapest 10-day Umrah in November for three": three adults, November, room not chosen. */
const intent = (over: Partial<TravelIntent> = {}): TravelIntent => ({
  journeyType: "UMRAH",
  travelWindow: { preferredMonth: "November", earliestDate: "2026-11-01", latestDate: "2026-11-30", flexibility: "FLEXIBLE" },
  travellers: { adults: 3, children: 0, infants: 0, groupType: "GROUP" },
  accommodationPreferences: {},
  travelPreferences: {},
  commercialSignals: { budgetSensitivity: "UNKNOWN", instalmentInterest: false, urgency: "UNKNOWN", decisionStage: "UNKNOWN" },
  objections: {},
  unansweredQuestions: [],
  extractedFacts: [],
  confidence: 0.5,
  updatedAt: NOW,
  ...over,
});

interface GroupOptions {
  id: string;
  name?: string;
  departureDate?: string;
  seats?: number;
  prices?: Partial<Record<"QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE", number>>;
  sellable?: boolean;
  waitlist?: boolean;
  pricedAt?: string | null;
  earlyBirdValidUntil?: string | null;
  packageId?: string;
}

function candidate(options: GroupOptions): OfferCandidate {
  const sellable = options.sellable ?? true;
  return {
    facts: {
      groupId: options.id,
      groupName: options.name ?? `Group ${options.id.slice(-1)}`,
      groupCode: `G${options.id.slice(-1)}`,
      packageTemplateId: options.packageId ?? PACKAGE,
      packageName: "10-day Umrah",
      journeyType: "UMRAH",
      departureDate: options.departureDate ?? "2026-11-12",
      returnDate: "2026-11-22",
      durationDays: 10,
      durationNights: 9,
      availableSeats: options.seats ?? 20,
      salesStatus: sellable ? "SELLING" : "WAITLIST",
      waitlistEnabled: options.waitlist ?? false,
      currency: "LKR",
      occupancyPrices: options.prices ?? { QUAD: 420000, TRIPLE: 450000, DOUBLE: 480000 },
      childPrice: null,
      infantPrice: null,
      depositPerPerson: 100000,
      paymentSchedule: [],
      accommodation: [],
      transportStandard: null,
      inclusions: ["Return flights", "Visa"],
      exclusions: [],
      confirmedHotels: [],
      confirmedFlights: [],
    },
    internal: {
      readinessStatus: "READY",
      hasCriticalBlock: false,
      priceSource: "GROUP_OVERRIDE",
      packagePublished: true,
      isSellable: sellable,
      pricedAt: options.pricedAt === undefined ? "2026-09-01T00:00:00.000Z" : options.pricedAt,
      earlyBirdValidUntil: options.earlyBirdValidUntil ?? null,
    },
  };
}

const match = (candidates: OfferCandidate[], travel: TravelIntent = intent()) => matchConversationOffers({ conversationId: CONVERSATION, intent: travel, candidates, now: NOW });

describe("hasOfferInputs — S3 needs a journey and a party", () => {
  const reading = { source: "RULES" as const, value: "x", evidence: [] };
  it("runs only when both were read", () => {
    expect(hasOfferInputs({ journey: reading, travellers: reading })).toBe(true);
    expect(hasOfferInputs({ journey: reading })).toBe(false);
    expect(hasOfferInputs({ travellers: reading })).toBe(false);
    expect(hasOfferInputs({})).toBe(false);
  });
});

describe("the stand-in lead", () => {
  it("carries nothing about the customer: everything comes from the intent, so a conversation with no lead still matches", () => {
    const lead = conversationLeadFacts(CONVERSATION, intent({ journeyType: "HAJJ" }));
    expect(lead).toMatchObject({ id: CONVERSATION, journeyType: "HAJJ", adults: 0, children: 0, notes: [], selectedDepartureGroupId: null });
  });
});

describe("matching a conversation's needs against live groups", () => {
  it("recommends the group that fits November for three, and lists the others as alternatives", () => {
    const result = match([
      candidate({ id: GROUP_A, departureDate: "2026-11-12" }),
      candidate({ id: GROUP_B, departureDate: "2026-11-25", prices: { QUAD: 400000 } }),
      candidate({ id: GROUP_C, departureDate: "2027-02-10" }),
    ]);
    expect(result.offers[0].isRecommended).toBe(true);
    expect(result.offers.map((offer) => offer.departureGroupId)).toContain(GROUP_A);
    expect(result.noMatch).toBeNull();
  });

  it("a sold-out group appears only as a waitlist option, never as an offer", () => {
    const result = match([candidate({ id: GROUP_A, sellable: false, seats: 0, waitlist: true })]);
    expect(result.offers).toEqual([]);
    expect(result.noMatch?.waitlistOptions.map((option) => option.groupId)).toEqual([GROUP_A]);
    expect(buildOfferSnapshot(result, [], NOW)).toBeNull();
  });

  it("a group with too few seats for the party is not offered", () => {
    expect(match([candidate({ id: GROUP_A, seats: 2 })]).offers).toEqual([]);
  });

  it("a group whose requested room type is unpriced is never offered", () => {
    const result = match([candidate({ id: GROUP_A, prices: { DOUBLE: 480000 } })], intent({ accommodationPreferences: { roomType: "QUAD" } }));
    expect(result.offers).toEqual([]);
  });

  it("the recommendation changes when the live seats change", () => {
    const before = match([candidate({ id: GROUP_A, departureDate: "2026-11-12", seats: 20 }), candidate({ id: GROUP_B, departureDate: "2026-11-26", seats: 20 })]);
    const after = match([candidate({ id: GROUP_A, departureDate: "2026-11-12", seats: 1 }), candidate({ id: GROUP_B, departureDate: "2026-11-26", seats: 20 })]);
    expect(before.offers[0].departureGroupId).toBe(GROUP_A);
    expect(after.offers.map((offer) => offer.departureGroupId)).toEqual([GROUP_B]);
  });

  it("no candidates means no offer and a reason", () => {
    expect(match([]).noMatch?.reason).toContain("No active Umrah");
  });
});

describe("the snapshot R1 compares", () => {
  const candidates = [candidate({ id: GROUP_A, seats: 14, pricedAt: "2026-09-01T08:30:00.000Z", earlyBirdValidUntil: "2026-10-01" }), candidate({ id: GROUP_B, departureDate: "2026-11-26" })];
  const snapshot = buildOfferSnapshot(match(candidates), candidates, NOW) as MatchedOfferSnapshot;

  it("records as_of, the source priced_at, and the seat count it was matched against", () => {
    expect(snapshot).toMatchObject({ departureGroupId: GROUP_A, asOf: NOW, pricedAt: "2026-09-01T08:30:00.000Z", seatsMatched: 14 });
  });

  it("records the price, room, party, inclusions and the early-bird end", () => {
    expect(snapshot).toMatchObject({ currency: "LKR", roomType: "TRIPLE", party: { adults: 3, children: 0, infants: 0 }, inclusions: ["Return flights", "Visa"], earlyBirdValidUntil: "2026-10-01", packageId: PACKAGE });
    expect(snapshot.pricePerPerson).toBeGreaterThan(0);
    expect(snapshot.totalPrice).toBe(snapshot.pricePerPerson * 3);
  });

  it("keeps runners-up compact, and never more than three", () => {
    expect(snapshot.alternatives.map((option) => option.departureGroupId)).toEqual([GROUP_B]);
  });

  it("falls back to as_of when the group has no pricing row, so a row created later reads as a change", () => {
    const unpriced = [candidate({ id: GROUP_A, pricedAt: null })];
    const fallback = buildOfferSnapshot(match(unpriced), unpriced, NOW) as MatchedOfferSnapshot;
    expect(fallback.pricedAt).toBe(NOW);
    expect(revalidateOffer(fallback, { available: true, availableSeats: 20, pricedAt: "2026-09-21T00:00:00.000Z", earlyBirdValidUntil: null }, NOW)).toBe("PRICE_CHANGED");
  });

  it("a built-in template's key is not a uuid, so it is not stored as a package id", () => {
    const builtIn = [candidate({ id: GROUP_A, packageId: "builtin-umrah-10" })];
    expect((buildOfferSnapshot(match(builtIn), builtIn, NOW) as MatchedOfferSnapshot).packageId).toBeNull();
  });
});

describe("revalidateOffer — R1 change detection", () => {
  const candidates = [candidate({ id: GROUP_A, seats: 14, pricedAt: "2026-09-01T08:30:00.000Z" })];
  const snapshot = buildOfferSnapshot(match(candidates), candidates, NOW) as MatchedOfferSnapshot;
  const live = (over: Partial<LiveOfferFacts> = {}): LiveOfferFacts => ({ available: true, availableSeats: 14, pricedAt: "2026-09-01T08:30:00.000Z", earlyBirdValidUntil: null, ...over });

  it("FRESH when nothing moved", () => {
    expect(revalidateOffer(snapshot, live(), NOW)).toBe("FRESH");
  });

  it("FRESH when only updated_at moved: R1 compares priced_at, and updated_at is not even an input", () => {
    // A reprice raises priced_at; any other edit to the pricing row leaves it alone.
    expect(revalidateOffer(snapshot, live({ pricedAt: "2026-09-01T08:30:00.000Z" }), NOW)).toBe("FRESH");
  });

  it("PRICE_CHANGED after a reprice (a newer priced_at)", () => {
    expect(revalidateOffer(snapshot, live({ pricedAt: "2026-09-19T12:00:00.000Z" }), NOW)).toBe("PRICE_CHANGED");
  });

  it("SEATS_INSUFFICIENT when fewer seats are left than the party needs, even with a same-day price", () => {
    expect(revalidateOffer(snapshot, live({ availableSeats: 2 }), NOW)).toBe("SEATS_INSUFFICIENT");
    expect(revalidateOffer(snapshot, live({ availableSeats: 3 }), NOW)).toBe("FRESH");
  });

  it("uses the party size the offer was worked out for", () => {
    expect(partySizeOf(snapshot)).toBe(3);
  });

  it("EARLY_BIRD_EXPIRING inside the seven-day window, and not before or after it", () => {
    expect(revalidateOffer(snapshot, live({ earlyBirdValidUntil: "2026-09-27" }), NOW)).toBe("EARLY_BIRD_EXPIRING");
    expect(revalidateOffer(snapshot, live({ earlyBirdValidUntil: "2026-09-20" }), NOW)).toBe("EARLY_BIRD_EXPIRING");
    expect(revalidateOffer(snapshot, live({ earlyBirdValidUntil: "2026-09-28" }), NOW)).toBe("FRESH");
    expect(revalidateOffer(snapshot, live({ earlyBirdValidUntil: "2026-09-19" }), NOW)).toBe("FRESH");
  });

  it("NO_LONGER_AVAILABLE beats everything else: a closed or another agency's group is never fresh", () => {
    expect(revalidateOffer(snapshot, live({ available: false, availableSeats: 0, pricedAt: null }), NOW)).toBe("NO_LONGER_AVAILABLE");
  });

  it("reports the most serious problem first", () => {
    expect(revalidateOffer(snapshot, live({ availableSeats: 1, pricedAt: "2026-09-19T12:00:00.000Z", earlyBirdValidUntil: "2026-09-22" }), NOW)).toBe("SEATS_INSUFFICIENT");
  });
});

describe("what the composer actions may say", () => {
  const candidates = [candidate({ id: GROUP_A, earlyBirdValidUntil: "2026-09-25" })];
  const snapshot = buildOfferSnapshot(match(candidates, intent({ accommodationPreferences: { roomType: "QUAD" } })), candidates, NOW) as MatchedOfferSnapshot;

  it("builds a reply from the offer's own figures while it is current", () => {
    const reply = composeOfferReply(snapshot, "FRESH") as string;
    expect(reply).toContain("Group 1");
    expect(reply).toContain("LKR 420,000 per person");
    expect(reply).toContain("LKR 1,260,000 in total for 3 adults");
    expect(reply).toContain("Return flights, Visa");
    expect(reply).toContain("quotation");
  });

  it("adds the early-bird deadline when it is close", () => {
    expect(composeOfferReply(snapshot, "EARLY_BIRD_EXPIRING")).toContain("available until");
  });

  it("refuses to put figures in a reply once the price or seats have moved", () => {
    for (const state of ["PRICE_CHANGED", "SEATS_INSUFFICIENT", "NO_LONGER_AVAILABLE"] as const) expect(composeOfferReply(snapshot, state), state).toBeNull();
  });

  it("never leaks internal notes into a customer draft", () => {
    const noisy = { ...snapshot, constraints: ["Internal: readiness BLOCKED"], reasons: ["Internal margin 12%"] };
    const reply = composeOfferReply(noisy, "FRESH") as string;
    expect(reply).not.toMatch(/Internal|margin|BLOCKED/);
  });

  it("asks only what a customer can answer, in plain words", () => {
    const gaps = { ...snapshot, missingInformation: ["Preferred travel month", "Maximum budget per person", "Child price is not set for this group — children priced at the adult rate", "Hotel distance to the Haram is not stated in the package"] };
    const text = composeFollowUp(gaps) as string;
    expect(text).toContain("Which month would you like to travel?");
    expect(text).toContain("What is your budget per person?");
    expect(text).toContain("How close to the Haram");
    expect(text).not.toMatch(/Child price|not stated in the package/);
  });

  it("has no follow-up when the only gaps are internal", () => {
    expect(composeFollowUp({ ...snapshot, missingInformation: ["Child price is not set for this group — children priced at the adult rate"] })).toBeNull();
    expect(composeFollowUp({ ...snapshot, missingInformation: [] })).toBeNull();
  });
});
