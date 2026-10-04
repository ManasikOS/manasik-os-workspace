/**
 * Lane workers for `channel_jobs` — MI1.2 of docs/inbox/implementation-plan.md (Architecture §7.2–7.4).
 *
 * `processLane()` claims a fair-share batch from ONE lane, runs each job through the handler registered for
 * its kind, and repeats until the lane is empty or the wall-clock budget is spent — never "until empty", so
 * one invocation cannot become an unbounded background process. Three properties are the point of this file:
 *
 *   - A throwing handler fails ONE job (retry with backoff, or dead-letter), never the tick.
 *   - A job that outlives the budget is failed for retry rather than allowed to overrun the function limit.
 *     The handler is handed an AbortSignal, and — because JavaScript cannot cancel a promise — every handler
 *     MUST be idempotent: it may finish in the background after its job has been re-queued.
 *   - A job whose kind has no handler is failed loudly ("no handler registered"), not silently consumed.
 *
 * Handlers are registered by the slice that owns them (`registerLaneJobHandler`), keyed by `JobKind`, so this
 * file never grows a `switch` over job kinds. This file does not touch `agent_jobs`, `lib/agent/whatsapp/drain.ts`
 * or their job kinds: the live WhatsApp reply path is unchanged.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import type { JobKind, WorkLane } from "@/lib/inbox/intelligence/contracts";
import { claimChannelJobs, completeChannelJob, failChannelJob, nextQueuedRunAfter, releaseChannelJob, releaseStaleLocks, type ClaimedChannelJob } from "@/lib/inbox/jobs/queue";
import { createAdminClient } from "@/utils/supabase/admin";

export interface LaneJobContext {
  db: Db;
  /** Aborted when the lane's budget is spent. Long handlers should stop work when it fires. */
  signal: AbortSignal;
  /** Epoch ms at which this lane's budget ends. */
  deadlineMs: number;
}

export type LaneJobHandler = (job: ClaimedChannelJob, context: LaneJobContext) => Promise<void>;
export type LaneJobHandlers = Partial<Record<JobKind, LaneJobHandler>>;

const registeredHandlers: LaneJobHandlers = {};

/** Registers the handler for one job kind. Re-registering replaces it (module reload safe). */
export function registerLaneJobHandler(kind: JobKind, handler: LaneJobHandler): void {
  registeredHandlers[kind] = handler;
}

/** The handlers registered so far. The always-on worker runs its jobs through this same registry, so both drain paths see the same set. */
export function getRegisteredLaneJobHandlers(): LaneJobHandlers {
  return registeredHandlers;
}

/** Per-lane defaults: REALTIME is short and wide, BULK is strictly capped (Architecture §7.2). */
export const LANE_DEFAULTS: Record<WorkLane, { batchSize: number; perAgencyCap: number }> = {
  REALTIME: { batchSize: 20, perAgencyCap: 10 },
  STANDARD: { batchSize: 10, perAgencyCap: 5 },
  BULK: { batchSize: 5, perAgencyCap: 2 },
};

export interface ProcessLaneOptions {
  budgetMs: number;
  /** Overrides `LANE_DEFAULTS[lane].perAgencyCap`. */
  perAgencyCap?: number;
  batchSize?: number;
  /**
   * When the lane has nothing due, wait up to this long for a job that is due soon, instead of ending. A reply merges a burst of
   * messages by waiting a few seconds before it runs; a drain kicked by the webhook would otherwise end before that and leave the
   * reply for the once-a-minute cron. Off by default: only the after-webhook drain sets it.
   */
  waitForScheduledJobsMs?: number;
  workerId?: string;
  /** Injected in tests; defaults to the module registry. */
  handlers?: LaneJobHandlers;
  db?: Db;
}

export interface ProcessLaneResult {
  lane: WorkLane;
  claimed: number;
  processed: number;
  /** Failed and put back for another try. */
  retried: number;
  /** Failed and out of attempts. */
  deadLettered: number;
  /** Claimed but not finished inside the budget, so failed for retry. */
  timedOut: number;
  /** No handler registered for the job's kind. */
  unhandled: number;
}

/** A job that ran for more than this share of the tick's budget before the cutoff is treated as slow, not unlucky. */
const SLOW_JOB_BUDGET_SHARE = 0.5;

class LaneBudgetExceededError extends Error {
  constructor() {
    super("Exceeded the lane's time budget");
    this.name = "LaneBudgetExceededError";
  }
}

function newWorkerId(lane: WorkLane): string {
  return `${lane}-${process.env.VERCEL_REGION ?? "local"}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Runs `work` but rejects when `deadlineMs` passes first. The work itself is not cancelled — see file header. */
async function withinDeadline(work: Promise<void>, deadlineMs: number): Promise<void> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new LaneBudgetExceededError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LaneBudgetExceededError()), remaining);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RunClaimedJobContext {
  db: Db;
  handlers: LaneJobHandlers;
  /** Aborted when the budget is spent, so a long handler can stop. */
  abort: AbortController;
  /** Epoch ms at which this job's budget ends (a lane tick's, or a worker's per-job timeout). */
  deadlineMs: number;
  /** The length of that budget: how a job cut off early is told from one that used most of it. */
  budgetMs: number;
}

/** What one claimed job did, as counter increments. */
export type ClaimedJobOutcome = Pick<ProcessLaneResult, "processed" | "retried" | "deadLettered" | "timedOut" | "unhandled">;

/**
 * Runs ONE claimed job through the handler registered for its kind and settles it: completed, failed for retry (or dead-lettered),
 * or handed back with its attempt refunded when the budget ended before it had a fair chance. Never throws: a handler that throws
 * fails that job only. Shared by the budgeted lane drain (`processLane`) and the always-on worker, so a job is treated the same
 * wherever it runs.
 */
export async function runClaimedJob(job: ClaimedChannelJob, context: RunClaimedJobContext): Promise<ClaimedJobOutcome> {
  const { db, handlers, abort, deadlineMs, budgetMs } = context;
  const outcome: ClaimedJobOutcome = { processed: 0, retried: 0, deadLettered: 0, timedOut: 0, unhandled: 0 };

  const recordFailure = async (reason: unknown) => {
    const status = await failChannelJob(db, job, reason);
    if (status === "DEAD") outcome.deadLettered += 1;
    else if (status === "QUEUED") outcome.retried += 1;
  };

  const handler = handlers[job.kind];
  if (!handler) {
    outcome.unhandled += 1;
    await recordFailure(new Error(`No handler registered for job kind ${job.kind}`));
    return outcome;
  }
  const startedAt = Date.now();
  try {
    await withinDeadline(handler(job, { db, signal: abort.signal, deadlineMs }), deadlineMs);
  } catch (cause) {
    if (cause instanceof LaneBudgetExceededError) {
      // The deadline race can win before the budget's own timer fires. Abort immediately so
      // handlers can stop their work and observe the timeout.
      abort.abort();
      outcome.timedOut += 1;
      // A job cut off early in its run is a victim of the tick ending, not a faulty job: hand it back with
      // its attempt refunded. One that had already used most of the budget is genuinely slow and fails normally.
      if (startedAt > deadlineMs - budgetMs * SLOW_JOB_BUDGET_SHARE && (await releaseChannelJob(db, job, cause.message))) {
        outcome.retried += 1;
        return outcome;
      }
    }
    await recordFailure(cause);
    return outcome;
  }
  if (await completeChannelJob(db, job)) outcome.processed += 1;
  return outcome;
}

export async function processLane(lane: WorkLane, options: ProcessLaneOptions): Promise<ProcessLaneResult> {
  const db = options.db ?? createAdminClient();
  const handlers = options.handlers ?? registeredHandlers;
  const defaults = LANE_DEFAULTS[lane];
  const workerId = options.workerId ?? newWorkerId(lane);
  const batchSize = options.batchSize ?? defaults.batchSize;
  const perAgencyCap = options.perAgencyCap ?? defaults.perAgencyCap;
  const deadlineMs = Date.now() + options.budgetMs;
  const abort = new AbortController();
  const abortTimer = setTimeout(() => abort.abort(), options.budgetMs);

  const result: ProcessLaneResult = { lane, claimed: 0, processed: 0, retried: 0, deadLettered: 0, timedOut: 0, unhandled: 0 };

  try {
    await releaseStaleLocks(db);

    while (Date.now() < deadlineMs) {
      const jobs = await claimChannelJobs(db, { lane, workerId, limit: batchSize, perAgencyCap });
      if (jobs.length === 0) {
        if (!options.waitForScheduledJobsMs) break;
        const nextDue = await nextQueuedRunAfter(db, lane);
        const waitMs = nextDue ? nextDue.getTime() - Date.now() : -1;
        // Nothing waiting, or it is due but was not claimable (another worker's cap or a running reply for the same
        // conversation): ending is right. Only a job scheduled a little ahead is worth waiting for, and only if it still fits.
        if (waitMs <= 0 || waitMs > options.waitForScheduledJobsMs || Date.now() + waitMs >= deadlineMs) break;
        await new Promise((resolve) => setTimeout(resolve, waitMs + 50));
        continue;
      }
      result.claimed += jobs.length;

      const outcomes = await Promise.all(
        jobs.map((job) => runClaimedJob(job, { db, handlers, abort, deadlineMs, budgetMs: options.budgetMs })),
      );
      for (const outcome of outcomes) {
        result.processed += outcome.processed;
        result.retried += outcome.retried;
        result.deadLettered += outcome.deadLettered;
        result.timedOut += outcome.timedOut;
        result.unhandled += outcome.unhandled;
      }
    }
  } finally {
    clearTimeout(abortTimer);
  }
  return result;
}

/** Wall-clock split for the scheduled drain: REALTIME first, all three inside the 50 s function budget. */
// BULK carries media: downloading a photo from the channel, storing it and (when enabled) reading it takes well over
// the old 8 s, so those jobs were aborted mid-way and retried. `processAllLanes` still never runs past the 50 s total,
// and a quiet REALTIME/STANDARD lane leaves the time unused for BULK.
export const CRON_LANE_BUDGETS_MS: Record<WorkLane, number> = { REALTIME: 20_000, STANDARD: 20_000, BULK: 30_000 };

/**
 * The scheduled drain: REALTIME, then STANDARD, then BULK, each with its own budget and never past the overall one.
 * A lane that throws is reported and does not stop the next lane.
 */
export async function processAllLanes(options: { totalBudgetMs?: number; db?: Db } = {}): Promise<ProcessLaneResult[]> {
  const overallDeadline = Date.now() + (options.totalBudgetMs ?? 50_000);
  const results: ProcessLaneResult[] = [];
  for (const lane of ["REALTIME", "STANDARD", "BULK"] as const) {
    const budgetMs = Math.min(CRON_LANE_BUDGETS_MS[lane], overallDeadline - Date.now());
    if (budgetMs <= 0) break;
    try {
      results.push(await processLane(lane, { budgetMs, db: options.db }));
    } catch (cause) {
      console.error(`Lane ${lane} drain failed:`, cause instanceof Error ? cause.message : cause);
    }
  }
  return results;
}

/** Budget for the opportunistic drain kicked from a webhook's `after()` — short by design (Architecture §7.4). */
// Long enough for one assistant turn (p95 about 17 s), which now runs in this lane; a shorter budget cut a turn off mid-way.
export const REALTIME_AFTER_BUDGET_MS = 25_000;
/** A reply waits a few seconds for the customer to pause; the after-webhook drain waits for it rather than ending first. */
export const REALTIME_AFTER_SETTLE_WAIT_MS = 8_000;

/** Budget for the media (BULK) drain kicked right behind the REALTIME one, so a photo shows in seconds, not on the next cron tick. */
export const MEDIA_AFTER_BUDGET_MS = 20_000;

/**
 * For a webhook's `after()`: drains REALTIME, then BULK (a photo, voice note or file that just arrived is downloaded
 * now instead of on the next minute's cron). Never throws into the request that scheduled it; a failing lane does not
 * stop the next one.
 */
export async function drainRealtimeLaneAfterWebhook(): Promise<void> {
  try {
    await processLane("REALTIME", { budgetMs: REALTIME_AFTER_BUDGET_MS, waitForScheduledJobsMs: REALTIME_AFTER_SETTLE_WAIT_MS });
  } catch (cause) {
    console.error("REALTIME lane drain (after webhook) failed:", cause instanceof Error ? cause.message : cause);
  }
  try {
    await processLane("BULK", { budgetMs: MEDIA_AFTER_BUDGET_MS });
  } catch (cause) {
    console.error("BULK lane drain (after webhook) failed:", cause instanceof Error ? cause.message : cause);
  }
}
