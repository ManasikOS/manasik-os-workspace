import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { deleteConversationMessageBatch, runRetentionSweepForAgency } from "./sweep";

const EPOCH_CURSOR = { at: "1970-01-01T00:00:00.000Z", id: "00000000-0000-0000-0000-000000000000" };

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj, in: () => obj, lt: () => obj, limit: () => obj,
    is: () => obj, not: () => obj, like: () => obj, delete: () => obj, or: () => obj, order: () => obj,
    single: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  return obj;
}

const DEFAULT_SETTINGS = {
  booking_linked_message_retention_years: 7, enquiry_message_retention_months: 24,
  inbox_attachment_retention_days: 90, voice_audio_retention_days: 180,
  intelligence_retention_months: 24, ai_run_retention_months: 13, webhook_payload_retention_days: 30,
};

/** A per-(agency,scope) cursor store shared by every scope a sweep touches, mirroring `inbox_retention_cursors`. */
function createCursorTable() {
  const cursors = new Map<string, { cursor_at: string; cursor_id: string }>();
  const upserts: Array<{ agency_id: string; scope: string; cursor_at: string; cursor_id: string }> = [];
  const from = () => {
    const state: { agency_id?: string; scope?: string } = {};
    const obj: Record<string, unknown> = {
      select: () => obj,
      eq: (col: string, val: string) => { (state as Record<string, string>)[col] = val; return obj; },
      maybeSingle: () => Promise.resolve({ data: cursors.get(`${state.agency_id}:${state.scope}`) ?? null, error: null }),
      upsert: (payload: { agency_id: string; scope: string; cursor_at: string; cursor_id: string }) => {
        cursors.set(`${payload.agency_id}:${payload.scope}`, { cursor_at: payload.cursor_at, cursor_id: payload.cursor_id });
        upserts.push(payload);
        return { then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }) };
      },
    };
    return obj;
  };
  return { from, upserts };
}

/** A resource table that pages a fixed set of arrays, one per fetch call, and records its filters and its deletions. */
function createPagedResourceTable(pages: Array<Array<Record<string, unknown>>>) {
  let call = 0;
  const fetchFilters: Array<{ or?: string; lt?: unknown; is?: unknown; like?: unknown }> = [];
  const deletions: string[][] = [];
  const from = () => {
    const state: { or?: string; lt?: unknown; is?: unknown; like?: unknown; deleting?: boolean } = {};
    const obj: Record<string, unknown> = {
      select: () => obj,
      eq: () => obj,
      lt: (_col: string, val: unknown) => { state.lt = val; return obj; },
      or: (expr: string) => { state.or = expr; return obj; },
      order: () => obj,
      limit: () => obj,
      is: (_col: string, val: unknown) => { state.is = val; return obj; },
      not: () => obj,
      like: (_col: string, val: unknown) => { state.like = val; return obj; },
      delete: () => { state.deleting = true; return obj; },
      in: (_col: string, ids: string[]) => {
        if (state.deleting) { deletions.push(ids); return { then: (resolve: (v: { count: number; error: null }) => void) => resolve({ count: ids.length, error: null }) }; }
        return obj;
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        fetchFilters.push({ or: state.or, lt: state.lt, is: state.is, like: state.like });
        const page = pages[call] ?? [];
        call += 1;
        resolve({ data: page, error: null });
      },
    };
    return obj;
  };
  return { from, fetchFilters, deletions };
}

/** A fake `Db` whose MESSAGES-scope candidate pages come from `rpcPages`, one array per call. */
function createFakeDb(rpcPages: Array<Array<{ id: string; last_activity_at: string; booking_linked: boolean }>>, options: { messagesQueryError?: string; attachmentPages?: Array<Array<Record<string, unknown>>>; storageRemove?: (paths: string[]) => Promise<{ data: unknown; error: unknown }> } = {}) {
  let rpcCall = 0;
  const rpc = vi.fn<(name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>(async (name) => {
    if (name !== "inbox_retention_candidate_conversations") throw new Error(`unexpected rpc ${name}`);
    const page = rpcPages[rpcCall] ?? [];
    rpcCall += 1;
    return { data: page, error: null };
  });
  const cursorTable = createCursorTable();
  const sweepInserts: Array<Record<string, unknown>> = [];
  const attachmentTable = createPagedResourceTable(options.attachmentPages ?? []);
  const storageRemove = vi.fn(options.storageRemove ?? (async () => ({ data: [], error: null })));
  const db = {
    rpc,
    storage: { from: () => ({ remove: storageRemove }) },
    from: (table: string) => {
      if (table === "agency_settings") return chain({ data: DEFAULT_SETTINGS, error: null });
      if (table === "conversation_messages") return options.messagesQueryError ? chain({ data: null, error: { message: options.messagesQueryError } }) : chain({ data: [], error: null });
      if (table === "inbox_retention_sweeps") { const obj = chain({ data: null, error: null }); obj.insert = (payload: Record<string, unknown>) => { sweepInserts.push(payload); return chain({ data: null, error: null }); }; return obj; }
      if (table === "inbox_retention_cursors") return cursorTable.from();
      if (table === "message_attachments" && options.attachmentPages) return attachmentTable.from();
      return chain({ data: [], error: null });
    },
  } as never;
  return { db, rpc, cursorUpserts: cursorTable.upserts, sweepInserts, attachmentTable, storageRemove };
}

describe("retention storage deletion", () => {
  it("removes private objects before deleting message rows", async () => {
    const order: string[] = [];
    const attachmentQuery = {
      select: () => attachmentQuery,
      eq: () => attachmentQuery,
      in: async () => ({ data: [{ id: "a1", storage_path: "agency/a1/passport.jpg" }], error: null }),
    };
    const messageQuery = {
      delete: () => { order.push("delete rows"); return messageQuery; },
      eq: () => messageQuery,
      in: async () => ({ count: 1, error: null }),
    };
    const db = {
      from: (table: string) => table === "message_attachments" ? attachmentQuery : messageQuery,
      storage: { from: () => ({ remove: vi.fn(async (paths: string[]) => { order.push(`remove ${paths.join(",")}`); return { data: [], error: null }; }) }) },
    } as never;

    await expect(deleteConversationMessageBatch(db, { agencyId: "agency", messageIds: ["m1"], dryRun: false })).resolves.toEqual({ rowsDeleted: 1, objectsDeleted: 1 });
    expect(order).toEqual(["remove agency/a1/passport.jpg", "delete rows"]);
  });

  it("dry-run counts objects and rows without mutating either store", async () => {
    const remove = vi.fn();
    const deleteRows = vi.fn();
    const query = { select: () => query, eq: () => query, in: async () => ({ data: [{ id: "a1", storage_path: "agency/a1/audio.ogg" }], error: null }), delete: deleteRows };
    const db = { from: () => query, storage: { from: () => ({ remove }) } } as never;
    await expect(deleteConversationMessageBatch(db, { agencyId: "agency", messageIds: ["m1"], dryRun: true })).resolves.toEqual({ rowsDeleted: 1, objectsDeleted: 1 });
    expect(remove).not.toHaveBeenCalled();
    expect(deleteRows).not.toHaveBeenCalled();
  });

  it("stops before row deletion when private-object deletion fails", async () => {
    const deleteRows = vi.fn();
    const attachmentQuery = { select: () => attachmentQuery, eq: () => attachmentQuery, in: async () => ({ data: [{ id: "a1", storage_path: "agency/a1/passport.jpg" }], error: null }) };
    const messageQuery = { delete: deleteRows };
    const db = {
      from: (table: string) => table === "message_attachments" ? attachmentQuery : messageQuery,
      storage: { from: () => ({ remove: async () => ({ data: null, error: { message: "storage unavailable" } }) }) },
    } as never;
    await expect(deleteConversationMessageBatch(db, { agencyId: "agency", messageIds: ["m1"], dryRun: false })).rejects.toThrow(/storage unavailable/);
    expect(deleteRows).not.toHaveBeenCalled();
  });
});

describe("resumable MESSAGES retention sweep (FIX2)", () => {
  it("starts a fresh sweep from the epoch cursor and resumes across pages using the persisted keyset cursor", async () => {
    const pageOne = [
      { id: "c1", last_activity_at: "2024-01-01T00:00:00.000Z", booking_linked: false },
      { id: "c2", last_activity_at: "2024-01-02T00:00:00.000Z", booking_linked: true },
    ];
    const pageTwo = [{ id: "c3", last_activity_at: "2024-01-03T00:00:00.000Z", booking_linked: false }];
    const { db, rpc, cursorUpserts } = createFakeDb([pageOne, pageTwo]);

    await runRetentionSweepForAgency(db, "agency-1", { dryRun: false, batchSize: 2 });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_cursor_at: EPOCH_CURSOR.at, p_cursor_id: EPOCH_CURSOR.id });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_cursor_at: "2024-01-02T00:00:00.000Z", p_cursor_id: "c2" });
    expect(cursorUpserts).toHaveLength(2);
    expect(cursorUpserts[0]).toMatchObject({ agency_id: "agency-1", scope: "MESSAGES", cursor_at: "2024-01-02T00:00:00.000Z", cursor_id: "c2" });
    expect(cursorUpserts[1]).toMatchObject({ cursor_at: "2024-01-03T00:00:00.000Z", cursor_id: "c3" });
  });

  it("never advances the resume cursor on a dry run, so a later live sweep does not skip previewed rows", async () => {
    const page = [{ id: "c1", last_activity_at: "2024-01-01T00:00:00.000Z", booking_linked: false }];
    const { db, cursorUpserts, sweepInserts } = createFakeDb([page]);

    await runRetentionSweepForAgency(db, "agency-1", { dryRun: true, batchSize: 5 });

    expect(cursorUpserts).toHaveLength(0);
    expect(sweepInserts[0]).toMatchObject({ scope: "MESSAGES", dry_run: true });
  });

  it("leaves the cursor at its last successful position when a batch fails, so it is retried rather than skipped", async () => {
    const page = [{ id: "c1", last_activity_at: "2024-01-01T00:00:00.000Z", booking_linked: false }];
    const { db, cursorUpserts, sweepInserts } = createFakeDb([page], { messagesQueryError: "connection reset" });

    const summaries = await runRetentionSweepForAgency(db, "agency-1", { dryRun: false, batchSize: 5 });

    expect(cursorUpserts).toHaveLength(0);
    expect(summaries.find((s) => s.scope === "MESSAGES")?.error).toMatch(/connection reset/);
    expect(sweepInserts[0]).toMatchObject({ scope: "MESSAGES", error: expect.stringContaining("connection reset") });
  });

  it("stops paging once the batch budget is exhausted, so one agency cannot starve the cron run", async () => {
    const page = [{ id: "c1", last_activity_at: "2024-01-01T00:00:00.000Z", booking_linked: false }];
    const { db, rpc } = createFakeDb([page, page, page, page]);

    await runRetentionSweepForAgency(db, "agency-1", { dryRun: false, batchSize: 1, maxBatches: 2 });

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("resumable ATTACHMENTS retention sweep (FIX2, generalized to every scope)", () => {
  it("pages by keyset cursor, removes storage objects before deleting rows, and keeps its own cursor separate from MESSAGES", async () => {
    const pageOne = [
      { id: "a1", storage_path: "agency-1/a1/passport.jpg", created_at: "2024-01-01T00:00:00.000Z" },
      { id: "a2", storage_path: "agency-1/a2/x.jpg", created_at: "2024-01-02T00:00:00.000Z" },
    ];
    const { db, cursorUpserts, attachmentTable, storageRemove } = createFakeDb([[]], { attachmentPages: [pageOne, []] });

    await runRetentionSweepForAgency(db, "agency-1", { dryRun: false, batchSize: 2 });

    // VOICE_AUDIO shares the same `message_attachments` table and runs right after
    // ATTACHMENTS in the scope list; its own fetch (tagged by the `.like()` filter
    // ATTACHMENTS never calls) finds nothing, so only the non-`like` calls are ATTACHMENTS'.
    expect(attachmentTable.fetchFilters.filter((f) => f.like === undefined)).toHaveLength(2);
    expect(storageRemove).toHaveBeenCalledWith(["agency-1/a1/passport.jpg", "agency-1/a2/x.jpg"]);
    expect(attachmentTable.deletions).toEqual([["a1", "a2"]]);
    const attachmentsCursor = cursorUpserts.filter((row) => row.scope === "ATTACHMENTS");
    expect(attachmentsCursor).toHaveLength(1);
    expect(attachmentsCursor[0]).toMatchObject({ agency_id: "agency-1", scope: "ATTACHMENTS", cursor_at: "2024-01-02T00:00:00.000Z", cursor_id: "a2" });
  });

  it("previews the same candidates on a dry run without removing storage objects, deleting rows, or persisting a cursor", async () => {
    const pageOne = [{ id: "a1", storage_path: "agency-1/a1/passport.jpg", created_at: "2024-01-01T00:00:00.000Z" }];
    const { db, cursorUpserts, attachmentTable, storageRemove } = createFakeDb([[]], { attachmentPages: [pageOne] });

    const summaries = await runRetentionSweepForAgency(db, "agency-1", { dryRun: true, batchSize: 5 });

    expect(storageRemove).not.toHaveBeenCalled();
    expect(attachmentTable.deletions).toHaveLength(0);
    expect(cursorUpserts.filter((row) => row.scope === "ATTACHMENTS")).toHaveLength(0);
    expect(summaries.find((s) => s.scope === "ATTACHMENTS")).toMatchObject({ rowsDeleted: 1, objectsDeleted: 1, dryRun: true, error: null });
  });
});

describe("FIX2 booking-linked classification migration", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202092900_fix2_retention_resumable_sweep.sql"), "utf8");

  it("classifies a conversation as booking-linked via a direct source link or a converted lead", () => {
    expect(sql).toMatch(/departure_group_bookings b[\s\S]+source_conversation_id = c\.id/);
    expect(sql).toMatch(/public\.leads l[\s\S]+l\.id = c\.lead_id and l\.booking_id is not null/);
  });

  it("orders and pages candidates by the keyset the application cursor tracks", () => {
    expect(sql).toMatch(/\(c\.last_activity_at, c\.id\) > \(p_cursor_at, p_cursor_id\)/);
    expect(sql).toMatch(/order by last_activity_at, id/);
  });

  it("restricts the candidate function and cursor table to the service role", () => {
    expect(sql).toMatch(/grant execute on function public\.inbox_retention_candidate_conversations[^;]+to service_role/);
    expect(sql).toMatch(/revoke all on public\.inbox_retention_cursors from anon, authenticated/);
  });
});

describe("FIX2 measured performance follow-up: the conversation keyset index", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202093000_fix2_retention_conversation_keyset_index.sql"), "utf8");

  it("adds exactly the index the candidate query's own filter and order need, no more", () => {
    // EXPLAIN (ANALYZE, BUFFERS) at 100k seeded conversations showed a parallel
    // sequential scan + external sort without this index (~104ms for one page,
    // already over budget) — see docs/progress/ for the recorded before/after.
    expect(sql).toMatch(/create index if not exists conversations_agency_activity_id_idx\s*\n\s*on public\.conversations \(agency_id, last_activity_at, id\);/);
  });
});
