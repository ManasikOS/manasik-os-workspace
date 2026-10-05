import { describe, expect, it } from "vitest";

import { CRON_AGENCY_BUDGET_MS, forEachAgencyWithinBudget, rotateFrom, rotationStart } from "./cron-agency-run";

/**
 * BUG-11 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the sweeps visited every agency in a fixed order with no time limit, so
 * a growing list outlasted the function limit and the agencies at the end were cut off on every run.
 */

const agencies = ["a", "b", "c", "d"].map((id) => ({ id }));
const SLICE = 120_000;

describe("rotateFrom", () => {
  it("starts the same list somewhere else and wraps round, losing and repeating nothing", () => {
    expect(rotateFrom([1, 2, 3, 4], 0)).toEqual([1, 2, 3, 4]);
    expect(rotateFrom([1, 2, 3, 4], 2)).toEqual([3, 4, 1, 2]);
    expect(rotateFrom([1, 2, 3, 4], 6)).toEqual([3, 4, 1, 2]);
    expect(rotateFrom([1, 2, 3, 4], -1)).toEqual([4, 1, 2, 3]);
  });
  it("copes with an empty list", () => {
    expect(rotateFrom([], 3)).toEqual([]);
  });
});

describe("rotationStart", () => {
  it("moves on by one each time slice, and wraps", () => {
    expect([0, 1, 2, 3, 4, 5].map((slice) => rotationStart(4, slice * SLICE + 5_000, SLICE))).toEqual([0, 1, 2, 3, 0, 1]);
  });
  it("stays put within one slice, so two overlapping runs start together", () => {
    expect(rotationStart(4, SLICE + 1, SLICE)).toBe(rotationStart(4, 2 * SLICE - 1, SLICE));
  });
  it("is zero for nothing to rotate", () => {
    expect(rotationStart(0, 999_999, SLICE)).toBe(0);
    expect(rotationStart(4, 999_999, 0)).toBe(0);
  });
});

describe("forEachAgencyWithinBudget", () => {
  /** A clock the work itself moves forward, so "slow agencies" need no real waiting. */
  function clock(startAt = 0) {
    let current = startAt;
    return { now: () => current, spend: (ms: number) => { current += ms; } };
  }

  it("visits every agency when there is time", async () => {
    const time = clock();
    const seen: string[] = [];
    const outcome = await forEachAgencyWithinBudget(agencies, { sliceMs: SLICE, now: time.now, run: async (agency) => { seen.push(agency.id); } });
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(outcome).toEqual({ visited: 4, failed: 0, notReached: 0, deadlineReached: false });
  });

  it("stops starting agencies when the budget is spent, and says how many are left for the next run", async () => {
    const time = clock();
    const seen: string[] = [];
    const outcome = await forEachAgencyWithinBudget(agencies, {
      sliceMs: SLICE,
      budgetMs: 45_000,
      now: time.now,
      run: async (agency) => { seen.push(agency.id); time.spend(20_000); },
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(outcome).toEqual({ visited: 3, failed: 0, notReached: 1, deadlineReached: true });
  });

  it("BUG-11: the agency cut off last time is visited first soon after, instead of being cut off again", async () => {
    const slow = { visited: [] as string[][] };
    for (const slice of [0, 1, 2, 3]) {
      const time = clock(slice * SLICE);
      const seen: string[] = [];
      await forEachAgencyWithinBudget(agencies, { sliceMs: SLICE, budgetMs: 45_000, now: time.now, run: async (agency) => { seen.push(agency.id); time.spend(20_000); } });
      slow.visited.push(seen);
    }
    // Every run is cut short after three agencies, yet across the runs each agency is visited, and "d" is no longer always the one left out.
    expect(new Set(slow.visited.flat())).toEqual(new Set(["a", "b", "c", "d"]));
    expect(slow.visited.map((seen) => seen[0])).toEqual(["a", "b", "c", "d"]);
    expect(slow.visited.filter((seen) => seen.includes("d")).length).toBeGreaterThan(1);
  });

  it("counts an agency that throws and carries on with the others", async () => {
    const errors: string[] = [];
    const seen: string[] = [];
    const outcome = await forEachAgencyWithinBudget(agencies, {
      sliceMs: SLICE,
      now: clock().now,
      run: async (agency) => { seen.push(agency.id); if (agency.id === "b") throw new Error("boom"); },
      onError: (agency) => errors.push(agency.id),
    });
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(errors).toEqual(["b"]);
    expect(outcome).toEqual({ visited: 4, failed: 1, notReached: 0, deadlineReached: false });
  });

  it("does nothing, without error, for no agencies", async () => {
    expect(await forEachAgencyWithinBudget([], { sliceMs: SLICE, now: clock().now, run: async () => { throw new Error("never"); } })).toEqual({ visited: 0, failed: 0, notReached: 0, deadlineReached: false });
  });

  it("uses the same 45 second budget the email poll already used", () => {
    expect(CRON_AGENCY_BUDGET_MS).toBe(45_000);
  });
});
