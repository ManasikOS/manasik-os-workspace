import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { SOURCE_LINKED_TABLES, stampConversationSource } = await import("./source-link");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MESSAGE = "e0000000-0000-4000-8000-000000000001";

type Call = { method: string; args: unknown[] };

function fakeDb(options: { message?: string | null; updateResult?: { data: unknown; error: { message: string } | null } } = {}) {
  const calls: Call[] = [];
  const message = options.message === undefined ? MESSAGE : options.message;
  const update = options.updateResult ?? { data: { id: "row" }, error: null };
  const db = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      const builder: Record<string, unknown> = new Proxy({}, {
        get: (_target, method: string) => {
          if (method === "maybeSingle") return async () => (table === "conversation_messages" ? { data: message ? { id: message } : null, error: null } : update);
          if (method === "then") return undefined;
          return (...args: unknown[]) => { calls.push({ method, args }); return builder; };
        },
      });
      return builder;
    },
  };
  return { db: db as never, calls };
}

const target = (overrides = {}) => ({ agencyId: AGENCY, table: "leads" as const, by: { column: "id" as const, value: "lead-1" }, conversationId: CONVERSATION, ...overrides });

describe("stampConversationSource", () => {
  it("points the row at the conversation and the customer's message, within the agency, only where it has no source yet", async () => {
    const { db, calls } = fakeDb();
    expect(await stampConversationSource(db, target())).toBe(true);
    expect(calls.find((call) => call.method === "update")?.args[0]).toEqual({ source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "agency_id" && call.args[1] === AGENCY)).toBe(true);
    expect(calls.some((call) => call.method === "is" && call.args[0] === "source_conversation_id" && call.args[1] === null)).toBe(true);
  });

  it("finds a quote by its reference", async () => {
    const { db, calls } = fakeDb();
    await stampConversationSource(db, target({ table: "lead_quotes", by: { column: "reference", value: "QT-2026-0007" } }));
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "reference" && call.args[1] === "QT-2026-0007")).toBe(true);
  });

  it("leaves a row that already knows its origin alone", async () => {
    const { db } = fakeDb({ updateResult: { data: null, error: null } });
    expect(await stampConversationSource(db, target())).toBe(false);
  });

  it("never throws: a failed write (or a missing column before the migration) is logged and reported false", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ updateResult: { data: null, error: { message: "column does not exist" } } });
    expect(await stampConversationSource(db, target())).toBe(false);
  });
});

describe("MI4.6 migration", () => {
  const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261202092000_mi4_6_conversation_source_links.sql"), "utf8");

  it("covers every table a conversion or a stamped flow writes to", () => {
    for (const table of [...SOURCE_LINKED_TABLES, "departure_group_tasks", "pilgrim_support_requests"]) expect(sql).toContain(`'${table}'`);
  });

  it("uses tenant-safe composite foreign keys that clear only the pointer on delete", () => {
    expect(sql).toMatch(/foreign key \(source_conversation_id, agency_id\) references public\.conversations \(id, agency_id\) on delete set null \(source_conversation_id\)/);
    expect(sql).toMatch(/foreign key \(source_message_id, agency_id\) references public\.conversation_messages \(id, agency_id\) on delete set null \(source_message_id\)/);
  });

  it("refuses a message pointer without its conversation pointer", () => {
    expect(sql).toMatch(/source_message_id is null or source_conversation_id is not null/);
  });
});
