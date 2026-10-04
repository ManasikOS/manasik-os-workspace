import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { upsertConversationForInbound } from "./whatsapp-repository";

/** A conversations table with one existing row, recording what is written to it and to the events table. */
function reopenDb(existingState: string, eventError: { message: string } | null = null) {
  const events: unknown[] = [];
  const row = { id: "c1", agency_id: "agency", state: existingState, lead_id: null, contact_name: "Afraz" };
  const conversations = {
    select: () => conversations,
    eq: () => conversations,
    // A copy, as a real read returns: the later update must not change what was read.
    maybeSingle: async () => ({ data: { ...row }, error: null }),
    update: (patch: Record<string, unknown>) => {
      Object.assign(row, patch);
      return conversations;
    },
    single: async () => ({ data: row, error: null }),
  };
  const db = {
    from: (table: string) => (table === "conversation_events" ? { insert: async (event: unknown) => (events.push(event), { error: eventError }) } : conversations),
  };
  return { db, events };
}

const input = { agencyId: "agency", externalConversationId: "94771234567", contactName: "Afraz" };

describe("upsertConversationForInbound reopening", () => {
  it("records that the customer reopened a closed conversation", async () => {
    const { db, events } = reopenDb("CLOSED");
    await upsertConversationForInbound(db as never, input);
    expect(events).toEqual([expect.objectContaining({ agency_id: "agency", conversation_id: "c1", kind: "CUSTOMER_REOPENED", actor_kind: "CUSTOMER", actor_id: null })]);
  });

  it("records nothing for a conversation that was already open", async () => {
    for (const state of ["AI_ACTIVE", "HUMAN_ACTIVE", "HUMAN_REQUESTED"]) {
      const { db, events } = reopenDb(state);
      await upsertConversationForInbound(db as never, input);
      expect(events).toEqual([]);
    }
  });

  it("still stores the message's conversation when the event cannot be written", async () => {
    const { db } = reopenDb("CLOSED", { message: "no grant" });
    await expect(upsertConversationForInbound(db as never, input)).resolves.toMatchObject({ id: "c1" });
  });
});
