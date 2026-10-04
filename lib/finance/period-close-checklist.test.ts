import { describe, expect, it } from "vitest";

import { evaluatePeriodCloseChecklist } from "./period-close-checklist";

describe("evaluatePeriodCloseChecklist", () => {
  it("passes only when every item is done", () => {
    const result = evaluatePeriodCloseChecklist({ unmatchedCount: 0, pendingVerificationCount: 0, cashCounted: true });
    expect(result.ok).toBe(true);
    expect(result.items.every((i) => i.done)).toBe(true);
  });

  it("fails on a seeded-broken fixture with unmatched lines", () => {
    const result = evaluatePeriodCloseChecklist({ unmatchedCount: 3, pendingVerificationCount: 0, cashCounted: true });
    expect(result.ok).toBe(false);
    expect(result.items.find((i) => i.key === "linesMatched")!.done).toBe(false);
  });

  it("fails when payments are still pending verification", () => {
    const result = evaluatePeriodCloseChecklist({ unmatchedCount: 0, pendingVerificationCount: 1, cashCounted: true });
    expect(result.ok).toBe(false);
  });

  it("fails when cash has not been counted", () => {
    const result = evaluatePeriodCloseChecklist({ unmatchedCount: 0, pendingVerificationCount: 0, cashCounted: false });
    expect(result.ok).toBe(false);
  });
});
