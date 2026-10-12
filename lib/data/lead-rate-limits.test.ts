import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeLeadRateLimit, LEAD_RATE_LIMITS, leadRateLimitMessage, type LeadRateLimitedAction } from "./lead-rate-limits";

type RpcAnswer = { data: unknown; error: { message: string } | null };

function dbAnswering(answer: RpcAnswer | (() => never)) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return typeof answer === "function" ? answer() : answer;
    },
  };
  return { db: db as never, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("consumeLeadRateLimit", () => {
  it("sends the policy for the action and allows when the database does", async () => {
    const { db, calls } = dbAnswering({ data: { allowed: true, blocked_by: null, retry_after_seconds: 0 }, error: null });
    await expect(consumeLeadRateLimit(db, "copilot.ask")).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      {
        fn: "consume_staff_rate_limit",
        args: {
          p_action: "copilot.ask",
          p_user_limit: LEAD_RATE_LIMITS["copilot.ask"].userLimit,
          p_window_seconds: 3600,
          p_agency_limit: LEAD_RATE_LIMITS["copilot.ask"].agencyDailyLimit,
        },
      },
    ]);
  });

  it("refuses with a message that says whose allowance ran out and when it resets", async () => {
    const user = dbAnswering({ data: { allowed: false, blocked_by: "USER", retry_after_seconds: 600 }, error: null });
    const byUser = await consumeLeadRateLimit(user.db, "lead.import");
    expect(byUser).toMatchObject({ ok: false });
    expect((byUser as { error: string }).error).toMatch(/hourly allowance of imports.*10 minutes/);

    const agency = dbAnswering({ data: { allowed: false, blocked_by: "AGENCY", retry_after_seconds: 7200 }, error: null });
    const byAgency = await consumeLeadRateLimit(agency.db, "copilot.analyse_enquiry");
    expect((byAgency as { error: string }).error).toMatch(/Your agency has used today's allowance.*2 hours/);
  });

  it("lets the cheap actions through, and refuses the paid ones, when the limiter cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down = () => dbAnswering({ data: null, error: { message: "boom" } });

    expect(await consumeLeadRateLimit(down().db, "lead.duplicate_check")).toEqual({ ok: true });
    expect(await consumeLeadRateLimit(down().db, "lead.import")).toEqual({ ok: true });
    expect(await consumeLeadRateLimit(down().db, "copilot.ask")).toMatchObject({ ok: false });
    expect(await consumeLeadRateLimit(down().db, "copilot.draft_reply")).toMatchObject({ ok: false });
  });

  it("treats a thrown error like an unreachable limiter", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = dbAnswering(() => {
      throw new Error("network down");
    });
    expect(await consumeLeadRateLimit(db, "lead.duplicate_check")).toEqual({ ok: true });
    expect(await consumeLeadRateLimit(db, "copilot.ask")).toMatchObject({ ok: false });
  });

  it("only bills the agency for actions that cost money", () => {
    const billed = (Object.keys(LEAD_RATE_LIMITS) as LeadRateLimitedAction[]).filter((action) => LEAD_RATE_LIMITS[action].agencyDailyLimit !== null);
    expect(billed.sort()).toEqual(["copilot.analyse_enquiry", "copilot.ask", "copilot.draft_reply"]);
  });
});

describe("leadRateLimitMessage", () => {
  it("says one minute, not one minutes", () => {
    expect(leadRateLimitMessage("lead.import", "USER", 30)).toMatch(/1 minute\./);
  });
});
