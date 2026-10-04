import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { projectLatestTemplateRates } = await import("./whatsapp-billing-repository");

describe("WhatsApp projected template charges", () => {
  it("uses the latest ordered Meta-derived regular rate for each category", () => {
    expect(projectLatestTemplateRates([
      { id: "new", pricing_category: "utility", pricing_type: "regular", unit_rate: 0.031, currency: "USD" },
      { id: "free", pricing_category: "UTILITY", pricing_type: "free_customer_service", unit_rate: 0, currency: "USD" },
      { id: "marketing", pricing_category: "MARKETING", pricing_type: "regular", unit_rate: 0.071, currency: "USD" },
    ], ["UTILITY", "MARKETING"])).toEqual({
      UTILITY: { amount: 0.031, currency: "USD", observationId: "new" },
      MARKETING: { amount: 0.071, currency: "USD", observationId: "marketing" },
    });
  });

  it("leaves a category unknown when Meta has not produced a matching observation", () => {
    expect(projectLatestTemplateRates([], ["AUTHENTICATION"])).toEqual({});
  });
});
