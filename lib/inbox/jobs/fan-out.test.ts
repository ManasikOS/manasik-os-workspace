import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const processLane = vi.fn();
const depthByLane = vi.fn();
vi.mock("@/lib/inbox/jobs/drain", () => ({ processLane, CRON_LANE_BUDGETS_MS: { REALTIME: 20_000, STANDARD: 20_000, BULK: 8_000 } }));
vi.mock("@/lib/inbox/jobs/queue", () => ({ depthByLane }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/inbox/intelligence/register-handlers", () => ({}));

const { FAN_OUT_DEPTH_THRESHOLD, MAX_SHARDS, parseLaneParam, parseShardParam, planShardCount } = await import("./fan-out");
const { GET } = await import("@/app/api/cron/inbox-lanes/route");

const SECRET = "test-secret";
const call = (query: string, authorization: string | null = `Bearer ${SECRET}`) =>
  GET(new NextRequest(`https://crm.example/api/cron/inbox-lanes${query}`, { headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  processLane.mockReset().mockResolvedValue({ lane: "REALTIME", claimed: 0, processed: 0 });
  depthByLane.mockReset().mockResolvedValue({ REALTIME: 0, STANDARD: 0, BULK: 0 });
});

describe("planShardCount", () => {
  it("does not fan out at or below the threshold", () => {
    expect(planShardCount(0)).toBe(0);
    expect(planShardCount(FAN_OUT_DEPTH_THRESHOLD)).toBe(0);
    expect(planShardCount(Number.NaN)).toBe(0);
  });

  it("fans out to at least two shards above the threshold and scales with depth", () => {
    expect(planShardCount(FAN_OUT_DEPTH_THRESHOLD + 1)).toBe(2);
    expect(planShardCount(450)).toBe(5);
  });

  it("never exceeds the shard ceiling — a 2 000-job backlog is 8 wide, not 20", () => {
    expect(planShardCount(2000)).toBe(MAX_SHARDS);
    expect(planShardCount(1_000_000)).toBe(MAX_SHARDS);
  });
});

describe("query parameters are validated, not coerced", () => {
  it("lane must be one of the three", () => {
    expect(parseLaneParam("REALTIME")).toBe("REALTIME");
    expect(parseLaneParam("realtime")).toBeNull();
    expect(parseLaneParam("../etc")).toBeNull();
    expect(parseLaneParam(null)).toBeNull();
  });

  it("shard must be a small non-negative integer", () => {
    expect(parseShardParam("0")).toBe(0);
    expect(parseShardParam("7")).toBe(7);
    for (const bad of ["8", "-1", "1.5", "abc", "", "007x", "100"]) expect(parseShardParam(bad)).toBeNull();
    expect(parseShardParam(null)).toBeNull();
  });
});

describe("GET /api/cron/inbox-lanes", () => {
  it("answers 401 to an unauthenticated request and does no work", async () => {
    expect((await call("", null)).status).toBe(401);
    expect((await call("", "Bearer wrong")).status).toBe(401);
    expect((await call("?shard=1", "Basic abc")).status).toBe(401);
    expect(processLane).not.toHaveBeenCalled();
    expect(depthByLane).not.toHaveBeenCalled();
  });

  it("answers 500 rather than accepting anything when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("", "Bearer undefined")).status).toBe(500);
    expect(processLane).not.toHaveBeenCalled();
  });

  it("rejects an unknown lane and an invalid shard with 400", async () => {
    expect((await call("?lane=FAST")).status).toBe(400);
    expect((await call("?lane=REALTIME&shard=99")).status).toBe(400);
    expect(processLane).not.toHaveBeenCalled();
  });

  it("a shard request drains its lane once and does not look at queue depth or fan out further", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await call("?lane=REALTIME&shard=3");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "shard", shard: 3 });
    expect(processLane).toHaveBeenCalledTimes(1);
    expect(depthByLane).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the coordinator drains inline when depth is under the threshold", async () => {
    depthByLane.mockResolvedValue({ REALTIME: FAN_OUT_DEPTH_THRESHOLD, STANDARD: 0, BULK: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const body = await (await call("")).json();
    expect(body).toMatchObject({ mode: "inline", depth: FAN_OUT_DEPTH_THRESHOLD });
    // REALTIME, then BULK (media) in the same minute-by-minute invocation.
    expect(processLane.mock.calls.map(([lane]) => lane)).toEqual(["REALTIME", "BULK"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the coordinator fans a 2 000-job backlog out to eight shards, forwarding the secret, and drains nothing itself", async () => {
    depthByLane.mockResolvedValue({ REALTIME: 2000, STANDARD: 0, BULK: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const body = await (await call("")).json();
    expect(body).toMatchObject({ mode: "fan-out", shards: MAX_SHARDS, failedShards: 0 });
    expect(processLane).not.toHaveBeenCalled();
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(MAX_SHARDS);
    expect(new Set(urls).size).toBe(MAX_SHARDS);
    expect(urls.every((url) => url.startsWith("https://crm.example/api/cron/inbox-lanes?lane=REALTIME&shard="))).toBe(true);
    for (const [, init] of fetchSpy.mock.calls) expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    fetchSpy.mockRestore();
  });

  it("reports failed shards instead of hiding them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    depthByLane.mockResolvedValue({ REALTIME: 500, STANDARD: 0, BULK: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const body = await (await call("")).json();
    expect(body.failedShards).toBe(body.shards);
    fetchSpy.mockRestore();
  });

  it("never fans out a non-REALTIME lane", async () => {
    depthByLane.mockResolvedValue({ REALTIME: 0, STANDARD: 5000, BULK: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const body = await (await call("?lane=STANDARD")).json();
    expect(body.mode).toBe("inline");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
