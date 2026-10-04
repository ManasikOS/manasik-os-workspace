import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordGateDecision } = await import("./gate-log");
const { GATE_REASONS } = await import("./contracts");
const { shouldEnrich } = await import("./gate");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const MESSAGE = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a1";

function fakeDb(result: { error: { message: string } | null } | "throw") {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    db: {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          if (result === "throw") throw new Error("network down");
          rows.push({ table, ...row });
          return result;
        },
      }),
    } as never,
  };
}

const skipDecision = shouldEnrich({
  message: { text: "thanks", type: "TEXT" },
  conversation: { lifecycleStatus: "OPEN", handlingMode: "AI_ACTIVE", awaitingCustomerAnswer: false },
  staff: { lastActiveAt: null },
  previous: null,
  current: { fingerprint: "f", pipelineVersion: 1 },
  surface: { enabled: true, mode: "ACTIVE" },
  entitlementExhausted: false,
  now: new Date("2026-09-20T10:00:00Z"),
});

describe("recordGateDecision", () => {
  it("logs a skip with its reason, stamped with the agency", async () => {
    const { db, rows } = fakeDb({ error: null });
    expect(await recordGateDecision(db, { agencyId: AGENCY, conversationId: CONVERSATION, messageId: MESSAGE, decision: skipDecision })).toBe(true);
    expect(rows).toEqual([
      { table: "inbox_gate_decisions", agency_id: AGENCY, conversation_id: CONVERSATION, message_id: MESSAGE, decision: "SKIP", reason: "SKIP_ACKNOWLEDGEMENT", escalate_to_risk: false },
    ]);
  });

  it("logs an enrichment as ENRICH, and records a risk escalation even on a skip", async () => {
    const { db, rows } = fakeDb({ error: null });
    await recordGateDecision(db, { agencyId: AGENCY, conversationId: CONVERSATION, decision: { enrich: true, reason: "ENRICH_NEW_CONVERSATION", escalateToRisk: false, redFlags: [] } });
    await recordGateDecision(db, { agencyId: AGENCY, conversationId: CONVERSATION, decision: { enrich: false, reason: "SKIP_CLOSED", escalateToRisk: true, redFlags: ["REFUND_REQUEST"] } });
    expect(rows.map((row) => [row.decision, row.reason, row.escalate_to_risk, row.message_id])).toEqual([
      ["ENRICH", "ENRICH_NEW_CONVERSATION", false, null],
      ["SKIP", "SKIP_CLOSED", true, null],
    ]);
  });

  it("never throws: a database error or a thrown exception returns false so the message still gets processed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await recordGateDecision(fakeDb({ error: { message: "violates check" } }).db, { agencyId: AGENCY, conversationId: CONVERSATION, decision: skipDecision })).toBe(false);
    expect(await recordGateDecision(fakeDb("throw").db, { agencyId: AGENCY, conversationId: CONVERSATION, decision: skipDecision })).toBe(false);
  });
});

describe("the migration mirrors the closed reason list", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261202090800_mi2_3_gate_reason_constraint.sql"), "utf8");

  it("allows exactly the GATE_REASONS the code can produce — no more, no fewer", () => {
    const block = /inbox_gate_decisions_reason_check check \(reason in \(([\s\S]*?)\)\);/.exec(sql);
    expect(block).not.toBeNull();
    const inSql = [...(block?.[1] ?? "").matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
    expect(inSql).toEqual([...GATE_REASONS].sort());
  });

  it("requires a decision and its reason to agree, so a skip can never be logged without a skip reason", () => {
    expect(sql).toMatch(/decision = 'ENRICH' and reason like 'ENRICH\\_%'/);
    expect(sql).toMatch(/decision = 'SKIP' and reason like 'SKIP\\_%'/);
  });
});
