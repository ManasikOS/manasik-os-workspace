import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { meterAiConversation, utcMonthStart } = await import("./meter");

describe("AI conversation metering", () => {
  it("uses the atomic idempotent database function for retries and redelivery", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const db = { rpc } as never;
    const input = { agencyId: "00000000-0000-4000-8000-000000000001", conversationId: "00000000-0000-4000-8000-000000000002", periodStart: "2026-09-01" };
    await expect(meterAiConversation(db, input)).resolves.toBe(true);
    await expect(meterAiConversation(db, input)).resolves.toBe(false);
    expect(rpc).toHaveBeenNthCalledWith(1, "meter_ai_conversation", {
      p_agency_id: input.agencyId,
      p_conversation_id: input.conversationId,
      p_period_start: input.periodStart,
    });
  });

  it("derives the billing period as the first of the UTC month, not the local one", () => {
    expect(utcMonthStart(new Date("2026-09-20T23:30:00-05:00"))).toBe("2026-09-01");
    expect(utcMonthStart(new Date("2026-01-31T00:00:00Z"))).toBe("2026-01-01");
    expect(utcMonthStart(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-01");
  });

  it("keys the underlying table by (agency, conversation, period) so two agencies sharing a conversation UUID never collide", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202092700_mi6_4_plans_entitlements.sql"), "utf8");
    expect(sql).toMatch(/primary key \(agency_id, conversation_id, period_start\)/);
  });
});
