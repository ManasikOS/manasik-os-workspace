import { describe, expect, it } from "vitest";

import { MIN_REVIEWED_FOR_GATE, summariseSignalPrecision, type SignalPrecisionRow } from "./precision";

const row = (overrides: Partial<SignalPrecisionRow> = {}): SignalPrecisionRow => ({ signalCode: "PAYMENT_CLAIM_UNVERIFIED", detector: "RULE", totalSignals: 40, reviewed: 20, correct: 20, wrong: 0, ...overrides });

describe("summariseSignalPrecision", () => {
  it("is met only with enough judged signals AND precision at the 95% target", () => {
    expect(summariseSignalPrecision([row()])[0]).toMatchObject({ precision: 1, target: 0.95, gate: "MET", reviewsStillNeeded: 0 });
    expect(summariseSignalPrecision([row({ reviewed: 20, correct: 19, wrong: 1 })])[0].gate).toBe("MET");
    expect(summariseSignalPrecision([row({ reviewed: 20, correct: 18, wrong: 2 })])[0].gate).toBe("NOT_MET");
  });

  it("does not let a handful of correct verdicts count as evidence", () => {
    const [summary] = summariseSignalPrecision([row({ reviewed: 5, correct: 5 })]);
    expect(summary.gate).toBe("NEEDS_MORE_REVIEWS");
    expect(summary.reviewsStillNeeded).toBe(MIN_REVIEWED_FOR_GATE - 5);
  });

  it("reports nothing judged yet as no precision rather than 0 %", () => {
    expect(summariseSignalPrecision([row({ reviewed: 0, correct: 0, wrong: 0 })])[0].precision).toBeNull();
  });

  it("gives a detector with no target no gate", () => {
    expect(summariseSignalPrecision([row({ signalCode: "REFUND_REQUEST" })])[0]).toMatchObject({ target: null, gate: "NO_TARGET" });
  });

  it("adds a rule reading and a model reading of the same signal together", () => {
    const [summary] = summariseSignalPrecision([row({ reviewed: 10, correct: 10 }), row({ detector: "MODEL", reviewed: 10, correct: 9, wrong: 1 })]);
    expect(summary).toMatchObject({ reviewed: 20, correct: 19, wrong: 1 });
  });
});
