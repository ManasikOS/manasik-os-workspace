import { describe, expect, it } from "vitest";

import { maskPhoneNumber } from "./departure-groups-privacy";

describe("maskPhoneNumber", () => {
  it("keeps only the last three digits", () => {
    expect(maskPhoneNumber("+94 77 123 4567")).toBe("••••567");
    expect(maskPhoneNumber("(011) 234-5678")).toBe("••••678");
  });

  it("never reveals a short number", () => {
    expect(maskPhoneNumber("123")).toBe("•••");
    expect(maskPhoneNumber("12")).toBe("•••");
  });

  it("handles missing numbers", () => {
    expect(maskPhoneNumber(null)).toBe("no number");
    expect(maskPhoneNumber("  ")).toBe("no number");
  });

  it("does not leak the original anywhere in the output", () => {
    expect(maskPhoneNumber("+94771234567")).not.toContain("94771234");
  });
});
