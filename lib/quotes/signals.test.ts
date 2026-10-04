import { describe, expect, it } from "vitest";

import { isDiscountOutsideBand, isExpiringWithoutFollowUp, snapshotPriceDiffersFromCurrent } from "./signals";

describe("isExpiringWithoutFollowUp", () => {
  const NOW = "2026-09-15T00:00:00.000Z";

  it("flags a SENT quote expiring within 72h with no follow-up", () => {
    expect(isExpiringWithoutFollowUp({ status: "SENT", validUntil: "2026-09-17T00:00:00.000Z" }, NOW, false)).toBe(true);
  });

  it("does not flag when a follow-up already happened", () => {
    expect(isExpiringWithoutFollowUp({ status: "SENT", validUntil: "2026-09-17T00:00:00.000Z" }, NOW, true)).toBe(false);
  });

  it("does not flag a quote expiring beyond 72h", () => {
    expect(isExpiringWithoutFollowUp({ status: "SENT", validUntil: "2026-09-25T00:00:00.000Z" }, NOW, false)).toBe(false);
  });

  it("does not flag an already-expired quote", () => {
    expect(isExpiringWithoutFollowUp({ status: "SENT", validUntil: "2026-09-10T00:00:00.000Z" }, NOW, false)).toBe(false);
  });

  it("does not flag a DRAFT or ACCEPTED quote", () => {
    expect(isExpiringWithoutFollowUp({ status: "DRAFT", validUntil: "2026-09-17T00:00:00.000Z" }, NOW, false)).toBe(false);
    expect(isExpiringWithoutFollowUp({ status: "ACCEPTED", validUntil: "2026-09-17T00:00:00.000Z" }, NOW, false)).toBe(false);
  });

  it("flags a VIEWED quote the same as SENT", () => {
    expect(isExpiringWithoutFollowUp({ status: "VIEWED", validUntil: "2026-09-17T00:00:00.000Z" }, NOW, false)).toBe(true);
  });
});

describe("isDiscountOutsideBand", () => {
  it("flags a discount above the band percentage", () => {
    expect(isDiscountOutsideBand(1500, 10000, 10)).toBe(true);
  });

  it("does not flag a discount within the band", () => {
    expect(isDiscountOutsideBand(500, 10000, 10)).toBe(false);
  });

  it("does not flag zero discount", () => {
    expect(isDiscountOutsideBand(0, 10000, 10)).toBe(false);
  });

  it("is exactly on the boundary as not outside", () => {
    expect(isDiscountOutsideBand(1000, 10000, 10)).toBe(false);
  });
});

describe("snapshotPriceDiffersFromCurrent", () => {
  it("flags a snapshot price that has drifted beyond tolerance", () => {
    expect(snapshotPriceDiffersFromCurrent(100000, 120000)).toBe(true);
  });

  it("does not flag a price within tolerance", () => {
    expect(snapshotPriceDiffersFromCurrent(100000, 100500)).toBe(false);
  });

  it("does not flag when current price is unknown (0)", () => {
    expect(snapshotPriceDiffersFromCurrent(100000, 0)).toBe(false);
  });
});
