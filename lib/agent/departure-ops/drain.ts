/**
 * The queue drain — claims due `departure_ops_jobs` and runs each to
 * completion. Mirrors `lib/agent/whatsapp/drain.ts`'s `processDueJobs`
 * shape exactly (budgeted loop, `FOR UPDATE SKIP LOCKED` claim, stale-lock
 * release), pointed at this agent's own queue.
 *
 * `DEPARTURE_OPS_SWEEP` is itself a queued, claimed job — not a function
 * the cron route calls directly — so a sweep's cost, retries and `DEAD`
 * terminal state are visible in exactly the same place a review's are.
 * `ensureSweepQueued()` is what keeps one cron tick from enqueueing a
 * second sweep on top of one still running.
 */

import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

import {
  claimDepartureOpsJobs,
  completeDepartureOpsJob,
  failDepartureOpsJob,
  releaseStaleDepartureOpsLocks,
  type DepartureOpsJobRow,
} from "@/lib/agent/departure-ops/jobs";
import { expireStaleProposals, reviewGroupIfDue, sweepDueGroups } from "@/lib/agent/departure-ops/scheduler";
import { checkAutoDemotion } from "@/lib/agent/departure-ops/auto-demotion";
import type { DepartureOpsContext } from "@/lib/agent/departure-ops/context";

const CLAIM_BATCH_SIZE = 5; // smaller than WhatsApp's 10 — a review calls the model and can run for tens of seconds

export interface DepartureOpsDrainResult {
  sweepEnqueued: boolean;
  processed: number;
  failed: number;
}

export async function processDueDepartureOpsJobs(options: { budgetMs: number }): Promise<DepartureOpsDrainResult> {
  const db = createAdminClient();
  const workerId = `${process.env.VERCEL_REGION ?? "local"}-${process.pid}-${Date.now()}`;
  const deadline = Date.now() + options.budgetMs;

  await releaseStaleDepartureOpsLocks(db);
  const sweepEnqueued = await ensureSweepQueued(db);

  let processed = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const jobs = await claimDepartureOpsJobs(db, workerId, CLAIM_BATCH_SIZE);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() >= deadline) break;
      try {
        await runJob(db, job);
        await completeDepartureOpsJob(db, job.id);
        processed++;
      } catch (error) {
        await failDepartureOpsJob(db, job, error instanceof Error ? error.message : String(error));
        failed++;
      }
    }
  }

  return { sweepEnqueued, processed, failed };
}

/**
 * One `DEPARTURE_OPS_SWEEP` job, at most, ever sits QUEUED or RUNNING —
 * checked and inserted here rather than relying on a DB constraint, since
 * (unlike `DEPARTURE_OPS_REVIEW`'s per-group fingerprint) there is no
 * natural per-sweep key to build a partial unique index against. The
 * failure mode of the small check-then-insert race this allows is a second
 * sweep enqueued a few milliseconds early — cosmetic, not a correctness
 * problem, since `sweepDueGroups()` itself is idempotent (F5's coalescing
 * index on the reviews it enqueues is the real safety net).
 */
async function ensureSweepQueued(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const { data: active } = await db
    .from("departure_ops_jobs")
    .select("id")
    .eq("kind", "DEPARTURE_OPS_SWEEP")
    .in("status", ["QUEUED", "RUNNING"])
    .limit(1)
    .maybeSingle();
  if (active) return false;

  const { data: anyAgency } = await db.from("agencies").select("id").limit(1).maybeSingle();
  const agencyId = (anyAgency as { id: string } | null)?.id;
  if (!agencyId) return false; // no agency exists yet — nothing to sweep

  const { error } = await db.from("departure_ops_jobs").insert({
    agency_id: agencyId, // the sweep spans every agency; this column exists for the table's own NOT NULL, not as a scope
    kind: "DEPARTURE_OPS_SWEEP",
    payload: {},
  });
  return !error;
}

async function runJob(db: ReturnType<typeof createAdminClient>, job: DepartureOpsJobRow): Promise<void> {
  switch (job.kind) {
    case "DEPARTURE_OPS_SWEEP": {
      await expireStaleProposals(db);
      await sweepDueGroups(db);
      // A trend check, not a per-turn guardrail — run once per sweep,
      // never per review (§11's auto-demotion row).
      await checkAutoDemotion(db);
      return;
    }
    case "DEPARTURE_OPS_REVIEW": {
      const payload = job.payload as { groupId?: string };
      if (!payload.groupId) throw new Error("DEPARTURE_OPS_REVIEW job is missing groupId");
      const ctx: DepartureOpsContext = { agencyId: job.agency_id, groupId: payload.groupId, db };
      await reviewGroupIfDue(ctx, job.id);
      return;
    }
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}
