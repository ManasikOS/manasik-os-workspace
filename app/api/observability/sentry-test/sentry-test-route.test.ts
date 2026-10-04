import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null, role: "ADMIN" as string }));
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(() => "event-123"),
  flush: vi.fn(async () => true),
  options: { dsn: "https://key@example.ingest.sentry.io/1", environment: "staging" } as { dsn?: string; environment?: string },
}));

vi.mock("@/lib/dal", () => ({ getUser: async () => session.user }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: session.role }) }));
vi.mock("@sentry/nextjs", () => ({
  getClient: () => ({ getOptions: () => sentry.options }),
  captureException: sentry.captureException,
  flush: sentry.flush,
}));

import { GET } from "./route";

beforeEach(() => {
  session.user = { id: "user-1" };
  session.role = "ADMIN";
  sentry.options = { dsn: "https://key@example.ingest.sentry.io/1", environment: "staging" };
  sentry.captureException.mockClear();
  sentry.flush.mockClear();
  sentry.flush.mockResolvedValue(true);
});

describe("GET /api/observability/sentry-test", () => {
  it("refuses a visitor who is not signed in and sends nothing", async () => {
    session.user = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user who is not an ADMIN and sends nothing", async () => {
    session.role = "OPERATIONS";
    const response = await GET();
    expect(response.status).toBe(403);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("sends one tagged test event for an ADMIN and reports the environment", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.flush).toHaveBeenCalled();
    expect(await response.json()).toEqual({ sent: true, dsnConfigured: true, flushed: true, environment: "staging", eventId: "event-123" });
  });

  it("says plainly when no DSN is configured, instead of claiming success", async () => {
    sentry.options = { environment: "staging" };
    const body = await (await GET()).json();
    expect(body.dsnConfigured).toBe(false);
    expect(body.sent).toBe(false);
  });

  it("says plainly when the event could not be flushed", async () => {
    sentry.flush.mockResolvedValue(false);
    const body = await (await GET()).json();
    expect(body.flushed).toBe(false);
    expect(body.sent).toBe(false);
  });
});

describe("proxy", () => {
  it("keeps the test route behind the normal sign-in", () => {
    const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(proxy).toMatch(/const MACHINE_ROUTES = \[[^\]]*\]/);
    expect(proxy.match(/const MACHINE_ROUTES = \[([^\]]*)\]/)?.[1]).not.toContain("/api/observability");
  });
});
