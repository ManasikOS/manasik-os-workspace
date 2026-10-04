import { describe, expect, it } from "vitest";

import { RISK_FIXTURES } from "./classify-fixtures";
import {
  fallbackReadings,
  FLAG_SIGNAL,
  lexiconReadings,
  mergeReadings,
  MODEL_MIN_CONFIDENCE,
  RISK_FLAGS,
  RISK_MODEL_JSON_SCHEMA,
  riskModelAnswerSchema,
  verdictOf,
  verifyModelAnswer,
  type RiskFlag,
  type RiskModelAnswer,
} from "./classify";

const none = { present: false, confidence: 0, quote: "" };
const answer = (over: Partial<RiskModelAnswer> = {}): RiskModelAnswer => ({ complaint: none, fraudConcern: none, medicalUrgency: none, religiousRuling: none, distress: none, ...over });

describe("the labelled fixture set", () => {
  it("has forty messages, each flag covered, and both scripts", () => {
    expect(RISK_FIXTURES).toHaveLength(40);
    for (const flag of RISK_FLAGS) expect(RISK_FIXTURES.some((fixture) => fixture.flags.includes(flag)), flag).toBe(true);
    expect(RISK_FIXTURES.some((fixture) => /[඀-෿]/.test(fixture.text))).toBe(true);
    expect(RISK_FIXTURES.some((fixture) => /[஀-௿]/.test(fixture.text))).toBe(true);
    expect(new Set(RISK_FIXTURES.map((fixture) => fixture.id)).size).toBe(40);
  });

  describe("STRONG messages are settled by the lexicon with no model, on the right flag", () => {
    for (const fixture of RISK_FIXTURES.filter((entry) => entry.tier === "STRONG")) {
      it(fixture.id, () => {
        const result = lexiconReadings(fixture.text);
        expect(result.strong.map((reading) => reading.flag), fixture.text).toEqual(expect.arrayContaining(fixture.flags));
        expect(verdictOf(result)).not.toBe("QUIET");
        for (const reading of result.strong) expect(reading.confidence).toBeGreaterThanOrEqual(0.9);
      });
    }
  });

  describe("WEAK messages are left to the model, and their cue survives a model failure", () => {
    for (const fixture of RISK_FIXTURES.filter((entry) => entry.tier === "WEAK")) {
      it(fixture.id, () => {
        const result = lexiconReadings(fixture.text);
        expect(verdictOf(result), fixture.text).toBe("INCONCLUSIVE");
        expect(fallbackReadings(result).map((reading) => reading.flag), fixture.text).toEqual(expect.arrayContaining(fixture.flags));
      });
    }
  });

  describe("QUIET messages cost nothing: no cue, no model call", () => {
    for (const fixture of RISK_FIXTURES.filter((entry) => entry.tier === "QUIET")) {
      it(fixture.id, () => {
        const result = lexiconReadings(fixture.text);
        expect(verdictOf(result), fixture.text).toBe("QUIET");
        expect(fallbackReadings(result)).toEqual([]);
      });
    }
  });

  describe("DECOYS are never settled as a concern by rules alone", () => {
    for (const fixture of RISK_FIXTURES.filter((entry) => entry.tier === "DECOY")) {
      it(fixture.id, () => {
        expect(lexiconReadings(fixture.text).strong, fixture.text).toEqual([]);
      });
    }
  });

  it("no routine message is ever settled as a concern by the lexicon (precision on ordinary traffic)", () => {
    for (const fixture of RISK_FIXTURES.filter((entry) => entry.flags.length === 0)) expect(lexiconReadings(fixture.text).strong, fixture.id).toEqual([]);
  });

  it("recall gate: with the model DOWN, a distressed customer is never made to look routine (100 % of the fixtures, gate is 95 %)", () => {
    const distressed = RISK_FIXTURES.filter((fixture) => fixture.distressed);
    expect(distressed.length).toBeGreaterThanOrEqual(8);
    let caught = 0;
    for (const fixture of distressed) {
      const result = lexiconReadings(fixture.text);
      const reported = fallbackReadings(result).length > 0 || (result.unreadable && verdictOf(result) === "INCONCLUSIVE");
      if (reported) caught += 1;
      expect(reported, `${fixture.id}: ${fixture.text}`).toBe(true);
    }
    expect(caught / distressed.length).toBeGreaterThanOrEqual(0.95);
  });

  it("recall on every labelled concern with the model down: the labelled flag is reported for all but the unreadable script", () => {
    const readable = RISK_FIXTURES.filter((fixture) => fixture.flags.length > 0 && fixture.tier !== "UNREADABLE");
    const missed = readable.filter((fixture) => !fallbackReadings(lexiconReadings(fixture.text)).some((reading) => fixture.flags.includes(reading.flag)));
    expect(missed.map((fixture) => fixture.id)).toEqual([]);
  });

  it("an unreadable message is sent to the model, not called routine", () => {
    for (const fixture of RISK_FIXTURES.filter((entry) => entry.tier === "UNREADABLE")) expect(verdictOf(lexiconReadings(fixture.text)), fixture.id).toBe("INCONCLUSIVE");
  });
});

describe("the flags map onto the existing signal codes", () => {
  it("one signal per flag, all distinct", () => {
    expect(new Set(RISK_FLAGS.map((flag) => FLAG_SIGNAL[flag])).size).toBe(RISK_FLAGS.length);
    expect(FLAG_SIGNAL.COMPLAINT).toBe("COMPLAINT_ESCALATION");
    expect(FLAG_SIGNAL.RELIGIOUS_RULING).toBe("RELIGIOUS_RULING_REQUEST");
  });
});

describe("a model's answer is never trusted on its own", () => {
  const message = "We are scared, the driver has not come and it is very late.";

  it("keeps a flag that quotes the customer verbatim, ignoring case, spacing and punctuation", () => {
    const { readings, rejected } = verifyModelAnswer(answer({ distress: { present: true, confidence: 0.8, quote: "we are SCARED the driver has not come" } }), message);
    expect(readings).toEqual([{ flag: "DISTRESS", confidence: 0.8, snippet: "we are SCARED the driver has not come", source: "MODEL" }]);
    expect(rejected).toBe(0);
  });

  it("drops a flag whose quote is not in the message: a model assertion is not evidence", () => {
    const result = verifyModelAnswer(answer({ medicalUrgency: { present: true, confidence: 0.95, quote: "my father has chest pain" } }), message);
    expect(result).toMatchObject({ readings: [], rejected: 1, rejectedFlags: ["MEDICAL_URGENCY"] });
  });

  it("drops a flag below 60 % confidence, and one with an empty quote", () => {
    expect(verifyModelAnswer(answer({ distress: { present: true, confidence: MODEL_MIN_CONFIDENCE - 0.01, quote: "we are scared" } }), message).readings).toEqual([]);
    expect(verifyModelAnswer(answer({ distress: { present: true, confidence: 0.9, quote: "" } }), message).readings).toEqual([]);
    expect(verifyModelAnswer(answer({ distress: { present: true, confidence: MODEL_MIN_CONFIDENCE, quote: "we are scared" } }), message).readings).toHaveLength(1);
  });

  it("ignores a flag the model says is not present", () => {
    expect(verifyModelAnswer(answer(), message)).toEqual({ readings: [], rejected: 0, rejectedFlags: [] });
  });

  it("reads a Sinhala quote too", () => {
    const text = "අපිට ගොඩක් අමාරුයි, දැන්ම කවුරුහරි කතා කරන්න";
    expect(verifyModelAnswer(answer({ distress: { present: true, confidence: 0.85, quote: "ගොඩක් අමාරුයි" } }), text).readings).toHaveLength(1);
  });

  it("the schema rejects an out-of-range confidence, and the JSON schema asks for every flag", () => {
    expect(riskModelAnswerSchema.safeParse(answer({ distress: { present: true, confidence: 2, quote: "x" } })).success).toBe(false);
    expect(RISK_MODEL_JSON_SCHEMA.required).toEqual(["complaint", "fraudConcern", "medicalUrgency", "religiousRuling", "distress"]);
  });
});

describe("merging", () => {
  it("keeps the most confident reading per flag, in a stable flag order", () => {
    const merged = mergeReadings(
      [{ flag: "DISTRESS" as RiskFlag, confidence: 0.5, snippet: "worried", source: "RULE_FALLBACK" as const }],
      [{ flag: "COMPLAINT" as RiskFlag, confidence: 0.9, snippet: "legal action", source: "RULE" as const }, { flag: "DISTRESS" as RiskFlag, confidence: 0.8, snippet: "we are scared", source: "MODEL" as const }],
    );
    expect(merged.map((reading) => [reading.flag, reading.confidence])).toEqual([["COMPLAINT", 0.9], ["DISTRESS", 0.8]]);
  });
});
