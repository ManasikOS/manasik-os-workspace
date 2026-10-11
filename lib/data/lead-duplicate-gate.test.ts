import { describe, expect, it } from "vitest";

import { isLeadDuplicateResolved } from "./lead-duplicate-gate";

describe("isLeadDuplicateResolved", () => {
  it("lets a lead with no match through, whatever the override says", () => {
    expect(
      isLeadDuplicateResolved(false, {
        duplicateReason: "",
        createAnyway: false,
      }),
    ).toBe(true);
  });

  it("blocks a match with no reason and no confirmation", () => {
    expect(
      isLeadDuplicateResolved(true, {
        duplicateReason: "",
        createAnyway: false,
      }),
    ).toBe(false);
  });

  it("blocks a match with a reason that was never confirmed", () => {
    expect(
      isLeadDuplicateResolved(true, {
        duplicateReason: "family-member",
        createAnyway: false,
      }),
    ).toBe(false);
  });

  it("blocks a match confirmed without a reason", () => {
    expect(
      isLeadDuplicateResolved(true, {
        duplicateReason: "   ",
        createAnyway: true,
      }),
    ).toBe(false);
  });

  it("lets a match through once a reason is given and confirmed", () => {
    expect(
      isLeadDuplicateResolved(true, {
        duplicateReason: "family-member",
        createAnyway: true,
      }),
    ).toBe(true);
  });
});
