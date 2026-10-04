import { describe, expect, it } from "vitest";

import { checkPlanInvariant } from "./plan-invariant";

describe("checkPlanInvariant", () => {
  it("passes when milestones sum exactly to the booking total", () => {
    const result = checkPlanInvariant({ milestoneAmounts: [300, 700], bookingTotal: 1000, creditNoteTotal: 0 });
    expect(result.ok).toBe(true);
    expect(result.differenceAbs).toBe(0);
  });

  it("accounts for credit notes", () => {
    const result = checkPlanInvariant({ milestoneAmounts: [600], bookingTotal: 1000, creditNoteTotal: 400 });
    expect(result.ok).toBe(true);
  });

  it("tolerates cents-level float drift", () => {
    const result = checkPlanInvariant({ milestoneAmounts: [333.33, 333.33, 333.34], bookingTotal: 1000, creditNoteTotal: 0 });
    expect(result.ok).toBe(true);
  });

  it("fails on a seeded-broken fixture where milestones don't sum to the total", () => {
    const result = checkPlanInvariant({ milestoneAmounts: [300, 300], bookingTotal: 1000, creditNoteTotal: 0 });
    expect(result.ok).toBe(false);
    expect(result.differenceAbs).toBeCloseTo(400);
  });
});
