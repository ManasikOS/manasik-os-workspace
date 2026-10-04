import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ result: { error: null } as { error: { code?: string; message: string } | null }, throws: false }));

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        limit: () => ({
          abortSignal: async () => {
            if (database.throws) throw new Error("fetch failed: https://secret-host.supabase.co");
            return database.result;
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/observability/report-error", () => ({ reportHandledError: vi.fn() }));

import { GET as liveness } from "./route";
import { GET as readiness } from "./ready/route";

beforeEach(() => {
  database.result = { error: null };
  database.throws = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/health (liveness)", () => {
  it("answers 200 with a status and build id, and touches no database", async () => {
    const response = liveness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", build: expect.any(String) });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/health/ready (readiness)", () => {
  it("answers 200 when the database answers", async () => {
    const response = await readiness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", checks: { database: true } });
  });

  it("answers 503 when the database returns an error, without leaking its text", async () => {
    database.result = { error: { code: "57P03", message: "connection to db.secret-host.supabase.co refused" } };
    const response = await readiness();
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toBe(JSON.stringify({ status: "not_ready", checks: { database: false } }));
    expect(text).not.toContain("secret-host");
  });

  it("answers 503 when the database cannot be reached at all, without leaking the host", async () => {
    database.throws = true;
    const response = await readiness();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
  });
});

describe("proxy", () => {
  it("lets health checks through without a sign-in", () => {
    const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(proxy).toMatch(/const MACHINE_ROUTES = \[[^\]]*"\/api\/health"/);
  });
});
