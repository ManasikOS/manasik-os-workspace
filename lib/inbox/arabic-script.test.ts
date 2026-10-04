import { describe, expect, it } from "vitest";

import { containsArabicScript } from "./arabic-script";

describe("containsArabicScript", () => {
  it("recognises Arabic names, alone or mixed with Latin text", () => {
    expect(containsArabicScript("محمد")).toBe(true);
    expect(containsArabicScript("Ahmed محمد")).toBe(true);
  });

  it("does not match Latin, Sinhala, Tamil or empty text", () => {
    expect(containsArabicScript("Nadeesha")).toBe(false);
    expect(containsArabicScript("නදීශා")).toBe(false);
    expect(containsArabicScript("நதீஷா")).toBe(false);
    expect(containsArabicScript("")).toBe(false);
  });
});
