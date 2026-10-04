import { describe, expect, it } from "vitest";

import { offerMatchReasons, type OfferReasonSource } from "./offer-match-reasons";

const full: OfferReasonSource = {
  recommendationReason: "Matches the November–January window.",
  fitLabel: "Strong fit",
  departureLabel: "Departs 15 Dec · 14 days",
  roomLabel: "Quad",
  seatsLabel: "4 seats open",
  check: { state: "FRESH", message: null, canQuote: true },
};

describe("offerMatchReasons", () => {
  it("lists every reason a recommendation has", () => {
    const result = offerMatchReasons(full);
    expect(result.heading).toBe("Why this matches");
    expect(result.lines).toEqual([
      "Matches the November–January window.",
      "Strong fit for what the customer asked",
      "Departs 15 Dec · 14 days",
      "Room type: Quad",
      "4 seats open",
      "Price and seats were checked against the live departure",
    ]);
  });

  it("does not claim the figures were checked when the live check failed", () => {
    const result = offerMatchReasons({ ...full, check: { state: "PRICE_CHANGED", message: "changed", canQuote: false } });
    expect(result.lines.join(" ")).not.toContain("checked against the live departure");
  });

  it("says 'Based on limited information' when nothing but the freshness check backs it", () => {
    const result = offerMatchReasons({ recommendationReason: null, fitLabel: null, departureLabel: "", roomLabel: null, seatsLabel: "", check: { state: "FRESH", message: null, canQuote: true } });
    expect(result.heading).toBe("Based on limited information");
  });

  it("says it when there is nothing at all", () => {
    const result = offerMatchReasons({ recommendationReason: "  ", fitLabel: null, departureLabel: "", roomLabel: null, seatsLabel: "", check: { state: null, message: null, canQuote: false } });
    expect(result).toEqual({ lines: [], heading: "Based on limited information" });
  });
});
