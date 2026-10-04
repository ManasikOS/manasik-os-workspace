import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { claimFollowup, summariseNudgeLedger } = await import("@/lib/data/conversation-followups-repository");

/** A minimal stand-in for the Supabase client: an insert chain that enforces the ledger's unique key. */
function fakeLedgerDb() {
  const keys = new Set<string>();
  let counter = 0;
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const key = [row.conversation_id, row.kind, row.sequence, row.anchor_message_id].join("|");
            if (keys.has(key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
            keys.add(key);
            counter += 1;
            return { data: { id: `row-${counter}` }, error: null };
          },
        }),
      }),
    }),
  };
}

const claim = {
  agencyId: "a1",
  conversationId: "c1",
  leadId: "l1",
  kind: "QUIET_NUDGE" as const,
  sequence: 1,
  anchorMessageId: "m1",
  channel: "MESSENGER",
  status: "CLAIMED" as const,
};

describe("claimFollowup", () => {
  it("claims a step once and refuses the same step a second time", async () => {
    const db = fakeLedgerDb();
    expect(await claimFollowup(db as never, claim)).toEqual({ claimed: true, id: "row-1" });
    expect(await claimFollowup(db as never, claim)).toEqual({ claimed: false });
  });

  it("treats a different anchor message or sequence as a new step", async () => {
    const db = fakeLedgerDb();
    await claimFollowup(db as never, claim);
    expect((await claimFollowup(db as never, { ...claim, anchorMessageId: "m2" })).claimed).toBe(true);
    expect((await claimFollowup(db as never, { ...claim, sequence: 2 })).claimed).toBe(true);
    expect((await claimFollowup(db as never, { ...claim, kind: "HANDOFF_ALERT" })).claimed).toBe(true);
  });

  it("rethrows any error other than a duplicate", async () => {
    const db = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "42501", message: "denied" } }) }) }) }) };
    await expect(claimFollowup(db as never, claim)).rejects.toThrow(/42501/);
  });
});

describe("summariseNudgeLedger", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "x",
    conversation_id: "c1",
    kind: "QUIET_NUDGE",
    sequence: 1,
    anchor_message_id: "m1",
    status: "SENT",
    created_at: "2026-10-01T10:00:00Z",
    ...over,
  });

  it("counts rows for this anchor only and reports the newest sent nudge across anchors", () => {
    const rows = [
      row({ id: "1", anchor_message_id: "m2", created_at: "2026-10-01T11:00:00Z" }),
      row({ id: "2", sequence: 2 }),
      row({ id: "3" }),
    ] as never;
    expect(summariseNudgeLedger(rows, "c1", "m1")).toEqual({ nudgesRecorded: 2, lastNudgeAt: "2026-10-01T11:00:00Z", stopped: false });
  });

  it("marks the sequence stopped after a failure or skip, but not after a dry run", () => {
    expect(summariseNudgeLedger([row({ status: "FAILED" })] as never, "c1", "m1").stopped).toBe(true);
    expect(summariseNudgeLedger([row({ status: "SKIPPED" })] as never, "c1", "m1").stopped).toBe(true);
    expect(summariseNudgeLedger([row({ status: "DRY_RUN" })] as never, "c1", "m1").stopped).toBe(false);
  });

  it("ignores other conversations and alert rows", () => {
    const rows = [row({ conversation_id: "c2" }), row({ kind: "HANDOFF_ALERT" })] as never;
    expect(summariseNudgeLedger(rows, "c1", "m1")).toEqual({ nudgesRecorded: 0, lastNudgeAt: null, stopped: false });
  });
});
