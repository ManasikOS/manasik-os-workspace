import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => { throw new Error("tests inject a db"); } }));

const { WORKER_LANES, WorkerConfigError, checkWorkerEnvironment, loadWorkerConfig } = await import("./config");
const { HEARTBEAT_STALE_MS, createHealthServer, evaluateWorkerHealth } = await import("./health-server");
const { isInboxWorkerActive } = await import("./mode");
const { LEASE_SECONDS } = await import("@/lib/inbox/jobs/queue");

describe("loadWorkerConfig", () => {
  it("defaults to a concurrency sized for the 500 messages/minute target, and timeouts safely under each lease", () => {
    const config = loadWorkerConfig({});
    expect(config.concurrency).toEqual({ REALTIME: 40, STANDARD: 10, BULK: 4 });
    expect(config.drainOutbox).toBe(true);
    expect(config.drainAgentJobs).toBe(true);
    expect(config.port).toBe(8080);
    for (const lane of WORKER_LANES) {
      // A worker must give a job up before its lease can lapse and hand the job to someone else.
      expect(config.jobTimeoutMs[lane]).toBeLessThan(LEASE_SECONDS[lane] * 1000);
    }
  });

  it("reads overrides, taking the port from PORT unless WORKER_PORT is set", () => {
    const config = loadWorkerConfig({ WORKER_CONCURRENCY_REALTIME: "80", WORKER_PER_AGENCY_CAP_BULK: "3", WORKER_DRAIN_OUTBOX: "false", PORT: "9000" });
    expect(config.concurrency.REALTIME).toBe(80);
    expect(config.perAgencyCap.BULK).toBe(3);
    expect(config.drainOutbox).toBe(false);
    expect(config.port).toBe(9000);
    expect(loadWorkerConfig({ PORT: "9000", WORKER_PORT: "9100" }).port).toBe(9100);
  });

  it("refuses a job timeout that outlives the lease, because the job would be run twice", () => {
    expect(() => loadWorkerConfig({ WORKER_JOB_TIMEOUT_MS_REALTIME: "90000" })).toThrow(/lease is 90 s/);
    expect(() => loadWorkerConfig({ WORKER_JOB_TIMEOUT_MS_REALTIME: "85000" })).not.toThrow(); // 5 s of margin
  });

  it("reports every problem at once, so a bad deployment is fixed in one pass", () => {
    try {
      loadWorkerConfig({ WORKER_CONCURRENCY_REALTIME: "0", WORKER_CONCURRENCY_BULK: "many", WORKER_DRAIN_OUTBOX: "maybe", PORT: "99999" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerConfigError);
      const problems = (error as InstanceType<typeof WorkerConfigError>).problems;
      expect(problems).toHaveLength(4);
      expect(problems.join("\n")).toMatch(/WORKER_CONCURRENCY_REALTIME/);
      expect(problems.join("\n")).toMatch(/WORKER_CONCURRENCY_BULK/);
      expect(problems.join("\n")).toMatch(/WORKER_DRAIN_OUTBOX/);
      expect(problems.join("\n")).toMatch(/PORT/);
    }
  });
});

describe("checkWorkerEnvironment", () => {
  it("names what is missing and never echoes a value", () => {
    const secret = "sb_secret_do_not_print";
    const result = checkWorkerEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: secret });
    expect(result.missing).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/OPENROUTER_API_KEY/);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(checkWorkerEnvironment({}).missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
    expect(checkWorkerEnvironment({ NEXT_PUBLIC_SUPABASE_URL: " ", SUPABASE_SECRET_KEY: "k", OPENROUTER_API_KEY: "k" }).missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });
});

describe("isInboxWorkerActive", () => {
  it("is off unless explicitly switched on", () => {
    expect(isInboxWorkerActive({})).toBe(false);
    expect(isInboxWorkerActive({ INBOX_WORKER_ACTIVE: "" })).toBe(false);
    expect(isInboxWorkerActive({ INBOX_WORKER_ACTIVE: "0" })).toBe(false);
    expect(isInboxWorkerActive({ INBOX_WORKER_ACTIVE: "no" })).toBe(false);
    for (const on of ["1", "true", "TRUE", " yes ", "on"]) expect(isInboxWorkerActive({ INBOX_WORKER_ACTIVE: on })).toBe(true);
  });
});

const lane = (name: "REALTIME" | "STANDARD" | "BULK", lastLoopAt: number | null) => ({
  lane: name, running: true, inFlight: 0, concurrency: 1, claimed: 0, processed: 0, retried: 0, deadLettered: 0, timedOut: 0, unhandled: 0, lastClaimAt: null, lastLoopAt,
});

describe("evaluateWorkerHealth", () => {
  const now = 1_000_000;
  const base = { ready: true, stopping: false, startedAt: now - 600_000, aux: [] };

  it("is healthy while every loop is advancing", () => {
    const health = evaluateWorkerHealth({ ...base, lanes: [lane("REALTIME", now - 500), lane("STANDARD", now - 900), lane("BULK", now - 100)] }, now);
    expect(health).toEqual({ healthy: true, ready: true, stalled: [] });
  });

  it("names a loop that has stopped advancing (a hung claim), so the platform restarts the process", () => {
    const health = evaluateWorkerHealth({ ...base, lanes: [lane("REALTIME", now - 500), lane("BULK", now - HEARTBEAT_STALE_MS - 1)], aux: [{ name: "outbox", lastLoopAt: now - HEARTBEAT_STALE_MS - 1 }] }, now);
    expect(health.healthy).toBe(false);
    expect(health.stalled).toEqual(["lane:BULK", "aux:outbox"]);
  });

  it("gives a loop that has not made its first pass yet the time since the worker started", () => {
    const fresh = { ...base, startedAt: now - 2000 };
    expect(evaluateWorkerHealth({ ...fresh, lanes: [lane("REALTIME", null)] }, now).healthy).toBe(true);
    expect(evaluateWorkerHealth({ ...base, lanes: [lane("REALTIME", null)] }, now).healthy).toBe(false);
  });

  it("keeps a draining worker alive but not ready, so a deploy stops routing to it without killing it mid-drain", () => {
    const health = evaluateWorkerHealth({ ...base, stopping: true, lanes: [lane("REALTIME", now - 500)] }, now);
    expect(health).toMatchObject({ healthy: true, ready: false });
  });
});

describe("createHealthServer", () => {
  const status = (overrides = {}) => ({ ready: true, stopping: false, startedAt: Date.now() - 5000, aux: [], lanes: [lane("REALTIME", Date.now())], ...overrides });

  async function serve(getStatus: () => ReturnType<typeof status>) {
    const server = createHealthServer(getStatus);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as { port: number };
    return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }
  afterEach(() => undefined);

  it("answers /healthz and /readyz with counters only", async () => {
    const { base, close } = await serve(() => status());
    try {
      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);
      const body = await health.json();
      expect(body).toMatchObject({ status: "ok", ready: true, stalled: [] });
      expect(Object.keys(body.lanes[0]).sort()).toEqual(["claimed", "concurrency", "deadLettered", "inFlight", "lane", "processed", "retried", "timedOut", "unhandled"]);
      expect((await fetch(`${base}/readyz`)).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("returns 503 for liveness when a loop is stuck, and for readiness once shutdown begins", async () => {
    const stuck = await serve(() => status({ lanes: [lane("REALTIME", Date.now() - HEARTBEAT_STALE_MS - 1000)] }));
    try {
      expect((await fetch(`${stuck.base}/healthz`)).status).toBe(503);
    } finally {
      await stuck.close();
    }
    const draining = await serve(() => status({ stopping: true }));
    try {
      expect((await fetch(`${draining.base}/healthz`)).status).toBe(200);
      expect((await fetch(`${draining.base}/readyz`)).status).toBe(503);
    } finally {
      await draining.close();
    }
  });

  it("exposes nothing else: other paths are 404 with no body, and it cannot be told to do anything", async () => {
    const { base, close } = await serve(() => status());
    try {
      for (const path of ["/", "/metrics", "/jobs", "/env", "/healthz/../env"]) {
        const response = await fetch(`${base}${path}`);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe("");
      }
      expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(405);
      expect((await fetch(`${base}/healthz`, { method: "DELETE" })).status).toBe(405);
    } finally {
      await close();
    }
  });
});
