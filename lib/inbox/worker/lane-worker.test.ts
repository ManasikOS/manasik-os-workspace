import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => { throw new Error("tests inject a db"); } }));

const { createLaneWorker } = await import("./lane-worker");
const { deferred, fakeQueueDb, jobUuid, until } = await import("./test-support");

const seed = (count: number, extra: Record<string, unknown> = {}) => Array.from({ length: count }, (_, i) => ({ id: jobUuid(i + 1), ...extra }));

function worker(db: ReturnType<typeof fakeQueueDb>, handler: (job: { id: string }) => Promise<void>, options: Record<string, unknown> = {}) {
  return createLaneWorker({
    lane: "REALTIME",
    db: db as never,
    handlers: { REPLY: async (job) => handler(job) },
    workerId: "test-worker",
    concurrency: 3,
    perAgencyCap: 10,
    jobTimeoutMs: 5000,
    idleMinMs: 5,
    idleMaxMs: 20,
    ...options,
  });
}

describe("createLaneWorker: concurrency", () => {
  it("claims exactly as many jobs as it has free slots, never more than its concurrency at once", async () => {
    const db = fakeQueueDb(seed(6));
    let running = 0;
    let peak = 0;
    const gates = seed(6).map(() => deferred());
    const started: string[] = [];
    const w = worker(db, async (job) => {
      running += 1;
      peak = Math.max(peak, running);
      started.push(job.id);
      await gates[started.length - 1].promise;
      running -= 1;
    });
    void w.run();

    await until(() => started.length === 3, "three jobs running");
    expect(db.claimLimits[0]).toBe(3); // asked for the free slots, not for a batch of ten
    expect(w.snapshot().inFlight).toBe(3);
    expect(db.jobs.filter((job) => job.status === "QUEUED")).toHaveLength(3); // the other three stay queued for any worker

    gates[0].resolve(); // a slot frees: exactly one more is claimed
    await until(() => started.length === 4, "a fourth job starts as soon as a slot frees");
    expect(db.claimLimits).toContain(1);

    for (const gate of gates) gate.resolve();
    await until(() => db.jobs.every((job) => job.status === "DONE"), "every job done");
    expect(peak).toBeLessThanOrEqual(3);
    await w.stop(100);
    expect(w.snapshot()).toMatchObject({ claimed: 6, processed: 6, inFlight: 0, running: false });
  });

  it("is woken the moment a job finishes instead of sleeping out its pause", async () => {
    // concurrency 1 and a long pause: if a finished job did not wake the loop, the second job would wait out the 5 s pause.
    const db = fakeQueueDb(seed(2));
    const w = worker(db, async () => undefined, { concurrency: 1, idleMinMs: 5000, idleMaxMs: 5000 });
    void w.run();
    await until(() => db.jobs.every((job) => job.status === "DONE"), "both jobs done well inside the pause", 1500);
    await w.stop(100);
  });

  it("takes a burst back to back and polls an empty lane with a pause that grows", async () => {
    const db = fakeQueueDb([]);
    const pauses: number[] = [];
    const w = worker(db, async () => undefined, {
      idleMinMs: 10,
      idleMaxMs: 80,
      sleep: async (ms: number) => {
        pauses.push(ms);
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    });
    void w.run();
    await until(() => pauses.length >= 6, "several empty polls");
    await w.stop(50);
    expect(pauses.slice(0, 4)).toEqual([10, 20, 40, 80]);
    expect(Math.max(...pauses)).toBe(80); // capped: an idle lane is polled a few times a second, not more
  });
});

describe("createLaneWorker: how jobs end", () => {
  it("fails a throwing handler's job for retry and keeps the lane moving", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeQueueDb(seed(2));
    const w = worker(db, async (job) => {
      if (job.id === jobUuid(1)) throw new Error("model unavailable");
    });
    void w.run();
    await until(() => w.snapshot().processed === 1 && w.snapshot().retried === 1, "one done, one retried");
    expect(db.jobs.find((job) => job.id === jobUuid(1))?.status).toBe("QUEUED");
    expect(db.jobs.find((job) => job.id === jobUuid(2))?.status).toBe("DONE");
    await w.stop(50);
  });

  it("does not let a job that never returns hold its slot: it is failed at the per-job timeout", async () => {
    const db = fakeQueueDb(seed(1));
    const w = worker(db, () => new Promise<void>(() => undefined), { jobTimeoutMs: 60 });
    void w.run();
    await until(() => w.snapshot().timedOut === 1, "the job to time out");
    await until(() => w.snapshot().inFlight === 0, "the slot to be freed");
    // It used its whole budget, so it is genuinely slow: failed for retry (an attempt spent), not handed back for free.
    expect(db.jobs[0].attempts).toBe(1);
    expect(db.jobs[0].status).toBe("QUEUED");
    await w.stop(50);
  });

  it("fails a job whose kind has no handler, loudly, instead of consuming it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeQueueDb([{ id: jobUuid(1), kind: "RISK_SCAN", max_attempts: 1 }]);
    const w = worker(db, async () => undefined);
    void w.run();
    await until(() => w.snapshot().unhandled === 1, "the unhandled kind to be reported");
    expect(db.jobs[0].status).toBe("DEAD");
    await w.stop(50);
  });
});

describe("createLaneWorker: shutdown", () => {
  it("lets running jobs finish inside the grace period and hands nothing back", async () => {
    const db = fakeQueueDb(seed(2));
    const gate = deferred();
    const w = worker(db, async () => gate.promise);
    void w.run();
    await until(() => w.snapshot().inFlight === 2, "both jobs running");

    const stopping = w.stop(1000);
    setTimeout(() => gate.resolve(), 30);
    expect(await stopping).toEqual({ released: 0 });
    expect(db.jobs.every((job) => job.status === "DONE")).toBe(true);
  });

  it("hands jobs that outlast the grace period straight back, with the attempt refunded, so a deploy never strands them", async () => {
    const db = fakeQueueDb(seed(2));
    const w = worker(db, () => new Promise<void>(() => undefined));
    void w.run();
    await until(() => w.snapshot().inFlight === 2, "both jobs running");

    expect(await w.stop(30)).toEqual({ released: 2 });
    for (const job of db.jobs) {
      expect(job.status).toBe("QUEUED");
      expect(job.attempts).toBe(0); // the claim's attempt was refunded: a restart must not push a healthy job toward dead-lettering
    }
    expect(w.snapshot().running).toBe(false);
  });

  it("stops claiming once told to stop", async () => {
    const db = fakeQueueDb(seed(1));
    const w = worker(db, async () => undefined);
    void w.run();
    await until(() => db.jobs[0].status === "DONE", "the first job done");
    await w.stop(50);
    const claimsAtStop = db.claimLimits.length;
    db.jobs.push({ id: jobUuid(9), agency_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", lane: "REALTIME", kind: "REPLY", coalesce_key: null, payload: {}, attempts: 0, max_attempts: 3, status: "QUEUED" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(db.claimLimits.length).toBe(claimsAtStop);
    expect(db.jobs[1].status).toBe("QUEUED");
  });
});

describe("createLaneWorker: health signal", () => {
  it("keeps advancing lastLoopAt while healthy, and reports the last claim", async () => {
    const db = fakeQueueDb(seed(1));
    const w = worker(db, async () => undefined);
    expect(w.snapshot()).toMatchObject({ lastLoopAt: null, lastClaimAt: null, running: false });
    void w.run();
    await until(() => w.snapshot().lastClaimAt !== null, "a claim");
    const first = w.snapshot().lastLoopAt as number;
    await until(() => (w.snapshot().lastLoopAt as number) > first, "the loop to advance again");
    await w.stop(50);
  });
});
