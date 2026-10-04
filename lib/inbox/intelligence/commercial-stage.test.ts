import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMERCIAL_STAGES, type CommercialStage, type IntentCode, type MatchedOfferSnapshot } from "./contracts";
import { commercialQueuesFor, deriveCommercialStage, deriveCommercialState, estimatedValueOf, type CommercialFacts } from "./commercial-stage";

const offer = (over: Partial<MatchedOfferSnapshot> = {}): MatchedOfferSnapshot => ({
  departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  packageId: null,
  seatsMatched: 20,
  roomType: "QUAD",
  pricePerPerson: 420000,
  currency: "LKR",
  pricedAt: "2026-09-01T00:00:00.000Z",
  asOf: "2026-09-20T10:00:00.000Z",
  inclusions: [],
  groupName: "Nov Umrah",
  departureDate: "2026-11-12",
  returnDate: "2026-11-22",
  durationDays: 10,
  totalPrice: 1260000,
  party: { adults: 3, children: 0, infants: 0 },
  fitLevel: "STRONG",
  recommendationReason: null,
  reasons: [],
  constraints: [],
  missingInformation: [],
  alternatives: [],
  earlyBirdValidUntil: null,
  ...over,
});

const reading = { source: "RULES" as const, value: "x", evidence: [] };

const facts = (over: Partial<CommercialFacts> = {}): CommercialFacts => ({ intentCode: null, leadStage: null, booking: null, quoteStatuses: [], matchedOffer: null, readings: {}, ...over });

describe("deriveCommercialStage — each transition has a fixture", () => {
  const cases: Array<[string, Partial<CommercialFacts>, CommercialStage]> = [
    ["nothing known, not about a trip", { intentCode: "FAQ" }, "UNQUALIFIED"],
    ["no intent read yet", {}, "UNQUALIFIED"],
    ["asking about packages", { intentCode: "PACKAGE_ENQUIRY" }, "QUALIFYING"],
    ["a group enquiry", { intentCode: "GROUP_ENQUIRY" }, "QUALIFYING"],
    ["some details read, intent unknown", { readings: { journey: reading } }, "QUALIFYING"],
    ["travellers and month known", { intentCode: "PACKAGE_ENQUIRY", readings: { travellers: reading, window: reading } }, "READY_TO_RECOMMEND"],
    ["a matched offer exists", { intentCode: "PRICE_REQUEST", matchedOffer: offer() }, "READY_TO_RECOMMEND"],
    ["staff qualified the lead", { leadStage: "QUALIFIED" }, "READY_TO_RECOMMEND"],
    ["a quote was sent", { matchedOffer: offer(), quoteStatuses: ["SENT"] }, "QUOTE_SENT"],
    ["the customer viewed the quote", { quoteStatuses: ["VIEWED"] }, "QUOTE_SENT"],
    ["the lead is at proposal sent", { leadStage: "PROPOSAL_SENT" }, "QUOTE_SENT"],
    ["an accepted quote", { quoteStatuses: ["SENT", "ACCEPTED"] }, "BOOKING_READY"],
    ["asked to book a matched departure", { intentCode: "BOOKING_REQUEST", matchedOffer: offer() }, "BOOKING_READY"],
    ["a held booking", { booking: { status: "HELD" }, quoteStatuses: ["ACCEPTED"] }, "BOOKED"],
    ["a confirmed booking", { booking: { status: "CONFIRMED" } }, "BOOKED"],
    ["the lead is booked", { leadStage: "BOOKED" }, "BOOKED"],
    ["the lead is lost", { leadStage: "LOST", quoteStatuses: ["SENT"], matchedOffer: offer() }, "LOST"],
    ["the lead is a duplicate", { leadStage: "DUPLICATE" }, "LOST"],
  ];
  for (const [name, input, expected] of cases) {
    it(`${name} → ${expected}`, () => expect(deriveCommercialStage(facts(input))).toBe(expected));
  }

  it("a cancelled or waitlisted booking is not a sale", () => {
    expect(deriveCommercialStage(facts({ booking: { status: "CANCELLED" }, quoteStatuses: ["SENT"] }))).toBe("QUOTE_SENT");
    expect(deriveCommercialStage(facts({ booking: { status: "WAITLIST" }, intentCode: "PACKAGE_ENQUIRY" }))).toBe("QUALIFYING");
  });

  it("a draft, expired or declined quote does not count as a quote sent", () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "EXPIRED", "DECLINED", "CANCELLED", "SUPERSEDED"]) {
      expect(deriveCommercialStage(facts({ intentCode: "PACKAGE_ENQUIRY", quoteStatuses: [status] })), status).toBe("QUALIFYING");
    }
  });

  it("is worked out from state, not the last message: a question after a quote does not send the sale back", () => {
    expect(deriveCommercialStage(facts({ intentCode: "FAQ", quoteStatuses: ["SENT"] }))).toBe("QUOTE_SENT");
    expect(deriveCommercialStage(facts({ intentCode: "COMPLAINT", booking: { status: "CONFIRMED" } }))).toBe("BOOKED");
  });

  it("always answers with a known stage", () => {
    for (const input of [facts(), facts({ leadStage: "POSTPONED" }), facts({ intentCode: "SPAM" })]) expect(COMMERCIAL_STAGES).toContain(deriveCommercialStage(input));
  });
});

describe("estimated value comes only from the matched offer", () => {
  it("is the offer's total in cents, in the offer's currency", () => {
    expect(deriveCommercialState(facts({ matchedOffer: offer({ totalPrice: 1260000.5, currency: "LKR" }) }))).toMatchObject({ stage: "READY_TO_RECOMMEND", estimatedValueCents: 126000050, estimatedValueCurrency: "LKR" });
  });

  it("is null without a matched offer, whatever else is known", () => {
    expect(deriveCommercialState(facts({ intentCode: "PACKAGE_ENQUIRY", readings: { budget: { source: "LLM", value: "LKR 900,000 per person", evidence: [] } } }))).toMatchObject({ estimatedValueCents: null, estimatedValueCurrency: null });
  });

  it("is null when the offer has no total", () => {
    expect(estimatedValueOf("READY_TO_RECOMMEND", offer({ totalPrice: null }))).toEqual({ cents: null, currency: null });
  });

  it("a lost lead has no pipeline value", () => {
    expect(deriveCommercialState(facts({ leadStage: "LOST", matchedOffer: offer() }))).toEqual({ stage: "LOST", estimatedValueCents: null, estimatedValueCurrency: null });
  });
});

describe("which Sales queues a stage belongs in", () => {
  const commercialIntents: IntentCode[] = ["PACKAGE_ENQUIRY", "PRICE_REQUEST", "BOOKING_REQUEST", "GROUP_ENQUIRY"];

  it("maps each stage to its queue", () => {
    expect(commercialQueuesFor("QUALIFYING", "PACKAGE_ENQUIRY")).toEqual(["NEW_ENQUIRIES"]);
    expect(commercialQueuesFor("UNQUALIFIED", "PRICE_REQUEST")).toEqual(["NEW_ENQUIRIES"]);
    expect(commercialQueuesFor("READY_TO_RECOMMEND", "PACKAGE_ENQUIRY")).toEqual(["QUALIFIED"]);
    expect(commercialQueuesFor("QUOTE_SENT", "FAQ")).toEqual(["QUOTE_SENT"]);
    expect(commercialQueuesFor("BOOKING_READY", null)).toEqual(["BOOKING_READY"]);
  });

  it("a lost or booked lead leaves every commercial queue", () => {
    for (const stage of ["LOST", "BOOKED"] as const) for (const intent of [...commercialIntents, "FAQ", null] as const) expect(commercialQueuesFor(stage, intent), `${stage}/${intent}`).toEqual([]);
  });

  it("a non-commercial conversation is not a new enquiry", () => {
    for (const intent of ["FAQ", "COMPLAINT", "VISA_QUERY", "PAYMENT_CLAIM", "SPAM", "OTHER", null] as const) expect(commercialQueuesFor("UNQUALIFIED", intent), String(intent)).toEqual([]);
  });

  it("every stage is in at most one Sales queue", () => {
    for (const stage of COMMERCIAL_STAGES) for (const intent of [...commercialIntents, "FAQ", null] as const) expect(commercialQueuesFor(stage, intent).length).toBeLessThanOrEqual(1);
  });
});

describe("the SQL predicates and commercialQueuesFor say the same thing", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261202091400_mi3_4_commercial_queues.sql"), "utf8");
  const compact = sql.replace(/\s+/g, " ");

  it("NEW_ENQUIRIES: UNQUALIFIED or QUALIFYING with a commercial intent", () => {
    expect(compact).toContain("commercial_stage in ('UNQUALIFIED', 'QUALIFYING') and r.intent_code in ('PACKAGE_ENQUIRY', 'PRICE_REQUEST', 'BOOKING_REQUEST', 'GROUP_ENQUIRY')");
  });

  it("QUALIFIED, BOOKING_READY and QUOTE_SENT read exactly one stage each", () => {
    expect(compact).toContain("('QUALIFIED', not r.is_closed and not r.is_spam and r.commercial_stage = 'READY_TO_RECOMMEND')");
    expect(compact).toContain("('BOOKING_READY', not r.is_closed and not r.is_spam and r.commercial_stage = 'BOOKING_READY')");
    expect(compact).toContain("('QUOTE_SENT', not r.is_closed and not r.is_spam and r.commercial_stage = 'QUOTE_SENT')");
  });

  it("LOST and BOOKED appear in no Sales predicate, and every predicate excludes closed and spam", () => {
    const predicates = compact.slice(compact.indexOf("('NEW_ENQUIRIES'"));
    expect(predicates).not.toMatch(/'LOST'|'BOOKED'/);
    expect((predicates.match(/not r\.is_closed and not r\.is_spam/g) ?? []).length).toBe(4);
  });

  it("the commercial intents in SQL are the ones the pipeline treats as commercial", () => {
    for (const intent of ["PACKAGE_ENQUIRY", "PRICE_REQUEST", "BOOKING_REQUEST", "GROUP_ENQUIRY"]) expect(compact).toContain(`'${intent}'`);
  });
});
