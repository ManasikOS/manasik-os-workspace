import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { releaseUnreachedOutboxRows } from "@/lib/inbox/outbox/drain";
import { releaseClaimedJobs } from "./whatsapp-repository";

function recordingDb() {
  const calls: Array<{ table: string; patch: unknown; filters: Array<[string, unknown]> }> = [];
  const db = {
    from: (table: string) => ({
      update: (patch: unknown) => {
        const call = { table, patch, filters: [] as Array<[string, unknown]> };
        calls.push(call);
        const chain: Record<string, unknown> = {
          in: (column: string, value: unknown) => (call.filters.push([`in:${column}`, value]), chain),
          eq: (column: string, value: unknown) => (call.filters.push([column, value]), chain),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  };
  return { db, calls };
}

describe("releaseClaimedJobs", () => {
  it("re-queues only this worker's still-running jobs and spends no attempt", async () => {
    const { db, calls } = recordingDb();
    await releaseClaimedJobs(db as never, "worker-1", ["a", "b"]);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("agent_jobs");
    expect(calls[0].patch).toEqual({ status: "QUEUED", locked_at: null, locked_by: null });
    expect(calls[0].filters).toEqual([["in:id", ["a", "b"]], ["status", "RUNNING"], ["locked_by", "worker-1"]]);
  });

  it("does nothing for an empty list", async () => {
    const { db, calls } = recordingDb();
    await releaseClaimedJobs(db as never, "worker-1", []);
    expect(calls).toHaveLength(0);
  });
});

describe("releaseUnreachedOutboxRows", () => {
  it("refunds the claim's attempt and stays scoped to the agency and the worker", async () => {
    const { db, calls } = recordingDb();
    await releaseUnreachedOutboxRows(db as never, "worker-1", [
      { id: "row-1", agency_id: "agency-1", attempts: 2 },
      { id: "row-2", agency_id: "agency-2", attempts: 1 },
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0].patch).toEqual({ status: "QUEUED", locked_at: null, locked_by: null, attempts: 1 });
    expect(calls[1].patch).toMatchObject({ attempts: 0 });
    expect(calls[0].filters).toEqual([["id", "row-1"], ["agency_id", "agency-1"], ["status", "RUNNING"], ["locked_by", "worker-1"]]);
    expect(calls[1].filters).toContainEqual(["agency_id", "agency-2"]);
  });
});
