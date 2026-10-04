import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readInboxHealthSnapshot } from "./snapshot";

type Call = { table: string; not: unknown[][] };

/** A chainable stand-in for the database client that records the `.not(...)` filters applied to each table. */
function fakeDb(options: { testAgencyIds: string[] | null }) {
  const calls: Call[] = [];
  const db = {
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      const call: Call = { table, not: [] };
      calls.push(call);
      const result =
        table === "agencies"
          ? options.testAgencyIds === null
            ? { data: null, error: { message: "denied" } }
            : { data: options.testAgencyIds.map((id) => ({ id })), error: null }
          : { data: [], error: null, count: 0 };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "lte", "lt", "gte", "order", "limit"]) chain[method] = () => chain;
      chain.not = (...args: unknown[]) => (call.not.push(args), chain);
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return chain;
    },
  };
  return { db: db as unknown as Parameters<typeof readInboxHealthSnapshot>[0], calls };
}

describe("readInboxHealthSnapshot and test agencies", () => {
  it("leaves the queues of disposable test agencies out of every outbox and job query", async () => {
    const { db, calls } = fakeDb({ testAgencyIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] });
    await readInboxHealthSnapshot(db);
    const queues = calls.filter((call) => call.table === "outbox_messages" || call.table === "channel_jobs");
    expect(queues.length).toBe(3 + 4);
    for (const call of queues) {
      expect(call.not).toEqual([["agency_id", "in", "(11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222)"]]);
    }
  });

  it("still filters with a harmless id when there are no test agencies", async () => {
    const { db, calls } = fakeDb({ testAgencyIds: [] });
    await readInboxHealthSnapshot(db);
    for (const call of calls.filter((entry) => entry.table === "outbox_messages")) {
      expect(call.not).toEqual([["agency_id", "in", "(00000000-0000-0000-0000-000000000000)"]]);
    }
  });

  it("reports the queue parts as unreadable, never as healthy, when the test-agency list cannot be read", async () => {
    const { db } = fakeDb({ testAgencyIds: null });
    const snapshot = await readInboxHealthSnapshot(db);
    expect(snapshot.outbox).toBeNull();
    expect(snapshot.jobs).toBeNull();
  });
});
