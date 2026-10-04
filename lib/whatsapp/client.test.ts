import { describe, expect, it, vi } from "vitest";

// `server-only` is a Next.js bundler guard, not a real package resolvable
// under Vitest's plain-Node runner — stub it so this pure-function test can
// import the module directly, same as any other server-only lib file would
// need if it grows a test suite.
vi.mock("server-only", () => ({}));

const { toUnixSeconds } = await import("./client");

/**
 * Regression coverage for the production incident where
 * `whatsapp-billing-sync` failed every run with "Invalid time value":
 * `pricing_analytics` buckets report `start`/`end` as `YYYY-MM-DD` strings
 * for DAILY/MONTHLY granularity, not the unix-seconds numbers the request
 * params use — undocumented by Meta, found only by a real WABA's response.
 */
describe("toUnixSeconds", () => {
  it("passes a numeric unix-seconds value through unchanged", () => {
    expect(toUnixSeconds(1_758_000_000, "start")).toBe(1_758_000_000);
  });

  it("parses a YYYY-MM-DD date string as returned for DAILY granularity", () => {
    const result = toUnixSeconds("2026-09-17", "start");
    expect(result).toBe(Math.floor(Date.parse("2026-09-17") / 1000));
  });

  it("throws a descriptive error on a value neither format can parse", () => {
    expect(() => toUnixSeconds("not-a-date", "end")).toThrow(/unparseable "end" value/);
  });

  it("throws on a non-finite number instead of silently producing an invalid date", () => {
    expect(() => toUnixSeconds(Number.NaN, "start")).toThrow(/unparseable "start" value/);
  });
});
