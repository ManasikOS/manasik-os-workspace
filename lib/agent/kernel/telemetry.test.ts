import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fakeSupabase, opsOn } from "@/lib/test-utils/fake-supabase";

const { recordAgentRun } = await import("./telemetry");

const base = {
  agencyId: "agency-1",
  conversationId: "conv-1",
  jobId: "job-1",
  model: "m",
  effort: "low",
  usage: { input: 10, output: 5, cacheRead: 3, cacheCreation: 1 },
  latencyMs: 1234,
  status: "OK",
  stopReason: "end_turn",
};

async function insertedRow(extra: Record<string, unknown>) {
  const { db, operations } = fakeSupabase((op) => (op.table === "agent_runs" ? { data: { id: "run-1" }, error: null } : undefined));
  await expect(recordAgentRun(db, { ...base, ...extra })).resolves.toBe("run-1");
  return opsOn(operations, "agent_runs", "insert")[0].payload as Record<string, unknown>;
}

describe("recordAgentRun — channel", () => {
  it("records Messenger and Instagram turns against their channel", async () => {
    expect((await insertedRow({ channel: "MESSENGER" })).channel).toBe("MESSENGER");
    expect((await insertedRow({ channel: "INSTAGRAM" })).channel).toBe("INSTAGRAM");
  });

  it("leaves a WhatsApp row exactly as before: no channel column is sent (the column defaults to WHATSAPP)", async () => {
    const withChannel = await insertedRow({ channel: "WHATSAPP" });
    const without = await insertedRow({});
    expect(withChannel).not.toHaveProperty("channel");
    expect(without).not.toHaveProperty("channel");
    expect(withChannel).toEqual(without);
  });

  it("records the latency the 30-second check is read from", async () => {
    expect((await insertedRow({ channel: "MESSENGER", latencyMs: 8123 })).latency_ms).toBe(8123);
  });
});
