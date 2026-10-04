import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";

import { GET } from "./route";

const SECRET_VALUES = {
  CRON_SECRET: "cron-secret-VALUE-abcdef123456",
  SUPABASE_SECRET_KEY: "service-key-VALUE-abcdef123456",
  META_APP_SECRET: "meta-secret-VALUE-abcdef123456",
  NEXT_PUBLIC_SUPABASE_URL: "https://projectref-xyz.supabase.co",
};

function request(authorization?: string): NextRequest {
  return new NextRequest("https://example.test/api/health/config", { headers: authorization ? { authorization } : {} });
}

beforeEach(() => {
  for (const [name, value] of Object.entries(SECRET_VALUES)) vi.stubEnv(name, value);
  vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
  vi.stubEnv("META_GRAPH_VERSION", "v25.0");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health/config", () => {
  it("answers 500, saying nothing else, when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = GET(request("Bearer anything"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "CRON_SECRET is not configured" });
  });

  it.each([[undefined], ["Bearer wrong"], ["cron-secret-VALUE-abcdef123456"], ["Basic cron-secret-VALUE-abcdef123456"]])("answers 401 for %j", async (header) => {
    const response = GET(request(header));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("reports the environment, the build and the variables to a caller with the secret", async () => {
    const response = GET(request(`Bearer ${SECRET_VALUES.CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ build: "0123456", environment: "staging", ready: expect.any(Boolean) });
    expect(body.variables.find((v: { name: string }) => v.name === "META_GRAPH_VERSION")).toMatchObject({ present: true, value: "v25.0" });
  });

  it("never returns a secret or identifier value, even to an authorised caller", async () => {
    const text = JSON.stringify(await GET(request(`Bearer ${SECRET_VALUES.CRON_SECRET}`)).json());
    for (const value of Object.values(SECRET_VALUES)) expect(text).not.toContain(value);
    expect(text).not.toContain("projectref-xyz");
  });

  it("answers 200 with ready false and the problems when the configuration is incomplete", async () => {
    const body = await GET(request(`Bearer ${SECRET_VALUES.CRON_SECRET}`)).json();
    expect(body.ready).toBe(false);
    expect(body.problems).toEqual(expect.arrayContaining(["META_APP_ID is not set."]));
  });
});

describe("proxy", () => {
  it("lets the gate reach the route without a sign-in, because /api/health is a machine route", () => {
    const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(proxy).toMatch(/const MACHINE_ROUTES = \[[^\]]*"\/api\/health"/);
  });
});
