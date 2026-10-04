import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { LEASE_SECONDS, STALE_LOCK_SECONDS, claimChannelJobs, completeChannelJob, depthByLane, enqueueChannelJob, failChannelJob, releaseStaleLocks, retryBackoffSeconds } = await import("./queue");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

type RpcCall = { name: string; args: Record<string, unknown> };

/** A stand-in Supabase client whose RPCs return canned results and record how they were called. */
function fakeRpcDb(results: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const calls: RpcCall[] = [];
  return {
    calls,
    db: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: results[name]?.data ?? null, error: results[name]?.error ?? null };
      },
    } as never,
  };
}

const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: JOB,
  agency_id: AGENCY,
  lane: "REALTIME",
  kind: "ENRICH",
  coalesce_key: `enrich:${JOB}`,
  payload: { conversationId: JOB },
  attempts: 1,
  max_attempts: 3,
  ...overrides,
});

describe("retryBackoffSeconds", () => {
  it("doubles from 15 s and caps at 15 minutes", () => {
    expect([1, 2, 3, 4].map(retryBackoffSeconds)).toEqual([15, 30, 60, 120]);
    expect(retryBackoffSeconds(20)).toBe(900);
    expect(retryBackoffSeconds(0)).toBe(15);
  });
});

describe("enqueueChannelJob", () => {
  it("derives the lane from the kind — a caller cannot put ENRICH on the BULK lane", async () => {
    const { db, calls } = fakeRpcDb({ enqueue_channel_job: { data: JOB } });
    const result = await enqueueChannelJob(db, { agencyId: AGENCY, kind: "ENRICH", coalesceKey: `enrich:${JOB}`, delaySeconds: 4 });
    expect(result).toEqual({ ok: true, jobId: JOB, lane: "REALTIME" });
    expect(calls[0].args).toMatchObject({ p_lane: "REALTIME", p_kind: "ENRICH", p_coalesce_key: `enrich:${JOB}`, p_delay_seconds: 4, p_max_attempts: 3 });

    const bulk = await enqueueChannelJob(db, { agencyId: AGENCY, kind: "TRANSCRIBE_VOICE" });
    expect(bulk).toMatchObject({ ok: true, lane: "BULK" });
  });

  it("rejects an unknown kind, a bad agency id and a negative delay without calling the database", async () => {
    const { db, calls } = fakeRpcDb({});
    expect((await enqueueChannelJob(db, { agencyId: AGENCY, kind: "DO_MAGIC" as never })).ok).toBe(false);
    expect((await enqueueChannelJob(db, { agencyId: "nope", kind: "ENRICH" })).ok).toBe(false);
    expect((await enqueueChannelJob(db, { agencyId: AGENCY, kind: "ENRICH", delaySeconds: -1 })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("accepts the bootstrap agency id, which is a real id that is not an RFC 4122 uuid", async () => {
    const BOOTSTRAP_AGENCY = "00000000-0000-0000-0000-000000000001";
    const { db } = fakeRpcDb({ enqueue_channel_job: { data: JOB }, claim_channel_jobs: { data: [jobRow({ agency_id: BOOTSTRAP_AGENCY })] } });
    expect((await enqueueChannelJob(db, { agencyId: BOOTSTRAP_AGENCY, kind: "READ_DOCUMENT" })).ok).toBe(true);
    const claimed = await claimChannelJobs(db, { lane: "REALTIME", workerId: "w", limit: 5, perAgencyCap: 2 });
    expect(claimed.map((job) => job.agencyId)).toEqual([BOOTSTRAP_AGENCY]);
  });

  it("reports a database failure as a value and never throws, so a webhook can still acknowledge", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeRpcDb({ enqueue_channel_job: { error: { message: "connection reset" } } });
    expect(await enqueueChannelJob(db, { agencyId: AGENCY, kind: "ENRICH" })).toEqual({ ok: false, error: "connection reset" });
    const throwing = { rpc: async () => { throw new Error("network down"); } } as never;
    expect(await enqueueChannelJob(throwing, { agencyId: AGENCY, kind: "ENRICH" })).toEqual({ ok: false, error: "network down" });
  });
});

describe("claimChannelJobs", () => {
  it("passes the fair-share parameters through and maps rows to typed jobs carrying the claiming worker", async () => {
    const { db, calls } = fakeRpcDb({ claim_channel_jobs: { data: [jobRow()] } });
    const jobs = await claimChannelJobs(db, { lane: "REALTIME", workerId: "w-1", limit: 20, perAgencyCap: 10 });
    expect(calls[0].args).toEqual({ p_lane: "REALTIME", p_worker_id: "w-1", p_limit: 20, p_per_agency_cap: 10, p_lease_seconds: 90 });
    expect(jobs).toEqual([
      { id: JOB, agencyId: AGENCY, lane: "REALTIME", kind: "ENRICH", coalesceKey: `enrich:${JOB}`, payload: { conversationId: JOB }, attempts: 1, maxAttempts: 3, workerId: "w-1" },
    ]);
  });

  it("leases each lane for longer than its drains ever run a job, and lets a caller override it", async () => {
    // A shard gives a lane 45 s; the lease must outlast that so a healthy worker is never treated as dead.
    expect(LEASE_SECONDS.REALTIME).toBeGreaterThan(45);
    expect(LEASE_SECONDS.STANDARD).toBeGreaterThan(LEASE_SECONDS.REALTIME - 1);
    expect(LEASE_SECONDS.BULK).toBeGreaterThanOrEqual(LEASE_SECONDS.STANDARD);
    // ...but far shorter than the 5-minute blanket it replaces, so a dead worker's job is recovered quickly.
    for (const seconds of Object.values(LEASE_SECONDS)) expect(seconds).toBeLessThan(STALE_LOCK_SECONDS);

    const bulk = fakeRpcDb({ claim_channel_jobs: { data: [] } });
    await claimChannelJobs(bulk.db, { lane: "BULK", workerId: "w-1", limit: 5, perAgencyCap: 2 });
    expect(bulk.calls[0].args).toMatchObject({ p_lease_seconds: LEASE_SECONDS.BULK });
    const custom = fakeRpcDb({ claim_channel_jobs: { data: [] } });
    await claimChannelJobs(custom.db, { lane: "BULK", workerId: "w-1", limit: 5, perAgencyCap: 2, leaseSeconds: 30 });
    expect(custom.calls[0].args).toMatchObject({ p_lease_seconds: 30 });
  });

  it("skips a malformed row instead of letting it crash the drain, and returns [] on an RPC error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mixed = fakeRpcDb({ claim_channel_jobs: { data: [jobRow({ kind: "DO_MAGIC" }), jobRow({ id: "3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e60" })] } });
    expect(await claimChannelJobs(mixed.db, { lane: "REALTIME", workerId: "w", limit: 5, perAgencyCap: 5 })).toHaveLength(1);
    const failing = fakeRpcDb({ claim_channel_jobs: { error: { message: "boom" } } });
    expect(await claimChannelJobs(failing.db, { lane: "REALTIME", workerId: "w", limit: 5, perAgencyCap: 5 })).toEqual([]);
  });
});

describe("complete / fail / release", () => {
  it("completes only for the owning worker (the RPC's answer is authoritative)", async () => {
    const yes = fakeRpcDb({ complete_channel_job: { data: true } });
    const no = fakeRpcDb({ complete_channel_job: { data: false } });
    expect(await completeChannelJob(yes.db, { id: JOB, workerId: "w-1" })).toBe(true);
    expect(await completeChannelJob(no.db, { id: JOB, workerId: "someone-else" })).toBe(false);
    expect(yes.calls[0].args).toEqual({ p_id: JOB, p_worker_id: "w-1" });
  });

  it("fail sends an exponential backoff based on attempts and returns the resulting status", async () => {
    const requeued = fakeRpcDb({ fail_channel_job: { data: "QUEUED" } });
    expect(await failChannelJob(requeued.db, { id: JOB, workerId: "w", attempts: 3 }, new Error("model timeout"))).toBe("QUEUED");
    expect(requeued.calls[0].args).toMatchObject({ p_error: "model timeout", p_backoff_seconds: 60 });

    const dead = fakeRpcDb({ fail_channel_job: { data: "DEAD" } });
    expect(await failChannelJob(dead.db, { id: JOB, workerId: "w", attempts: 3 }, "gave up")).toBe("DEAD");

    const foreign = fakeRpcDb({ fail_channel_job: { data: null } });
    expect(await failChannelJob(foreign.db, { id: JOB, workerId: "w", attempts: 1 }, "x")).toBeNull();
  });

  it("releaseStaleLocks returns the released count, defaults to five minutes, and returns 0 on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = fakeRpcDb({ release_stale_channel_jobs: { data: 2 } });
    expect(await releaseStaleLocks(ok.db)).toBe(2);
    expect(ok.calls[0].args).toEqual({ p_older_than_seconds: 300 });
    const bad = fakeRpcDb({ release_stale_channel_jobs: { error: { message: "x" } } });
    expect(await releaseStaleLocks(bad.db)).toBe(0);
  });
});

describe("depthByLane", () => {
  it("counts QUEUED jobs per lane", async () => {
    const counts: Record<string, number> = { REALTIME: 7, STANDARD: 3, BULK: 0 };
    const db = {
      from: () => {
        let lane = "";
        const builder = {
          select: () => builder,
          eq: (column: string, value: string) => {
            if (column === "lane") lane = value;
            return column === "status" ? Promise.resolve({ count: counts[lane], error: null }) : builder;
          },
        };
        return builder;
      },
    } as never;
    expect(await depthByLane(db)).toEqual({ REALTIME: 7, STANDARD: 3, BULK: 0 });
  });
});

describe("the migration keeps the queue closed to signed-in sessions", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202090200_mi1_1_channel_jobs.sql"), "utf8");

  it("enables RLS in the same migration, with a read-only own-agency policy", () => {
    expect(sql).toMatch(/alter table public\.channel_jobs enable row level security/);
    expect(sql).toMatch(/for select to authenticated\s+using \(agency_id = public\.current_agency_id\(\)\)/);
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/);
  });

  it("every function is security definer with an empty search_path and service_role-only EXECUTE", () => {
    const definers = sql.match(/security definer\s+set search_path = ''/g) ?? [];
    expect(definers).toHaveLength(5);
    expect(sql).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function %s to service_role/);
  });

  it("has the coalescing unique index and both claim indexes", () => {
    expect(sql).toMatch(/unique index if not exists channel_jobs_coalesce_uidx[\s\S]*where status = 'QUEUED'/);
    expect(sql).toMatch(/channel_jobs_claim_idx on public\.channel_jobs \(lane, status, run_after, priority desc\)/);
    expect(sql).toMatch(/channel_jobs_agency_status_idx on public\.channel_jobs \(agency_id, status\)/);
  });
});
