import { describe, expect, it } from "vitest";

import { offerCardModeFor } from "./offer-card-mode";

describe("offerCardModeFor", () => {
  it("is ready when the figures are current and nothing is missing", () => {
    expect(offerCardModeFor({ missing: [], check: { canQuote: true } })).toBe("READY");
  });

  it("asks for details first when the customer has not said enough", () => {
    expect(offerCardModeFor({ missing: ["Room preference"], check: { canQuote: true } })).toBe("NEEDS_DETAILS");
  });

  it("requires review when price or seats cannot be trusted, even if details are missing too", () => {
    expect(offerCardModeFor({ missing: [], check: { canQuote: false } })).toBe("REVIEW_REQUIRED");
    expect(offerCardModeFor({ missing: ["Room preference"], check: { canQuote: false } })).toBe("REVIEW_REQUIRED");
  });
});
