import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  REPLY_GENERATE_LEASE_SECONDS,
  beginReplySend,
  claimReplyIntent,
  decideExistingIntent,
  finishReplySent,
  finishReplySkipped,
  revertReplyToGenerated,
  type ReplyIntentRow,
} from "./reply-intent";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const future = new Date(NOW.getTime() + 30_000).toISOString();
const past = new Date(NOW.getTime() - 30_000).toISOString();

describe("decideExistingIntent", () => {
  it.each([
    ["SENT", null, "DONE"],
    ["SKIPPED", null, "DONE"],
    ["UNKNOWN", null, "DONE"],
    ["GENERATED", null, "TAKE_STORED"],
    ["GENERATING", future, "BUSY"],
    ["GENERATING", past, "TAKE_GENERATION"],
    ["GENERATING", null, "TAKE_GENERATION"],
    ["SENDING", future, "BUSY"],
    // The send began and never reported back: it may have reached the customer, so it is never simply retried.
    ["SENDING", past, "MARK_UNKNOWN"],
  ] as const)("%s with lease %s -> %s", (status, lease, expected) => {
    expect(decideExistingIntent({ status, lease_until: lease }, NOW)).toBe(expected);
  });
});

/** An in-memory `reply_intents` with the table's unique key and the compare-and-set semantics of the real updates. */
function intentDb() {
  const rows: Array<ReplyIntentRow & { agency_id: string; inbound_message_id: string; conversation_id: string; provider_message_id?: string | null; skip_reason?: string | null }> = [];
  let version = 0;
  const nextVersion = () => `v${++version}`;

  type Filter = { col: string; value: unknown };
  const matches = (row: Record<string, unknown>, filters: Filter[], lists: Array<{ col: string; values: unknown[] }>) =>
    filters.every((f) => row[f.col] === f.value) && lists.every((l) => l.values.includes(row[l.col]));

  const from = (table: string) => {
    if (table !== "reply_intents") throw new Error(`unexpected table ${table}`);
    let op: "select" | "insert" | "update" = "select";
    let patch: Record<string, unknown> = {};
    let inserted: Record<string, unknown> = {};
    const filters: Filter[] = [];
    const lists: Array<{ col: string; values: unknown[] }> = [];
    let returning = false;

    const run = () => {
      if (op === "insert") {
        const clash = rows.find((r) => r.agency_id === inserted.agency_id && r.inbound_message_id === inserted.inbound_message_id);
        if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const row = { id: `intent-${rows.length + 1}`, attempts: 1, reply_text: null, reply_buttons: null, updated_at: nextVersion(), ...inserted } as (typeof rows)[number];
        rows.push(row);
        return { data: [{ id: row.id }], error: null };
      }
      if (op === "update") {
        const hit = rows.filter((r) => matches(r as never, filters, lists));
        for (const row of hit) Object.assign(row, patch, { updated_at: nextVersion() });
        return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      const hit = rows.filter((r) => matches(r as never, filters, lists));
      return { data: hit.map((r) => ({ ...r })), error: null };
    };

    const builder: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => ((op = "insert"), (inserted = row), builder),
      update: (p: Record<string, unknown>) => ((op = "update"), (patch = p), builder),
      select: () => ((returning = true), builder),
      eq: (col: string, value: unknown) => (filters.push({ col, value }), builder),
      in: (col: string, values: unknown[]) => (lists.push({ col, values }), builder),
      maybeSingle: async () => {
        const result = run();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };
  return { db: { from } as never, rows };
}

const key = { agencyId: "agency-1", conversationId: "conv-1", inboundMessageId: "msg-1" };

describe("claimReplyIntent", () => {
  it("lets the first attempt generate, and makes a concurrent second attempt stand down", async () => {
    const { db, rows } = intentDb();
    expect(await claimReplyIntent(db, key, "token-a", NOW)).toEqual({ action: "GENERATE", intentId: "intent-1" });
    expect(rows).toHaveLength(1); // one intent per inbound message

    expect(await claimReplyIntent(db, key, "token-b", NOW)).toEqual({ action: "BUSY" });
    expect(rows).toHaveLength(1);
  });

  it("takes over a generation whose lease expired, and only one of two racing attempts wins", async () => {
    const { db, rows } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    const later = new Date(NOW.getTime() + (REPLY_GENERATE_LEASE_SECONDS + 5) * 1000);

    const [first, second] = await Promise.all([claimReplyIntent(db, key, "token-b", later), claimReplyIntent(db, key, "token-c", later)]);
    const actions = [first.action, second.action].sort();
    expect(actions).toEqual(["BUSY", "GENERATE"]); // the row's version is compared, so the loser's update matches nothing
    expect(rows[0].attempts).toBe(2);
  });

  it("hands a produced-but-unsent reply to the next attempt, without the model", async () => {
    const { db, rows } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    await beginReplySend(db, { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" }, { text: "Salaam, here are the March departures", buttons: [{ id: "book", title: "Book now" }] }, NOW);
    await revertReplyToGenerated(db, { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" });
    expect(rows[0].status).toBe("GENERATED");

    expect(await claimReplyIntent(db, key, "token-b", NOW)).toEqual({
      action: "SEND_STORED",
      intentId: "intent-1",
      reply: "Salaam, here are the March departures",
      buttons: [{ id: "book", title: "Book now" }],
    });
  });

  it("never re-sends a reply whose send began and never reported back: it becomes UNKNOWN", async () => {
    const { db, rows } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    await beginReplySend(db, { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" }, { text: "hello", buttons: [] }, NOW);
    const afterLease = new Date(NOW.getTime() + 5 * 60_000);

    expect(await claimReplyIntent(db, key, "token-b", afterLease)).toEqual({ action: "UNKNOWN", intentId: "intent-1" });
    expect(rows[0].status).toBe("UNKNOWN");
    // And once it is UNKNOWN, later attempts do nothing: staff own it.
    expect(await claimReplyIntent(db, key, "token-c", afterLease)).toEqual({ action: "DONE" });
  });

  it("does nothing for a reply that was already sent or deliberately skipped", async () => {
    const { db } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    const ids = { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" };
    await beginReplySend(db, ids, { text: "hello", buttons: [] }, NOW);
    await finishReplySent(db, ids, "wamid.out");
    expect(await claimReplyIntent(db, key, "token-b", NOW)).toEqual({ action: "DONE" });

    const other = { ...key, inboundMessageId: "msg-2" };
    await claimReplyIntent(db, other, "token-a", NOW);
    await finishReplySkipped(db, { agencyId: "agency-1", intentId: "intent-2", ownerToken: "token-a" }, "SUPERSEDED");
    expect(await claimReplyIntent(db, other, "token-b", NOW)).toEqual({ action: "DONE" });
  });

  it("keeps two agencies' intents apart even for the same message id", async () => {
    const { db, rows } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    expect(await claimReplyIntent(db, { ...key, agencyId: "agency-2" }, "token-b", NOW)).toMatchObject({ action: "GENERATE" });
    expect(rows).toHaveLength(2);
  });
});

describe("the attempt that lost its lease cannot act", () => {
  it("cannot start a send after another attempt took over", async () => {
    const { db } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    const later = new Date(NOW.getTime() + (REPLY_GENERATE_LEASE_SECONDS + 5) * 1000);
    await claimReplyIntent(db, key, "token-b", later); // takes over

    const stale = { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" };
    expect(await beginReplySend(db, stale, { text: "late reply", buttons: [] }, later)).toBe(false);
    expect(await beginReplySend(db, { ...stale, ownerToken: "token-b" }, { text: "current reply", buttons: [] }, later)).toBe(true);
  });

  it("cannot mark another attempt's send as done", async () => {
    const { db, rows } = intentDb();
    await claimReplyIntent(db, key, "token-a", NOW);
    await beginReplySend(db, { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-a" }, { text: "hello", buttons: [] }, NOW);
    await finishReplySent(db, { agencyId: "agency-1", intentId: "intent-1", ownerToken: "token-z" }, "wamid.forged");
    expect(rows[0].status).toBe("SENDING");
  });
});
