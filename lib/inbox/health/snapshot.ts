import "server-only";

import type { createAdminClient } from "@/utils/supabase/admin";

import { HEALTH_THRESHOLDS, type InboxHealthSnapshot, type JobLane } from "./evaluate";

type Db = ReturnType<typeof createAdminClient>;

const LANES: JobLane[] = ["REALTIME", "STANDARD", "BULK"];
const NO_AGENCY = "00000000-0000-0000-0000-000000000000";

/**
 * Disposable test agencies (`agencies.is_test`) are refused every provider send on purpose, so their refused messages would otherwise
 * show up as dead letters and page the team. Their queues are left out of the health numbers. `null` when the list cannot be read, which
 * makes the parts that depend on it unreadable (reported as a finding) rather than quietly counted.
 */
async function readTestAgencyFilter(db: Db): Promise<string | null> {
  const { data, error } = await db.from("agencies").select("id").eq("is_test", true);
  if (error || !Array.isArray(data)) return null;
  const ids = (data as Array<{ id: string }>).map((row) => row.id);
  return `(${ids.length > 0 ? ids.join(",") : NO_AGENCY})`;
}

function ageSeconds(timestamp: unknown, now: number): number | null {
  if (typeof timestamp !== "string") return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 1000) : null;
}

/**
 * Reads the queue ages and counts across every agency. Platform monitoring, not tenant data: it returns numbers and job names only, so the
 * privileged client does not need an agency scope. Each part fails on its own to `null`, which the evaluator reports as a finding.
 */
export async function readInboxHealthSnapshot(db: Db, nowMs: number = Date.now()): Promise<InboxHealthSnapshot> {
  const nowIso = new Date(nowMs).toISOString();
  const since24h = new Date(nowMs - 24 * 3_600_000).toISOString();
  const stuckBefore = new Date(nowMs - HEALTH_THRESHOLDS.outboxStuckRunningMinutes * 60_000).toISOString();

  const testAgencies = await readTestAgencyFilter(db);

  const cronJobs = await (async () => {
    const { data, error } = await db.rpc("cron_job_health");
    if (error || !Array.isArray(data)) return null;
    return (data as Array<{ jobname: string; state: string; reason: string | null }>).map((row) => ({
      jobname: row.jobname,
      state: row.state,
      reason: row.reason,
    }));
  })();

  const outbox = await (async () => {
    if (testAgencies === null) return null;
    const [oldest, stuck, dead] = await Promise.all([
      db.from("outbox_messages").select("run_after").eq("status", "QUEUED").lte("run_after", nowIso).not("agency_id", "in", testAgencies).order("run_after", { ascending: true }).limit(1),
      db.from("outbox_messages").select("id", { count: "exact", head: true }).eq("status", "RUNNING").lt("locked_at", stuckBefore).not("agency_id", "in", testAgencies),
      db.from("outbox_messages").select("id", { count: "exact", head: true }).eq("status", "DEAD").gte("updated_at", since24h).not("agency_id", "in", testAgencies),
    ]);
    if (oldest.error || stuck.error || dead.error) return null;
    return {
      oldestQueuedAgeSeconds: ageSeconds((oldest.data?.[0] as { run_after?: unknown } | undefined)?.run_after, nowMs),
      stuckRunning: stuck.count ?? 0,
      deadLast24h: dead.count ?? 0,
    };
  })();

  const jobs = await (async () => {
    if (testAgencies === null) return null;
    const [laneResults, dead] = await Promise.all([
      Promise.all(
        LANES.map((lane) =>
          db.from("channel_jobs").select("run_after").eq("lane", lane).eq("status", "QUEUED").lte("run_after", nowIso).not("agency_id", "in", testAgencies).order("run_after", { ascending: true }).limit(1),
        ),
      ),
      db.from("channel_jobs").select("id", { count: "exact", head: true }).eq("status", "DEAD").gte("updated_at", since24h).not("agency_id", "in", testAgencies),
    ]);
    if (dead.error || laneResults.some((result) => result.error)) return null;
    const oldestQueuedAgeSeconds: Record<JobLane, number | null> = { REALTIME: null, STANDARD: null, BULK: null };
    LANES.forEach((lane, index) => {
      oldestQueuedAgeSeconds[lane] = ageSeconds((laneResults[index].data?.[0] as { run_after?: unknown } | undefined)?.run_after, nowMs);
    });
    return { oldestQueuedAgeSeconds, deadLast24h: dead.count ?? 0 };
  })();

  return { cronJobs, outbox, jobs };
}
