/**
 * Shard fan-out planning — MI1.3 of docs/inbox/implementation-plan.md (Architecture §7.4 "Overflow").
 *
 * A REALTIME backlog is absorbed by WIDTH, not by one worker looping longer: when depth crosses a threshold the
 * coordinator invokes N parallel copies of the lane route, each a `shard`. Correctness needs no coordination between
 * shards — `claim_channel_jobs` serialises claims per lane and locks with SKIP LOCKED, so two shards can never
 * hold the same job. Pure, so the sizing rule is tested without any I/O.
 */

import { WORK_LANES, type WorkLane } from "@/lib/inbox/intelligence/contracts";

/** Below this many queued REALTIME jobs one inline worker is enough. */
export const FAN_OUT_DEPTH_THRESHOLD = 100;
/** Jobs one shard is expected to clear inside its budget. */
export const JOBS_PER_SHARD = 100;
export const MAX_SHARDS = 8;

/** How many shard invocations a backlog of `depth` warrants. 0 means "no fan-out: drain inline". */
export function planShardCount(depth: number, options: { threshold?: number; jobsPerShard?: number; maxShards?: number } = {}): number {
  const threshold = options.threshold ?? FAN_OUT_DEPTH_THRESHOLD;
  const jobsPerShard = options.jobsPerShard ?? JOBS_PER_SHARD;
  const maxShards = options.maxShards ?? MAX_SHARDS;
  if (!Number.isFinite(depth) || depth <= threshold) return 0;
  return Math.min(Math.max(Math.ceil(depth / jobsPerShard), 2), maxShards);
}

export function parseLaneParam(value: string | null): WorkLane | null {
  return (WORK_LANES as readonly string[]).includes(value ?? "") ? (value as WorkLane) : null;
}

/** A shard is a small non-negative integer; anything else is rejected rather than coerced. */
export function parseShardParam(value: string | null): number | null {
  if (value === null || !/^\d{1,2}$/.test(value)) return null;
  const shard = Number(value);
  return shard < MAX_SHARDS ? shard : null;
}
