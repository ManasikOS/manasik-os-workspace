/**
 * One lane of the always-on worker (Q3, docs/inbox/scale-inngest-implementation-plan.md §5.2).
 *
 * `processLane` (lib/inbox/jobs/drain.ts) drains a lane for a fixed time budget and stops: right for a serverless function that
 * must return, wrong for a process that should simply keep the lane moving. This runs for as long as the process does:
 *
 *   - it keeps up to `concurrency` jobs running, claiming exactly as many as it has free slots, so the queue's per-agency fairness
 *     decides who runs next and no worker hoards work it cannot start;
 *   - a burst is taken back to back; an empty lane is polled after a short pause that grows to a ceiling, and is cut short the
 *     moment a job finishes (a slot is free). A settle delay of a few seconds is just a job that becomes claimable later;
 *   - each job is run by `runClaimedJob`, the same function the budgeted drain uses, with a per-job timeout in place of the tick
 *     budget, so a job is completed, retried, dead-lettered or refunded exactly as it is anywhere else;
 *   - on shutdown it stops claiming, lets running jobs finish for a grace period, then hands the rest straight back to the queue
 *     with their attempt refunded, so a deploy never makes a customer wait out a lease.
 *
 * Correctness never depends on this process: every claim is a lease, so a killed worker's jobs return to the queue when the lease
 * runs out, and the scheduled drains keep working alongside it. Tests inject the clock-free pieces; time itself is real.
 */

import "server-only";

import { reportHandledError } from "@/lib/observability/report-error";

import type { Db } from "@/lib/ai/db";
import type { WorkLane } from "@/lib/inbox/intelligence/contracts";
import { runClaimedJob, type LaneJobHandlers } from "@/lib/inbox/jobs/drain";
import { claimChannelJobs, releaseChannelJob, type ClaimedChannelJob } from "@/lib/inbox/jobs/queue";

export interface LaneWorkerOptions {
  lane: WorkLane;
  db: Db;
  handlers: LaneJobHandlers;
  workerId: string;
  /** Jobs this worker runs at once in the lane. */
  concurrency: number;
  /** At most this many jobs per agency in flight in the lane (the queue's fairness cap). */
  perAgencyCap: number;
  /** A job still running after this is failed for retry. Must be below the lane's lease. */
  jobTimeoutMs: number;
  /** Poll pause when the lane is empty: starts here, doubles up to `idleMaxMs`. */
  idleMinMs?: number;
  idleMaxMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LaneWorkerSnapshot {
  lane: WorkLane;
  running: boolean;
  inFlight: number;
  concurrency: number;
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
  timedOut: number;
  unhandled: number;
  /** Epoch ms of the last claim that returned work, and of the last pass of the loop (health: a hung loop stops advancing this). */
  lastClaimAt: number | null;
  lastLoopAt: number | null;
}

export interface LaneWorker {
  /** Runs until `stop()` is called. Resolves once the loop has ended. */
  run(): Promise<void>;
  /** Stops claiming, waits up to `graceMs` for running jobs, then hands the rest back. */
  stop(graceMs: number): Promise<{ released: number }>;
  snapshot(): LaneWorkerSnapshot;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createLaneWorker(options: LaneWorkerOptions): LaneWorker {
  const { lane, db, handlers, workerId, concurrency, perAgencyCap, jobTimeoutMs } = options;
  const idleMinMs = options.idleMinMs ?? 250;
  const idleMaxMs = Math.max(options.idleMaxMs ?? 1000, idleMinMs);
  const sleep = options.sleep ?? defaultSleep;

  const inFlight = new Map<string, { job: ClaimedChannelJob; abort: AbortController; done: Promise<void> }>();
  const counters = { claimed: 0, processed: 0, retried: 0, deadLettered: 0, timedOut: 0, unhandled: 0 };
  let stopping = false;
  let running = false;
  let lastClaimAt: number | null = null;
  let lastLoopAt: number | null = null;
  let loop: Promise<void> = Promise.resolve();
  /** Cuts the current pause short: a job finished (a slot is free) or the worker is stopping. */
  let wake: (() => void) | null = null;

  /** Pauses up to `ms`, or until woken. */
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (wake === finish) wake = null;
        resolve();
      };
      wake = finish;
      void sleep(ms).then(finish);
    });

  const launch = (job: ClaimedChannelJob) => {
    const abort = new AbortController();
    const deadlineMs = Date.now() + jobTimeoutMs;
    const done = runClaimedJob(job, { db, handlers, abort, deadlineMs, budgetMs: jobTimeoutMs })
      .then((outcome) => {
        counters.processed += outcome.processed;
        counters.retried += outcome.retried;
        counters.deadLettered += outcome.deadLettered;
        counters.timedOut += outcome.timedOut;
        counters.unhandled += outcome.unhandled;
      })
      .catch((cause) => {
        // runClaimedJob settles its own failures and does not throw; this is a last guard so a bug cannot kill the loop.
        console.error(`Worker ${workerId}: job ${job.id} settled with an unexpected error:`, cause instanceof Error ? cause.message : cause);
        reportHandledError("worker.lane.unexpectedJobError", cause);
      })
      .finally(() => {
        inFlight.delete(job.id);
        wake?.();
      });
    inFlight.set(job.id, { job, abort, done });
  };

  async function runLoop() {
    running = true;
    let idleMs = idleMinMs;
    try {
      while (!stopping) {
        lastLoopAt = Date.now();
        const free = concurrency - inFlight.size;
        if (free <= 0) {
          await pause(idleMaxMs); // woken as soon as a job finishes
          continue;
        }

        const jobs = await claimChannelJobs(db, { lane, workerId, limit: free, perAgencyCap });
        if (stopping) {
          // Claimed in the instant the worker was told to stop: give them straight back, refunding the attempt.
          for (const job of jobs) await releaseChannelJob(db, job, "worker shutting down");
          break;
        }
        if (jobs.length > 0) {
          lastClaimAt = Date.now();
          counters.claimed += jobs.length;
          for (const job of jobs) launch(job);
          idleMs = idleMinMs;
          continue; // a burst is taken back to back
        }
        await pause(idleMs);
        idleMs = Math.min(idleMs * 2, idleMaxMs);
      }
    } finally {
      running = false;
    }
  }

  return {
    run() {
      loop = runLoop();
      return loop;
    },

    async stop(graceMs) {
      stopping = true;
      wake?.();
      await Promise.race([Promise.allSettled([...inFlight.values()].map((entry) => entry.done)), sleep(graceMs)]);

      let released = 0;
      for (const { job, abort } of [...inFlight.values()]) {
        abort.abort();
        if (await releaseChannelJob(db, job, "worker shutting down")) released += 1;
      }
      await loop;
      return { released };
    },

    snapshot() {
      return { lane, running, inFlight: inFlight.size, concurrency, ...counters, lastClaimAt, lastLoopAt };
    },
  };
}
