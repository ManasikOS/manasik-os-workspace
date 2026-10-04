import { describe, expect, it } from "vitest";

import { facts } from "./fixtures";
import { RISK_DETECTORS } from "./registry";
import { findingsToSignals, runRiskDetectors } from "./run";
import type { RiskDetector, RiskFinding } from "./types";

const findingFor = (code: RiskFinding["code"], messageId: string | null = null): RiskFinding => ({ code, messageId, confidence: 0.8, evidence: [] });

const detectorReturning = (code: RiskDetector["code"], finding: RiskFinding | null): RiskDetector => ({ code, detect: () => finding });

const detectorThrowing = (code: RiskDetector["code"], thrown: unknown): RiskDetector => ({
  code,
  detect: () => {
    throw thrown;
  },
});

describe("runRiskDetectors", () => {
  it("returns no findings and no failures when there are no detectors", () => {
    expect(runRiskDetectors(facts(), [])).toEqual({ findings: [], failed: [] });
  });

  it("skips a detector that finds nothing", () => {
    const run = runRiskDetectors(facts(), [detectorReturning("STALE_PRICE_QUOTED", null)]);

    expect(run.findings).toEqual([]);
    expect(run.failed).toEqual([]);
  });

  it("keeps findings in detector order", () => {
    const first = findingFor("LOW_CONFIDENCE_DRAFT");
    const second = findingFor("STALE_PRICE_QUOTED");

    const run = runRiskDetectors(facts(), [detectorReturning("LOW_CONFIDENCE_DRAFT", first), detectorReturning("STALE_PRICE_QUOTED", second)]);

    expect(run.findings).toEqual([first, second]);
  });

  it("reports the text of a thrown value that is not an Error", () => {
    const run = runRiskDetectors(facts(), [detectorThrowing("STALE_PRICE_QUOTED", "plain string failure")]);

    expect(run.failed).toEqual([{ code: "STALE_PRICE_QUOTED", message: "plain string failure" }]);
  });

  it("reports every failing detector and still returns the finding from the one that worked", () => {
    const worked = findingFor("LOW_CONFIDENCE_DRAFT");

    const run = runRiskDetectors(facts(), [
      detectorThrowing("STALE_PRICE_QUOTED", new Error("first")),
      detectorReturning("LOW_CONFIDENCE_DRAFT", worked),
      detectorThrowing("GROUP_FULL_REQUESTED", new Error("second")),
    ]);

    expect(run.findings).toEqual([worked]);
    expect(run.failed.map((entry) => entry.message)).toEqual(["first", "second"]);
  });

  it("uses the full registry when no detector list is given, and every registered rule runs on quiet facts without failing", () => {
    const run = runRiskDetectors(facts());

    expect(run.failed).toEqual([]);
    expect(RISK_DETECTORS.length).toBeGreaterThan(0);
  });

  it("hands every detector the same facts object", () => {
    const seen: unknown[] = [];
    const recorder = (code: RiskDetector["code"]): RiskDetector => ({
      code,
      detect: (input) => {
        seen.push(input);
        return null;
      },
    });
    const input = facts();

    runRiskDetectors(input, [recorder("STALE_PRICE_QUOTED"), recorder("LOW_CONFIDENCE_DRAFT")]);

    expect(seen).toEqual([input, input]);
    expect(seen[0]).toBe(input);
  });
});

describe("findingsToSignals", () => {
  it("returns nothing for no findings", () => {
    expect(findingsToSignals([])).toEqual([]);
  });

  it("marks every signal as coming from a rule, never a model", () => {
    const signals = findingsToSignals([findingFor("STALE_PRICE_QUOTED"), findingFor("LOW_CONFIDENCE_DRAFT", "message-1")]);

    expect(signals.map((signal) => signal.detector)).toEqual(["RULE", "RULE"]);
  });

  it("keeps a state-only finding's missing message id as null", () => {
    const [signal] = findingsToSignals([findingFor("STALE_PRICE_QUOTED", null)]);

    expect(signal.messageId).toBeNull();
    expect(signal.signalCode).toBe("STALE_PRICE_QUOTED");
  });

  it("carries the confidence and evidence through unchanged", () => {
    const evidence = [{ messageId: "message-1", snippet: "I have paid" }];
    const [signal] = findingsToSignals([{ code: "PAYMENT_CLAIM_UNVERIFIED", messageId: "message-1", confidence: 0.9, evidence }]);

    expect(signal).toMatchObject({ confidence: 0.9, evidence });
  });
});
