/**
 * Inbox lane worker and shard coordinator (MI1.3, Architecture §7.4).
 *
 *   GET /api/cron/inbox-lanes?lane=REALTIME&shard=3   — a SHARD: drains that lane once and returns.
 *   GET /api/cron/inbox-lanes[?lane=REALTIME]         — the COORDINATOR (what pg_cron calls, every minute):
 *     reads the lane's queue depth; below the threshold it drains the lane inline, above it it fans out N
 *     parallel shard invocations of this same route instead of looping one worker longer.
 *
 * Shards never double-process: `claim_channel_jobs` serialises claims per lane and locks with SKIP LOCKED.
 * Authenticated by `Authorization: Bearer $CRON_SECRET` alone (proxy.ts already lets /api/cron/* through without a
 * session), and the coordinator forwards the same header to its shards. Responses carry counts only.
 */

import { NextResponse, type NextRequest } from "next/server";

import "@/lib/inbox/intelligence/register-handlers";
import { CRON_LANE_BUDGETS_MS, processLane } from "@/lib/inbox/jobs/drain";
import { parseLaneParam, parseShardParam, planShardCount } from "@/lib/inbox/jobs/fan-out";
import { depthByLane } from "@/lib/inbox/jobs/queue";
import { hasValidBearerSecret } from "@/lib/security/secure-compare";
import { createAdminClient } from "@/utils/supabase/admin";

/** A shard must finish inside this so the coordinator's own invocation can outlive it. */
const SHARD_BUDGET_MS = 45_000;
const SHARD_REQUEST_TIMEOUT_MS = 55_000;
/** REALTIME's inline budget (20 s) plus this stays inside the 50 s function limit. */
const BULK_AFTER_REALTIME_BUDGET_MS = 25_000;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authorization = request.headers.get("authorization");
  if (!hasValidBearerSecret(authorization, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const laneParam = searchParams.get("lane");
  const lane = laneParam === null ? "REALTIME" : parseLaneParam(laneParam);
  if (!lane) return NextResponse.json({ error: "Unknown lane" }, { status: 400 });

  const shardParam = searchParams.get("shard");
  if (shardParam !== null) {
    if (parseShardParam(shardParam) === null) return NextResponse.json({ error: "Invalid shard" }, { status: 400 });
    const result = await processLane(lane, { budgetMs: SHARD_BUDGET_MS });
    return NextResponse.json({ mode: "shard", shard: Number(shardParam), ...result }, { status: 200 });
  }

  // Coordinator.
  const depth = (await depthByLane(createAdminClient()))[lane];
  const shards = lane === "REALTIME" ? planShardCount(depth) : 0;
  if (shards === 0) {
    const result = await processLane(lane, { budgetMs: CRON_LANE_BUDGETS_MS[lane] });
    // This route is the only job that runs every minute, so media (BULK: photos, voice notes, files) rides along once
    // REALTIME is drained. Without this, BULK waited for the 5-minute agent-jobs sweep and photos sat on "Loading".
    const bulk = lane === "REALTIME"
      ? await processLane("BULK", { budgetMs: BULK_AFTER_REALTIME_BUDGET_MS }).catch((cause) => {
          console.error("BULK lane drain failed:", cause instanceof Error ? cause.message : cause);
          return null;
        })
      : null;
    return NextResponse.json({ mode: "inline", depth, ...result, ...(bulk ? { bulk } : {}) }, { status: 200 });
  }

  // Shards receive our bearer secret, so the target is the configured deployment origin when there is one — never
  // an origin rebuilt from request headers that a proxy or caller could influence.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || request.nextUrl.origin).replace(/\/+$/, "");
  const settled = await Promise.allSettled(
    Array.from({ length: shards }, (_, shard) =>
      fetch(`${origin}/api/cron/inbox-lanes?lane=${lane}&shard=${shard}`, {
        headers: { authorization: authorization ?? "" },
        signal: AbortSignal.timeout(SHARD_REQUEST_TIMEOUT_MS),
      }).then((response) => {
        if (!response.ok) throw new Error(`shard ${shard} answered ${response.status}`);
      }),
    ),
  );
  const failedShards = settled.filter((outcome) => outcome.status === "rejected").length;
  if (failedShards > 0) console.error(`Inbox lane fan-out: ${failedShards} of ${shards} shards failed`);
  return NextResponse.json({ mode: "fan-out", depth, shards, failedShards }, { status: 200 });
}
