import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const uuid = (n: number) => `3f1d2c4e-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`;

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error?: { message: string } | null };

/** A chainable stand-in for the Supabase query builder that records every filter, so a test can assert what a read asked for. */
function fakeDb(results: Record<string, Result | (() => Result)>) {
  const queries: Array<{ table: string; calls: Call[] }> = [];
  const db = {
    queries,
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null }) }) },
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      const calls: Call[] = [];
      queries.push({ table, calls });
      const resolve = () => {
        const entry = results[table];
        const value = typeof entry === "function" ? entry() : entry;
        return { data: value?.data ?? null, error: value?.error ?? null };
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gt", "in", "or", "order", "limit", "neq", "not"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = async () => {
        calls.push(["maybeSingle"]);
        const value = resolve();
        return { data: Array.isArray(value.data) ? (value.data[0] ?? null) : value.data, error: value.error };
      };
      builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled);
      return builder;
    },
  };
  return db;
}

let currentDb: ReturnType<typeof fakeDb>;
let currentRole: { role: string; staffId: string | null; agencyId: string | null };

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: STAFF }) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => currentDb }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => currentDb }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => currentRole }));

const repository = await import("./inbox-repository");
const validations = await import("@/lib/validations/inbox");

const callsOf = (db: ReturnType<typeof fakeDb>, table: string) => db.queries.filter((query) => query.table === table).map((query) => query.calls);
const hasCall = (calls: Call[], method: string, ...args: unknown[]) => calls.some((call) => call[0] === method && args.every((arg, index) => call[index + 1] === arg));

beforeEach(() => {
  currentRole = { role: "OPERATIONS", staffId: STAFF, agencyId: AGENCY };
});

describe("loadInboxThreadDelta", () => {
  const message = (n: number, sequence: number | null) => ({ id: uuid(n), conversation_id: CONVERSATION, sequence_number: sequence, created_at: `2026-09-24T10:00:0${n}Z`, content: `m${n}` });

  it("reads only messages after the sequence, ascending, scoped to the agency and conversation", async () => {
    currentDb = fakeDb({ conversation_messages: { data: [message(1, 6), message(2, 7)] }, message_attachments: { data: [] }, message_media_analyses: { data: [] } });
    const delta = await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 5, messageIds: [] });

    const [newerCalls] = callsOf(currentDb, "conversation_messages");
    expect(hasCall(newerCalls, "eq", "agency_id", AGENCY)).toBe(true);
    expect(hasCall(newerCalls, "eq", "conversation_id", CONVERSATION)).toBe(true);
    expect(hasCall(newerCalls, "gt", "sequence_number", 5)).toBe(true);
    expect(hasCall(newerCalls, "order", "sequence_number")).toBe(true);
    expect(hasCall(newerCalls, "limit", repository.THREAD_DELTA_LIMIT + 1)).toBe(true);
    expect(delta).toMatchObject({ highestSequence: 7, hasMore: false });
    expect(delta?.messages.map((row) => row.id)).toEqual([uuid(1), uuid(2)]);
  });

  it("does not run the requested-ids query when none are asked for, and signs links only for returned messages", async () => {
    currentDb = fakeDb({ conversation_messages: { data: [message(1, 6)] }, message_attachments: { data: [] }, message_media_analyses: { data: [] } });
    await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 5, messageIds: [] });
    expect(callsOf(currentDb, "conversation_messages")).toHaveLength(1);
    const [attachmentCalls] = callsOf(currentDb, "message_attachments");
    expect(attachmentCalls.find((call) => call[0] === "in")?.slice(1)).toEqual(["message_id", [uuid(1)]]);
  });

  it("merges requested delivery-status rows without duplicating a message that is also newer, in sequence order", async () => {
    let call = 0;
    currentDb = fakeDb({
      conversation_messages: () => ({ data: call++ === 0 ? [message(3, 9)] : [message(1, 4), message(3, 9)] }),
      message_attachments: { data: [] },
      message_media_analyses: { data: [] },
    });
    const delta = await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 8, messageIds: [uuid(1), uuid(3)] });
    expect(delta?.messages.map((row) => row.id)).toEqual([uuid(1), uuid(3)]);
    expect(delta?.highestSequence).toBe(9);
  });

  it("reports a further page when the backlog exceeds the limit, and returns exactly one page", async () => {
    const backlog = Array.from({ length: repository.THREAD_DELTA_LIMIT + 1 }, (_, index) => message(index + 1, index + 1));
    currentDb = fakeDb({ conversation_messages: { data: backlog }, message_attachments: { data: [] }, message_media_analyses: { data: [] } });
    const delta = await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 0, messageIds: [] });
    expect(delta?.hasMore).toBe(true);
    expect(delta?.messages).toHaveLength(repository.THREAD_DELTA_LIMIT);
    expect(delta?.highestSequence).toBe(repository.THREAD_DELTA_LIMIT);
  });

  it("returns nothing new as a null highest sequence", async () => {
    currentDb = fakeDb({ conversation_messages: { data: [] } });
    expect(await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 99, messageIds: [] })).toMatchObject({ messages: [], highestSequence: null, hasMore: false });
  });

  it("is not available to a role that cannot view the Inbox, or to an account with no agency", async () => {
    currentDb = fakeDb({});
    currentRole = { role: "GUIDE", staffId: STAFF, agencyId: AGENCY };
    expect(await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 0, messageIds: [] })).toBeNull();
    currentRole = { role: "OPERATIONS", staffId: STAFF, agencyId: null };
    expect(await repository.loadInboxThreadDelta({ conversationId: CONVERSATION, afterSequence: 0, messageIds: [] })).toBeNull();
    expect(currentDb.queries).toHaveLength(0);
  });
});

describe("loadInboxNotesDelta", () => {
  const note = (n: number) => ({ id: uuid(n), conversation_id: CONVERSATION, body: `n${n}`, author_id: STAFF, author_name_snapshot: "A", created_at: `2026-09-24T10:00:0${n}Z` });

  it("applies the keyset position and scopes to the agency", async () => {
    currentDb = fakeDb({ conversation_notes: { data: [note(2)] } });
    await repository.loadInboxNotesDelta({ conversationId: CONVERSATION, after: { createdAt: "2026-09-24T10:00:01.123456+00:00", id: uuid(1) }, noteIds: [] });
    const [calls] = callsOf(currentDb, "conversation_notes");
    expect(hasCall(calls, "eq", "agency_id", AGENCY)).toBe(true);
    const orFilter = calls.find((call) => call[0] === "or")?.[1] as string;
    expect(orFilter).toBe(`created_at.gt.2026-09-24T10:00:01.123456+00:00,and(created_at.eq.2026-09-24T10:00:01.123456+00:00,id.gt.${uuid(1)})`);
  });

  it("says when more notes are waiting than one read returns, and returns only a page", async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ ...note(1), id: uuid(index + 1), created_at: `2026-09-24T10:00:00.${String(index).padStart(3, "0")}Z` }));
    currentDb = fakeDb({ conversation_notes: { data: many } });
    const delta = await repository.loadInboxNotesDelta({ conversationId: CONVERSATION, after: null, noteIds: [] });
    expect(delta?.hasMore).toBe(true);
    expect(delta?.notes).toHaveLength(100);
  });

  it("says there are no more notes when the read came back short", async () => {
    currentDb = fakeDb({ conversation_notes: { data: [note(1)] } });
    expect((await repository.loadInboxNotesDelta({ conversationId: CONVERSATION, after: null, noteIds: [] }))?.hasMore).toBe(false);
  });

  it("reads from the start when the browser holds no notes", async () => {
    currentDb = fakeDb({ conversation_notes: { data: [note(1)] } });
    await repository.loadInboxNotesDelta({ conversationId: CONVERSATION, after: null, noteIds: [] });
    const [calls] = callsOf(currentDb, "conversation_notes");
    expect(calls.some((call) => call[0] === "or")).toBe(false);
  });

  it("names a requested note that no longer exists as removed", async () => {
    let call = 0;
    currentDb = fakeDb({ conversation_notes: () => ({ data: call++ === 0 ? [] : [note(1)] }) });
    const delta = await repository.loadInboxNotesDelta({ conversationId: CONVERSATION, after: null, noteIds: [uuid(1), uuid(2)] });
    expect(delta?.removedNoteIds).toEqual([uuid(2)]);
    expect(delta?.notes.map((row) => row.id)).toEqual([uuid(1)]);
  });
});

describe("loadInboxConversationListPatch", () => {
  const row = { id: CONVERSATION, agency_id: AGENCY, state: "AI_ACTIVE", assigned_to_id: null, last_activity_at: "2026-09-24T10:00:00.123456+00:00", version: 4, leads: { reference: "L-1", stage: "NEW", desired_package_name: null } };

  it("returns one list row with its version and exact activity string, and never runs the 100-row list read", async () => {
    currentDb = fakeDb({
      conversations: { data: row },
      conversation_messages: { data: [{ content: "", role: "user", message_type: "IMAGE" }] },
      conversation_interventions: { data: [] },
      conversation_queue_membership: { data: { last_activity_at: row.last_activity_at } },
    });
    const patch = await repository.loadInboxConversationListPatch({ conversationId: CONVERSATION, view: "all", includeCounts: false });
    expect(patch).toMatchObject({ inActiveView: true, conversationVersion: 4, lastActivityAt: "2026-09-24T10:00:00.123456+00:00", queueCounts: null, viewCounts: null });
    expect(patch?.conversation).toMatchObject({ last_message_content: "", last_message_type: "IMAGE", lead_reference: "L-1", has_open_support_case: false });
    for (const [table, calls] of currentDb.queries.map((query) => [query.table, query.calls] as const)) {
      if (table !== "conversations") continue;
      expect(hasCall(calls, "eq", "agency_id", AGENCY)).toBe(true);
      expect(hasCall(calls, "eq", "id", CONVERSATION)).toBe(true);
      expect(calls.some((call) => call[0] === "in" && call[1] === "id")).toBe(false);
    }
  });

  it("says a conversation that left the view is not in it", async () => {
    currentDb = fakeDb({ conversations: { data: row }, conversation_messages: { data: [] }, conversation_interventions: { data: [] }, conversation_queue_membership: { data: null } });
    const patch = await repository.loadInboxConversationListPatch({ conversationId: CONVERSATION, view: "unassigned", includeCounts: false });
    expect(patch?.inActiveView).toBe(false);
    expect(patch?.conversation?.id).toBe(CONVERSATION);
  });

  it("answers the personal MINE view from the row itself and skips the membership table", async () => {
    currentDb = fakeDb({ conversations: { data: { ...row, assigned_to_id: STAFF } }, conversation_messages: { data: [] }, conversation_interventions: { data: [] } });
    const patch = await repository.loadInboxConversationListPatch({ conversationId: CONVERSATION, view: "assigned-to-me", includeCounts: false });
    expect(patch?.inActiveView).toBe(true);
    expect(callsOf(currentDb, "conversation_queue_membership")).toHaveLength(0);

    currentDb = fakeDb({ conversations: { data: { ...row, assigned_to_id: STAFF, state: "CLOSED" } }, conversation_messages: { data: [] }, conversation_interventions: { data: [] } });
    expect((await repository.loadInboxConversationListPatch({ conversationId: CONVERSATION, view: "assigned-to-me", includeCounts: false }))?.inActiveView).toBe(false);
  });

  it("returns a null conversation when it is not visible (another agency's row is filtered out by scope and row security)", async () => {
    currentDb = fakeDb({ conversations: { data: null }, conversation_messages: { data: [] }, conversation_interventions: { data: [] }, conversation_queue_membership: { data: null } });
    const patch = await repository.loadInboxConversationListPatch({ conversationId: CONVERSATION, view: "all", includeCounts: false });
    expect(patch).toMatchObject({ conversation: null, inActiveView: false, conversationVersion: null, lastActivityAt: null });
  });

  it("flags an open support case and reads counts only when asked", async () => {
    currentDb = fakeDb({ conversations: { data: row }, conversation_messages: { data: [] }, conversation_interventions: { data: [{ conversation_id: CONVERSATION }] }, conversation_queue_membership: { data: null } });
    currentDb.rpc = (async () => ({ data: [{ queue_code: "ALL", conversation_count: 12 }], error: null })) as never;
    const patch = await repository.loadInboxConversationListPatch({ conversationId: CONVERSATION, view: "all", includeCounts: true });
    expect(patch?.conversation?.has_open_support_case).toBe(true);
    expect(patch?.queueCounts).toEqual({ ALL: 12 });
    expect(patch?.viewCounts?.all).toBe(12);
  });
});

describe("loadInboxPresence", () => {
  it("returns only the lease of one agency-scoped conversation", async () => {
    currentDb = fakeDb({ conversations: { data: { composing_by: STAFF, composing_at: "2026-09-24T10:00:00Z" } } });
    expect(await repository.loadInboxPresence(CONVERSATION)).toEqual({ composerPresence: { staffId: STAFF, at: "2026-09-24T10:00:00Z" } });
    const [calls] = callsOf(currentDb, "conversations");
    expect(hasCall(calls, "eq", "agency_id", AGENCY)).toBe(true);
    expect(callsOf(currentDb, "conversation_messages")).toHaveLength(0);
  });

  it("returns no presence when nobody holds the lease", async () => {
    currentDb = fakeDb({ conversations: { data: { composing_by: null, composing_at: null } } });
    expect(await repository.loadInboxPresence(CONVERSATION)).toEqual({ composerPresence: null });
  });
});

describe("scoped request schemas", () => {
  it("accepts exactly the browser-known fields and rejects anything else", () => {
    expect(validations.inboxThreadDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, afterSequence: 0 }).success).toBe(true);
    expect(validations.inboxThreadDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, afterSequence: 0, agencyId: AGENCY }).success).toBe(false);
    expect(validations.inboxListPatchRequestSchema.safeParse({ conversationId: CONVERSATION, view: "nonsense" }).success).toBe(false);
  });

  it("bounds every list and rejects a negative or fractional sequence", () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => uuid(index + 1));
    expect(validations.inboxThreadDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, afterSequence: 0, messageIds: tooMany }).success).toBe(false);
    expect(validations.inboxNotesDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, noteIds: tooMany }).success).toBe(false);
    expect(validations.inboxThreadDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, afterSequence: -1 }).success).toBe(false);
    expect(validations.inboxThreadDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, afterSequence: 1.5 }).success).toBe(false);
  });

  it("rejects a notes cursor that could break out of the filter string", () => {
    const injection = { createdAt: "2026-09-24T10:00:00Z),id.gt.0", id: uuid(1) };
    expect(validations.inboxNotesDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, after: injection }).success).toBe(false);
    expect(validations.inboxNotesDeltaRequestSchema.safeParse({ conversationId: CONVERSATION, after: { createdAt: "2026-09-24T10:00:00.123456+00:00", id: uuid(1) } }).success).toBe(true);
  });
});
