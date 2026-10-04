import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const handoffSweep = vi.fn();
const quietSweep = vi.fn();
vi.mock("@/lib/followups/handoff-alert-sweep", () => ({ runHandoffAlertSweep: (...args: unknown[]) => handoffSweep(...args) }));
vi.mock("@/lib/followups/quiet-lead-sweep", () => ({ runQuietLeadSweep: (...args: unknown[]) => quietSweep(...args) }));
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: async () => ({ data: [{ id: "agency-a" }, { id: "agency-b" }], error: null }) }) }),
}));

const SECRET = "test-secret";

function requestWith(header?: string) {
  return { headers: new Headers(header ? { authorization: header } : {}) } as never;
}

async function callRoute(header?: string) {
  const { GET } = await import("@/app/api/cron/lead-followups/route");
  return GET(requestWith(header));
}

describe("GET /api/cron/lead-followups", () => {
  beforeEach(() => {
    vi.resetModules();
    handoffSweep.mockReset();
    quietSweep.mockReset();
    handoffSweep.mockResolvedValue({ waiting: 0, alertsSent: 1, escalationsSent: 0, failed: 0 });
    quietSweep.mockResolvedValue({ considered: 0, sent: 0, dryRun: 2, skipped: 0, failed: 0 });
    process.env.CRON_SECRET = SECRET;
  });

  it("rejects a missing or wrong secret without touching any data", async () => {
    expect((await callRoute()).status).toBe(401);
    expect((await callRoute("Bearer nope")).status).toBe(401);
    expect(handoffSweep).not.toHaveBeenCalled();
    expect(quietSweep).not.toHaveBeenCalled();
  });

  it("refuses to run when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await callRoute("Bearer undefined")).status).toBe(500);
  });

  it("runs both sweeps once per agency, each scoped to that agency's id, and returns counts only", async () => {
    const response = await callRoute(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(handoffSweep.mock.calls.map((call) => call[1])).toEqual(["agency-a", "agency-b"]);
    expect(quietSweep.mock.calls.map((call) => call[1])).toEqual(["agency-a", "agency-b"]);
    expect(await response.json()).toEqual({
      agencies: 2,
      failedAgencies: 0,
      alertsSent: 2,
      escalationsSent: 0,
      nudgesSent: 0,
      nudgesDryRun: 4,
      nudgesSkipped: 0,
      nudgesFailed: 0,
    });
  });

  it("keeps going for other agencies when one agency fails", async () => {
    handoffSweep.mockRejectedValueOnce(new Error("boom"));
    const response = await callRoute(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(handoffSweep).toHaveBeenCalledTimes(2);
    expect(quietSweep).toHaveBeenCalledTimes(2);
    expect((await response.json()).failedAgencies).toBe(1);
  });
});
