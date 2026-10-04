import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => { throw new Error("tests inject a db"); } }));

const { createInboxWorker } = await import("./worker-runtime");
const { loadWorkerConfig } = await import("./config");
const { deferred, fakeQueueDb, jobUuid, until } = await import("./test-support");

const smallConfig = (env: Record<string, string> = {}) =>
  loadWorkerConfig({ WORKER_CONCURRENCY_REALTIME: "2", WORKER_CONCURRENCY_STANDARD: "1", WORKER_CONCURRENCY_BULK: "1", WORKER_STALE_SWEEP_MS: "1000", WORKER_SHUTDOWN_GRACE_MS: "40", ...env });

function build(db: ReturnType<typeof fakeQueueDb>, overrides: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const worker = createInboxWorker({
    config: smallConfig(env),
    db: db as never,
    handlers: { REPLY: async () => undefined, ENRICH: async () => undefined },
    workerId: "host-1",
    releaseStale: async () => 0,
    log: (event) => logs.push(event),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
    serveHealth: false,
    ...overrides,
  });
  return { worker, logs };
}

describe("createInboxWorker", () => {
  it("runs all three lanes and reports itself ready", async () => {
    const db = fakeQueueDb([
      { id: jobUuid(1), lane: "REALTIME", kind: "REPLY" },
      { id: jobUuid(2), lane: "STANDARD", kind: "ENRICH" },
      { id: jobUuid(3), lane: "BULK", kind: "REPLY" },
    ]);
    const { worker, logs } = build(db);
    expect(worker.status().ready).toBe(false);
    await worker.start();
    expect(worker.status().ready).toBe(true);
    expect(worker.status().lanes.map((lane) => lane.lane)).toEqual(["REALTIME", "STANDARD", "BULK"]);

    await until(() => db.jobs.every((job) => job.status === "DONE"), "a job in every lane done");
    await worker.stop();
    expect(logs.map((entry) => entry.event)).toEqual(expect.arrayContaining(["worker_started", "worker_stopping", "worker_stopped"]));
  });

  it("gives each lane its own worker id, so a job is always traceable to the lane that ran it", async () => {
    const db = fakeQueueDb([{ id: jobUuid(1), lane: "REALTIME" }]);
    const { worker } = build(db);
    await worker.start();
    await until(() => db.jobs[0].status === "DONE", "the job done");
    await worker.stop();
    expect(db.jobs[0].locked_by).toBe("host-1:REALTIME");
  });

  it("stops cleanly: stops claiming, hands stuck jobs back, and reports how many", async () => {
    const db = fakeQueueDb([{ id: jobUuid(1), lane: "REALTIME" }]);
    const gate = deferred();
    const { worker, logs } = build(db, { handlers: { REPLY: async () => gate.promise } });
    await worker.start();
    await until(() => worker.status().lanes[0].inFlight === 1, "the job running");

    await worker.stop(); // grace is 40 ms; the job never finishes
    expect(db.jobs[0].status).toBe("QUEUED");
    expect(db.jobs[0].attempts).toBe(0);
    expect(worker.status()).toMatchObject({ ready: false, stopping: true });
    expect(logs.find((entry) => entry.event === "worker_stopped")).toMatchObject({ releasedJobs: 1 });
    gate.resolve();
  });

  it("sweeps expired leases at start and on a schedule, and survives a failed sweep", async () => {
    const db = fakeQueueDb([]);
    const releaseStale = vi.fn().mockRejectedValueOnce(new Error("database down")).mockResolvedValue(2);
    const { worker, logs } = build(db, { releaseStale }, { WORKER_STALE_SWEEP_MS: "1000" });
    await worker.start();
    await until(() => releaseStale.mock.calls.length >= 1, "the first sweep");
    await until(() => logs.some((entry) => entry.event === "stale_sweep_failed"), "the failure to be logged, not thrown");
    await worker.stop();
  });

  it("drains staff sends and the legacy agent jobs alongside the lanes, and can be told not to", async () => {
    const drainOutbox = vi.fn(async () => ({ processed: 0, failed: 0 }));
    const drainAgentJobs = vi.fn(async () => ({ processed: 0, failed: 0 }));
    const on = build(fakeQueueDb([]), { drainOutbox, drainAgentJobs });
    await on.worker.start();
    await until(() => drainOutbox.mock.calls.length > 0 && drainAgentJobs.mock.calls.length > 0, "both aux drains to run");
    expect(on.worker.status().aux.map((loop) => loop.name)).toEqual(["outbox", "agent_jobs"]);
    await on.worker.stop();

    const off = build(fakeQueueDb([]), { drainOutbox, drainAgentJobs }, { WORKER_DRAIN_OUTBOX: "false", WORKER_DRAIN_AGENT_JOBS: "false" });
    expect(off.worker.status().aux).toEqual([]);
  });

  it("keeps an aux drain running after it throws, logging the error", async () => {
    const drainOutbox = vi.fn().mockRejectedValueOnce(new Error("provider down")).mockResolvedValue({ processed: 0, failed: 0 });
    const { worker, logs } = build(fakeQueueDb([]), { drainOutbox }, { WORKER_DRAIN_AGENT_JOBS: "false" });
    await worker.start();
    await until(() => drainOutbox.mock.calls.length >= 2, "the drain to run again after failing");
    expect(logs.find((entry) => entry.event === "aux_drain_failed")).toMatchObject({ name: "outbox", error: "provider down" });
    await worker.stop();
  });

  it("never puts a job payload, message text or secret in a log line", async () => {
    const db = fakeQueueDb([{ id: jobUuid(1), lane: "REALTIME", payload: { conversationId: "c-1", text: "my passport number is X1234567" } }]);
    const { worker, logs } = build(db);
    await worker.start();
    await until(() => db.jobs[0].status === "DONE", "the job done");
    await worker.stop();
    const text = JSON.stringify(logs);
    expect(text).not.toContain("passport");
    expect(text).not.toContain("X1234567");
    expect(text).not.toContain("conversationId");
  });

  it("stop() is safe to call twice", async () => {
    const { worker } = build(fakeQueueDb([]));
    await worker.start();
    await worker.stop();
    await expect(worker.stop()).resolves.toBeUndefined();
  });
});
