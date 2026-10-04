/**
 * The worker's health endpoints (Q3): what an orchestrator polls to decide whether to restart or route to a process.
 *
 *   GET /healthz  liveness. 200 while every loop is advancing, 503 when one has stopped (a hung claim, a wedged event loop). A process
 *                 that fails this should be restarted.
 *   GET /readyz   readiness. 200 once started and until shutdown begins, then 503, so a deploy stops sending work to a draining worker.
 *
 * The body is counters and lane names only: no job payload, agency id, customer data or configuration value can appear in it, and it
 * is safe to expose to the platform's health checker. Anything else is a 404 with no body. There is no other route and no way to
 * make the worker do anything through this port.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { LaneWorkerSnapshot } from "@/lib/inbox/worker/lane-worker";

/** A loop that has not advanced for this long is treated as stuck. Loops advance at least once a second when healthy. */
export const HEARTBEAT_STALE_MS = 30_000;

export interface AuxLoopSnapshot {
  name: string;
  lastLoopAt: number | null;
}

export interface WorkerStatus {
  ready: boolean;
  stopping: boolean;
  startedAt: number;
  lanes: LaneWorkerSnapshot[];
  aux: AuxLoopSnapshot[];
}

export interface WorkerHealth {
  healthy: boolean;
  ready: boolean;
  /** Names of the loops that have stopped advancing. */
  stalled: string[];
}

/** Pure, so the rule is tested without a server. A loop that has not started its first pass yet is measured from the worker's start. */
export function evaluateWorkerHealth(status: WorkerStatus, now: number): WorkerHealth {
  const stalled: string[] = [];
  for (const lane of status.lanes) {
    if (now - (lane.lastLoopAt ?? status.startedAt) > HEARTBEAT_STALE_MS) stalled.push(`lane:${lane.lane}`);
  }
  for (const loop of status.aux) {
    if (now - (loop.lastLoopAt ?? status.startedAt) > HEARTBEAT_STALE_MS) stalled.push(`aux:${loop.name}`);
  }
  // A worker that is shutting down is still alive: killing it mid-drain would strand the jobs it is finishing.
  return { healthy: stalled.length === 0, ready: status.ready && !status.stopping, stalled };
}

function send(response: ServerResponse, code: number, body?: unknown) {
  if (body === undefined) {
    response.writeHead(code).end();
    return;
  }
  response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

export function createHealthServer(getStatus: () => WorkerStatus, now: () => number = Date.now): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405);
    const path = (request.url ?? "").split("?")[0];
    if (path !== "/healthz" && path !== "/readyz") return send(response, 404);

    const status = getStatus();
    const health = evaluateWorkerHealth(status, now());
    const ok = path === "/healthz" ? health.healthy : health.ready;
    return send(response, ok ? 200 : 503, {
      status: ok ? "ok" : "unavailable",
      ready: health.ready,
      stalled: health.stalled,
      uptimeSeconds: Math.round((now() - status.startedAt) / 1000),
      lanes: status.lanes.map((lane) => ({
        lane: lane.lane,
        inFlight: lane.inFlight,
        concurrency: lane.concurrency,
        claimed: lane.claimed,
        processed: lane.processed,
        retried: lane.retried,
        deadLettered: lane.deadLettered,
        timedOut: lane.timedOut,
        unhandled: lane.unhandled,
      })),
    });
  });
}
