/**
 * TypeScript face of the `channel_jobs` work queue — MI1.1 of docs/inbox/implementation-plan.md (Architecture §7).
 *
 * Every write goes through a service_role-only RPC (`enqueue_channel_job`, `claim_channel_jobs`,
 * `complete_channel_job`, `fail_channel_job`, `release_stale_channel_jobs`); the fairness, coalescing and
 * dead-letter rules live in SQL where they are atomic, and are verified against a real database by
 * scripts/sql/verify-mi1-1-channel-jobs.sql. This file validates inputs, derives the lane from the job kind
 * (so a kind can never land on the wrong lane) and turns RPC results into typed values.
 *
 * Callers pass the ADMIN client: the queue deliberately crosses tenants, and no signed-in session may call it.
 * Nothing here throws to a webhook: `enqueueChannelJob` reports failure as a value so persist-and-ack is never at risk.
 */

import "server-only";

import { z } from "zod";

import type { Db } from "@/lib/ai/db";
import { LANE_FOR_JOB_KIND, WORK_LANES, jobKindSchema, type JobKind, type WorkLane } from "@/lib/inbox/intelligence/contracts";

export const DEFAULT_MAX_ATTEMPTS = 3;
/**
 * A RUNNING job with no lease (claimed before leases existed) untouched for this long is treated as belonging to a dead worker.
 * Above the 60 s function limit. Jobs claimed now carry a lease instead: see `LEASE_SECONDS`.
 */
export const STALE_LOCK_SECONDS = 5 * 60;

/**
 * How long a claim lasts, per lane. Each is above the longest time budget a drain gives that lane (a shard runs 45 s), so a healthy
 * worker always finishes or gives the job back inside its lease, while a dead worker's job is released after one lease rather than
 * after the 5-minute blanket. A handler that outlives its lease must be idempotent, as every handler already has to be.
 */
export const LEASE_SECONDS: Record<WorkLane, number> = { REALTIME: 90, STANDARD: 120, BULK: 180 };

const BACKOFF_BASE_SECONDS = 15;
const BACKOFF_CAP_SECONDS = 15 * 60;

/** Exponential backoff after the `attempts`-th failed try: 15 s, 30 s, 60 s … capped at 15 min. */
export function retryBackoffSeconds(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0);
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** exponent, BACKOFF_CAP_SECONDS);
}

/**
 * Any 8-4-4-4-12 hex id. Zod's own `.uuid()` insists on RFC version/variant bits and so rejects real ids such as the
 * bootstrap agency `00000000-0000-0000-0000-000000000001`, which silently stopped every job for that agency.
 */
const anyUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID");

export const enqueueChannelJobSchema = z.object({
  agencyId: anyUuidSchema,
  kind: jobKindSchema,
  /** Jobs with the same key collapse while QUEUED; a later enqueue only pushes `run_after` out. */
  coalesceKey: z.string().min(1).max(200).nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(-100).max(100).default(0),
  /** The settle delay: how long to wait so a burst is read as one turn. */
  delaySeconds: z.number().int().min(0).max(3600).default(0),
  maxAttempts: z.number().int().min(1).max(10).default(DEFAULT_MAX_ATTEMPTS),
});
export type EnqueueChannelJobInput = z.input<typeof enqueueChannelJobSchema>;

export type EnqueueChannelJobResult = { ok: true; jobId: string; lane: WorkLane } | { ok: false; error: string };

export async function enqueueChannelJob(db: Db, input: EnqueueChannelJobInput): Promise<EnqueueChannelJobResult> {
  const parsed = enqueueChannelJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid job: ${parsed.error.issues[0]?.message ?? "unknown"}` };

  const job = parsed.data;
  const lane = LANE_FOR_JOB_KIND[job.kind];
  try {
    const { data, error } = await db.rpc("enqueue_channel_job", {
      p_agency_id: job.agencyId,
      p_lane: lane,
      p_kind: job.kind,
      p_coalesce_key: job.coalesceKey,
      p_payload: job.payload,
      p_priority: job.priority,
      p_delay_seconds: job.delaySeconds,
      p_max_attempts: job.maxAttempts,
    });
    if (error || typeof data !== "string") {
      console.error("enqueueChannelJob failed (non-fatal):", error?.message ?? "no id returned");
      return { ok: false, error: error?.message ?? "no id returned" };
    }
    return { ok: true, jobId: data, lane };
  } catch (cause) {
    console.error("enqueueChannelJob failed (non-fatal):", cause);
    return { ok: false, error: cause instanceof Error ? cause.message : "unknown error" };
  }
}

export interface ClaimedChannelJob {
  id: string;
  agencyId: string;
  lane: WorkLane;
  kind: JobKind;
  coalesceKey: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  workerId: string;
}

const claimedRowSchema = z.object({
  id: anyUuidSchema,
  agency_id: anyUuidSchema,
  lane: z.enum(WORK_LANES),
  kind: jobKindSchema,
  coalesce_key: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
});

export interface ClaimChannelJobsOptions {
  lane: WorkLane;
  workerId: string;
  limit: number;
  /** At most this many jobs per agency in flight in the lane — the fairness cap. */
  perAgencyCap: number;
  /** Overrides `LEASE_SECONDS[lane]`. */
  leaseSeconds?: number;
}

/** Claims up to `limit` due jobs, fair across agencies. Returns [] (never throws) when the claim itself fails. */
export async function claimChannelJobs(db: Db, options: ClaimChannelJobsOptions): Promise<ClaimedChannelJob[]> {
  try {
    const { data, error } = await db.rpc("claim_channel_jobs", {
      p_lane: options.lane,
      p_worker_id: options.workerId,
      p_limit: options.limit,
      p_per_agency_cap: options.perAgencyCap,
      p_lease_seconds: options.leaseSeconds ?? LEASE_SECONDS[options.lane],
    });
    if (error) {
      console.error("claimChannelJobs failed:", error.message);
      return [];
    }
    const claimed: ClaimedChannelJob[] = [];
    for (const row of (data ?? []) as unknown[]) {
      const parsed = claimedRowSchema.safeParse(row);
      if (!parsed.success) {
        // The table's check constraints make this unreachable; if a row ever slips through, surface it and leave it for stale release.
        console.error("claimChannelJobs skipped a malformed row:", parsed.error.issues[0]?.message);
        continue;
      }
      const value = parsed.data;
      claimed.push({
        id: value.id,
        agencyId: value.agency_id,
        lane: value.lane,
        kind: value.kind,
        coalesceKey: value.coalesce_key,
        payload: value.payload ?? {},
        attempts: value.attempts,
        maxAttempts: value.max_attempts,
        workerId: options.workerId,
      });
    }
    return claimed;
  } catch (cause) {
    console.error("claimChannelJobs failed:", cause);
    return [];
  }
}

/** Marks a claimed job DONE. False when the job was no longer this worker's (e.g. released as stale). */
export async function completeChannelJob(db: Db, job: Pick<ClaimedChannelJob, "id" | "workerId">): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("complete_channel_job", { p_id: job.id, p_worker_id: job.workerId });
    if (error) {
      console.error("completeChannelJob failed:", error.message);
      return false;
    }
    return data === true;
  } catch (cause) {
    console.error("completeChannelJob failed:", cause);
    return false;
  }
}

/** Re-queues with backoff, or dead-letters once attempts are exhausted. Returns the resulting status, or null if the job was not this worker's. */
export async function failChannelJob(
  db: Db,
  job: Pick<ClaimedChannelJob, "id" | "workerId" | "attempts">,
  reason: unknown,
): Promise<"QUEUED" | "DEAD" | null> {
  const message = reason instanceof Error ? reason.message : String(reason);
  try {
    const { data, error } = await db.rpc("fail_channel_job", {
      p_id: job.id,
      p_worker_id: job.workerId,
      p_error: message,
      p_backoff_seconds: retryBackoffSeconds(job.attempts),
    });
    if (error) {
      console.error("failChannelJob failed:", error.message);
      return null;
    }
    return data === "QUEUED" || data === "DEAD" ? data : null;
  } catch (cause) {
    console.error("failChannelJob failed:", cause);
    return null;
  }
}

/**
 * Puts a claimed job straight back on the queue and refunds the attempt the claim spent. For a tick that ran out of time
 * while the job was healthy: that is the worker's shortage of time, not the job's fault, so it must not count toward
 * dead-lettering. Returns false when the job was no longer this worker's.
 */
export async function releaseChannelJob(
  db: Db,
  job: Pick<ClaimedChannelJob, "id" | "workerId">,
  reason: string,
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("release_channel_job", { p_id: job.id, p_worker_id: job.workerId, p_reason: reason });
    if (error) {
      console.error("releaseChannelJob failed:", error.message);
      return false;
    }
    return data === true;
  } catch (cause) {
    console.error("releaseChannelJob failed:", cause);
    return false;
  }
}

/** Re-queues (or dead-letters) RUNNING jobs whose worker stopped responding. Returns how many were released. */
export async function releaseStaleLocks(db: Db, olderThanSeconds: number = STALE_LOCK_SECONDS): Promise<number> {
  try {
    const { data, error } = await db.rpc("release_stale_channel_jobs", { p_older_than_seconds: olderThanSeconds });
    if (error) {
      console.error("releaseStaleLocks failed:", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (cause) {
    console.error("releaseStaleLocks failed:", cause);
    return 0;
  }
}

/**
 * When the earliest QUEUED job in the lane becomes due, or null when the lane has none (or the read failed). A job with a settle
 * delay is queued for a few seconds ahead; a drain that already found nothing due uses this to wait for it instead of leaving it
 * for the once-a-minute cron.
 */
export async function nextQueuedRunAfter(db: Db, lane: WorkLane): Promise<Date | null> {
  try {
    const { data, error } = await db
      .from("channel_jobs")
      .select("run_after")
      .eq("lane", lane)
      .eq("status", "QUEUED")
      .order("run_after", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const runAfter = new Date((data as { run_after: string }).run_after);
    return Number.isNaN(runAfter.getTime()) ? null : runAfter;
  } catch (cause) {
    console.error("nextQueuedRunAfter failed:", cause);
    return null;
  }
}

/** Jobs waiting per lane, across every agency — what the fan-out threshold and the lane-health alarm read. */
export async function depthByLane(db: Db): Promise<Record<WorkLane, number>> {
  const depth: Record<WorkLane, number> = { REALTIME: 0, STANDARD: 0, BULK: 0 };
  await Promise.all(
    WORK_LANES.map(async (lane) => {
      const { count, error } = await db
        .from("channel_jobs")
        .select("id", { count: "exact", head: true })
        .eq("lane", lane)
        .eq("status", "QUEUED");
      if (error) console.error(`depthByLane(${lane}) failed:`, error.message);
      else depth[lane] = count ?? 0;
    }),
  );
  return depth;
}
