/**
 * The traffic shapes of the Inbox load test — docs/inbox/scaling.md §12.1 — as pure functions, so every profile can be
 * validated, planned and unit tested WITHOUT a database, a network or a clock. The runner (inbox-multitenant.ts) only
 * executes what these return.
 */

export const INBOX_LOAD_PROFILES = ["baseline", "sustained", "burst", "noisy-tenant"] as const;
export type InboxLoadProfile = (typeof INBOX_LOAD_PROFILES)[number];

/** One stretch of steady traffic: `ratePerMinute` jobs for `minutes` minutes. */
export interface LoadPhase {
  minutes: number;
  ratePerMinute: number;
}

export interface LoadProfileShape {
  profile: InboxLoadProfile;
  /** Everything is queued at once (the Baseline profile) instead of arriving over time. */
  instantJobs: number | null;
  phases: LoadPhase[];
  /** Share of traffic, 0–1, sent by ONE agency to prove no other agency is starved (§12.1 "Noisy tenant"). */
  noisyShare: number;
}

/** A guard against a typo turning a staging test into an outage: no plan may exceed these. */
export const MAX_LOAD_TEST_JOBS = 100_000;
export const MAX_LOAD_TEST_MINUTES = 60;

export const DEFAULT_LOAD_MINUTES = 10;

export function buildLoadProfileShape(profile: InboxLoadProfile, options: { minutes?: number; agencies: number; conversationsPerAgency: number }): LoadProfileShape {
  const minutes = options.minutes ?? DEFAULT_LOAD_MINUTES;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_LOAD_TEST_MINUTES) {
    throw new Error(`--minutes must be a whole number between 1 and ${MAX_LOAD_TEST_MINUTES}.`);
  }

  let shape: LoadProfileShape;
  switch (profile) {
    case "baseline":
      // The original profile: one job per conversation, all at once.
      shape = { profile, instantJobs: options.agencies * options.conversationsPerAgency, phases: [], noisyShare: 0 };
      break;
    case "sustained":
      shape = { profile, instantJobs: null, phases: [{ minutes, ratePerMinute: 1_000 }], noisyShare: 0 };
      break;
    case "burst": {
      // §12.1: 5,000/min for a stretch, then normal load, so the backlog's absorption and recovery are both measured.
      const burstMinutes = Math.max(1, Math.floor(minutes / 2));
      shape = {
        profile,
        instantJobs: null,
        phases: [
          { minutes: burstMinutes, ratePerMinute: 5_000 },
          { minutes: Math.max(1, minutes - burstMinutes), ratePerMinute: 1_000 },
        ],
        noisyShare: 0,
      };
      break;
    }
    case "noisy-tenant":
      shape = { profile, instantJobs: null, phases: [{ minutes, ratePerMinute: 1_000 }], noisyShare: 0.5 };
      break;
  }

  const total = totalJobs(shape);
  if (total > MAX_LOAD_TEST_JOBS) throw new Error(`This plan would create ${total} jobs; the limit is ${MAX_LOAD_TEST_JOBS}.`);
  return shape;
}

export function totalJobs(shape: LoadProfileShape): number {
  if (shape.instantJobs !== null) return shape.instantJobs;
  return shape.phases.reduce((sum, phase) => sum + Math.round(phase.minutes * phase.ratePerMinute), 0);
}

export function totalSeconds(shape: LoadProfileShape): number {
  return shape.phases.reduce((sum, phase) => sum + phase.minutes * 60, 0);
}

/**
 * How many jobs to create in each second of the run. The per-second counts sum EXACTLY to the plan's total: a fractional
 * rate (1,000/min = 16.67/s) carries its remainder forward instead of rounding it away, so a 10-minute run creates
 * exactly 10,000 jobs, not 9,960.
 */
export function planInjectionSchedule(shape: LoadProfileShape): number[] {
  if (shape.instantJobs !== null) return [shape.instantJobs];
  const perSecond: number[] = [];
  let carried = 0;
  for (const phase of shape.phases) {
    const perSecondRate = phase.ratePerMinute / 60;
    for (let second = 0; second < phase.minutes * 60; second += 1) {
      const exact = perSecondRate + carried;
      const whole = Math.floor(exact + 1e-9);
      perSecond.push(whole);
      carried = exact - whole;
    }
  }
  // Whatever fraction is left over belongs to the plan: add it to the last second so the total is exact.
  const planned = totalJobs(shape);
  const scheduled = perSecond.reduce((sum, count) => sum + count, 0);
  if (perSecond.length > 0 && scheduled < planned) perSecond[perSecond.length - 1] += planned - scheduled;
  return perSecond;
}

/**
 * Which agency the n-th job belongs to. With no noisy share, jobs spread evenly. With one, `noisyShare` of them go to agency
 * index 0 and the rest spread over the others — deterministic, so a run is reproducible and testable.
 */
export function pickAgencyIndex(jobNumber: number, agencies: number, noisyShare: number): number {
  if (agencies <= 1) return 0;
  if (noisyShare > 0) {
    const noisyOutOf100 = Math.round(noisyShare * 100);
    if (jobNumber % 100 < noisyOutOf100) return 0;
    return 1 + (Math.floor(jobNumber / 100) * (100 - noisyOutOf100) + (jobNumber % 100 - noisyOutOf100)) % (agencies - 1);
  }
  return jobNumber % agencies;
}

/* ── Statistics ───────────────────────────────────────────────────────────── */

export function percentile(values: ReadonlyArray<number>, ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
}

export interface CompletedJobTiming {
  agencyId: string;
  /** Milliseconds from the job being created to it being done. */
  latencyMs: number;
}

export interface CohortSummary {
  jobs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export function summarizeLatencies(latenciesMs: ReadonlyArray<number>): CohortSummary {
  return {
    jobs: latenciesMs.length,
    p50Ms: percentile(latenciesMs, 0.5),
    p95Ms: percentile(latenciesMs, 0.95),
    p99Ms: percentile(latenciesMs, 0.99),
    maxMs: latenciesMs.length === 0 ? 0 : Math.max(...latenciesMs),
  };
}

export interface NoisyNeighbourResult {
  noisy: CohortSummary;
  /** Every agency except the noisy one. */
  control: CohortSummary;
  /** How much slower the control cohort's p95 is than it would be with no noisy tenant: reported as control p95 vs the median per-agency p95. */
  worstControlAgencyP95Ms: number;
  medianControlAgencyP95Ms: number;
  /** (worst control agency p95 ÷ median control agency p95) − 1. The plan's bar is 0.2 (§11.3). */
  controlSpread: number;
}

/** Splits completed jobs into the noisy agency and the control cohort and measures whether any control agency was starved. */
export function summarizeNoisyNeighbour(timings: ReadonlyArray<CompletedJobTiming>, noisyAgencyId: string): NoisyNeighbourResult {
  const noisy = timings.filter((timing) => timing.agencyId === noisyAgencyId);
  const control = timings.filter((timing) => timing.agencyId !== noisyAgencyId);
  const byAgency = new Map<string, number[]>();
  for (const timing of control) byAgency.set(timing.agencyId, [...(byAgency.get(timing.agencyId) ?? []), timing.latencyMs]);
  const perAgencyP95 = [...byAgency.values()].map((values) => percentile(values, 0.95));
  const median = percentile(perAgencyP95, 0.5);
  const worst = perAgencyP95.length === 0 ? 0 : Math.max(...perAgencyP95);
  return {
    noisy: summarizeLatencies(noisy.map((timing) => timing.latencyMs)),
    control: summarizeLatencies(control.map((timing) => timing.latencyMs)),
    worstControlAgencyP95Ms: worst,
    medianControlAgencyP95Ms: median,
    controlSpread: median > 0 ? worst / median - 1 : 0,
  };
}

/** Throughput in jobs per second across the span that had traffic, or 0 when there is none. */
export function throughputPerSecond(completed: number, firstCreatedAtMs: number, lastFinishedAtMs: number): number {
  const spanSeconds = (lastFinishedAtMs - firstCreatedAtMs) / 1000;
  return spanSeconds > 0 ? completed / spanSeconds : 0;
}
