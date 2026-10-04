import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { upsertConversationForInbound } from "./whatsapp-repository";

const existingRow = { id: "conv-1", agency_id: "agency-1", state: "AI_ACTIVE", lead_id: null, contact_name: "Aisha", connection_id: null, attributed_campaign_id: null };

/**
 * A conversations table where the FIRST select finds nothing and the insert collides (another request created the row
 * in between); after that the row exists.
 */
function racingDb(options: { insertAlwaysCollides?: boolean } = {}) {
  let selects = 0;
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const table = {
    select: () => table,
    eq: () => table,
    maybeSingle: async () => {
      selects += 1;
      return { data: selects === 1 ? null : existingRow, error: null };
    },
    insert: (row: unknown) => {
      inserts.push(row);
      return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
    },
    update: (patch: unknown) => {
      updates.push(patch);
      return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...existingRow, ...(patch as object) }, error: null }) }) }) };
    },
  };
  return { db: { from: () => table }, inserts, updates, selects: () => selects, options };
}

const input = { agencyId: "agency-1", channel: "WHATSAPP" as const, externalConversationId: "94771234567", contactName: "Aisha" };

describe("upsertConversationForInbound — losing the create race", () => {
  it("takes the existing-row path instead of failing, and tells the caller it lost", async () => {
    const h = racingDb();
    const lost = vi.fn();

    const conversation = await upsertConversationForInbound(h.db as never, { ...input, onLostCreateRace: lost });

    expect(conversation.id).toBe("conv-1");
    expect(lost).toHaveBeenCalledTimes(1);
    expect(h.inserts).toHaveLength(1); // one insert attempt, no second
    expect(h.updates).toHaveLength(1); // the inbound activity was applied to the row the other request created
  });

  it("does not loop: a second collision on the retry is reported", async () => {
    // The retry finds no row either (select always empty) and collides again.
    const table = {
      select: () => table,
      eq: () => table,
      maybeSingle: async () => ({ data: null, error: null }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) }),
    };
    await expect(upsertConversationForInbound({ from: () => table } as never, input)).rejects.toThrow();
  });
});
