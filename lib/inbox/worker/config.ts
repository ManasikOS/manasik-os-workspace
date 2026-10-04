/**
 * Settings for the always-on worker (Q3), read from the environment and checked before anything starts. A worker that starts with
 * a nonsensical setting (a job timeout longer than its lease, say) would quietly lose or duplicate work, so a bad value stops it
 * at boot with every problem listed, not one at a time.
 */

import type { WorkLane } from "@/lib/inbox/intelligence/contracts";
import { LANE_DEFAULTS } from "@/lib/inbox/jobs/drain";
import { LEASE_SECONDS } from "@/lib/inbox/jobs/queue";

export const WORKER_LANES: readonly WorkLane[] = ["REALTIME", "STANDARD", "BULK"];

export interface InboxWorkerConfig {
  concurrency: Record<WorkLane, number>;
  perAgencyCap: Record<WorkLane, number>;
  /** A job still running after this is failed for retry. Always below the lane's lease. */
  jobTimeoutMs: Record<WorkLane, number>;
  /** Also drain staff sends (the outbox) and the legacy agent_jobs. On by default: the worker replaces the webhook-triggered drains. */
  drainOutbox: boolean;
  drainAgentJobs: boolean;
  /** Apply buffered delivery ticks in batches (Q4). */
  drainDeliveryStatus: boolean;
  /** Repair webhook deliveries whose messages never landed, once a minute (I2). */
  reconcileRawEvents: boolean;
  port: number;
  shutdownGraceMs: number;
  staleSweepMs: number;
}

export class WorkerConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid worker configuration:\n- ${problems.join("\n- ")}`);
    this.name = "WorkerConfigError";
  }
}

/** Defaults sized for the 500 messages/minute target: about 40 assistant turns in flight (8 turns/s x ~5 s), fewer for the slow lanes. */
const DEFAULT_CONCURRENCY: Record<WorkLane, number> = { REALTIME: 40, STANDARD: 10, BULK: 4 };
/** Each is at least 15 s below the lane's lease (see LEASE_SECONDS), so a healthy worker gives a job up before its lease can lapse. */
const DEFAULT_JOB_TIMEOUT_MS: Record<WorkLane, number> = { REALTIME: 75_000, STANDARD: 100_000, BULK: 150_000 };
const LEASE_MARGIN_MS = 5_000;

type Env = Record<string, string | undefined>;

function readInt(env: Env, name: string, fallback: number, range: { min: number; max: number }, problems: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    problems.push(`${name} must be a whole number from ${range.min} to ${range.max} (got "${raw}")`);
    return fallback;
  }
  return value;
}

function readFlag(env: Env, name: string, fallback: boolean, problems: string[]): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  problems.push(`${name} must be true or false (got "${raw}")`);
  return fallback;
}

export function loadWorkerConfig(env: Env = process.env): InboxWorkerConfig {
  const problems: string[] = [];
  const concurrency = {} as Record<WorkLane, number>;
  const perAgencyCap = {} as Record<WorkLane, number>;
  const jobTimeoutMs = {} as Record<WorkLane, number>;

  for (const lane of WORKER_LANES) {
    concurrency[lane] = readInt(env, `WORKER_CONCURRENCY_${lane}`, DEFAULT_CONCURRENCY[lane], { min: 1, max: 200 }, problems);
    perAgencyCap[lane] = readInt(env, `WORKER_PER_AGENCY_CAP_${lane}`, LANE_DEFAULTS[lane].perAgencyCap, { min: 1, max: 200 }, problems);
    jobTimeoutMs[lane] = readInt(env, `WORKER_JOB_TIMEOUT_MS_${lane}`, DEFAULT_JOB_TIMEOUT_MS[lane], { min: 1_000, max: 600_000 }, problems);

    const ceiling = LEASE_SECONDS[lane] * 1000 - LEASE_MARGIN_MS;
    if (jobTimeoutMs[lane] > ceiling) {
      problems.push(
        `WORKER_JOB_TIMEOUT_MS_${lane} (${jobTimeoutMs[lane]} ms) must be at most ${ceiling} ms: the lane's lease is ${LEASE_SECONDS[lane]} s, and a job that outlives its lease is handed to another worker while this one is still running it`,
      );
    }
  }

  const config: InboxWorkerConfig = {
    concurrency,
    perAgencyCap,
    jobTimeoutMs,
    drainOutbox: readFlag(env, "WORKER_DRAIN_OUTBOX", true, problems),
    drainAgentJobs: readFlag(env, "WORKER_DRAIN_AGENT_JOBS", true, problems),
    drainDeliveryStatus: readFlag(env, "WORKER_DRAIN_DELIVERY_STATUS", true, problems),
    reconcileRawEvents: readFlag(env, "WORKER_RECONCILE_RAW_EVENTS", true, problems),
    port: readInt(env, "WORKER_PORT", readInt(env, "PORT", 8080, { min: 1, max: 65535 }, problems), { min: 1, max: 65535 }, problems),
    shutdownGraceMs: readInt(env, "WORKER_SHUTDOWN_GRACE_MS", 20_000, { min: 0, max: 120_000 }, problems),
    staleSweepMs: readInt(env, "WORKER_STALE_SWEEP_MS", 15_000, { min: 1_000, max: 300_000 }, problems),
  };
  if (problems.length > 0) throw new WorkerConfigError(problems);
  return config;
}

export interface WorkerEnvironmentCheck {
  /** Without these the worker cannot start. */
  missing: string[];
  /** The worker starts, but a feature will fail at run time. */
  warnings: string[];
}

/** Which secrets the worker was given. Names only: a value is never read into a message or a log. */
export function checkWorkerEnvironment(env: Env = process.env): WorkerEnvironmentCheck {
  const present = (name: string) => Boolean(env[name]?.trim());
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((name) => !present(name));
  const warnings: string[] = [];
  if (!present("OPENROUTER_API_KEY")) warnings.push("OPENROUTER_API_KEY is not set: the assistant cannot answer and every reply job will fail");
  return { missing, warnings };
}
