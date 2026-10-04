import { describe, expect, it } from "vitest";

import { templateCategoryLabel, templateChargeLabel } from "./template-charge-label";

describe("templateChargeLabel", () => {
  it("shows the projected charge with three decimals", () => {
    expect(templateChargeLabel({ projected_charge: 0.0429, charge_currency: "USD" })).toBe("Projected charge: USD 0.043");
  });

  it("says so honestly when no rate has been observed", () => {
    for (const template of [{}, { projected_charge: null, charge_currency: "USD" }, { projected_charge: 0.05, charge_currency: null }]) {
      expect(templateChargeLabel(template)).toContain("no matching Meta rate has been observed yet");
    }
  });

  it("treats a zero rate as a real, observed rate", () => {
    expect(templateChargeLabel({ projected_charge: 0, charge_currency: "USD" })).toBe("Projected charge: USD 0.000");
  });
});

describe("templateCategoryLabel", () => {
  it("capitalises Meta's category", () => {
    expect(templateCategoryLabel("MARKETING")).toBe("Marketing");
    expect(templateCategoryLabel(" utility ")).toBe("Utility");
  });

  it("does not hide an unknown category", () => {
    expect(templateCategoryLabel("")).toBe("Unknown");
  });
});
