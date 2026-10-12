import { describe, expect, it } from "vitest";

import { leadsToMatrix } from "./csv";

describe("leadsToMatrix", () => {
  it("includes the estimated value column by default", () => {
    expect(leadsToMatrix([])[0]).toContain("Estimated Value (LKR)");
  });

  it("drops it for a role that does not see pipeline value, and nothing else", () => {
    const withValue = leadsToMatrix([])[0];
    const withoutValue = leadsToMatrix([], { includeValue: false })[0];

    expect(withoutValue).not.toContain("Estimated Value (LKR)");
    expect(withoutValue).toHaveLength(withValue.length - 1);
    expect(withValue.filter((header) => header !== "Estimated Value (LKR)")).toEqual(withoutValue);
  });
});
