import { describe, expect, it, vi } from "vitest";

import type { ConversationIntelligence } from "./contracts";
import type { EnrichmentContext, EnrichmentDeps, PipelineMessage } from "./pipeline";

vi.mock("server-only", () => ({}));

const { PIPELINE_VERSION, inputFingerprint, isAwaitingCustomerAnswer, lastStaffActivity, nextDigest, runEnrichment } = await import("./pipeline");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const NOW = new Date("2026-09-20T10:00:00Z");

const message = (id: string, actor: PipelineMessage["actor"], text: string, minutesAgo: number, type: PipelineMessage["type"] = "TEXT"): PipelineMessage => ({
  id,
  actor,
  text,
  type,
  createdAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
});

const previousRow = (overrides: Partial<ConversationIntelligence> = {}): ConversationIntelligence => ({
  conversationId: CONVERSATION,
  intentCode: "PACKAGE_ENQUIRY",
  intentConfidence: 0.8,
  travelIntent: null,
  urgency: "NORMAL",
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
  pipelineVersion: PIPELINE_VERSION,
  inputFingerprint: "old",
  computedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
  staleAt: null,
  aiRunId: null,
  ...overrides,
});

const baseTravelIntent = {
  travelWindow: { flexibility: "UNKNOWN" as const },
  travellers: { adults: 0, children: 0, infants: 0, groupType: "UNKNOWN" as const },
  accommodationPreferences: {},
  travelPreferences: {},
  commercialSignals: { budgetSensitivity: "UNKNOWN" as const, instalmentInterest: false, urgency: "UNKNOWN" as const, decisionStage: "UNKNOWN" as const },
  objections: {},
  unansweredQuestions: [],
  extractedFacts: [],
  confidence: 0,
  updatedAt: "2026-09-20T10:00:00.000Z",
};

const cleanTriage: EnrichmentDeps["triage"] = async () => ({
  intentCode: "PRICE_REQUEST",
  intentConfidence: 0.9,
  urgency: "NORMAL",
  sentiment: "NEUTRAL",
  languageCode: "en",
  source: "LLM",
  note: null,
  aiRunId: "run-1",
});

function harness(context: Partial<EnrichmentContext> & { messages: PipelineMessage[] }, triageImpl: EnrichmentDeps["triage"] = cleanTriage) {
  const full: EnrichmentContext = {
    conversation: { lifecycleStatus: "OPEN", handlingMode: "AI_ACTIVE" },
    previous: null,
    surface: { enabled: true, mode: "SHADOW" },
    intentSurface: null,
    ...context,
  };
  const triage = vi.fn(triageImpl);
  const recordGate = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
  const saveIntelligence = vi.fn<(...args: unknown[]) => Promise<{ written: true }>>(async () => ({ written: true }));
  const saveSignals = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
  const readTravelIntent = vi.fn<EnrichmentDeps["readTravelIntent"]>(async () => ({ intent: baseTravelIntent, readings: {}, source: "RULES", note: null, modelCalls: 0, aiRunId: null }));
  const matchOffers = vi.fn<EnrichmentDeps["matchOffers"]>(async () => ({ result: {} as never, snapshot: null }));
  const loadCommercialRecords = vi.fn<EnrichmentDeps["loadCommercialRecords"]>(async () => ({ leadStage: null, booking: null, quoteStatuses: [] }));
  const assignOwner = vi.fn<EnrichmentDeps["assignOwner"]>(async () => ({ status: "SKIPPED", reason: "test" }));
  const runRisk = vi.fn<EnrichmentDeps["runRisk"]>(async () => ({ fired: [], recorded: 0, superseded: 0, failedDetectors: [] }));
  const openInterventions = vi.fn<EnrichmentDeps["openInterventions"]>(async () => ({ opened: 0, notified: 0 }));
  const deps: EnrichmentDeps = { loadContext: async () => full, triage, readTravelIntent, matchOffers, loadCommercialRecords, assignOwner, runRisk, openInterventions, recordGate: recordGate as never, saveIntelligence: saveIntelligence as never, saveSignals: saveSignals as never, now: () => NOW };
  return { deps, triage, readTravelIntent, matchOffers, loadCommercialRecords, assignOwner, runRisk, openInterventions, recordGate, saveIntelligence, saveSignals };
}

const run = (h: ReturnType<typeof harness>) => runEnrichment({} as never, { agencyId: AGENCY, conversationId: CONVERSATION }, h.deps);
const lastSaved = (h: ReturnType<typeof harness>) => h.saveIntelligence.mock.calls.at(-1)?.[2] as unknown as Record<string, unknown>;

describe("runEnrichment — the gate decides, and every decision is logged", () => {
  it("enriches a fresh question: gate logged as ENRICH, triage called once, projection written FRESH", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "How much is the December Umrah package?", 0)] });
    expect(await run(h)).toMatchObject({ status: "ENRICHED", source: "LLM" });
    expect(h.triage).toHaveBeenCalledTimes(1);
    expect(h.recordGate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, messageId: "m1", decision: expect.objectContaining({ enrich: true, reason: "ENRICH_NEW_CONVERSATION" }) }),
    );
    expect(h.saveIntelligence.mock.calls.map((call) => (call[2] as { state: string }).state)).toEqual(["PENDING", "FRESH"]);
    expect(lastSaved(h)).toMatchObject({ intentCode: "PRICE_REQUEST", source: "LLM", aiRunId: "run-1", digest: expect.stringContaining("C: How much") });
  });

  it("makes NO model call when the gate says skip, and still logs the reason", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "thanks", 0)] });
    expect(await run(h)).toEqual({ status: "SKIPPED", reason: "SKIP_ACKNOWLEDGEMENT", escalatedToRisk: false });
    expect(h.triage).not.toHaveBeenCalled();
    expect(h.saveIntelligence).not.toHaveBeenCalled();
    expect(h.recordGate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: expect.objectContaining({ enrich: false, reason: "SKIP_ACKNOWLEDGEMENT" }) }));
  });

  it("treats an agency with no surface row as OFF: no model call", async () => {
    const h = harness({ surface: null, messages: [message("m1", "CUSTOMER", "How much is the Umrah package?", 0)] });
    expect(await run(h)).toMatchObject({ status: "SKIPPED", reason: "SKIP_SURFACE_OFF" });
    expect(h.triage).not.toHaveBeenCalled();
  });

  it("skips a disabled or OFF surface, but runs SHADOW, PROPOSE and ACTIVE", async () => {
    const cases = [
      [{ enabled: false, mode: "SHADOW" }, "SKIPPED"],
      [{ enabled: true, mode: "OFF" }, "SKIPPED"],
      [{ enabled: true, mode: "SHADOW" }, "ENRICHED"],
      [{ enabled: true, mode: "PROPOSE" }, "ENRICHED"],
      [{ enabled: true, mode: "ACTIVE" }, "ENRICHED"],
    ] as const;
    for (const [surface, expected] of cases) {
      const h = harness({ surface, messages: [message("m1", "CUSTOMER", "Any Umrah packages in March?", 0)] });
      expect((await run(h)).status).toBe(expected);
    }
  });

  it("skips a closed conversation, a spam conversation and one a person is actively handling", async () => {
    const question = message("m1", "CUSTOMER", "Any packages in March?", 0);
    const cases = [
      [{ lifecycleStatus: "CLOSED", handlingMode: "AI_ACTIVE" }, [question], "SKIP_CLOSED"],
      [{ lifecycleStatus: "SPAM", handlingMode: "AI_ACTIVE" }, [question], "SKIP_SPAM"],
      [{ lifecycleStatus: "OPEN", handlingMode: "HUMAN_ACTIVE" }, [message("m0", "STAFF", "Salaam, let me check", 1), question], "SKIP_HUMAN_ACTIVE"],
    ] as const;
    for (const [conversation, messages, reason] of cases) {
      const h = harness({ conversation, messages: [...messages] });
      expect(await run(h)).toMatchObject({ status: "SKIPPED", reason });
      expect(h.triage).not.toHaveBeenCalled();
    }
  });

  it("does not skip 'ok' when we had just asked the customer a question, because it is their answer", async () => {
    const h = harness({ messages: [message("m0", "AI", "Would you like the 10 or 14 day package?", 1), message("m1", "CUSTOMER", "ok", 0)] });
    expect((await run(h)).status).toBe("ENRICHED");
  });

  it("returns MISSING with no calls when the conversation or its customer message is not there", async () => {
    const gone = harness({ messages: [] });
    gone.deps.loadContext = async () => null;
    expect(await run(gone)).toEqual({ status: "MISSING" });
    const noCustomer = harness({ messages: [message("m1", "STAFF", "Hello", 0)] });
    expect(await run(noCustomer)).toEqual({ status: "MISSING" });
    expect(noCustomer.recordGate).not.toHaveBeenCalled();
  });
});

describe("runEnrichment — risk is never gated on cost", () => {
  it("records a refund red flag at 200% of allowance while refusing the model call", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "Please refund my deposit", 0)] });
    h.deps.loadEntitlements = async () => ({
      planCode: "PRO",
      aiConversationAllowance: 100,
      autonomyCeiling: "L2",
      overageOptIn: false,
      usage: 200,
    });

    expect(await run(h)).toMatchObject({ status: "SKIPPED", reason: "SKIP_ENTITLEMENT_EXHAUSTED", escalatedToRisk: true });
    expect(h.triage).not.toHaveBeenCalled();
    expect(h.saveSignals).toHaveBeenCalledWith(
      expect.anything(),
      AGENCY,
      CONVERSATION,
      [expect.objectContaining({ signalCode: "REFUND_REQUEST", detector: "RULE" })],
    );
  });

  it("records a refund red flag as a rule signal even when the surface is off and the gate skips", async () => {
    const h = harness({ surface: null, messages: [message("m1", "CUSTOMER", "I want a refund of my deposit", 0)] });
    expect(await run(h)).toMatchObject({ status: "SKIPPED", reason: "SKIP_SURFACE_OFF", escalatedToRisk: true });
    expect(h.triage).not.toHaveBeenCalled();
    expect(h.saveSignals).toHaveBeenCalledWith(expect.anything(), AGENCY, CONVERSATION, [expect.objectContaining({ signalCode: "REFUND_REQUEST", messageId: "m1", detector: "RULE" })]);
  });

  it("records distress even on a closed conversation", async () => {
    const h = harness({ conversation: { lifecycleStatus: "CLOSED", handlingMode: null }, messages: [message("m1", "CUSTOMER", "We are stranded at the airport", 0)] });
    await run(h);
    expect(h.saveSignals).toHaveBeenCalledWith(expect.anything(), AGENCY, CONVERSATION, [expect.objectContaining({ signalCode: "DISTRESS_LANGUAGE" })]);
  });

  it("records no signal for an ordinary message", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "Any Umrah packages in March?", 0)] });
    await run(h);
    expect(h.saveSignals).not.toHaveBeenCalled();
  });
});

describe("runEnrichment — failure and replay", () => {
  it("a rules fallback is stored as RULES with its note, and the job still succeeds", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "visa eka awada?", 0)] }, async () => ({
      intentCode: "VISA_QUERY",
      intentConfidence: 0.55,
      urgency: "NORMAL",
      sentiment: "NEUTRAL",
      languageCode: "en",
      source: "RULES",
      note: "AI call failed: 503",
      aiRunId: "run-9",
    }));
    expect(await run(h)).toMatchObject({ status: "ENRICHED", source: "RULES", note: "AI call failed: 503" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH", source: "RULES", note: "AI call failed: 503", intentCode: "VISA_QUERY" });
  });

  it("an unexpected triage exception stores FAILED with a note and rethrows so the job retries", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "Any Umrah packages?", 0)] }, async () => {
      throw new Error("socket hang up");
    });
    await expect(run(h)).rejects.toThrow("socket hang up");
    expect(lastSaved(h)).toMatchObject({ state: "FAILED", note: expect.stringContaining("socket hang up") });
  });

  it("a replay of the same input is skipped as unchanged, with no second model call", async () => {
    const messages = [message("m1", "CUSTOMER", "Any Umrah packages in March?", 0)];
    const first = harness({ messages });
    await run(first);
    const stored = lastSaved(first) as { inputFingerprint: string; digest: string | null };
    const replay = harness({ messages, previous: previousRow({ inputFingerprint: stored.inputFingerprint, digest: stored.digest, computedAt: NOW.toISOString() }) });
    expect(await run(replay)).toMatchObject({ status: "SKIPPED", reason: "SKIP_UNCHANGED_INPUT" });
    expect(replay.triage).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing projection when the gate skips", async () => {
    const h = harness({ previous: previousRow(), messages: [message("m1", "CUSTOMER", "Any packages?", 5), message("m2", "CUSTOMER", "thanks", 0)] });
    await run(h);
    expect(h.saveIntelligence).not.toHaveBeenCalled();
  });
});

describe("pipeline helpers", () => {
  it("lastStaffActivity ignores the AI and customers", () => {
    expect(lastStaffActivity([message("a", "AI", "x", 5), message("b", "CUSTOMER", "y", 3)])).toBeNull();
    expect(lastStaffActivity([message("a", "STAFF", "x", 5), message("b", "AI", "y", 3)])?.toISOString()).toBe(new Date(NOW.getTime() - 5 * 60_000).toISOString());
  });

  it("isAwaitingCustomerAnswer is true only when our message before the customer's ends in a question", () => {
    expect(isAwaitingCustomerAnswer([message("a", "AI", "Which month?", 2), message("b", "CUSTOMER", "ok", 1)])).toBe(true);
    expect(isAwaitingCustomerAnswer([message("a", "AI", "Here is the price.", 2), message("b", "CUSTOMER", "ok", 1)])).toBe(false);
    expect(isAwaitingCustomerAnswer([message("b", "CUSTOMER", "ok", 1)])).toBe(false);
  });

  it("nextDigest is incremental for a same-version stored digest and rebuilt otherwise", () => {
    const messages = [message("a", "CUSTOMER", "old question", 120), message("b", "AI", "old answer", 119), message("c", "CUSTOMER", "new question", 1)];
    const stored = previousRow({ digest: "C: old question\nT: old answer", computedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString() });
    expect(nextDigest(stored, messages)).toBe("C: old question\nT: old answer\nC: new question");
    expect(nextDigest(previousRow({ digest: "stale", pipelineVersion: PIPELINE_VERSION + 1 }), messages)).toBe("C: old question\nT: old answer\nC: new question");
    expect(nextDigest(null, messages)).toBe("C: old question\nT: old answer\nC: new question");
  });

  it("the fingerprint changes with the message and with the digest", () => {
    expect(inputFingerprint("m1", "d")).toBe(inputFingerprint("m1", "d"));
    expect(inputFingerprint("m1", "d")).not.toBe(inputFingerprint("m2", "d"));
    expect(inputFingerprint("m1", "d")).not.toBe(inputFingerprint("m1", "e"));
  });
});

describe("runEnrichment — S2 travel intent", () => {
  const intentOn = { enabled: true, mode: "SHADOW" as const };
  const commercialTriage: EnrichmentDeps["triage"] = async () => ({
    intentCode: "PACKAGE_ENQUIRY",
    intentConfidence: 0.9,
    urgency: "NORMAL",
    sentiment: "NEUTRAL",
    languageCode: "en",
    source: "LLM",
    note: null,
    aiRunId: "run-1",
  });
  const question = message("m1", "CUSTOMER", "4 adults from Kandy, December, quad", 0);
  const travelResult = {
    intent: baseTravelIntent,
    readings: { origin: { source: "RULES" as const, value: "Kandy", evidence: [{ messageId: "m1", snippet: "4 adults from Kandy" }] } },
    source: "RULES" as const,
    note: null,
    modelCalls: 0,
    aiRunId: null,
  };

  it("runs for a commercial conversation on an agency that switched INBOX_INTENT on, and stores the readings with the triage", async () => {
    const h = harness({ intentSurface: intentOn, messages: [message("m0", "AI", "Salaam!", 5), question] }, commercialTriage);
    h.readTravelIntent.mockResolvedValue(travelResult);
    await run(h);
    expect(h.readTravelIntent).toHaveBeenCalledTimes(1);
    expect(h.readTravelIntent).toHaveBeenCalledWith(expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, customerMessages: [{ id: "m1", text: "4 adults from Kandy, December, quad" }] }));
    // One FRESH write carries both stages: a second write with the same fingerprint would be skipped as unchanged.
    const writes = h.saveIntelligence.mock.calls.map((call) => call[2] as Record<string, unknown>).filter((row) => row.state === "FRESH");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ intentCode: "PACKAGE_ENQUIRY", travelIntentEvidence: travelResult.readings, travelIntent: expect.objectContaining({ confidence: 0 }) });
  });

  it("sends only customer messages to S2, never the team's", async () => {
    const h = harness({ intentSurface: intentOn, messages: [message("m0", "STAFF", "We fly in March", 9), message("m1", "CUSTOMER", "Umrah packages?", 5), message("m2", "AI", "Sure", 4), message("m3", "CUSTOMER", "For 3 adults", 0)] }, commercialTriage);
    await run(h);
    const sent = h.readTravelIntent.mock.calls[0][0].customerMessages;
    expect(sent.map((item) => item.id)).toEqual(["m1", "m3"]);
  });

  it("does not run for a conversation that is not about buying a trip", async () => {
    for (const intentCode of ["FAQ", "COMPLAINT", "VISA_QUERY", "PAYMENT_CLAIM", "SPAM", "OTHER"] as const) {
      const h = harness({ intentSurface: intentOn, messages: [question] }, async (input) => ({ ...(await commercialTriage(input)), intentCode }));
      await run(h);
      expect(h.readTravelIntent, intentCode).not.toHaveBeenCalled();
    }
  });

  it("runs for each commercial intent", async () => {
    for (const intentCode of ["PACKAGE_ENQUIRY", "PRICE_REQUEST", "BOOKING_REQUEST", "GROUP_ENQUIRY"] as const) {
      const h = harness({ intentSurface: intentOn, messages: [question] }, async (input) => ({ ...(await commercialTriage(input)), intentCode }));
      await run(h);
      expect(h.readTravelIntent, intentCode).toHaveBeenCalledTimes(1);
    }
  });

  it("does not run when the agency has no INBOX_INTENT row, has it disabled, or has it OFF: rules are free but the surface decides", async () => {
    for (const intentSurface of [null, { enabled: false, mode: "SHADOW" as const }, { enabled: true, mode: "OFF" as const }]) {
      const h = harness({ intentSurface, messages: [question] }, commercialTriage);
      await run(h);
      expect(h.readTravelIntent).not.toHaveBeenCalled();
      expect(lastSaved(h)).toMatchObject({ state: "FRESH", intentCode: "PACKAGE_ENQUIRY" });
      expect(lastSaved(h)).not.toHaveProperty("travelIntentEvidence");
    }
  });

  it("makes no S2 call when the gate skips the message", async () => {
    const h = harness({ intentSurface: intentOn, messages: [message("m1", "CUSTOMER", "thanks", 0)] }, commercialTriage);
    await run(h);
    expect(h.readTravelIntent).not.toHaveBeenCalled();
  });

  it("an S2 failure never costs the triage result: it is stored without travel details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ intentSurface: intentOn, messages: [question] }, commercialTriage);
    h.readTravelIntent.mockRejectedValue(new Error("extractor blew up"));
    expect(await run(h)).toMatchObject({ status: "ENRICHED", source: "LLM" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH", intentCode: "PACKAGE_ENQUIRY" });
    expect(lastSaved(h)).not.toHaveProperty("travelIntentEvidence");
  });

  it("surfaces the S2 note when triage had none, and never hides a triage note behind it", async () => {
    const withNote = { ...travelResult, note: "Left out 1 detail the model gave without a matching quote from the customer." };
    const clean = harness({ intentSurface: intentOn, messages: [question] }, commercialTriage);
    clean.readTravelIntent.mockResolvedValue(withNote);
    await run(clean);
    expect(lastSaved(clean).note).toBe(withNote.note);

    const noted = harness({ intentSurface: intentOn, messages: [question] }, async (input) => ({ ...(await commercialTriage(input)), source: "RULES" as const, note: "AI call failed: 503" }));
    noted.readTravelIntent.mockResolvedValue(withNote);
    await run(noted);
    expect(lastSaved(noted).note).toBe("AI call failed: 503");
  });
});

describe("runEnrichment â€” S3 live offer matching", () => {
  const intentOn = { enabled: true, mode: "SHADOW" as const };
  const commercialTriage: EnrichmentDeps["triage"] = async () => ({
    intentCode: "PACKAGE_ENQUIRY",
    intentConfidence: 0.9,
    urgency: "NORMAL",
    sentiment: "NEUTRAL",
    languageCode: "en",
    source: "LLM",
    note: null,
    aiRunId: "run-1",
  });
  const question = message("m1", "CUSTOMER", "Cheapest 10-day Umrah in November for 3 adults", 0);
  const reading = (value: string) => ({ source: "RULES" as const, value, evidence: [{ messageId: "m1", snippet: "Umrah for 3 adults" }] });
  const withInputs = { intent: baseTravelIntent, readings: { journey: reading("Umrah"), travellers: reading("3 adults") }, source: "RULES" as const, note: null, modelCalls: 0, aiRunId: null };
  const snapshot = {
    departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    packageId: null,
    seatsMatched: 20,
    roomType: "QUAD" as const,
    pricePerPerson: 420000,
    currency: "LKR",
    pricedAt: "2026-09-01T00:00:00.000Z",
    asOf: NOW.toISOString(),
    inclusions: [],
    groupName: "Nov Umrah",
    departureDate: "2026-11-12",
    returnDate: "2026-11-22",
    durationDays: 10,
    totalPrice: 1260000,
    party: { adults: 3, children: 0, infants: 0 },
    fitLevel: "STRONG" as const,
    recommendationReason: null,
    reasons: [],
    constraints: [],
    missingInformation: [],
    alternatives: [],
    earlyBirdValidUntil: null,
  };

  it("matches offers once S2 read a journey and a party, and stores the snapshot in the SAME single write as the triage", async () => {
    const h = harness({ intentSurface: intentOn, messages: [question] }, commercialTriage);
    h.readTravelIntent.mockResolvedValue(withInputs);
    h.matchOffers.mockResolvedValue({ result: {} as never, snapshot });
    await run(h);
    expect(h.matchOffers).toHaveBeenCalledTimes(1);
    expect(h.matchOffers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, now: NOW.toISOString() }));
    const writes = h.saveIntelligence.mock.calls.map((call) => call[2] as Record<string, unknown>).filter((row) => row.state === "FRESH");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ matchedOffer: snapshot, intentCode: "PACKAGE_ENQUIRY" });
  });

  it("never runs without S2: no surface, no readings, no offer", async () => {
    const off = harness({ intentSurface: null, messages: [question] }, commercialTriage);
    await run(off);
    expect(off.matchOffers).not.toHaveBeenCalled();
    expect(lastSaved(off)).not.toHaveProperty("matchedOffer");
  });

  it("does not match for a party of nobody, or for a journey the customer never named", async () => {
    for (const readings of [{ journey: reading("Umrah") }, { travellers: reading("3 adults") }, {}]) {
      const h = harness({ intentSurface: intentOn, messages: [question] }, commercialTriage);
      h.readTravelIntent.mockResolvedValue({ ...withInputs, readings });
      await run(h);
      expect(h.matchOffers, JSON.stringify(Object.keys(readings))).not.toHaveBeenCalled();
    }
  });

  it("clears a stale offer when nothing is bookable any more (null is written, not skipped)", async () => {
    const h = harness({ intentSurface: intentOn, previous: previousRow({ matchedOffer: snapshot }), messages: [question] }, commercialTriage);
    h.readTravelIntent.mockResolvedValue(withInputs);
    h.matchOffers.mockResolvedValue({ result: {} as never, snapshot: null });
    await run(h);
    expect(lastSaved(h)).toHaveProperty("matchedOffer", null);
  });

  it("an S3 failure never costs the triage result or the travel details, and leaves the stored offer alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ intentSurface: intentOn, messages: [question] }, commercialTriage);
    h.readTravelIntent.mockResolvedValue(withInputs);
    h.matchOffers.mockRejectedValue(new Error("pricing table unreadable"));
    expect(await run(h)).toMatchObject({ status: "ENRICHED" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH", intentCode: "PACKAGE_ENQUIRY", travelIntentEvidence: withInputs.readings });
    expect(lastSaved(h)).not.toHaveProperty("matchedOffer");
  });
});


describe("runEnrichment — commercial stage (MI3.4)", () => {
  const packageEnquiry: EnrichmentDeps["triage"] = async () => ({ intentCode: "PACKAGE_ENQUIRY", intentConfidence: 0.9, urgency: "NORMAL", sentiment: "NEUTRAL", languageCode: "en", source: "LLM", note: null, aiRunId: "run-1" });
  const question = message("m1", "CUSTOMER", "Any Umrah package for 3 in November?", 0);

  it("writes the stage with everything else in the single FRESH write, with no model involved", async () => {
    const h = harness({ messages: [question] }, packageEnquiry);
    await run(h);
    const writes = h.saveIntelligence.mock.calls.map((call) => call[2] as Record<string, unknown>).filter((row) => row.state === "FRESH");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ commercialStage: "QUALIFYING", estimatedValueCents: null, estimatedValueCurrency: null });
  });

  it("moves on to QUOTE_SENT from the lead's quotes, whatever the message says", async () => {
    const h = harness({ messages: [question] }, cleanTriage);
    h.loadCommercialRecords.mockResolvedValue({ leadStage: "PROPOSAL_SENT", booking: null, quoteStatuses: ["SENT"] });
    await run(h);
    expect(lastSaved(h)).toMatchObject({ commercialStage: "QUOTE_SENT" });
  });

  it("takes the value from the matched offer only, in cents", async () => {
    const h = harness({ intentSurface: { enabled: true, mode: "SHADOW" }, messages: [question] }, packageEnquiry);
    h.readTravelIntent.mockResolvedValue({ intent: baseTravelIntent, readings: { journey: { source: "RULES", value: "Umrah", evidence: [] }, travellers: { source: "RULES", value: "3 adults", evidence: [] } }, source: "RULES", note: null, modelCalls: 0, aiRunId: null });
    h.matchOffers.mockResolvedValue({ result: {} as never, snapshot: { departureGroupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", packageId: null, seatsMatched: 20, roomType: "QUAD", pricePerPerson: 420000, currency: "LKR", pricedAt: "2026-09-01T00:00:00.000Z", asOf: NOW.toISOString(), inclusions: [], groupName: "Nov", departureDate: "2026-11-12", returnDate: "2026-11-22", durationDays: 10, totalPrice: 1260000, party: { adults: 3, children: 0, infants: 0 }, fitLevel: "STRONG", recommendationReason: null, reasons: [], constraints: [], missingInformation: [], alternatives: [], earlyBirdValidUntil: null } });
    await run(h);
    expect(lastSaved(h)).toMatchObject({ commercialStage: "READY_TO_RECOMMEND", estimatedValueCents: 126000000, estimatedValueCurrency: "LKR" });
  });

  it("a lost lead has no value and is in the LOST stage, so it leaves every commercial queue", async () => {
    const h = harness({ messages: [question] }, packageEnquiry);
    h.loadCommercialRecords.mockResolvedValue({ leadStage: "LOST", booking: null, quoteStatuses: ["SENT"] });
    await run(h);
    expect(lastSaved(h)).toMatchObject({ commercialStage: "LOST", estimatedValueCents: null });
  });

  it("a failed read of the records never costs the triage result, and leaves the stored stage alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ messages: [question] }, packageEnquiry);
    h.loadCommercialRecords.mockRejectedValue(new Error("leads table unreadable"));
    expect(await run(h)).toMatchObject({ status: "ENRICHED" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH", intentCode: "PACKAGE_ENQUIRY" });
    expect(lastSaved(h)).not.toHaveProperty("commercialStage");
  });
});

describe("runEnrichment — auto-assignment (MI3.5)", () => {
  const question = message("m1", "CUSTOMER", "Any Umrah packages for 12 of us in March?", 0);
  const groupTriage: EnrichmentDeps["triage"] = async () => ({ intentCode: "GROUP_ENQUIRY", intentConfidence: 0.9, urgency: "NORMAL", sentiment: "NEUTRAL", languageCode: "en", source: "LLM", note: null, aiRunId: "run-1" });

  it("offers an unassigned open conversation to the routing chain, with the party size and intent it just read", async () => {
    const h = harness({ conversation: { lifecycleStatus: "OPEN", handlingMode: "AI_ACTIVE", assignedToId: null }, intentSurface: { enabled: true, mode: "SHADOW" }, messages: [question] }, groupTriage);
    h.readTravelIntent.mockResolvedValue({ intent: { ...baseTravelIntent, travellers: { adults: 10, children: 2, infants: 0, groupType: "GROUP" as const } }, readings: {}, source: "RULES", note: null, modelCalls: 0, aiRunId: null });
    await run(h);
    expect(h.assignOwner).toHaveBeenCalledTimes(1);
    expect(h.assignOwner).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, partySize: 12, intentCode: "GROUP_ENQUIRY" }));
  });

  it("never touches a conversation that already has an owner, or a closed one", async () => {
    for (const conversation of [{ lifecycleStatus: "OPEN" as const, handlingMode: "AI_ACTIVE" as const, assignedToId: "staff-1" }, { lifecycleStatus: "CLOSED" as const, handlingMode: "AI_ACTIVE" as const, assignedToId: null }]) {
      const h = harness({ conversation, messages: [question] }, groupTriage);
      await run(h);
      expect(h.assignOwner, JSON.stringify(conversation)).not.toHaveBeenCalled();
    }
  });

  it("leaves routing alone for callers that do not say who owns the conversation", async () => {
    const h = harness({ messages: [question] }, groupTriage);
    await run(h);
    expect(h.assignOwner).not.toHaveBeenCalled();
  });

  it("a routing failure never costs the reading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ conversation: { lifecycleStatus: "OPEN", handlingMode: "AI_ACTIVE", assignedToId: null }, messages: [question] }, groupTriage);
    h.assignOwner.mockRejectedValue(new Error("staff table unreadable"));
    expect(await run(h)).toMatchObject({ status: "ENRICHED" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH", intentCode: "GROUP_ENQUIRY" });
  });
});

describe("runEnrichment — S4 risk detectors (MI4.1)", () => {
  const question = message("m1", "CUSTOMER", "I have paid LKR 250,000 already", 0);
  const on = { enabled: true, mode: "SHADOW" as const };

  it("runs the detectors when INBOX_RISK is on, with the thread, the fresh confidence and the approved accounts", async () => {
    const h = harness({ riskSurface: on, approvedAccounts: ["123456789012"], messages: [question] });
    await run(h);
    expect(h.runRisk).toHaveBeenCalledTimes(1);
    expect(h.runRisk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, intentConfidence: 0.9, approvedAccounts: ["123456789012"], messages: [expect.objectContaining({ id: "m1" })] }));
  });

  it("does not run when the agency has no INBOX_RISK row, has it disabled, or has it OFF", async () => {
    for (const riskSurface of [null, { enabled: false, mode: "SHADOW" as const }, { enabled: true, mode: "OFF" as const }, undefined]) {
      const h = harness({ riskSurface, messages: [question] });
      await run(h);
      expect(h.runRisk, JSON.stringify(riskSurface)).not.toHaveBeenCalled();
    }
  });

  it("a detector failure never costs the reading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ riskSurface: on, messages: [question] });
    h.runRisk.mockRejectedValue(new Error("payments unreadable"));
    expect(await run(h)).toMatchObject({ status: "ENRICHED" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH" });
  });

  it("the approved accounts reach the S0 gate: an approved account number is not a red flag, an unknown one is", async () => {
    const bank = message("m1", "CUSTOMER", "please use bank account 1234 5678 9012", 0);
    const approved = harness({ approvedAccounts: ["123456789012"], messages: [bank] });
    await run(approved);
    expect(approved.saveSignals).not.toHaveBeenCalled();
    const unknown = harness({ approvedAccounts: ["999999999999"], messages: [bank] });
    await run(unknown);
    expect(unknown.saveSignals).toHaveBeenCalledTimes(1);
  });
});

describe("runEnrichment — review cards past SHADOW (MI4.2)", () => {
  const claim = message("m1", "CUSTOMER", "I have paid LKR 250,000 already", 0);
  const refund = message("m1", "CUSTOMER", "I want my money back, this is a refund request", 0);

  it("opens the cards for what the detectors found only when INBOX_RISK is past SHADOW", async () => {
    for (const [mode, expected] of [["SHADOW", false], ["PROPOSE", true], ["ACTIVE", true]] as const) {
      const h = harness({ riskSurface: { enabled: true, mode }, messages: [claim] });
      await run(h);
      expect(h.runRisk, mode).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ openInterventions: expected }));
    }
  });

  it("opens cards for S0 red flags too, whatever the gate decided, but not in SHADOW or when off", async () => {
    const on = harness({ riskSurface: { enabled: true, mode: "PROPOSE" }, surface: null, messages: [refund] });
    await run(on);
    expect(on.openInterventions).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION, codes: expect.arrayContaining(["REFUND_REQUEST"]) }));

    for (const riskSurface of [{ enabled: true, mode: "SHADOW" as const }, { enabled: false, mode: "ACTIVE" as const }, null, undefined]) {
      const h = harness({ riskSurface, surface: null, messages: [refund] });
      await run(h);
      expect(h.openInterventions, JSON.stringify(riskSurface)).not.toHaveBeenCalled();
    }
  });

  it("a failure to open a card never costs the reading", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ riskSurface: { enabled: true, mode: "ACTIVE" }, messages: [refund] });
    h.openInterventions.mockRejectedValue(new Error("interventions unreadable"));
    expect(await run(h)).toMatchObject({ status: "ENRICHED" });
    expect(lastSaved(h)).toMatchObject({ state: "FRESH" });
  });
});

describe("runEnrichment — the model half of the risk flags (MI4.3)", () => {
  const question = message("m1", "CUSTOMER", "We are scared, the driver has not come", 0);

  it("lets the classifier use the model only when INBOX_RISK_MODEL is on: its own switch, separate from the free detectors", async () => {
    const cases: Array<[EnrichmentContext["riskModelSurface"], boolean]> = [
      [null, false],
      [undefined, false],
      [{ enabled: false, mode: "ACTIVE" }, false],
      [{ enabled: true, mode: "OFF" }, false],
      [{ enabled: true, mode: "SHADOW" }, true],
      [{ enabled: true, mode: "ACTIVE" }, true],
    ];
    for (const [riskModelSurface, allowed] of cases) {
      const h = harness({ riskSurface: { enabled: true, mode: "SHADOW" }, riskModelSurface, messages: [question] });
      await run(h);
      expect(h.runRisk, JSON.stringify(riskModelSurface)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classifyModel: allowed }));
    }
  });

  it("switching INBOX_RISK on never switches the model on", async () => {
    const h = harness({ riskSurface: { enabled: true, mode: "ACTIVE" }, messages: [question] });
    await run(h);
    expect(h.runRisk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ classifyModel: false }));
  });

  it("runs nothing when the risk detectors themselves are off, whatever the model switch says", async () => {
    const h = harness({ riskSurface: null, riskModelSurface: { enabled: true, mode: "ACTIVE" }, messages: [question] });
    await run(h);
    expect(h.runRisk).not.toHaveBeenCalled();
  });
});

describe("runEnrichment — FIX3 AI-assisted conversation metering", () => {
  it("meters once, for the current UTC month, when the S1 enrichment write succeeds", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "How much is the December Umrah package?", 0)] });
    const meterConversation = vi.fn(async () => true);
    h.deps.meterConversation = meterConversation;

    await run(h);

    expect(meterConversation).toHaveBeenCalledOnce();
    expect(meterConversation).toHaveBeenCalledWith({}, { agencyId: AGENCY, conversationId: CONVERSATION, periodStart: "2026-09-01" });
  });

  it("does not meter an S0 skip: no enrichment write means nothing qualifying happened", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "thanks", 0)] });
    const meterConversation = vi.fn(async () => true);
    h.deps.meterConversation = meterConversation;

    expect(await run(h)).toMatchObject({ status: "SKIPPED" });

    expect(meterConversation).not.toHaveBeenCalled();
  });

  it("does not meter when the write itself reported nothing changed", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "How much is the December Umrah package?", 0)] });
    h.saveIntelligence.mockResolvedValue({ written: false } as never);
    const meterConversation = vi.fn(async () => true);
    h.deps.meterConversation = meterConversation;

    await run(h);

    expect(meterConversation).not.toHaveBeenCalled();
  });

  it("is optional: an enrichment write still succeeds when no metering dependency is wired", async () => {
    const h = harness({ messages: [message("m1", "CUSTOMER", "How much is the December Umrah package?", 0)] });
    await expect(run(h)).resolves.toMatchObject({ status: "ENRICHED" });
  });
});
