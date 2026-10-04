import { describe, expect, it } from "vitest";

import {
  MAX_LOAD_TEST_JOBS,
  buildLoadProfileShape,
  pickAgencyIndex,
  percentile,
  planInjectionSchedule,
  summarizeNoisyNeighbour,
  throughputPerSecond,
  totalJobs,
  totalSeconds,
} from "./inbox-load-profiles";

const sizes = { agencies: 50, conversationsPerAgency: 200 };

describe("buildLoadProfileShape — the §12.1 profiles", () => {
  it("baseline queues one job per conversation at once, as the original harness did", () => {
    const shape = buildLoadProfileShape("baseline", sizes);
    expect(shape).toMatchObject({ instantJobs: 10_000, phases: [], noisyShare: 0 });
    expect(planInjectionSchedule(shape)).toEqual([10_000]);
  });

  it("sustained is 1,000 per minute for the requested minutes", () => {
    const shape = buildLoadProfileShape("sustained", { ...sizes, minutes: 15 });
    expect(shape.phases).toEqual([{ minutes: 15, ratePerMinute: 1_000 }]);
    expect(totalJobs(shape)).toBe(15_000);
    expect(totalSeconds(shape)).toBe(900);
  });

  it("burst is 5,000 per minute for half the run, then normal load, so absorption and recovery are both measured", () => {
    const shape = buildLoadProfileShape("burst", { ...sizes, minutes: 10 });
    expect(shape.phases).toEqual([
      { minutes: 5, ratePerMinute: 5_000 },
      { minutes: 5, ratePerMinute: 1_000 },
    ]);
    expect(totalJobs(shape)).toBe(30_000);
  });

  it("noisy-tenant sends half of normal traffic from one agency", () => {
    const shape = buildLoadProfileShape("noisy-tenant", { ...sizes, minutes: 5 });
    expect(shape.noisyShare).toBe(0.5);
    expect(totalJobs(shape)).toBe(5_000);
  });

  it("defaults to a ten-minute run", () => {
    expect(totalSeconds(buildLoadProfileShape("sustained", sizes))).toBe(600);
  });

  it("rejects a nonsense duration before any traffic is planned", () => {
    for (const minutes of [0, -3, 1.5, 61, Number.NaN]) {
      expect(() => buildLoadProfileShape("sustained", { ...sizes, minutes })).toThrow("--minutes");
    }
  });

  it("refuses a plan larger than the safety limit", () => {
    expect(() => buildLoadProfileShape("burst", { ...sizes, minutes: 60 })).toThrow(String(MAX_LOAD_TEST_JOBS));
  });
});

describe("planInjectionSchedule", () => {
  it("sums exactly to the planned total even though 1,000/min is 16.67 per second", () => {
    for (const profile of ["sustained", "burst", "noisy-tenant"] as const) {
      const shape = buildLoadProfileShape(profile, { ...sizes, minutes: 10 });
      const schedule = planInjectionSchedule(shape);
      expect(schedule.reduce((sum, count) => sum + count, 0)).toBe(totalJobs(shape));
      expect(schedule).toHaveLength(totalSeconds(shape));
    }
  });

  it("spreads a phase smoothly: no second differs from the rate by more than one job", () => {
    const shape = buildLoadProfileShape("sustained", { ...sizes, minutes: 2 });
    for (const count of planInjectionSchedule(shape).slice(0, -1)) expect([16, 17]).toContain(count);
  });

  it("steps up at the phase boundary in a burst", () => {
    const schedule = planInjectionSchedule(buildLoadProfileShape("burst", { ...sizes, minutes: 2 }));
    expect(schedule[0]).toBeGreaterThanOrEqual(83);
    expect(schedule[59]).toBeGreaterThanOrEqual(83);
    expect(schedule[60]).toBeLessThanOrEqual(17);
  });
});

describe("pickAgencyIndex", () => {
  it("spreads evenly with no noisy share", () => {
    const counts = new Map<number, number>();
    for (let job = 0; job < 5_000; job += 1) counts.set(pickAgencyIndex(job, 50, 0), (counts.get(pickAgencyIndex(job, 50, 0)) ?? 0) + 1);
    expect(counts.size).toBe(50);
    for (const count of counts.values()) expect(count).toBe(100);
  });

  it("sends the noisy share to agency 0 and spreads the rest over the others", () => {
    const counts = new Map<number, number>();
    for (let job = 0; job < 10_000; job += 1) {
      const index = pickAgencyIndex(job, 50, 0.5);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    expect(counts.get(0)).toBe(5_000);
    expect(counts.size).toBe(50);
    for (let agency = 1; agency < 50; agency += 1) {
      const count = counts.get(agency) ?? 0;
      expect(count).toBeGreaterThan(5_000 / 49 - 5);
      expect(count).toBeLessThan(5_000 / 49 + 5);
    }
  });

  it("never returns an index outside the agency range, and handles a single agency", () => {
    for (let job = 0; job < 2_000; job += 1) {
      const index = pickAgencyIndex(job, 7, 0.5);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
    expect(pickAgencyIndex(123, 1, 0.5)).toBe(0);
  });
});

describe("statistics", () => {
  it("computes percentiles and tolerates an empty set", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(6);
    expect(percentile([5], 0.99)).toBe(5);
  });

  it("separates the noisy tenant from the control cohort and reports the worst control agency against the median", () => {
    const timings = [
      ...Array.from({ length: 20 }, () => ({ agencyId: "noisy", latencyMs: 9_000 })),
      ...Array.from({ length: 10 }, () => ({ agencyId: "a", latencyMs: 1_000 })),
      ...Array.from({ length: 10 }, () => ({ agencyId: "b", latencyMs: 1_100 })),
      ...Array.from({ length: 10 }, () => ({ agencyId: "c", latencyMs: 1_300 })),
    ];
    const result = summarizeNoisyNeighbour(timings, "noisy");
    expect(result.noisy.jobs).toBe(20);
    expect(result.control.jobs).toBe(30);
    expect(result.worstControlAgencyP95Ms).toBe(1_300);
    expect(result.medianControlAgencyP95Ms).toBe(1_100);
    expect(result.controlSpread).toBeCloseTo(1_300 / 1_100 - 1, 5);
    // The noisy tenant being slow must NOT count against the control cohort.
    expect(result.control.maxMs).toBe(1_300);
  });

  it("reports zero spread when there is no control traffic", () => {
    expect(summarizeNoisyNeighbour([{ agencyId: "noisy", latencyMs: 5 }], "noisy").controlSpread).toBe(0);
  });

  it("computes throughput over the span, and 0 for an empty one", () => {
    expect(throughputPerSecond(600, 0, 10_000)).toBe(60);
    expect(throughputPerSecond(5, 1_000, 1_000)).toBe(0);
  });
});
