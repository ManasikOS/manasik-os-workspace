import { describe, expect, it } from "vitest";

import type { ConversationIntelligence, ConversationSignal } from "./contracts";
import { buildIntelligenceRailView, channelLabelOf, humaniseCode, type InboxIntelligenceData, type RailDeterministicFacts } from "./rail-view";

const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const MESSAGE = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a1";

const known: RailDeterministicFacts = { channelLabel: "WhatsApp", leadStage: "NEW_LEAD", preferredLanguage: "si" };

const reading = (overrides: Partial<ConversationIntelligence> = {}): ConversationIntelligence => ({
  conversationId: CONVERSATION,
  intentCode: "PRICE_REQUEST",
  intentConfidence: 0.91,
  travelIntent: null,
  urgency: "HIGH",
  commercialStage: "UNQUALIFIED",
  sentiment: "NEUTRAL",
  estimatedValueCents: null,
  estimatedValueCurrency: null,
  riskLevel: "NONE",
  nextActionCode: "NO_ACTION",
  languageCode: "en",
  summary: null,
  digest: null,
  travelIntentEvidence: {},
  openQuestions: [],
  matchedOffer: null,
  source: "LLM",
  state: "FRESH",
  note: null,
  pipelineVersion: 1,
  inputFingerprint: "f",
  computedAt: "2026-09-20T10:00:00.000Z",
  staleAt: null,
  aiRunId: null,
  ...overrides,
});

const data = (overrides: Partial<InboxIntelligenceData> = {}): InboxIntelligenceData => ({
  surfaceEnabled: true,
  intelligence: reading(),
  signals: [],
  sourceMessage: { id: MESSAGE, snippet: "How much is the December Umrah package?", createdAt: "2026-09-20T09:59:58.000Z" },
  ...overrides,
});

const signal = (overrides: Partial<ConversationSignal> = {}): ConversationSignal => ({
  conversationId: CONVERSATION,
  signalCode: "REFUND_REQUEST",
  messageId: MESSAGE,
  detector: "RULE",
  confidence: 1,
  evidence: [{ messageId: MESSAGE, snippet: "I want a refund" }],
  supersededAt: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

describe("never an empty panel", () => {
  it("with no reading yet on an agency that uses Copilot: says it is reading, and still shows what is known for certain", () => {
    const view = buildIntelligenceRailView(data({ intelligence: null, sourceMessage: null }), known);
    expect(view).toMatchObject({ status: "PENDING", headline: "Copilot is reading this conversation", facts: [] });
    expect(view?.deterministic).toEqual([
      { label: "Channel", value: "WhatsApp" },
      { label: "Lead stage", value: "New lead" },
      { label: "Language on file", value: "Sinhala" },
    ]);
  });

  it("a PENDING row renders the same way as no row", () => {
    const view = buildIntelligenceRailView(data({ intelligence: reading({ state: "PENDING", intentCode: null }) }), known);
    expect(view).toMatchObject({ status: "PENDING", headline: "Copilot is reading this conversation" });
    expect(view?.deterministic.length).toBe(3);
  });

  it("shows only the facts it has when there is no lead and no channel", () => {
    const view = buildIntelligenceRailView(data({ intelligence: null }), { channelLabel: null, leadStage: null, preferredLanguage: null });
    expect(view?.headline).toBe("Copilot is reading this conversation");
    expect(view?.deterministic).toEqual([]);
  });

  it("hides the rail entirely when the agency does not use Copilot and nothing was ever stored", () => {
    expect(buildIntelligenceRailView(data({ surfaceEnabled: false, intelligence: null }), known)).toBeNull();
  });

  it("still shows a stored reading after the surface is switched off", () => {
    expect(buildIntelligenceRailView(data({ surfaceEnabled: false }), known)?.status).toBe("READY");
  });
});

describe("a reading in plain words", () => {
  it("lists what they want, urgency, feeling and language, each linked to the message it was read from", () => {
    const view = buildIntelligenceRailView(data(), known);
    expect(view).toMatchObject({ status: "READY", headline: "Read by Copilot", sourceLabel: null });
    expect(view?.facts.map((fact) => [fact.key, fact.value])).toEqual([
      ["intent", "Asking for a price"],
      ["urgency", "High"],
      ["sentiment", "Neutral"],
      ["language", "English"],
    ]);
    for (const fact of view?.facts ?? []) expect(fact.evidence).toEqual({ messageId: MESSAGE, snippet: "How much is the December Umrah package?" });
  });

  it("states confidence as a percentage, and says so out loud when it is low", () => {
    const sure = buildIntelligenceRailView(data(), known)?.facts[0];
    expect(sure).toMatchObject({ confidencePercent: 91, lowConfidence: false });
    const unsure = buildIntelligenceRailView(data({ intelligence: reading({ intentConfidence: 0.45 }) }), known)?.facts[0];
    expect(unsure).toMatchObject({ confidencePercent: 45, lowConfidence: true });
    expect(buildIntelligenceRailView(data({ intelligence: reading({ intentConfidence: 0.6 }) }), known)?.facts[0].lowConfidence).toBe(false);
  });

  it("marks urgent, angry, distressed and complaint readings as needing attention, and calm ones not", () => {
    const calm = buildIntelligenceRailView(data({ intelligence: reading({ urgency: "NORMAL" }) }), known);
    expect(calm?.facts.some((fact) => fact.attention)).toBe(false);
    const hot = buildIntelligenceRailView(data({ intelligence: reading({ urgency: "CRITICAL", sentiment: "DISTRESSED", intentCode: "COMPLAINT" }) }), known);
    expect(hot?.facts.filter((fact) => fact.attention).map((fact) => fact.key)).toEqual(["intent", "urgency", "sentiment"]);
  });

  it("leaves out an intent that was never read rather than printing a blank", () => {
    const view = buildIntelligenceRailView(data({ intelligence: reading({ intentCode: null, intentConfidence: null }) }), known);
    expect(view?.facts.map((fact) => fact.key)).toEqual(["urgency", "sentiment", "language"]);
  });

  it("gives every fact a plain-language label, never a raw code", () => {
    const view = buildIntelligenceRailView(data({ intelligence: reading({ intentCode: "CANCELLATION", languageCode: "ta" }) }), known);
    expect(JSON.stringify(view?.facts.map((fact) => fact.value))).not.toMatch(/[A-Z]{3,}_[A-Z]+/);
    expect(view?.facts.find((fact) => fact.key === "language")?.value).toBe("Tamil");
  });
});

describe("honesty about where a reading came from", () => {
  it("labels a rule-sourced reading as a keyword match, with the reason it is not the model's", () => {
    const view = buildIntelligenceRailView(data({ intelligence: reading({ source: "RULES", note: "AI call failed: 503" }) }), known);
    expect(view).toMatchObject({ status: "READY", headline: "Keyword reading", sourceLabel: "Keyword match, not the AI model", note: "AI call failed: 503" });
  });

  it("says a stale reading may be out of date", () => {
    expect(buildIntelligenceRailView(data({ intelligence: reading({ state: "STALE" }) }), known)).toMatchObject({ status: "STALE", headline: "This reading may be out of date" });
  });

  it("a FAILED row shows its note and no facts", () => {
    const view = buildIntelligenceRailView(data({ intelligence: reading({ state: "FAILED", note: "Triage failed: socket hang up" }) }), known);
    expect(view).toMatchObject({ status: "FAILED", headline: "Copilot could not read this conversation", note: "Triage failed: socket hang up", facts: [] });
    expect(view?.deterministic.length).toBe(3);
  });

  it("a FAILED row with no note still says something", () => {
    expect(buildIntelligenceRailView(data({ intelligence: reading({ state: "FAILED", note: null }) }), known)?.note).toBeTruthy();
  });

  it("a SKIPPED row says it was not read", () => {
    expect(buildIntelligenceRailView(data({ intelligence: reading({ state: "SKIPPED", note: "Plan allowance used up" }) }), known)).toMatchObject({
      status: "SKIPPED",
      note: "Plan allowance used up",
    });
  });
});

describe("flags", () => {
  it("shows a live flag in plain words with the message it came from", () => {
    const view = buildIntelligenceRailView(data({ signals: [signal()] }), known);
    expect(view?.signals).toEqual([{ code: "REFUND_REQUEST", label: "Asked for a refund", evidence: [{ messageId: MESSAGE, snippet: "I want a refund" }] }]);
  });

  it("shows flags even while the reading is pending or has failed, because risk is not gated on the model", () => {
    expect(buildIntelligenceRailView(data({ intelligence: null, signals: [signal()] }), known)?.signals).toHaveLength(1);
    expect(buildIntelligenceRailView(data({ intelligence: reading({ state: "FAILED" }), signals: [signal()] }), known)?.signals).toHaveLength(1);
  });

  it("folds repeats of one flag into one row and drops superseded ones", () => {
    const view = buildIntelligenceRailView(
      data({
        signals: [
          signal(),
          signal({ evidence: [{ messageId: "m2", snippet: "refund please" }] }),
          signal({ signalCode: "DISTRESS_LANGUAGE", supersededAt: "2026-09-20T11:00:00.000Z" }),
        ],
      }),
      known,
    );
    expect(view?.signals).toHaveLength(1);
    expect(view?.signals[0].evidence).toHaveLength(2);
  });

  it("falls back to a readable name for a signal with no dedicated label, and keeps a link when there is no snippet", () => {
    const view = buildIntelligenceRailView(data({ signals: [signal({ signalCode: "INSTALMENT_INTEREST", evidence: [], messageId: MESSAGE })] }), known);
    expect(view?.signals[0]).toEqual({ code: "INSTALMENT_INTEREST", label: "Instalment interest", evidence: [{ messageId: MESSAGE, snippet: "" }] });
  });

  it("keeps the S4 detectors' signals out of sight while INBOX_RISK is in SHADOW, but shows the S0 flags and the bank-detail flag", () => {
    const signals = [signal({ signalCode: "PAYMENT_CLAIM_UNVERIFIED" }), signal({ signalCode: "GROUP_FULL_REQUESTED" }), signal({ signalCode: "BANK_DETAIL_MISMATCH" }), signal({ signalCode: "REFUND_REQUEST" })];
    for (const riskVisible of [undefined, false]) {
      expect(buildIntelligenceRailView(data({ signals, riskVisible }), known)?.signals.map((entry) => entry.code).sort()).toEqual(["BANK_DETAIL_MISMATCH", "REFUND_REQUEST"]);
    }
  });

  it("shows every signal once the agency moves INBOX_RISK past SHADOW", () => {
    const signals = [signal({ signalCode: "PAYMENT_CLAIM_UNVERIFIED" }), signal({ signalCode: "GROUP_FULL_REQUESTED" }), signal({ signalCode: "REFUND_REQUEST" })];
    expect(buildIntelligenceRailView(data({ signals, riskVisible: true }), known)?.signals).toHaveLength(3);
  });
});

describe("labels", () => {
  it("humanises codes and channels", () => {
    expect(humaniseCode("NEW_LEAD")).toBe("New lead");
    expect(channelLabelOf("INSTAGRAM")).toBe("Instagram");
    expect(channelLabelOf("WHATSAPP")).toBe("WhatsApp");
    expect(channelLabelOf(null)).toBeNull();
    expect(channelLabelOf("TELEGRAM")).toBe("Telegram");
  });
});

describe("travel details (S2, MI3.1)", () => {
  const withTravel = (evidence: ConversationIntelligence["travelIntentEvidence"]) => data({ intelligence: reading({ travelIntentEvidence: evidence }) });
  const readings: ConversationIntelligence["travelIntentEvidence"] = {
    origin: { source: "RULES", value: "Kandy", evidence: [{ messageId: MESSAGE, snippet: "4 adults from Kandy" }] },
    travellers: { source: "RULES", value: "4 adults", evidence: [{ messageId: MESSAGE, snippet: "4 adults from Kandy" }] },
    hotelDistance: { source: "LLM", value: "Very close to the Haram", evidence: [{ messageId: MESSAGE, snippet: "close hotel" }] },
    window: { source: "RULES", value: "December 2026", evidence: [{ messageId: null, snippet: "December" }] },
  };

  it("lists each detail in a fixed order with plain labels, each with the words it came from", () => {
    const view = buildIntelligenceRailView(withTravel(readings), known);
    expect(view?.travelDetails.map((detail) => [detail.label, detail.value])).toEqual([
      ["Travellers", "4 adults"],
      ["Travelling in", "December 2026"],
      ["Hotel distance", "Very close to the Haram"],
      ["Travelling from", "Kandy"],
    ]);
    for (const detail of view?.travelDetails ?? []) expect(detail.evidence.length, detail.label).toBeGreaterThan(0);
    expect(view?.travelDetails[0].evidence).toEqual([{ messageId: MESSAGE, snippet: "4 adults from Kandy" }]);
  });

  it("labels the source PER FIELD: a keyword-read detail says so, a model-read one does not", () => {
    const view = buildIntelligenceRailView(withTravel(readings), known);
    const bySource = Object.fromEntries((view?.travelDetails ?? []).map((detail) => [detail.key, detail.sourceLabel]));
    expect(bySource).toEqual({ travellers: "Keyword match", window: "Keyword match", hotelDistance: null, origin: "Keyword match" });
  });

  it("is empty until S2 has run, and never blank-filled", () => {
    expect(buildIntelligenceRailView(data(), known)?.travelDetails).toEqual([]);
    expect(buildIntelligenceRailView(data({ intelligence: null }), known)?.travelDetails).toEqual([]);
  });

  it("still shows what was read when a later reading failed or is out of date", () => {
    for (const state of ["FAILED", "STALE"] as const) {
      const view = buildIntelligenceRailView(data({ intelligence: reading({ state, travelIntentEvidence: readings }) }), known);
      expect(view?.travelDetails.length, state).toBe(4);
    }
  });
});

describe("best departure (S3, MI3.2)", () => {
  const snapshot: NonNullable<ConversationIntelligence["matchedOffer"]> = {
    departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    packageId: null,
    seatsMatched: 14,
    roomType: "TRIPLE",
    pricePerPerson: 450000,
    currency: "LKR",
    pricedAt: "2026-09-01T08:30:00.000Z",
    asOf: "2026-09-20T10:00:00.000Z",
    inclusions: ["Return flights", "Visa"],
    groupName: "November Umrah",
    departureDate: "2026-11-12",
    returnDate: "2026-11-22",
    durationDays: 10,
    totalPrice: 1350000,
    party: { adults: 3, children: 0, infants: 0 },
    fitLevel: "STRONG",
    recommendationReason: "It matches the stated budget.",
    reasons: [],
    constraints: ["Limited availability â€” only 14 seats left"],
    missingInformation: ["Maximum budget per person"],
    alternatives: [{ departureGroupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", groupName: "Late November", departureDate: "2026-11-26", roomType: "TRIPLE", pricePerPerson: 460000, seatsAvailable: 1 }],
    earlyBirdValidUntil: null,
  };
  const withOffer = (offerCheck: "FRESH" | "PRICE_CHANGED" | null | undefined) => data({ intelligence: reading({ matchedOffer: snapshot }), offerCheck });

  it("puts the best departure's seats, price, room, inclusions and constraints in plain words", () => {
    const offer = buildIntelligenceRailView(withOffer("FRESH"), known)?.offer;
    expect(offer).toMatchObject({
      title: "November Umrah",
      priceLabel: "LKR 450,000 per person",
      totalLabel: "LKR 1,350,000 for 3 adults",
      seatsLabel: "14 seats open",
      roomLabel: "Triple Sharing",
      fitLabel: "Strong fit",
      inclusions: ["Return flights", "Visa"],
      constraints: ["Limited availability â€” only 14 seats left"],
      missing: ["Maximum budget per person"],
    });
    expect(offer?.departureLabel).toContain("10 days");
  });

  it("lists the runners-up with their own price and seats", () => {
    const offer = buildIntelligenceRailView(withOffer("FRESH"), known)?.offer;
    expect(offer?.alternatives).toEqual([{ departureGroupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: expect.stringContaining("Late November"), priceLabel: "LKR 460,000 per person", seatsLabel: "1 seat open" }]);
  });

  it("a current offer can be quoted, and shows no warning", () => {
    expect(buildIntelligenceRailView(withOffer("FRESH"), known)?.offer?.check).toEqual({ state: "FRESH", message: null, canQuote: true });
  });

  it("a changed price says so and cannot be quoted", () => {
    const check = buildIntelligenceRailView(withOffer("PRICE_CHANGED"), known)?.offer?.check;
    expect(check).toMatchObject({ state: "PRICE_CHANGED", canQuote: false });
    expect(check?.message).toContain("price changed");
  });

  it("an offer that could not be checked is never treated as current", () => {
    for (const unchecked of [null, undefined] as const) {
      const check = buildIntelligenceRailView(withOffer(unchecked), known)?.offer?.check;
      expect(check).toMatchObject({ state: null, canQuote: false });
      expect(check?.message).toContain("Could not check");
    }
  });

  it("has no offer card until S3 has found one", () => {
    expect(buildIntelligenceRailView(data(), known)?.offer).toBeNull();
    expect(buildIntelligenceRailView(data({ intelligence: null }), known)?.offer).toBeNull();
  });
});


describe("offer age (display only, R1)", () => {
  const stored: NonNullable<ConversationIntelligence["matchedOffer"]> = {
    departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", packageId: null, seatsMatched: 5, roomType: "QUAD", pricePerPerson: 1000, currency: "LKR", pricedAt: "2026-09-01T00:00:00.000Z", asOf: "2026-09-20T10:00:00.000Z",
    inclusions: [], groupName: "G", departureDate: null, returnDate: null, durationDays: null, totalPrice: null, party: null, fitLevel: null, recommendationReason: null, reasons: [], constraints: [], missingInformation: [], alternatives: [], earlyBirdValidUntil: null,
  };
  const view = (offerAge: { minutes: number; limitMinutes: number } | null) => buildIntelligenceRailView(data({ intelligence: reading({ matchedOffer: stored }), offerCheck: "FRESH", offerAge }), known)?.offer;

  it("says how old the offer is once it passes the agency's limit, and never blocks anything because of it", () => {
    expect(view({ minutes: 90, limitMinutes: 60 })?.ageNote).toContain("90 minutes ago");
    expect(view({ minutes: 300, limitMinutes: 60 })?.ageNote).toContain("5 hours ago");
    expect(view({ minutes: 90, limitMinutes: 60 })?.check.canQuote).toBe(true);
  });

  it("says nothing inside the limit, or when the age is unknown", () => {
    expect(view({ minutes: 60, limitMinutes: 60 })?.ageNote).toBeNull();
    expect(view(null)?.ageNote).toBeNull();
  });
});

describe("review cards (MI4.2)", () => {
  const review = (over: Partial<NonNullable<InboxIntelligenceData["interventions"]>[number]> = {}): NonNullable<InboxIntelligenceData["interventions"]>[number] => ({
    id: "3f1d2c4e-5a6b-4c7d-8e9f-0000000000ee",
    conversationId: "3f1d2c4e-5a6b-4c7d-8e9f-000000000001",
    kind: "PAYMENT_CLAIM",
    severity: "BLOCK",
    headline: "The customer says they paid, but no payment is recorded",
    guidance: "Do not confirm the payment.",
    requiredActionCode: "VERIFY_PAYMENT",
    assignedRole: "FINANCE",
    assignedToId: null,
    status: "OPEN",
    resolvedBy: null,
    resolutionNote: null,
    sourceSignalIds: [],
    createdAt: "2026-09-21T10:00:00.000Z",
    resolvedAt: null,
    ...over,
  });

  it("turns an open review into words staff can act on: what happened, what to do, who owns it", () => {
    const [card] = buildIntelligenceRailView(data({ interventions: [review()] }), known)?.interventions ?? [];
    expect(card).toMatchObject({ headline: "The customer says they paid, but no payment is recorded", actionLabel: "Check the payment", ownerLabel: "Finance", blocking: true, acknowledged: false });
  });

  it("says who may close a money review, and says nothing for the others", () => {
    expect(buildIntelligenceRailView(data({ interventions: [review()] }), known)?.interventions[0].closeHint).toBe("Only Finance or an Admin can close this.");
    expect(buildIntelligenceRailView(data({ interventions: [review({ kind: "GROUP_FULL", severity: "REVIEW", assignedRole: "MARKETING" })] }), known)?.interventions[0].closeHint).toBeNull();
  });

  it("lists blocking reviews first, and shows an acknowledged one as being handled", () => {
    const cards = buildIntelligenceRailView(data({ interventions: [review({ id: "3f1d2c4e-5a6b-4c7d-8e9f-0000000000e1", kind: "GROUP_FULL", severity: "REVIEW", headline: "Group full" }), review({ status: "ACKNOWLEDGED" })] }), known)?.interventions ?? [];
    expect(cards.map((card) => card.blocking)).toEqual([true, false]);
    expect(cards[0].acknowledged).toBe(true);
  });

  it("shows a review even when the agency does not use triage and there is no reading: a person is still needed", () => {
    expect(buildIntelligenceRailView(data({ surfaceEnabled: false, intelligence: null, interventions: [review()] }), known)?.interventions).toHaveLength(1);
    expect(buildIntelligenceRailView(data({ surfaceEnabled: false, intelligence: null, interventions: [] }), known)).toBeNull();
  });

  it("has none when nothing is open", () => {
    expect(buildIntelligenceRailView(data(), known)?.interventions).toEqual([]);
  });
});

describe("shadow: the judgement flags and anything a model raised (MI4.3)", () => {
  it("hides the four judgement flags while INBOX_RISK is in SHADOW, and shows them past it", () => {
    const signals = ["COMPLAINT_ESCALATION", "FRAUD_CONCERN", "MEDICAL_URGENCY", "RELIGIOUS_RULING_REQUEST"].map((signalCode) => signal({ signalCode: signalCode as never }));
    expect(buildIntelligenceRailView(data({ signals, riskVisible: false }), known)?.signals).toEqual([]);
    expect(buildIntelligenceRailView(data({ signals, riskVisible: true }), known)?.signals).toHaveLength(4);
  });

  it("hides a distress signal the model raised in shadow, but keeps the one S0 raised by rule", () => {
    const signals = [signal({ signalCode: "DISTRESS_LANGUAGE", detector: "MODEL" }), signal({ signalCode: "DISTRESS_LANGUAGE", detector: "RULE" })];
    expect(buildIntelligenceRailView(data({ signals, riskVisible: false }), known)?.signals).toHaveLength(1);
    expect(buildIntelligenceRailView(data({ signals: [signals[0]], riskVisible: true }), known)?.signals).toHaveLength(1);
  });
});
