import { describe, expect, it } from "vitest";

import { customerMessage, facts, offer } from "../fixtures";
import { detectStalePriceQuoted, figuresIn } from "./stale-price-quoted";

const sent = (text: string, createdAt = "2026-09-15T10:00:00.000Z") => customerMessage(text, { id: "3f1d2c4e-5a6b-4c7d-8e9f-0000000000aa", createdAt });

describe("STALE_PRICE_QUOTED (R1: change-detection, never a timer)", () => {
  it("fires when the price has changed and we sent the old figure after the offer was worked out", () => {
    const finding = detectStalePriceQuoted(facts({ matchedOffer: offer(), offerCheck: "PRICE_CHANGED", outbound: [sent("The package is LKR 420,000 per person")] }));
    expect(finding).toMatchObject({ code: "STALE_PRICE_QUOTED", messageId: "3f1d2c4e-5a6b-4c7d-8e9f-0000000000aa" });
  });

  it("also fires on the offer's total", () => {
    expect(detectStalePriceQuoted(facts({ matchedOffer: offer(), offerCheck: "PRICE_CHANGED", outbound: [sent("For all three it comes to 1,260,000")] }))).not.toBeNull();
  });

  it("does NOT fire merely because the snapshot is old: an unchanged price stays quiet however long ago it was worked out", () => {
    const ancient = offer({ asOf: "2020-01-01T00:00:00.000Z" });
    expect(detectStalePriceQuoted(facts({ matchedOffer: ancient, offerCheck: "FRESH", outbound: [sent("LKR 420,000 per person", "2026-09-15T10:00:00.000Z")] }))).toBeNull();
  });

  it("does not fire for any other check state, or when the check could not be made", () => {
    for (const state of ["SEATS_INSUFFICIENT", "EARLY_BIRD_EXPIRING", "NO_LONGER_AVAILABLE", null] as const) expect(detectStalePriceQuoted(facts({ matchedOffer: offer(), offerCheck: state, outbound: [sent("LKR 420,000")] })), String(state)).toBeNull();
  });

  it("near-miss: a different number, or a message sent before the offer existed, is not a quoted price", () => {
    expect(detectStalePriceQuoted(facts({ matchedOffer: offer(), offerCheck: "PRICE_CHANGED", outbound: [sent("Call us on 0112345678 or pay 100,000 as advance")] }))).toBeNull();
    expect(detectStalePriceQuoted(facts({ matchedOffer: offer(), offerCheck: "PRICE_CHANGED", outbound: [sent("LKR 420,000", "2026-09-01T10:00:00.000Z")] }))).toBeNull();
  });

  it("negative: no offer, or nothing sent", () => {
    expect(detectStalePriceQuoted(facts({ offerCheck: "PRICE_CHANGED", outbound: [sent("LKR 420,000")] }))).toBeNull();
    expect(detectStalePriceQuoted(facts({ matchedOffer: offer(), offerCheck: "PRICE_CHANGED" }))).toBeNull();
  });

  it("reads figures the way people write them", () => {
    expect(figuresIn("LKR 420,000 or 420000/= or 4,20,000")).toEqual([420000]);
    expect(figuresIn("12 December, 3 adults")).toEqual([]);
  });
});
