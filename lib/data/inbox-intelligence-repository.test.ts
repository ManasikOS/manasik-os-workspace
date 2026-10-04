import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { assembleInboxIntelligence } = await import("./inbox-intelligence-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const MESSAGE_OLD = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a1";
const MESSAGE_NEW = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a2";

type Row = Record<string, unknown>;

/** A tiny chainable fake: eq / is / lte filters, ordering and limit over in-memory tables. */
function fakeDb(tables: Record<string, Row[]>, failing: string | null = null) {
  const queries: Array<{ table: string; eq: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const eq: Record<string, unknown> = {};
      const filters: Array<(row: Row) => boolean> = [];
      let orderBy: { column: string; ascending: boolean } | null = null;
      let max = Infinity;
      const run = () => {
        if (failing === table) return { data: null, error: { message: `${table} exploded` } };
        let out = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (orderBy) {
          const { column, ascending } = orderBy;
          out = [...out].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
        }
        return { data: out.slice(0, max), error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          eq[column] = value;
          filters.push((row) => row[column] === value);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        lte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) <= value);
          return builder;
        },
        order: (column: string, options: { ascending: boolean }) => {
          orderBy = { column, ascending: options.ascending };
          return builder;
        },
        limit: (count: number) => {
          max = count;
          return builder;
        },
        maybeSingle: async () => {
          queries.push({ table, eq });
          const result = run();
          return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => unknown) => {
          queries.push({ table, eq });
          return Promise.resolve(run()).then(resolve);
        },
      };
      return builder;
    },
  };
  return { db: db as never, queries };
}

const intelligenceRow = (overrides: Row = {}): Row => ({
  conversation_id: CONVERSATION,
  agency_id: AGENCY,
  intent_code: "PRICE_REQUEST",
  intent_confidence: "0.90",
  travel_intent: null,
  urgency: "NORMAL",
  commercial_stage: "UNQUALIFIED",
  sentiment: "NEUTRAL",
  estimated_value_cents: null,
  estimated_value_currency: null,
  risk_level: "NONE",
  next_action_code: "NO_ACTION",
  language_code: "en",
  summary: null,
  digest: "C: hi",
  open_questions: [],
  matched_offer: null,
  source: "LLM",
  state: "FRESH",
  note: null,
  pipeline_version: 1,
  input_fingerprint: "f",
  computed_at: "2026-09-20T10:00:00.000Z",
  stale_at: null,
  ai_run_id: null,
  ...overrides,
});

const message = (id: string, createdAt: string, actorKind = "CUSTOMER", agency = AGENCY, content = "text"): Row => ({
  id,
  agency_id: agency,
  conversation_id: CONVERSATION,
  actor_kind: actorKind,
  content,
  created_at: createdAt,
});

const signalRow = (code: string, supersededAt: string | null): Row => ({
  agency_id: AGENCY,
  conversation_id: CONVERSATION,
  signal_code: code,
  message_id: MESSAGE_NEW,
  detector: "RULE",
  confidence: "1",
  evidence: [],
  superseded_at: supersededAt,
  created_at: "2026-09-20T10:00:00.000Z",
});

describe("assembleInboxIntelligence", () => {
  it("returns the reading, the surface state, and the customer message it was based on", async () => {
    const { db } = fakeDb({
      ai_surface_settings: [{ agency_id: AGENCY, surface: "INBOX_TRIAGE", enabled: true, mode: "SHADOW" }],
      conversation_intelligence: [intelligenceRow()],
      conversation_signals: [],
      conversation_messages: [
        message(MESSAGE_OLD, "2026-09-20T09:00:00.000Z", "CUSTOMER", AGENCY, "first question"),
        message(MESSAGE_NEW, "2026-09-20T09:59:58.000Z", "CUSTOMER", AGENCY, "  How much   is the\npackage? "),
        message("staff-reply", "2026-09-20T09:59:59.000Z", "STAFF"),
        message("later", "2026-09-20T10:05:00.000Z", "CUSTOMER"),
      ],
    });
    const result = await assembleInboxIntelligence(db, AGENCY, CONVERSATION);
    expect(result.surfaceEnabled).toBe(true);
    expect(result.intelligence?.intentCode).toBe("PRICE_REQUEST");
    expect(result.sourceMessage).toEqual({ id: MESSAGE_NEW, snippet: "How much is the package?", createdAt: "2026-09-20T09:59:58.000Z" });
  });

  it("scopes every read to the agency", async () => {
    const { db, queries } = fakeDb({
      ai_surface_settings: [],
      conversation_intelligence: [intelligenceRow()],
      conversation_signals: [],
      conversation_messages: [message(MESSAGE_NEW, "2026-09-20T09:59:58.000Z")],
    });
    await assembleInboxIntelligence(db, AGENCY, CONVERSATION);
    for (const query of queries) expect(query.eq.agency_id, query.table).toBe(AGENCY);
    expect(queries.map((query) => query.table).sort()).toEqual(["agency_settings", "ai_surface_settings", "ai_surface_settings", "conversation_intelligence", "conversation_interventions", "conversation_messages", "conversation_signals"]);
  });

  it("does not leak another agency's reading or messages", async () => {
    const { db } = fakeDb({
      ai_surface_settings: [{ agency_id: OTHER_AGENCY, surface: "INBOX_TRIAGE", enabled: true, mode: "ACTIVE" }],
      conversation_intelligence: [intelligenceRow({ agency_id: OTHER_AGENCY })],
      conversation_signals: [],
      conversation_messages: [message(MESSAGE_NEW, "2026-09-20T09:59:58.000Z", "CUSTOMER", OTHER_AGENCY)],
    });
    expect(await assembleInboxIntelligence(db, AGENCY, CONVERSATION)).toEqual({ surfaceEnabled: false, riskVisible: false, offerAge: null, intelligence: null, signals: [], interventions: [], sourceMessage: null });
  });

  it("shows the S4 risk signals only once INBOX_RISK is past SHADOW (SHADOW records them, staff do not see them)", async () => {
    const cases: Array<[Row[], boolean]> = [
      [[], false],
      [[{ agency_id: AGENCY, surface: "INBOX_RISK", enabled: true, mode: "SHADOW" }], false],
      [[{ agency_id: AGENCY, surface: "INBOX_RISK", enabled: false, mode: "ACTIVE" }], false],
      [[{ agency_id: AGENCY, surface: "INBOX_RISK", enabled: true, mode: "PROPOSE" }], true],
      [[{ agency_id: AGENCY, surface: "INBOX_RISK", enabled: true, mode: "ACTIVE" }], true],
    ];
    for (const [rows, expected] of cases) {
      const { db } = fakeDb({ ai_surface_settings: rows, conversation_intelligence: [], conversation_signals: [], conversation_messages: [] });
      expect((await assembleInboxIntelligence(db, AGENCY, CONVERSATION)).riskVisible, JSON.stringify(rows)).toBe(expected);
    }
  });

  it("treats a missing, disabled or OFF surface as not in use", async () => {
    const cases: Row[][] = [
      [],
      [{ agency_id: AGENCY, surface: "INBOX_TRIAGE", enabled: false, mode: "SHADOW" }],
      [{ agency_id: AGENCY, surface: "INBOX_TRIAGE", enabled: true, mode: "OFF" }],
    ];
    for (const rows of cases) {
      const { db } = fakeDb({ ai_surface_settings: rows, conversation_intelligence: [], conversation_signals: [], conversation_messages: [] });
      expect((await assembleInboxIntelligence(db, AGENCY, CONVERSATION)).surfaceEnabled).toBe(false);
    }
  });

  it("skips the message lookup while a reading is pending, failed or skipped, since nothing was based on a message yet", async () => {
    for (const state of ["PENDING", "FAILED", "SKIPPED"]) {
      const { db, queries } = fakeDb({
        ai_surface_settings: [],
        conversation_intelligence: [intelligenceRow({ state, intent_code: null })],
        conversation_signals: [],
        conversation_messages: [message(MESSAGE_NEW, "2026-09-20T09:59:58.000Z")],
      });
      const result = await assembleInboxIntelligence(db, AGENCY, CONVERSATION);
      expect(result.sourceMessage).toBeNull();
      expect(queries.some((query) => query.table === "conversation_messages")).toBe(false);
    }
  });

  it("returns live signals only", async () => {
    const { db } = fakeDb({
      ai_surface_settings: [],
      conversation_intelligence: [],
      conversation_signals: [signalRow("REFUND_REQUEST", null), signalRow("DISTRESS_LANGUAGE", "2026-09-20T11:00:00.000Z")],
      conversation_messages: [],
    });
    expect((await assembleInboxIntelligence(db, AGENCY, CONVERSATION)).signals.map((signal) => signal.signalCode)).toEqual(["REFUND_REQUEST"]);
  });

  it("fails loudly rather than showing a half-empty rail when a read fails", async () => {
    const tables = { ai_surface_settings: [], conversation_intelligence: [intelligenceRow()], conversation_signals: [], conversation_messages: [] };
    for (const failing of ["ai_surface_settings", "conversation_intelligence", "conversation_signals", "conversation_messages"]) {
      await expect(assembleInboxIntelligence(fakeDb(tables, failing).db, AGENCY, CONVERSATION), failing).rejects.toThrow("exploded");
    }
  });
});

describe("a change to the projection refreshes an open Inbox (migration 20261202091000)", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202091000_mi2_5_intelligence_realtime.sql"), "utf8");

  it("sends the existing invalidation broadcast on every insert, update and delete", () => {
    expect(sql).toMatch(
      /create trigger conversation_intelligence_inbox_realtime\s+after insert or update or delete on public\.conversation_intelligence\s+for each row execute function public\.broadcast_inbox_invalidation\(\)/,
    );
  });

  it("reuses the function whose payload carries only the conversation id", () => {
    const original = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20260916081405_inbox_realtime_broadcast.sql"), "utf8");
    expect(original).toMatch(/jsonb_build_object\('conversation_id', v_conversation_id\)/);
  });
});
