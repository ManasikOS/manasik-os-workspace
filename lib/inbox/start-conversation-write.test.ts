import { describe, expect, it } from "vitest";

import type { Db } from "@/lib/ai/db";

import { openStartedConversation, type ExistingConversationRow } from "./start-conversation-write";

/**
 * BUG-8 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): starting a chat read the conversation, sent the message and then
 * upserted, so a customer message or a colleague taking the chat in between was overwritten.
 */

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "me";
const fields = { contact_name: "Nimal", contact_phone: "94771234567", last_outbound_at: "2026-10-05T10:00:00.000Z" };

const chat = (extra: Partial<ExistingConversationRow> = {}): ExistingConversationRow => ({ id: "conv-1", state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Nimal", ...extra });

/** A stand-in for the conversations table: one scripted result for each insert and each guarded update, in order. */
function createScriptedDb(script: { inserts?: Array<{ id?: string; code?: string }>; updates?: boolean[] }) {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const insertResults = [...(script.inserts ?? [])];
  const updateResults = [...(script.updates ?? [])];
  const db = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => {
              const next = insertResults.shift() ?? { id: "new-conv" };
              return next.code ? { data: null, error: { code: next.code, message: "duplicate" } } : { data: { id: next.id ?? "new-conv" }, error: null };
            },
          }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: unknown) => ((filters[column] = value), query);
        query.is = (column: string, value: unknown) => ((filters[column] = value), query);
        query.select = async () => {
          updated.push({ patch, filters });
          return { data: (updateResults.shift() ?? true) ? [{ id: filters.id }] : [], error: null };
        };
        return query;
      },
    }),
  } as unknown as Db;
  return { db, inserted, updated };
}

const open = (db: Db, existing: ExistingConversationRow | null, readExisting: () => Promise<ExistingConversationRow | null | "UNREADABLE">) =>
  openStartedConversation(db, { agencyId: AGENCY, channel: "WHATSAPP", externalId: "94771234567", staffId: ME, staffName: "Me", fields, existing, readExisting });

describe("openStartedConversation — no conversation yet", () => {
  it("inserts one owned by the sender, instead of upserting over whatever appears", async () => {
    const fake = createScriptedDb({ inserts: [{ id: "conv-9" }] });
    const result = await open(fake.db, null, async () => null);
    expect(result).toEqual({ ok: true, conversationId: "conv-9", tookOver: true, previous: null });
    expect(fake.inserted[0]).toMatchObject({ agency_id: AGENCY, channel: "WHATSAPP", external_conversation_id: "94771234567", state: "HUMAN_ACTIVE", assigned_to_id: ME, assigned_to_name: "Me", contact_name: "Nimal" });
  });

  it("when a customer message created the chat first, takes it only if it is still unowned, with a guarded update", async () => {
    const fake = createScriptedDb({ inserts: [{ code: "23505" }], updates: [true] });
    const result = await open(fake.db, null, async () => chat());
    expect(result).toMatchObject({ ok: true, conversationId: "conv-1", tookOver: true, previous: { id: "conv-1" } });
    expect(fake.updated[0].filters).toMatchObject({ agency_id: AGENCY, id: "conv-1", state: "AI_ACTIVE", assigned_to_id: null });
  });

  it("when a colleague took the chat that appeared, leaves it exactly as it is", async () => {
    const fake = createScriptedDb({ inserts: [{ code: "23505" }] });
    const result = await open(fake.db, null, async () => chat({ state: "HUMAN_ACTIVE", assigned_to_id: "other", assigned_to_name: "Nadeesha" }));
    expect(result).toMatchObject({ ok: true, conversationId: "conv-1", tookOver: false });
    expect(fake.updated).toEqual([]);
  });

  it("fails when the insert fails for any other reason, or the chat cannot be read again", async () => {
    expect(await open(createScriptedDb({ inserts: [{ code: "42501" }] }).db, null, async () => null)).toEqual({ ok: false });
    expect(await open(createScriptedDb({ inserts: [{ code: "23505" }] }).db, null, async () => "UNREADABLE")).toEqual({ ok: false });
  });
});

describe("openStartedConversation — a conversation exists", () => {
  it("takes over with a write guarded on the state and owner that were checked", async () => {
    const fake = createScriptedDb({ updates: [true] });
    const result = await open(fake.db, chat({ state: "HUMAN_ACTIVE", assigned_to_id: ME, assigned_to_name: "Me" }), async () => null);
    expect(result).toMatchObject({ ok: true, tookOver: true });
    expect(fake.updated[0].filters).toMatchObject({ agency_id: AGENCY, id: "conv-1", state: "HUMAN_ACTIVE", assigned_to_id: ME });
    expect(fake.updated[0].patch).toMatchObject({ state: "HUMAN_ACTIVE", assigned_to_id: ME, contact_name: "Nimal" });
    expect(fake.updated[0].patch).not.toHaveProperty("channel");
    expect(fake.updated[0].patch).not.toHaveProperty("external_conversation_id");
  });

  it("returns the previous owner when it takes over a closed chat that was a colleague's", async () => {
    const fake = createScriptedDb({ updates: [true] });
    const result = await open(fake.db, chat({ state: "CLOSED", assigned_to_id: "other", assigned_to_name: "Nadeesha" }), async () => null);
    expect(result).toMatchObject({ ok: true, tookOver: true, previous: { assigned_to_id: "other", assigned_to_name: "Nadeesha" } });
  });

  it("when the chat changed since it was read, reads it again and decides again instead of overwriting it", async () => {
    const fake = createScriptedDb({ updates: [false] });
    const result = await open(fake.db, chat(), async () => chat({ state: "HUMAN_ACTIVE", assigned_to_id: "other", assigned_to_name: "Nadeesha" }));
    expect(result).toMatchObject({ ok: true, conversationId: "conv-1", tookOver: false, previous: { assigned_to_id: "other" } });
    expect(fake.updated).toHaveLength(1);
  });

  it("when the chat changed but is still free to take, retries once against what it now is", async () => {
    const fake = createScriptedDb({ updates: [false, true] });
    const result = await open(fake.db, chat(), async () => chat({ state: "HUMAN_REQUESTED" }));
    expect(result).toMatchObject({ ok: true, tookOver: true });
    expect(fake.updated.map((entry) => entry.filters.state)).toEqual(["AI_ACTIVE", "HUMAN_REQUESTED"]);
  });

  it("gives up and leaves the chat alone if it keeps changing", async () => {
    const fake = createScriptedDb({ updates: [false, false, false] });
    const result = await open(fake.db, chat(), async () => chat());
    expect(result).toMatchObject({ ok: true, tookOver: false });
    expect(fake.updated).toHaveLength(3);
  });

  it("does not touch a chat a colleague owns, even one it was told about", async () => {
    const fake = createScriptedDb({});
    const result = await open(fake.db, chat({ state: "HUMAN_ACTIVE", assigned_to_id: "other", assigned_to_name: "Nadeesha" }), async () => null);
    expect(result).toMatchObject({ ok: true, tookOver: false });
    expect(fake.updated).toEqual([]);
    expect(fake.inserted).toEqual([]);
  });

  it("fails when it cannot read the chat again", async () => {
    expect(await open(createScriptedDb({ updates: [false] }).db, chat(), async () => "UNREADABLE")).toEqual({ ok: false });
  });
});
