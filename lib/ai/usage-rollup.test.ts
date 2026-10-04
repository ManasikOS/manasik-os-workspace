import { describe, expect, it } from "vitest";

import { monthStartFor, rollupDaysFor, summariseMonthToDate, type AiUsageDailyRow } from "./usage-rollup";

const NOW = new Date("2026-09-20T10:00:00Z");

const row = (overrides: Partial<AiUsageDailyRow>): AiUsageDailyRow => ({
  day: "2026-09-10",
  surface: "INBOX_TRIAGE",
  runs: 10,
  unpriced_runs: 0,
  cost_usd: "0.5",
  conversations_enriched: 4,
  ...overrides,
});

describe("rollupDaysFor", () => {
  it("returns yesterday then today in UTC, so a run just after midnight lands on the right day", () => {
    expect(rollupDaysFor(new Date("2026-09-20T00:05:00Z"))).toEqual(["2026-09-19", "2026-09-20"]);
  });

  it("crosses a month boundary", () => {
    expect(rollupDaysFor(new Date("2026-10-01T00:05:00Z"))).toEqual(["2026-09-30", "2026-10-01"]);
  });
});

describe("monthStartFor", () => {
  it("is the first UTC day of the month", () => {
    expect(monthStartFor(NOW)).toBe("2026-09-01");
  });
});

describe("summariseMonthToDate", () => {
  it("sums cost, runs and enriched conversations and orders surfaces by cost", () => {
    const usage = summariseMonthToDate(
      [row({}), row({ day: "2026-09-11", cost_usd: 0.25 }), row({ surface: "WHATSAPP_AGENT", cost_usd: "2", runs: 3 })],
      NOW,
    );
    expect(usage.costUsd).toBeCloseTo(2.75, 8);
    expect(usage.runs).toBe(23);
    expect(usage.conversationsEnriched).toBe(12);
    expect(usage.bySurface.map((entry) => entry.surface)).toEqual(["WHATSAPP_AGENT", "INBOX_TRIAGE"]);
  });

  it("carries unpriced runs separately so cost is never silently understated", () => {
    const usage = summariseMonthToDate([row({ unpriced_runs: 3 })], NOW);
    expect(usage.unpricedRuns).toBe(3);
  });

  it("ignores rows from other months and returns all zero for no rows", () => {
    expect(summariseMonthToDate([row({ day: "2026-08-31" })], NOW).costUsd).toBe(0);
    expect(summariseMonthToDate([], NOW)).toMatchObject({ costUsd: 0, runs: 0, unpricedRuns: 0, bySurface: [] });
  });
});
