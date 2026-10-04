import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => { throw new Error("tests inject a db"); } }));

const { processLane } = await import("./drain");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jobId = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";

/**
 * A `channel_jobs` with one job that becomes due `dueInMs` from now. `claimable: false` models a job that is due but that the claim
 * will not hand out (another worker's cap, or a reply already running for that conversation).
 */
function delayedJobDb(input: { dueInMs: number; claimable?: boolean }) {
  const dueAt = Date.now() + input.dueInMs;
  let status: "QUEUED" | "RUNNING" | "DONE" = "QUEUED";
  const claims: number[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_channel_jobs") {
        claims.push(Date.now());
        if (status === "QUEUED" && dueAt <= Date.now() && input.claimable !== false) {
          status = "RUNNING";
          return {
            data: [{ id: jobId, agency_id: AGENCY, lane: "REALTIME", kind: "REPLY", coalesce_key: "reply:c", payload: {}, attempts: 1, max_attempts: 5, locked_by: args.p_worker_id }],
            error: null,
          };
        }
        return { data: [], error: null };
      }
      if (name === "complete_channel_job") {
        status = "DONE";
        return { data: true, error: null };
      }
      if (name === "release_stale_channel_jobs") return { data: 0, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: (table: string) => {
      if (table !== "channel_jobs") throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
      chain.maybeSingle = async () => ({ data: status === "QUEUED" ? { run_after: new Date(dueAt).toISOString() } : null, error: null });
      return chain;
    },
  };
  return { db, claims, status: () => status };
}

const handlers = { REPLY: async () => undefined };

describe("processLane waiting for a job scheduled a few seconds ahead", () => {
  it("ends when nothing is due, by default: only the after-webhook drain opts in", async () => {
    const { db, status } = delayedJobDb({ dueInMs: 150 });
    const result = await processLane("REALTIME", { budgetMs: 2000, db: db as never, handlers });
    expect(result.processed).toBe(0);
    expect(status()).toBe("QUEUED");
  });

  it("waits for the settle window and then runs the reply, instead of leaving it for the once-a-minute cron", async () => {
    const { db, status } = delayedJobDb({ dueInMs: 150 });
    const result = await processLane("REALTIME", { budgetMs: 3000, db: db as never, handlers, waitForScheduledJobsMs: 1000 });
    expect(result.processed).toBe(1);
    expect(status()).toBe("DONE");
  });

  it("does not wait for a job due further ahead than it is willing to wait", async () => {
    const { db, status } = delayedJobDb({ dueInMs: 5000 });
    const startedAt = Date.now();
    const result = await processLane("REALTIME", { budgetMs: 8000, db: db as never, handlers, waitForScheduledJobsMs: 500 });
    expect(result.processed).toBe(0);
    expect(status()).toBe("QUEUED");
    expect(Date.now() - startedAt).toBeLessThan(400);
  });

  it("does not wait when the wait would run past the lane's own budget", async () => {
    const { db } = delayedJobDb({ dueInMs: 600 });
    const startedAt = Date.now();
    const result = await processLane("REALTIME", { budgetMs: 300, db: db as never, handlers, waitForScheduledJobsMs: 5000 });
    expect(result.processed).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it("ends, and does not spin, when a job is due but the claim will not hand it out", async () => {
    const { db, claims } = delayedJobDb({ dueInMs: -1000, claimable: false });
    const result = await processLane("REALTIME", { budgetMs: 2000, db: db as never, handlers, waitForScheduledJobsMs: 1000 });
    expect(result.processed).toBe(0);
    expect(claims).toHaveLength(1); // one claim attempt, then done: no polling loop
  });
});
