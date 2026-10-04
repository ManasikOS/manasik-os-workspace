import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => { throw new Error("tests inject a db"); } }));

const { processLane, processAllLanes, CRON_LANE_BUDGETS_MS } = await import("./drain");
const { DEFAULT_SETTLE_DELAY_SECONDS, enqueueEnrichForConversation, enrichCoalesceKey, settleDelaySeconds } = await import("./settle");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uuid = (n: number) => `3f1d2c4e-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`;

interface FakeJob {
  id: string;
  agency_id: string;
  lane: string;
  kind: string;
  coalesce_key: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  status: "QUEUED" | "RUNNING" | "DONE" | "DEAD";
  locked_by?: string;
}

/** An in-memory `channel_jobs` behind the same RPC surface the real queue exposes (semantics verified against Postgres separately). */
function fakeQueueDb(seed: Array<Partial<FakeJob> & { id: string }>) {
  const jobs: FakeJob[] = seed.map((job) => ({
    agency_id: AGENCY, lane: "REALTIME", kind: "ENRICH", coalesce_key: null, payload: {}, attempts: 0, max_attempts: 3, status: "QUEUED" as const, ...job,
  }));
  const rpcNames: string[] = [];
  const db = {
    jobs,
    rpcNames,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcNames.push(name);
      if (name === "claim_channel_jobs") {
        const claimed = jobs.filter((job) => job.status === "QUEUED" && job.lane === args.p_lane).slice(0, args.p_limit as number);
        for (const job of claimed) { job.status = "RUNNING"; job.locked_by = args.p_worker_id as string; job.attempts += 1; }
        return { data: claimed.map((job) => ({ ...job })), error: null };
      }
      if (name === "complete_channel_job") {
        const job = jobs.find((row) => row.id === args.p_id && row.status === "RUNNING" && row.locked_by === args.p_worker_id);
        if (job) job.status = "DONE";
        return { data: Boolean(job), error: null };
      }
      if (name === "fail_channel_job") {
        const job = jobs.find((row) => row.id === args.p_id && row.status === "RUNNING" && row.locked_by === args.p_worker_id);
        if (!job) return { data: null, error: null };
        job.status = job.attempts >= job.max_attempts ? "DEAD" : "QUEUED";
        // A retried job is backed off in Postgres; the fake removes it from this tick's reach.
        if (job.status === "QUEUED") job.lane = "BACKED_OFF";
        return { data: job.status, error: null };
      }
      if (name === "release_channel_job") {
        const job = jobs.find((row) => row.id === args.p_id && row.status === "RUNNING" && row.locked_by === args.p_worker_id);
        if (!job) return { data: false, error: null };
        job.status = "QUEUED";
        job.attempts = Math.max(job.attempts - 1, 0);
        return { data: true, error: null };
      }
      if (name === "release_stale_channel_jobs") return { data: 0, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
  return db;
}

describe("processLane", () => {
  it("runs each claimed job through the handler registered for its kind and completes it", async () => {
    const db = fakeQueueDb([{ id: uuid(1) }, { id: uuid(2), kind: "IDENTITY_MATCH" }]);
    const seen: string[] = [];
    const result = await processLane("REALTIME", {
      budgetMs: 1000,
      db: db as never,
      handlers: {
        ENRICH: async (job) => { seen.push(`enrich:${job.id}`); },
        IDENTITY_MATCH: async (job) => { seen.push(`identity:${job.id}`); },
      },
    });
    expect(seen.sort()).toEqual([`enrich:${uuid(1)}`, `identity:${uuid(2)}`]);
    expect(result).toMatchObject({ lane: "REALTIME", claimed: 2, processed: 2, retried: 0, deadLettered: 0 });
    expect(db.jobs.every((job) => job.status === "DONE")).toBe(true);
  });

  it("a throwing handler fails one job, not the tick: the others still complete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeQueueDb([{ id: uuid(1) }, { id: uuid(2) }, { id: uuid(3) }]);
    const result = await processLane("REALTIME", {
      budgetMs: 1000,
      db: db as never,
      handlers: { ENRICH: async (job) => { if (job.id === uuid(2)) throw new Error("model exploded"); } },
    });
    expect(result).toMatchObject({ claimed: 3, processed: 2, retried: 1, deadLettered: 0 });
    expect(db.jobs.find((job) => job.id === uuid(1))?.status).toBe("DONE");
    expect(db.jobs.find((job) => job.id === uuid(3))?.status).toBe("DONE");
    expect(db.jobs.find((job) => job.id === uuid(2))?.status).toBe("QUEUED");
  });

  it("dead-letters a job that has used its last attempt", async () => {
    const db = fakeQueueDb([{ id: uuid(1), attempts: 2, max_attempts: 3 }]);
    const result = await processLane("REALTIME", { budgetMs: 1000, db: db as never, handlers: { ENRICH: async () => { throw new Error("still broken"); } } });
    expect(result).toMatchObject({ retried: 0, deadLettered: 1 });
    expect(db.jobs[0].status).toBe("DEAD");
  });

  it("fails a job whose kind has no handler instead of silently consuming it", async () => {
    const db = fakeQueueDb([{ id: uuid(1), kind: "REPLAY", lane: "REALTIME" }]);
    const result = await processLane("REALTIME", { budgetMs: 1000, db: db as never, handlers: {} });
    expect(result).toMatchObject({ processed: 0, unhandled: 1, retried: 1 });
    expect(db.jobs[0].status).not.toBe("DONE");
  });

  it("respects the budget: a handler that runs long is failed for retry and the tick returns on time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeQueueDb([{ id: uuid(1) }]);
    let sawAbort = false;
    const started = Date.now();
    const result = await processLane("REALTIME", {
      budgetMs: 60,
      db: db as never,
      handlers: {
        ENRICH: (_job, context) => new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => { sawAbort = true; });
          setTimeout(resolve, 2000);
        }),
      },
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ timedOut: 1, retried: 1, processed: 0 });
    expect(sawAbort).toBe(true);
  });

  it("hands back a job the tick ended on, refunding its attempt, instead of spending one of its tries", async () => {
    const db = fakeQueueDb([{ id: uuid(1), max_attempts: 1 }, { id: uuid(2), max_attempts: 1 }]);
    const result = await processLane("REALTIME", {
      budgetMs: 200,
      batchSize: 1,
      db: db as never,
      handlers: {
        // The first job uses most of the tick; the second starts late and is cut off through no fault of its own.
        ENRICH: (job) => new Promise<void>((resolve) => setTimeout(resolve, job.id === uuid(1) ? 150 : 5000)),
      },
    });
    expect(result).toMatchObject({ processed: 1, timedOut: 1, retried: 1, deadLettered: 0 });
    const cutOff = db.jobs.find((job) => job.id === uuid(2))!;
    // max_attempts is 1: had the cutoff spent the attempt, this job would be DEAD.
    expect(cutOff.status).toBe("QUEUED");
    expect(cutOff.attempts).toBe(0);
    expect(db.rpcNames).toContain("release_channel_job");
  });

  it("still fails a slow job that used most of the tick, so a genuinely slow job cannot loop forever", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeQueueDb([{ id: uuid(1), max_attempts: 1 }]);
    const result = await processLane("REALTIME", { budgetMs: 100, db: db as never, handlers: { ENRICH: () => new Promise<void>((resolve) => setTimeout(resolve, 5000)) } });
    expect(result).toMatchObject({ timedOut: 1, deadLettered: 1 });
    expect(db.jobs[0].status).toBe("DEAD");
    expect(db.rpcNames).not.toContain("release_channel_job");
  });

  it("stops claiming once the budget is spent, leaving the rest queued", async () => {
    const seed = Array.from({ length: 12 }, (_, index) => ({ id: uuid(index + 1) }));
    const db = fakeQueueDb(seed);
    const result = await processLane("REALTIME", {
      budgetMs: 80,
      batchSize: 2,
      db: db as never,
      handlers: { ENRICH: () => new Promise<void>((resolve) => setTimeout(resolve, 30)) },
    });
    expect(result.processed).toBeGreaterThan(0);
    expect(result.processed).toBeLessThan(12);
    expect(db.jobs.some((job) => job.status === "QUEUED")).toBe(true);
  });

  it("only touches its own lane", async () => {
    const db = fakeQueueDb([{ id: uuid(1), lane: "BULK", kind: "REPLAY" }]);
    const result = await processLane("REALTIME", { budgetMs: 200, db: db as never, handlers: {} });
    expect(result.claimed).toBe(0);
    expect(db.jobs[0].status).toBe("QUEUED");
  });
});

describe("processAllLanes", () => {
  it("drains REALTIME, STANDARD and BULK in that order, each budget fits the 50 s function budget on its own, and the total deadline caps the sum", async () => {
    // The lane budgets are ceilings, not a schedule: a quiet lane returns early and `processAllLanes` never runs past its total.
    for (const budgetMs of Object.values(CRON_LANE_BUDGETS_MS)) expect(budgetMs).toBeLessThanOrEqual(50_000);
    const db = fakeQueueDb([]);
    const results = await processAllLanes({ db: db as never, totalBudgetMs: 5_000 });
    expect(results.map((result) => result.lane)).toEqual(["REALTIME", "STANDARD", "BULK"]);
  });
});

describe("settle delay and burst coalescing", () => {
  it("delays a follow-up message by the settle window but never delays first-contact triage", () => {
    expect(settleDelaySeconds({ firstContact: false })).toBe(DEFAULT_SETTLE_DELAY_SECONDS);
    expect(settleDelaySeconds({ firstContact: true })).toBe(0);
    expect(settleDelaySeconds({ firstContact: false, agencySettleSeconds: 10 })).toBe(10);
    expect(settleDelaySeconds({ firstContact: false, agencySettleSeconds: 9999 })).toBe(60);
    expect(settleDelaySeconds({ firstContact: false, agencySettleSeconds: -5 })).toBe(0);
  });

  it("a five-message burst enqueues five times with ONE coalesce key, so the queue holds one run", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const queued = new Map<string, string>();
    const db = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        calls.push(args);
        const key = `${args.p_agency_id}|${args.p_coalesce_key}`;
        if (!queued.has(key)) queued.set(key, uuid(queued.size + 1)); // the partial unique index in Postgres does this
        return { data: queued.get(key), error: null };
      },
    };
    const conversationId = uuid(99);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueueEnrichForConversation(db as never, { agencyId: AGENCY, conversationId, firstContact: false })),
    );
    expect(new Set(calls.map((call) => call.p_coalesce_key))).toEqual(new Set([enrichCoalesceKey(conversationId)]));
    expect(calls.every((call) => call.p_delay_seconds === DEFAULT_SETTLE_DELAY_SECONDS && call.p_lane === "REALTIME")).toBe(true);
    expect(queued.size).toBe(1);
    expect(new Set(results.map((result) => (result.ok ? result.jobId : null))).size).toBe(1);
  });
});
