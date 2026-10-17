import { describe, expect, it } from "vitest";

import { QUOTE_EXPIRING_WINDOW_DAYS, isQuoteAwaitingReply, isQuoteExpiringSoon } from "./pipeline";

const NOW = Date.parse("2026-10-13T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("isQuoteExpiringSoon", () => {
  it("uses a two-day window, as the Quotes page always has", () => {
    expect(QUOTE_EXPIRING_WINDOW_DAYS).toBe(2);
  });

  it("is true for a sent or viewed quote that lapses inside the window", () => {
    expect(isQuoteExpiringSoon({ status: "SENT", validUntil: at(DAY) }, NOW)).toBe(true);
    expect(isQuoteExpiringSoon({ status: "VIEWED", validUntil: at(2 * DAY) }, NOW)).toBe(true);
  });

  it("is true at the very moment of expiry, false the instant after", () => {
    expect(isQuoteExpiringSoon({ status: "SENT", validUntil: at(0) }, NOW)).toBe(true);
    expect(isQuoteExpiringSoon({ status: "SENT", validUntil: at(-1) }, NOW)).toBe(false);
  });

  it("is false beyond the window", () => {
    expect(isQuoteExpiringSoon({ status: "SENT", validUntil: at(2 * DAY + 1) }, NOW)).toBe(false);
  });

  it("is false for any quote that is not awaiting a reply", () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "ACCEPTED", "DECLINED", "EXPIRED", "SUPERSEDED", "CANCELLED"] as const) {
      expect(isQuoteExpiringSoon({ status, validUntil: at(DAY) }, NOW)).toBe(false);
    }
  });
});

describe("isQuoteAwaitingReply", () => {
  it("is sent or viewed, nothing else", () => {
    expect(isQuoteAwaitingReply("SENT")).toBe(true);
    expect(isQuoteAwaitingReply("VIEWED")).toBe(true);
    expect(isQuoteAwaitingReply("DRAFT")).toBe(false);
    expect(isQuoteAwaitingReply("ACCEPTED")).toBe(false);
  });
});
