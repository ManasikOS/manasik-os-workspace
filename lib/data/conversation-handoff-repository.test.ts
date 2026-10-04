import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

const { acknowledgeConversationHandoff, listUnacknowledgedConversationHandoffs } = await import("./conversation-handoff-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HANDOFF = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STAFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("conversation handoff repository", () => {
  it("scopes the Operations queue to one agency before returning handoffs", async () => {
    const eq = vi.fn(() => ({ is: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [], error: null })) })) })) }));
    const db = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) };
    await expect(listUnacknowledgedConversationHandoffs(db as never, AGENCY)).resolves.toEqual([]);
    expect(eq).toHaveBeenCalledWith("agency_id", AGENCY);
  });

  it("records the authenticated actor and refuses a missing or already acknowledged row", async () => {
    const maybeSingle = vi.fn<() => Promise<{ data: { id: string } | null; error: null }>>(async () => ({ data: { id: HANDOFF }, error: null }));
    const select = vi.fn(() => ({ maybeSingle }));
    const is = vi.fn(() => ({ select }));
    const secondEq = vi.fn(() => ({ is }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const update = vi.fn(() => ({ eq: firstEq }));
    const db = { from: vi.fn(() => ({ update })) };

    await acknowledgeConversationHandoff(db as never, AGENCY, HANDOFF, STAFF);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ acknowledged_by: STAFF, acknowledged_at: expect.any(String) }));
    expect(firstEq).toHaveBeenCalledWith("agency_id", AGENCY);
    expect(secondEq).toHaveBeenCalledWith("id", HANDOFF);

    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(acknowledgeConversationHandoff(db as never, AGENCY, HANDOFF, STAFF)).rejects.toThrow("missing or already acknowledged");
  });
});

describe("MI4.5 handoff migration security", () => {
  const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261202091800_mi4_5_conversation_handoffs.sql"), "utf8");

  it("creates the tenant table with RLS and limits staff updates to acknowledgement columns", () => {
    expect(sql).toMatch(/alter table public\.conversation_handoffs enable row level security/);
    expect(sql).toMatch(/grant update \(acknowledged_by, acknowledged_at\) on table public\.conversation_handoffs to authenticated/);
    expect(sql).not.toMatch(/grant select, insert, update on table public\.conversation_handoffs/);
  });

  it("ships the narrator disabled in SHADOW mode", () => {
    expect(sql).toMatch(/'INBOX_HANDOFF', false, 'SHADOW'/);
  });
});
