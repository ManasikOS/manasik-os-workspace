import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const generateStructured = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ generateStructured: (input: unknown) => generateStructured(input) }));

const { classifyRisk, INBOX_RISK_MODEL_SURFACE } = await import("./risk-classify");
const { RISK_FIXTURES } = await import("@/lib/inbox/risk/classify-fixtures");
const { lexiconReadings, verdictOf } = await import("@/lib/inbox/risk/classify");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const none = { present: false, confidence: 0, quote: "" };
const modelSays = (over: Record<string, unknown>) => generateStructured.mockResolvedValue({ value: { complaint: none, fraudConcern: none, medicalUrgency: none, religiousRuling: none, distress: none, ...over }, source: "LLM", note: null, runId: "run-1" });
const classify = (text: string, allowModel = true, earlier: string[] = []) => classifyRisk({ agencyId: AGENCY, conversationId: "c1", text, earlier, allowModel, db: {} as never });

beforeEach(() => generateStructured.mockReset());

describe("classifyRisk — rules first, the model only when they cannot decide", () => {
  it("an ordinary message makes no model call and reports nothing", async () => {
    const result = await classify("How much is the 10 day package for three adults?");
    expect(generateStructured).not.toHaveBeenCalled();
    expect(result).toMatchObject({ readings: [], source: "NONE", modelCalls: 0, unread: false });
  });

  it("a message the lexicon is sure of makes no model call and is settled by the rule", async () => {
    const result = await classify("What is the ruling on wearing a watch in ihram?");
    expect(generateStructured).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: "RULES", modelCalls: 0 });
    expect(result.readings.map((reading) => [reading.flag, reading.source])).toEqual([["RELIGIOUS_RULING", "RULE"]]);
  });

  it("only weak cues: exactly ONE classify-tier call on the INBOX_RISK_MODEL surface, for all five flags at once", async () => {
    modelSays({ distress: { present: true, confidence: 0.85, quote: "We are scared" } });
    const result = await classify("We are scared, the driver has not come and it is very late.", true, ["Salaam", "We land at 9pm"]);
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ tier: "classify", surface: INBOX_RISK_MODEL_SURFACE, agencyId: AGENCY, subjectType: "CONVERSATION", subjectId: "c1" }));
    expect((generateStructured.mock.calls[0][0] as { instruction: string }).instruction).toContain("Earlier messages");
    expect(result).toMatchObject({ source: "MODEL", modelCalls: 1, aiRunId: "run-1" });
    expect(result.readings).toEqual([{ flag: "DISTRESS", confidence: 0.85, snippet: "We are scared", source: "MODEL" }]);
  });

  it("a Sinhala message the English lexicon cannot read goes to the model", async () => {
    modelSays({ distress: { present: true, confidence: 0.9, quote: "ගොඩක් අමාරුයි" } });
    const result = await classify("අපිට ගොඩක් අමාරුයි, දැන්ම කවුරුහරි කතා කරන්න");
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(result.readings.map((reading) => reading.flag)).toEqual(["DISTRESS"]);
  });

  it("with the model switched OFF nothing is called and weak cues are not reported (that is not a failure)", async () => {
    const result = await classify("We are scared, the driver has not come and it is very late.", false);
    expect(generateStructured).not.toHaveBeenCalled();
    expect(result).toMatchObject({ readings: [], source: "NONE", modelCalls: 0, unread: false });
  });

  it("a strong phrase still stands when the model is off", async () => {
    const result = await classify("I will take legal action about this.", false);
    expect(result.readings.map((reading) => reading.flag)).toEqual(["COMPLAINT"]);
  });
});

describe("classifyRisk — a model failure never becomes 'no risk'", () => {
  const scared = "We are scared, the driver has not come and it is very late.";

  it("a model that returns nothing falls back to the lexicon's cues, at low confidence, and says so", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: "AI call failed: 503", runId: "run-2" });
    const result = await classify(scared);
    expect(result).toMatchObject({ source: "FALLBACK", note: "AI call failed: 503", modelCalls: 1, unread: false });
    expect(result.readings).toEqual([expect.objectContaining({ flag: "DISTRESS", confidence: 0.5, source: "RULE_FALLBACK" })]);
  });

  it("a refused call (over budget, no key) is treated as a failure too", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: 'AI surface "INBOX_RISK_MODEL" is over its daily budget.', runId: null });
    const result = await classify(scared);
    expect(result).toMatchObject({ source: "FALLBACK", modelCalls: 0 });
    expect(result.readings).toHaveLength(1);
  });

  it("an unreadable message the model cannot read either is reported as UNREAD, never as routine", async () => {
    generateStructured.mockResolvedValue({ value: null, source: "RULES", note: "AI call failed", runId: "run-3" });
    const result = await classify("අපිට ගොඩක් අමාරුයි, දැන්ම කවුරුහරි කතා කරන්න");
    expect(result).toMatchObject({ readings: [], source: "FALLBACK", unread: true });
  });
});

describe("classifyRisk — the model's answer is guarded", () => {
  it("drops a flag whose quote is not in the message, and says so", async () => {
    modelSays({ medicalUrgency: { present: true, confidence: 0.95, quote: "my father has chest pain" } });
    const result = await classify("We are scared, the driver has not come and it is very late.");
    expect(result.readings.map((reading) => reading.flag)).not.toContain("MEDICAL_URGENCY");
    expect(result.note).toContain("Left out 1 concern");
  });

  it("keeps the keyword cue when the model raised the same concern but could not quote it", async () => {
    modelSays({ distress: { present: true, confidence: 0.95, quote: "help me now" } });
    const result = await classify("We are scared, the driver has not come and it is very late.");
    expect(result.readings).toEqual([expect.objectContaining({ flag: "DISTRESS", source: "RULE_FALLBACK" })]);
  });

  it("a decoy the model correctly calls ordinary is reported as nothing", async () => {
    modelSays({});
    const result = await classify("Please help me choose between the 10 day and the 14 day package.");
    expect(result).toMatchObject({ readings: [], source: "NONE", modelCalls: 1 });
  });
});

describe("cost: over the whole labelled set the model is asked only when the rules cannot decide", () => {
  it("makes a call for exactly the inconclusive messages and for fewer than half of all traffic", async () => {
    modelSays({});
    for (const fixture of RISK_FIXTURES) await classify(fixture.text);
    const inconclusive = RISK_FIXTURES.filter((fixture) => verdictOf(lexiconReadings(fixture.text)) === "INCONCLUSIVE").length;
    expect(generateStructured).toHaveBeenCalledTimes(inconclusive);
    expect(inconclusive).toBeLessThan(RISK_FIXTURES.length / 2);
    expect(inconclusive).toBeGreaterThan(0);
  });

  it("with a perfect model, every labelled concern is found and no ordinary message is flagged", async () => {
    let missed = 0;
    let falseAlarms = 0;
    for (const fixture of RISK_FIXTURES) {
      const first = fixture.text.split(/\s+/).slice(0, 3).join(" ");
      const keys: Record<string, string> = { COMPLAINT: "complaint", FRAUD_CONCERN: "fraudConcern", MEDICAL_URGENCY: "medicalUrgency", RELIGIOUS_RULING: "religiousRuling", DISTRESS: "distress" };
      modelSays(Object.fromEntries(fixture.flags.map((flag) => [keys[flag], { present: true, confidence: 0.9, quote: first }])));
      const found = (await classify(fixture.text)).readings.map((reading) => reading.flag);
      for (const flag of fixture.flags) if (!found.includes(flag)) missed += 1;
      if (fixture.flags.length === 0 && found.length > 0) falseAlarms += 1;
    }
    expect(missed).toBe(0);
    expect(falseAlarms).toBe(0);
  });
});
