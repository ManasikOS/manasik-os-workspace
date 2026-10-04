/**
 * `departure_ops_jobs` queue operations — mirrors
 * `lib/data/whatsapp-repository.ts`'s `claimJobs`/`completeJob`/`failJob`/
 * `releaseStaleLocks` exactly, scoped to this agent's own queue table (see
 * F-DRIFT in docs/modules/departure-operations-agent-implementation-plan.md for
 * why it's a separate table rather than `agent_jobs`).
 */

import "server-only";

import type { Db } from "@/lib/data/departure-groups-repository";

export type DepartureOpsJobKind = "DEPARTURE_OPS_SWEEP" | "DEPARTURE_OPS_REVIEW";
export type DepartureOpsJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "DEAD";

export interface DepartureOpsJobRow {
  id: string;
  agency_id: string;
  kind: DepartureOpsJobKind;
  payload: Record<string, unknown>;
  status: DepartureOpsJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function claimDepartureOpsJobs(db: Db, workerId: string, limit: number): Promise<DepartureOpsJobRow[]> {
  const { data, error } = await db.rpc("claim_departure_ops_jobs", { p_worker_id: workerId, p_limit: limit });
  if (error) throw new Error(`Failed to claim departure_ops_jobs: ${error.message}`);
  return (data ?? []) as DepartureOpsJobRow[];
}

export async function completeDepartureOpsJob(db: Db, jobId: string): Promise<void> {
  const { error } = await db
    .from("departure_ops_jobs")
    .update({ status: "DONE", locked_at: null, locked_by: null })
    .eq("id", jobId);
  if (error) throw new Error(`Failed to complete departure_ops_jobs row: ${error.message}`);
}

/** Increments attempts and moves to DEAD once max_attempts is reached; otherwise re-queues with backoff. */
export async function failDepartureOpsJob(db: Db, job: DepartureOpsJobRow, errorMessage: string): Promise<void> {
  const attempts = job.attempts + 1;
  const status: DepartureOpsJobStatus = attempts >= job.max_attempts ? "DEAD" : "QUEUED";
  const { error } = await db
    .from("departure_ops_jobs")
    .update({
      status,
      attempts,
      last_error: errorMessage.slice(0, 2000),
      locked_at: null,
      locked_by: null,
      run_after: new Date(Date.now() + 30_000 * 4 ** attempts).toISOString(),
    })
    .eq("id", job.id);
  if (error) throw new Error(`Failed to fail departure_ops_jobs row: ${error.message}`);
}

/** Releases jobs a crashed worker never completed, so they can be re-claimed. */
export async function releaseStaleDepartureOpsLocks(db: Db, olderThanMs = 5 * 60_000): Promise<void> {
  const { error } = await db
    .from("departure_ops_jobs")
    .update({ status: "QUEUED", locked_at: null, locked_by: null })
    .eq("status", "RUNNING")
    .lt("locked_at", new Date(Date.now() - olderThanMs).toISOString());
  if (error) throw new Error(`Failed to release stale departure_ops_jobs locks: ${error.message}`);
}
