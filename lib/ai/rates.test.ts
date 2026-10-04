import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { selectModelRate, priceTokenUsage, loadAiModelRates, clearAiModelRateCache } = await import("./rates");
const { estimateCostUsd } = await import("./telemetry");

const RATE_ROWS = [
  { model: "m/a", effective_from: "2026-01-01", input_rate_per_million: 1, output_rate_per_million: 2, cache_read_rate_per_million: 0.1, cache_write_rate_per_million: 1.25 },
  { model: "m/a", effective_from: "2026-06-01", input_rate_per_million: 3, output_rate_per_million: 4, cache_read_rate_per_million: 0.3, cache_write_rate_per_million: 3.75 },
];

function fakeDb(rows: unknown[], counter = { reads: 0 }) {
  return {
    counter,
    db: {
      from: () => ({
        select: async () => {
          counter.reads += 1;
          return { data: rows, error: null };
        },
      }),
    },
  };
}

beforeEach(() => clearAiModelRateCache());

describe("selectModelRate", () => {
  const rates = RATE_ROWS.map((row) => ({
    model: row.model,
    effectiveFrom: row.effective_from,
    inputRatePerMillion: row.input_rate_per_million,
    outputRatePerMillion: row.output_rate_per_million,
    cacheReadRatePerMillion: row.cache_read_rate_per_million,
    cacheWriteRatePerMillion: row.cache_write_rate_per_million,
  }));

  it("uses the older rate the day before a new one takes effect and the new rate on its effective_from day", () => {
    expect(selectModelRate(rates, "m/a", new Date("2026-05-31T23:59:59Z"))?.inputRatePerMillion).toBe(1);
    expect(selectModelRate(rates, "m/a", new Date("2026-06-01T00:00:00Z"))?.inputRatePerMillion).toBe(3);
  });

  it("returns null before any rate is effective and for an unknown model", () => {
    expect(selectModelRate(rates, "m/a", new Date("2025-12-31T00:00:00Z"))).toBeNull();
    expect(selectModelRate(rates, "m/unknown", new Date("2026-07-01T00:00:00Z"))).toBeNull();
  });
});

describe("priceTokenUsage", () => {
  const rate = {
    model: "m/a",
    effectiveFrom: "2026-01-01",
    inputRatePerMillion: 0.1,
    outputRatePerMillion: 0.6,
    cacheReadRatePerMillion: 0.01,
    cacheWriteRatePerMillion: 0.125,
  };

  it("prices each of the four token classes at its own rate", () => {
    expect(priceTokenUsage(rate, { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 })).toBe(0.1);
    expect(priceTokenUsage(rate, { input: 0, output: 1_000_000, cacheRead: 0, cacheCreation: 0 })).toBe(0.6);
    expect(priceTokenUsage(rate, { input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 0 })).toBe(0.01);
    expect(priceTokenUsage(rate, { input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000_000 })).toBe(0.125);
  });

  it("prices cache-read tokens at the cache rate, ten times below the input rate here", () => {
    const cached = priceTokenUsage(rate, { input: 0, output: 0, cacheRead: 500_000, cacheCreation: 0 });
    const fresh = priceTokenUsage(rate, { input: 500_000, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect(cached).toBeCloseTo(fresh / 10, 8);
  });

  it("keeps sub-cent precision for a small classify call", () => {
    expect(priceTokenUsage(rate, { input: 300, output: 50, cacheRead: 0, cacheCreation: 0 })).toBe(0.00006);
  });
});

describe("loadAiModelRates", () => {
  it("reads the table once inside the five-minute cache window and again after it", async () => {
    const { db, counter } = fakeDb(RATE_ROWS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadAiModelRates(db as any, 1_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadAiModelRates(db as any, 1_000 + 4 * 60 * 1000);
    expect(counter.reads).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadAiModelRates(db as any, 1_000 + 5 * 60 * 1000 + 1);
    expect(counter.reads).toBe(2);
  });
});

describe("estimateCostUsd", () => {
  const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 };

  it("records null, not 0, for a model with no rate", async () => {
    const { db } = fakeDb(RATE_ROWS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await estimateCostUsd(db as any, "m/unpriced", usage)).toBeNull();
  });

  it("prices a known model at the rate in force at the given time", async () => {
    const { db } = fakeDb(RATE_ROWS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await estimateCostUsd(db as any, "m/a", usage, new Date("2026-03-01T00:00:00Z"))).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await estimateCostUsd(db as any, "m/a", usage, new Date("2026-08-01T00:00:00Z"))).toBe(3);
  });

  it("returns null instead of throwing when the rate table cannot be read", async () => {
    const failing = { from: () => ({ select: async () => ({ data: null, error: { message: "boom" } }) }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await estimateCostUsd(failing as any, "m/a", usage)).toBeNull();
  });
});
