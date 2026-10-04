import { describe, expect, it } from "vitest";

import { isDraftStale, isIssuedUnsent, isOverpaid } from "./signals";

const NOW = "2026-09-15T00:00:00.000Z";

describe("isOverpaid", () => {
  it("flags allocations exceeding the invoice amount", () => {
    expect(isOverpaid(10000, 10500)).toBe(true);
  });

  it("does not flag an exact match", () => {
    expect(isOverpaid(10000, 10000)).toBe(false);
  });

  it("does not flag an underpayment", () => {
    expect(isOverpaid(10000, 5000)).toBe(false);
  });

  it("tolerates cents-level float drift", () => {
    expect(isOverpaid(10000, 10000.005)).toBe(false);
  });
});

describe("isIssuedUnsent", () => {
  it("flags an issued invoice unsent for more than 3 days", () => {
    expect(isIssuedUnsent("ISSUED", "2026-09-10T00:00:00.000Z", null, NOW)).toBe(true);
  });

  it("does not flag one already sent", () => {
    expect(isIssuedUnsent("ISSUED", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z", NOW)).toBe(false);
  });

  it("does not flag a draft", () => {
    expect(isIssuedUnsent("DRAFT", null, null, NOW)).toBe(false);
  });

  it("does not flag within the 3-day window", () => {
    expect(isIssuedUnsent("ISSUED", "2026-09-14T00:00:00.000Z", null, NOW)).toBe(false);
  });

  it("does not flag a void invoice", () => {
    expect(isIssuedUnsent("VOID", "2026-09-01T00:00:00.000Z", null, NOW)).toBe(false);
  });
});

describe("isDraftStale", () => {
  it("flags a draft older than 7 days", () => {
    expect(isDraftStale("DRAFT", "2026-09-01T00:00:00.000Z", NOW)).toBe(true);
  });

  it("does not flag a recent draft", () => {
    expect(isDraftStale("DRAFT", "2026-09-14T00:00:00.000Z", NOW)).toBe(false);
  });

  it("does not flag a non-draft invoice regardless of age", () => {
    expect(isDraftStale("ISSUED", "2026-01-01T00:00:00.000Z", NOW)).toBe(false);
  });
});
