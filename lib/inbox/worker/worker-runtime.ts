/**
 * The always-on worker (Q3): the lane workers for REALTIME, STANDARD and BULK, the two drains that are not lane jobs (staff sends and
 * the legacy `agent_jobs`), the stale-lease sweep and the health port, started and stopped as one.
 *
 * Nothing here is required for correctness. Every claim is a lease, and the scheduled drains keep running, so a worker that is down,
 * slow or restarting only makes replies later, never lost. What it adds is the difference between "a reply waits for the next
 * once-a-minute tick or for a webhook's function to be free" and "a process that is already running picks it up in a fraction of a
 * second, at a concurrency chosen for the load".
 *
 * Logs are one JSON object per line: event names, lane names and counters only, never a job payload, message text or secret.
 */

import "server-only";

import type { Server } from "node:http";

import type { Db } from "@/lib/ai/db";
import type { LaneJobHandlers } from "@/lib/inbox/jobs/drain";
import { WORKER_LANES, type InboxWorkerConfig } from "@/lib/inbox/worker/config";
import { createHealthServer, type AuxLoopSnapshot, type WorkerStatus } from "@/lib/inbox/worker/health-server";
import { createLaneWorker, type LaneWorker } from "@/lib/inbox/worker/lane-worker";

export interface DrainResult {
  processed: number;
  failed: number;
}

export interface InboxWorkerDeps {
  config: InboxWorkerConfig;
  db: Db;
  handlers: LaneJobHandlers;
  workerId: string;
  /** Staff sends. Omitted when `config.drainOutbox` is off. */
  drainOutbox?: (options: { budgetMs: number }) => Promise<DrainResult>;
  /** The legacy `agent_jobs`. Omitted when `config.drainAgentJobs` is off. */
  drainAgentJobs?: (options: { budgetMs: number }) => Promise<DrainResult>;
  /** Buffered delivery ticks (Q4). Omitted when `config.drainDeliveryStatus` is off. */
  drainDeliveryStatus?: (options: { budgetMs: number }) => Promise<DrainResult>;
  /** Repairs webhook deliveries whose messages never landed (I2). Omitted when `config.reconcileRawEvents` is off. Throttled by the caller. */
  reconcileRawEvents?: (options: { budgetMs: number }) => Promise<DrainResult>;
  /** Hands back RUNNING jobs whose lease ran out. */
  releaseStale: (db: Db) => Promise<number>;
  log?: (event: Record<string, unknown>) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** False in tests, which do not open a port. */
  serveHealth?: boolean;
}

export interface InboxWorker {
  start(): Promise<void>;
  /** Stops claiming, finishes or hands back running jobs, and closes the port. Resolves when everything has stopped. */
  stop(): Promise<void>;
  status(): WorkerStatus;
}

const AUX_BUDGET_MS = 15_000;
const AUX_IDLE_MS = 1_000;
const SUMMARY_EVERY_MS = 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultLog = (event: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));

export function createInboxWorker(deps: InboxWorkerDeps): InboxWorker {
  const { config, db, handlers, workerId } = deps;
  const log = deps.log ?? defaultLog;
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = Date.now();
  let ready = false;
  let stopping = false;

  const laneWorkers: LaneWorker[] = WORKER_LANES.map((lane) =>
    createLaneWorker({
      lane,
      db,
      handlers,
      workerId: `${workerId}:${lane}`,
      concurrency: config.concurrency[lane],
      perAgencyCap: config.perAgencyCap[lane],
      jobTimeoutMs: config.jobTimeoutMs[lane],
      sleep,
    }),
  );

  const auxLoops: Array<{ name: string; lastLoopAt: number | null; run: () => Promise<void> }> = [];
  const addAuxLoop = (name: string, drain: (options: { budgetMs: number }) => Promise<DrainResult>) => {
    const loop = {
      name,
      lastLoopAt: null as number | null,
      async run() {
        while (!stopping) {
          loop.lastLoopAt = Date.now();
          let processed = 0;
          try {
            const result = await drain({ budgetMs: AUX_BUDGET_MS });
            processed = result.processed + result.failed;
          } catch (cause) {
            log({ event: "aux_drain_failed", name, error: cause instanceof Error ? cause.message : String(cause) });
          }
          if (processed === 0) await sleep(AUX_IDLE_MS);
        }
      },
    };
    auxLoops.push(loop);
  };
  if (config.drainOutbox && deps.drainOutbox) addAuxLoop("outbox", deps.drainOutbox);
  if (config.drainAgentJobs && deps.drainAgentJobs) addAuxLoop("agent_jobs", deps.drainAgentJobs);
  if (config.drainDeliveryStatus && deps.drainDeliveryStatus) addAuxLoop("delivery_status", deps.drainDeliveryStatus);
  if (config.reconcileRawEvents && deps.reconcileRawEvents) addAuxLoop("raw_event_reconcile", deps.reconcileRawEvents);

  const status = (): WorkerStatus => ({
    ready,
    stopping,
    startedAt,
    lanes: laneWorkers.map((worker) => worker.snapshot()),
    aux: auxLoops.map((loop): AuxLoopSnapshot => ({ name: loop.name, lastLoopAt: loop.lastLoopAt })),
  });

  let server: Server | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  let summaryTimer: ReturnType<typeof setInterval> | null = null;
  const running: Array<Promise<void>> = [];

  return {
    async start() {
      if (deps.serveHealth !== false) {
        server = createHealthServer(status);
        await new Promise<void>((resolve, reject) => {
          server!.once("error", reject);
          server!.listen(config.port, "0.0.0.0", () => resolve());
        });
      }

      const sweep = () => {
        deps.releaseStale(db).then(
          (released) => {
            if (released > 0) log({ event: "stale_jobs_released", count: released });
          },
          (cause) => log({ event: "stale_sweep_failed", error: cause instanceof Error ? cause.message : String(cause) }),
        );
      };
      sweep();
      staleTimer = setInterval(sweep, config.staleSweepMs);
      summaryTimer = setInterval(() => {
        for (const lane of laneWorkers.map((worker) => worker.snapshot())) {
          log({
            event: "lane_summary", lane: lane.lane, inFlight: lane.inFlight, claimed: lane.claimed, processed: lane.processed,
            retried: lane.retried, deadLettered: lane.deadLettered, timedOut: lane.timedOut, unhandled: lane.unhandled,
          });
        }
      }, SUMMARY_EVERY_MS);

      for (const worker of laneWorkers) running.push(worker.run());
      for (const loop of auxLoops) running.push(loop.run());
      ready = true;
      log({
        event: "worker_started", workerId, port: deps.serveHealth === false ? null : config.port,
        concurrency: config.concurrency, drainOutbox: auxLoops.some((loop) => loop.name === "outbox"),
        drainAgentJobs: auxLoops.some((loop) => loop.name === "agent_jobs"),
      });
    },

    async stop() {
      if (stopping) return;
      stopping = true;
      ready = false;
      log({ event: "worker_stopping", inFlight: laneWorkers.reduce((sum, worker) => sum + worker.snapshot().inFlight, 0) });
      if (staleTimer) clearInterval(staleTimer);
      if (summaryTimer) clearInterval(summaryTimer);

      const released = await Promise.all(laneWorkers.map((worker) => worker.stop(config.shutdownGraceMs)));
      await Promise.allSettled(running);
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      log({ event: "worker_stopped", releasedJobs: released.reduce((sum, item) => sum + item.released, 0) });
    },

    status,
  };
}
