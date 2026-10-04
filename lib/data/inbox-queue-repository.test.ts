import { describe, expect, it } from "vitest";

import {
  QUEUE_PAGE_SIZE,
  keysetFilter,
  listQueueConversationIds,
  loadInboxQueuesV2Enabled,
  loadQueueCounts,
  parseQueueCountRows,
  queueCursorSchema,
} from "./inbox-queue-repository";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000b1";
const id = (n: number) => `3f1d2c4e-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;

/**
 * An in-memory `conversation_queue_membership` / `conversations` behind the query-builder calls the repository makes,
 * including the keyset `or(...)` filter. Ordering by (last_activity_at desc, id desc) is done as Postgres would,
 * on the exact timestamp strings.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; or: string | null; limit: number | null }> = [];
  return {
    calls,
    db: {
      rpc: async (name: string, args: Record<string, unknown>) => ({ data: name === "inbox_queue_counts" ? tables.__counts : null, error: null, args }),
      from(table: string) {
        const tests: Array<(row: Row) => boolean> = [];
        const record = { table, filters: [] as Array<[string, unknown]>, or: null as string | null, limit: null as number | null };
        let orders: Array<[string, boolean]> = [];
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: (column: string, value: unknown) => { record.filters.push([column, value]); tests.push((row) => row[column] === value); return builder; },
          neq: (column: string, value: unknown) => { tests.push((row) => row[column] !== value); return builder; },
          or: (expression: string) => {
            record.or = expression;
            const match = /^last_activity_at\.lt\.(.+?),and\(last_activity_at\.eq\.(.+?),(\w+)\.lt\.(.+)\)$/.exec(expression);
            if (!match) throw new Error(`unexpected or() ${expression}`);
            const [, ts, , idColumn, cursorId] = match;
            tests.push((row) => String(row.last_activity_at) < ts || (String(row.last_activity_at) === ts && String(row[idColumn]) < cursorId));
            return builder;
          },
          order: (column: string, options: { ascending: boolean }) => { orders.push([column, options.ascending]); return builder; },
          limit: (n: number) => { record.limit = n; return builder; },
          maybeSingle: () => builder,
          then: (resolve: (value: unknown) => unknown) => {
            calls.push(record);
            let rows = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
            rows = [...rows].sort((a, b) => {
              for (const [column, ascending] of orders) {
                const [x, y] = [String(a[column]), String(b[column])];
                if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
              }
              return 0;
            });
            if (record.limit !== null) rows = rows.slice(0, record.limit);
            orders = [];
            return resolve({ data: table === "agency_settings" ? rows[0] ?? null : rows, error: null });
          },
        };
        return builder;
      },
    } as never,
  };
}

/** `count` rows in one agency's queue: timestamps repeat every 7 rows so ties are common, and carry microseconds. */
function membershipRows(count: number, queue = "ALL", agency = AGENCY): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    agency_id: agency,
    queue_code: queue,
    conversation_id: id(index + 1),
    last_activity_at: `2026-09-19T14:${String(10 + Math.floor(index / 7)).padStart(2, "0")}:15.${String(500000 + (index % 3) * 111111).padStart(6, "0")}+00:00`,
  }));
}

describe("parseQueueCountRows", () => {
  it("maps rows to a typed map and ignores unknown queue codes and non-numeric counts", () => {
    expect(parseQueueCountRows([
      { queue_code: "ALL", conversation_count: 12 },
      { queue_code: "NEEDS_REPLY", conversation_count: "5" },
      { queue_code: "FROM_THE_FUTURE", conversation_count: 9 },
      { queue_code: "MINE", conversation_count: "abc" },
    ])).toEqual({ ALL: 12, NEEDS_REPLY: 5 });
    expect(parseQueueCountRows(null)).toEqual({});
  });

  it("loadQueueCounts calls the indexed RPC with the staff id, and surfaces an error instead of showing zeros", async () => {
    const { db } = fakeDb({ __counts: [{ queue_code: "ALL", conversation_count: 3 }] });
    expect(await loadQueueCounts(db, STAFF)).toEqual({ ALL: 3 });
    const failing = { rpc: async () => ({ data: null, error: { message: "timeout" } }) } as never;
    await expect(loadQueueCounts(failing, STAFF)).rejects.toThrow(/timeout/);
  });
});

describe("queueCursorSchema and keysetFilter", () => {
  it("accepts a Postgres timestamp with microseconds and rejects anything that could break out of the filter string", () => {
    expect(queueCursorSchema.safeParse({ lastActivityAt: "2026-09-19T14:41:15.553864+00:00", conversationId: id(1) }).success).toBe(true);
    expect(queueCursorSchema.safeParse({ lastActivityAt: "2026-09-19 14:41:15+00", conversationId: id(1) }).success).toBe(true);
    for (const bad of ["yesterday", "2026-09-19T14:41:15Z),id.gt.0", "2026-09-19", "", "x)or(y"]) {
      expect(queueCursorSchema.safeParse({ lastActivityAt: bad, conversationId: id(1) }).success).toBe(false);
    }
    expect(queueCursorSchema.safeParse({ lastActivityAt: "2026-09-19T14:41:15Z", conversationId: "not-a-uuid" }).success).toBe(false);
  });

  it("builds a strictly-after filter on (last_activity_at desc, id desc)", () => {
    expect(keysetFilter({ lastActivityAt: "2026-09-19T14:41:15.5Z", conversationId: id(7) }, "conversation_id")).toBe(
      `last_activity_at.lt.2026-09-19T14:41:15.5Z,and(last_activity_at.eq.2026-09-19T14:41:15.5Z,conversation_id.lt.${id(7)})`,
    );
  });
});

describe("listQueueConversationIds", () => {
  it("returns one page newest-first and a cursor only when another page exists", async () => {
    const { db } = fakeDb({ conversation_queue_membership: membershipRows(250) });
    const first = await listQueueConversationIds(db, { agencyId: AGENCY, staffId: STAFF, queue: "ALL" });
    expect(first.ids).toHaveLength(QUEUE_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const small = fakeDb({ conversation_queue_membership: membershipRows(40) });
    const only = await listQueueConversationIds(small.db, { agencyId: AGENCY, staffId: STAFF, queue: "ALL" });
    expect(only.ids).toHaveLength(40);
    expect(only.nextCursor).toBeNull();
  });

  it("walks a 250-row queue with tied timestamps: no duplicates and no gaps across pages", async () => {
    const { db } = fakeDb({ conversation_queue_membership: membershipRows(250) });
    const seen: string[] = [];
    let cursor = null as Awaited<ReturnType<typeof listQueueConversationIds>>["nextCursor"];
    let pages = 0;
    do {
      const page = await listQueueConversationIds(db, { agencyId: AGENCY, staffId: STAFF, queue: "ALL", cursor });
      seen.push(...page.ids);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
    expect(new Set(seen)).toEqual(new Set(Array.from({ length: 250 }, (_, index) => id(index + 1))));
  });

  it("never returns another agency's rows or another queue's rows", async () => {
    const { db, calls } = fakeDb({
      conversation_queue_membership: [...membershipRows(5, "ALL", AGENCY), ...membershipRows(9, "ALL", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), ...membershipRows(3, "SPAM", AGENCY)],
    });
    const page = await listQueueConversationIds(db, { agencyId: AGENCY, staffId: STAFF, queue: "ALL" });
    expect(page.ids).toHaveLength(5);
    expect(calls[0].filters).toEqual(expect.arrayContaining([["agency_id", AGENCY], ["queue_code", "ALL"]]));
  });

  it("MINE reads the caller's own open conversations and never queries membership", async () => {
    const mine = { agency_id: AGENCY, id: id(1), assigned_to_id: STAFF, state: "HUMAN_ACTIVE", last_activity_at: "2026-09-19T10:00:00.000000+00:00" };
    const closed = { ...mine, id: id(2), state: "CLOSED" };
    const theirs = { ...mine, id: id(3), assigned_to_id: id(99) };
    const { db, calls } = fakeDb({ conversations: [mine, closed, theirs] });
    const page = await listQueueConversationIds(db, { agencyId: AGENCY, staffId: STAFF, queue: "MINE" });
    expect(page.ids).toEqual([id(1)]);
    expect(calls.map((call) => call.table)).toEqual(["conversations"]);
    expect((await listQueueConversationIds(db, { agencyId: AGENCY, staffId: null, queue: "MINE" })).ids).toEqual([]);
  });

  it("rejects a hostile cursor before building any filter", async () => {
    const { db, calls } = fakeDb({ conversation_queue_membership: [] });
    await expect(
      listQueueConversationIds(db, { agencyId: AGENCY, staffId: STAFF, queue: "ALL", cursor: { lastActivityAt: "2026-01-01T00:00:00Z),conversation_id.gt.0", conversationId: id(1) } }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("loadInboxQueuesV2Enabled", () => {
  it("is off unless the agency's setting is exactly true, and off when the row is missing or unreadable", async () => {
    expect(await loadInboxQueuesV2Enabled(fakeDb({ agency_settings: [{ agency_id: AGENCY, inbox_queues_v2: true }] }).db, AGENCY)).toBe(true);
    expect(await loadInboxQueuesV2Enabled(fakeDb({ agency_settings: [{ agency_id: AGENCY, inbox_queues_v2: false }] }).db, AGENCY)).toBe(false);
    expect(await loadInboxQueuesV2Enabled(fakeDb({ agency_settings: [] }).db, AGENCY)).toBe(false);
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "denied" } }) }) }) }) } as never;
    expect(await loadInboxQueuesV2Enabled(failing, AGENCY)).toBe(false);
  });
});
