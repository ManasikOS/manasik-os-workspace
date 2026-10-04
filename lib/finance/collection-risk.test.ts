import { describe, expect, it } from "vitest";

import { computeCollectionRisk, type CollectionRiskMilestoneInput } from "./collection-risk";

const NOW = "2026-09-15T00:00:00.000Z";

function milestone(overrides: Partial<CollectionRiskMilestoneInput>): CollectionRiskMilestoneInput {
  return { amount: 1000, paidAmount: 0, dueAt: "2026-09-01T00:00:00.000Z", waived: false, rescheduled: false, ...overrides };
}

describe("computeCollectionRisk", () => {
  it("scores 0 for a fully paid, on-time booking", () => {
    const result = computeCollectionRisk([milestone({ paidAmount: 1000, dueAt: "2026-10-01T00:00:00.000Z" })], NOW);
    expect(result.score).toBe(0);
    expect(result.band).toBe("LOW");
  });

  it("is bounded to [0, 100]", () => {
    const many = Array.from({ length: 50 }, () => milestone({ dueAt: "2020-01-01T00:00:00.000Z", rescheduled: true }));
    const result = computeCollectionRisk(many, NOW);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("is monotonic in days overdue", () => {
    const near = computeCollectionRisk([milestone({ dueAt: "2026-09-10T00:00:00.000Z" })], NOW);
    const far = computeCollectionRisk([milestone({ dueAt: "2026-08-01T00:00:00.000Z" })], NOW);
    expect(far.score).toBeGreaterThan(near.score);
  });

  it("is monotonic in instalments missed", () => {
    const one = computeCollectionRisk([milestone({})], NOW);
    const two = computeCollectionRisk([milestone({}), milestone({})], NOW);
    expect(two.score).toBeGreaterThan(one.score);
  });

  it("increases for a rescheduled instalment relative to an identical non-rescheduled one", () => {
    const plain = computeCollectionRisk([milestone({})], NOW);
    const rescheduled = computeCollectionRisk([milestone({ rescheduled: true })], NOW);
    expect(rescheduled.score).toBeGreaterThan(plain.score);
  });

  it("ignores waived instalments entirely", () => {
    const result = computeCollectionRisk([milestone({ waived: true, dueAt: "2020-01-01T00:00:00.000Z" })], NOW);
    expect(result.score).toBe(0);
  });

  it("ignores instalments not yet due", () => {
    const result = computeCollectionRisk([milestone({ dueAt: "2026-12-01T00:00:00.000Z" })], NOW);
    expect(result.score).toBe(0);
    expect(result.factors.overdueCount).toBe(0);
  });

  it("only reports factors it actually computed, never a fabricated one", () => {
    const result = computeCollectionRisk([milestone({})], NOW);
    expect(Object.keys(result.factors).sort()).toEqual(
      ["maxDaysOverdue", "overdueCount", "rescheduledCount", "unpaidDueRatio"].sort(),
    );
  });
});
