import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  acknowledgeIntervention,
  findOpenInterventions,
  listInterventions,
  loadIntelligence,
  openIntervention,
  recordSignals,
  resolveIntervention,
  supersedeSignals,
  toConversationIntelligence,
  upsertIntelligence,
} = await import("./conversation-intelligence-repository");

const AGENCY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENCY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONV_A = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const CONV_B = "3f1d2c4e-5a6b-4c7d-8e9f-000000000002";
const MSG = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a1";
const STAFF = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000b1";

type Row = Record<string, unknown>;

/**
 * A small in-memory Supabase stand-in that honours eq / in / is filters, upsert-on-conflict, and the two unique
 * indexes the migration defines (open intervention per conversation+kind; live signal per conversation+code+message) —
 * enough to prove the repository scopes every read and write by agency and behaves idempotently.
 */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { conversation_intelligence: [], conversation_signals: [], conversation_interventions: [], ...seed };
  let nextId = 1;
  const log: Array<{ table: string; op: string; filters: Array<[string, unknown]> }> = [];

  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    const described: Array<[string, unknown]> = [];
    let op = "select";
    let payload: Row | Row[] | null = null;
    let upsertKey: string | null = null;
    let single: "single" | "maybe" | null = null;
    let returning = false;

    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      log.push({ table, op, filters: described });
      const rows = (tables[table] ??= []);
      const matching = () => rows.filter((row) => filters.every((test) => test(row)));
      const finish = (data: Row[]) => {
        if (single === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "no row" } };
        if (single === "maybe") return { data: data[0] ?? null, error: null };
        return { data, error: null };
      };

      if (op === "insert") {
        const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const created: Row[] = [];
        for (const row of incoming) {
          const full: Row = { id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`, status: "OPEN", superseded_at: null, created_at: "2026-09-20T10:00:00Z", resolved_at: null, resolved_by: null, resolution_note: null, ...row };
          const clash =
            (table === "conversation_interventions" && rows.some((r) => r.agency_id === full.agency_id && r.conversation_id === full.conversation_id && r.kind === full.kind && ["OPEN", "ACKNOWLEDGED"].includes(String(r.status)))) ||
            (table === "conversation_signals" && rows.some((r) => r.agency_id === full.agency_id && r.conversation_id === full.conversation_id && r.signal_code === full.signal_code && (r.message_id ?? null) === (full.message_id ?? null) && r.superseded_at === null));
          if (clash) return { data: null, error: { message: "duplicate key", code: "23505" } };
          rows.push(full);
          created.push(full);
        }
        return returning ? finish(created) : { data: null, error: null };
      }
      if (op === "upsert") {
        const row = payload as Row;
        const existing = rows.find((r) => r[upsertKey as string] === row[upsertKey as string]);
        if (existing) Object.assign(existing, row);
        else rows.push({ ...row });
        return { data: null, error: null };
      }
      if (op === "update") {
        const changed = matching();
        for (const row of changed) Object.assign(row, payload);
        return finish(changed);
      }
      return finish(matching());
    };

    const builder: Record<string, unknown> = {
      select: () => { if (op === "insert" || op === "update") returning = true; return builder; },
      insert: (row: Row | Row[]) => { op = "insert"; payload = row; return builder; },
      update: (row: Row) => { op = "update"; payload = row; return builder; },
      upsert: (row: Row, options: { onConflict: string }) => { op = "upsert"; payload = row; upsertKey = options.onConflict; return builder; },
      eq: (column: string, value: unknown) => { described.push([column, value]); filters.push((row) => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      order: () => builder,
      maybeSingle: () => { single = "maybe"; return builder; },
      single: () => { single = "single"; return builder; },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };
  return { db: { from } as never, tables, log };
}

const intelligenceRow = (overrides: Row = {}): Row => ({
  conversation_id: CONV_A, agency_id: AGENCY_A, intent_code: "PACKAGE_ENQUIRY", intent_confidence: "0.91", travel_intent: null, urgency: "NORMAL",
  commercial_stage: "QUALIFYING", sentiment: "NEUTRAL", estimated_value_cents: "180000000", estimated_value_currency: "LKR", risk_level: "NONE",
  next_action_code: "CREATE_QUOTE", language_code: "en", summary: null, open_questions: [], matched_offer: null, source: "RULES", state: "FRESH", note: null,
  pipeline_version: 1, input_fingerprint: "fp-1", computed_at: "2026-09-20T10:00:00Z", stale_at: null, ai_run_id: null, ...overrides,
});

const interventionInput = (overrides: Record<string, unknown> = {}) => ({
  conversationId: CONV_A,
  kind: "PAYMENT_CLAIM" as const,
  severity: "BLOCK" as const,
  headline: "Customer says they paid LKR 250 000",
  guidance: "Ask Finance to check the bank statement.",
  requiredActionCode: "VERIFY_PAYMENT" as const,
  assignedRole: "FINANCE",
  ...overrides,
});

describe("conversation_intelligence", () => {
  it("loads a row, converting Postgres numeric strings and validating the closed enums", async () => {
    const { db } = fakeDb({ conversation_intelligence: [intelligenceRow()] });
    const loaded = await loadIntelligence(db, AGENCY_A, CONV_A);
    expect(loaded).toMatchObject({ intentCode: "PACKAGE_ENQUIRY", intentConfidence: 0.91, estimatedValueCents: 180000000, state: "FRESH", source: "RULES" });
  });

  it("returns null for a conversation never evaluated", async () => {
    expect(await loadIntelligence(fakeDb().db, AGENCY_A, CONV_A)).toBeNull();
  });

  it("rejects a stored row with an out-of-enum value instead of trusting it", () => {
    expect(() => toConversationIntelligence(intelligenceRow({ intent_code: "MADE_UP" }))).toThrow();
  });

  it("cross-agency read: agency B cannot load agency A's row", async () => {
    const { db } = fakeDb({ conversation_intelligence: [intelligenceRow()] });
    expect(await loadIntelligence(db, AGENCY_B, CONV_A)).toBeNull();
  });

  it("upsert is idempotent on input_fingerprint: a replay of the same input writes nothing", async () => {
    const { db, log } = fakeDb({ conversation_intelligence: [intelligenceRow()] });
    const result = await upsertIntelligence(db, AGENCY_A, { conversationId: CONV_A, inputFingerprint: "fp-1", state: "FRESH", pipelineVersion: 1 });
    expect(result).toEqual({ written: false, reason: "UNCHANGED" });
    expect(log.some((entry) => entry.op === "upsert")).toBe(false);
  });

  it("writes when the fingerprint changed, when the pipeline version was bumped, and over a non-FRESH row", async () => {
    for (const scenario of [
      { existing: intelligenceRow(), input: { inputFingerprint: "fp-2", pipelineVersion: 1 } },
      { existing: intelligenceRow(), input: { inputFingerprint: "fp-1", pipelineVersion: 2 } },
      { existing: intelligenceRow({ state: "PENDING" }), input: { inputFingerprint: "fp-1", pipelineVersion: 1 } },
    ]) {
      const { db, tables } = fakeDb({ conversation_intelligence: [scenario.existing] });
      const result = await upsertIntelligence(db, AGENCY_A, { conversationId: CONV_A, state: "FRESH", ...scenario.input });
      expect(result).toEqual({ written: true });
      expect(tables.conversation_intelligence).toHaveLength(1);
    }
  });

  it("stamps the agency on the write and creates a first PENDING row with just a fingerprint", async () => {
    const { db, tables } = fakeDb();
    await upsertIntelligence(db, AGENCY_A, { conversationId: CONV_A, inputFingerprint: "pending", state: "PENDING" });
    expect(tables.conversation_intelligence[0]).toMatchObject({ conversation_id: CONV_A, agency_id: AGENCY_A, state: "PENDING", pipeline_version: 1 });
    expect(tables.conversation_intelligence[0]).not.toHaveProperty("intent_code");
  });
});

describe("conversation_signals", () => {
  const refund = { signalCode: "REFUND_REQUEST" as const, messageId: MSG, detector: "RULE" as const, evidence: [{ messageId: MSG, snippet: "I want a refund" }] };

  it("records new signals stamped with the agency and conversation", async () => {
    const { db, tables } = fakeDb();
    expect(await recordSignals(db, AGENCY_A, CONV_A, [refund, { signalCode: "DISTRESS_LANGUAGE", detector: "RULE" }])).toBe(2);
    expect(tables.conversation_signals).toHaveLength(2);
    expect(tables.conversation_signals[0]).toMatchObject({ agency_id: AGENCY_A, conversation_id: CONV_A, signal_code: "REFUND_REQUEST", message_id: MSG });
  });

  it("a replay never double-records a live signal", async () => {
    const { db, tables } = fakeDb();
    await recordSignals(db, AGENCY_A, CONV_A, [refund]);
    expect(await recordSignals(db, AGENCY_A, CONV_A, [refund, refund])).toBe(0);
    expect(tables.conversation_signals).toHaveLength(1);
  });

  it("treats a duplicate the database catches (a concurrent worker) as already recorded, not as an error", async () => {
    const { db } = fakeDb();
    const racing = {
      from: (table: string) => {
        const real = (db as never as { from: (t: string) => Record<string, unknown> }).from(table);
        return { ...real, insert: () => ({ then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: "duplicate", code: "23505" } }) }) };
      },
    } as never;
    expect(await recordSignals(racing, AGENCY_A, CONV_A, [refund])).toBe(0);
  });

  it("rejects an unknown signal code before touching the database", async () => {
    const { db, log } = fakeDb();
    await expect(recordSignals(db, AGENCY_A, CONV_A, [{ signalCode: "MADE_UP" as never, detector: "RULE" }])).rejects.toThrow();
    expect(log).toHaveLength(0);
  });

  it("supersedes only this agency's live signals, optionally restricted to some codes, and allows re-signalling", async () => {
    const { db, tables } = fakeDb();
    await recordSignals(db, AGENCY_A, CONV_A, [refund, { signalCode: "DISTRESS_LANGUAGE", detector: "RULE" }]);
    tables.conversation_signals.push({ id: "x", agency_id: AGENCY_B, conversation_id: CONV_A, signal_code: "REFUND_REQUEST", message_id: MSG, superseded_at: null });

    expect(await supersedeSignals(db, AGENCY_A, CONV_A, { codes: ["REFUND_REQUEST"] })).toBe(1);
    expect(tables.conversation_signals.find((row) => row.agency_id === AGENCY_B)?.superseded_at).toBeNull();
    expect(await recordSignals(db, AGENCY_A, CONV_A, [refund])).toBe(1);
    expect(await supersedeSignals(db, AGENCY_A, CONV_A)).toBe(2);
  });
});

describe("conversation_interventions", () => {
  it("opens an intervention scoped to the agency", async () => {
    const { db, tables } = fakeDb();
    const { intervention, created } = await openIntervention(db, AGENCY_A, interventionInput());
    expect(created).toBe(true);
    expect(intervention).toMatchObject({ kind: "PAYMENT_CLAIM", status: "OPEN", severity: "BLOCK", requiredActionCode: "VERIFY_PAYMENT" });
    expect(tables.conversation_interventions[0].agency_id).toBe(AGENCY_A);
  });

  it("returns the existing open card instead of stacking a second one of the same kind", async () => {
    const { db, tables } = fakeDb();
    const first = await openIntervention(db, AGENCY_A, interventionInput());
    const second = await openIntervention(db, AGENCY_A, interventionInput({ headline: "Same claim, again" }));
    expect(second.created).toBe(false);
    expect(second.intervention.id).toBe(first.intervention.id);
    expect(tables.conversation_interventions).toHaveLength(1);
  });

  it("validates its input: unknown kind, empty headline and a non-uuid conversation are rejected", async () => {
    const { db } = fakeDb();
    await expect(openIntervention(db, AGENCY_A, interventionInput({ kind: "MADE_UP" }))).rejects.toThrow();
    await expect(openIntervention(db, AGENCY_A, interventionInput({ headline: "   " }))).rejects.toThrow();
    await expect(openIntervention(db, AGENCY_A, interventionInput({ conversationId: "not-a-uuid" }))).rejects.toThrow();
  });

  it("resolving requires a note and an actor, and marks the intervention closed", async () => {
    const { db } = fakeDb();
    const { intervention } = await openIntervention(db, AGENCY_A, interventionInput());
    await expect(resolveIntervention(db, AGENCY_A, { interventionId: intervention.id, status: "RESOLVED", note: "   ", actorStaffId: STAFF })).rejects.toThrow(/note is required/);
    const closed = await resolveIntervention(db, AGENCY_A, { interventionId: intervention.id, status: "RESOLVED", note: "Finance confirmed receipt", actorStaffId: STAFF });
    expect(closed).toMatchObject({ status: "RESOLVED", resolutionNote: "Finance confirmed receipt", resolvedBy: STAFF });
    expect(closed?.resolvedAt).not.toBeNull();
  });

  it("cross-agency: agency B cannot resolve or acknowledge agency A's intervention", async () => {
    const { db, tables } = fakeDb();
    const { intervention } = await openIntervention(db, AGENCY_A, interventionInput());
    expect(await resolveIntervention(db, AGENCY_B, { interventionId: intervention.id, status: "DISMISSED", note: "not mine", actorStaffId: STAFF })).toBeNull();
    expect(await acknowledgeIntervention(db, AGENCY_B, intervention.id)).toBeNull();
    expect(tables.conversation_interventions[0].status).toBe("OPEN");
  });

  it("an already-closed intervention cannot be closed twice", async () => {
    const { db } = fakeDb();
    const { intervention } = await openIntervention(db, AGENCY_A, interventionInput());
    const input = { interventionId: intervention.id, status: "DISMISSED" as const, note: "false alarm", actorStaffId: STAFF };
    expect(await resolveIntervention(db, AGENCY_A, input)).not.toBeNull();
    expect(await resolveIntervention(db, AGENCY_A, input)).toBeNull();
  });

  it("acknowledging moves OPEN to ACKNOWLEDGED, which still counts as open", async () => {
    const { db } = fakeDb();
    const { intervention } = await openIntervention(db, AGENCY_A, interventionInput());
    expect((await acknowledgeIntervention(db, AGENCY_A, intervention.id))?.status).toBe("ACKNOWLEDGED");
    expect(await findOpenInterventions(db, AGENCY_A, CONV_A)).toHaveLength(1);
  });

  describe("the open-intervention gate query", () => {
    it("sees an open PAYMENT_CLAIM, stops seeing it once resolved, and can be limited to certain kinds", async () => {
      const { db } = fakeDb();
      const { intervention } = await openIntervention(db, AGENCY_A, interventionInput());
      await openIntervention(db, AGENCY_A, interventionInput({ kind: "COMPLAINT", severity: "REVIEW", requiredActionCode: "ESCALATE_TO_HUMAN" }));

      expect(await findOpenInterventions(db, AGENCY_A, CONV_A)).toHaveLength(2);
      expect((await findOpenInterventions(db, AGENCY_A, CONV_A, ["PAYMENT_CLAIM"])).map((row) => row.kind)).toEqual(["PAYMENT_CLAIM"]);

      await resolveIntervention(db, AGENCY_A, { interventionId: intervention.id, status: "RESOLVED", note: "Paid and recorded", actorStaffId: STAFF });
      expect(await findOpenInterventions(db, AGENCY_A, CONV_A, ["PAYMENT_CLAIM"])).toEqual([]);
      expect(await listInterventions(db, AGENCY_A, CONV_A)).toHaveLength(2);
      expect(await listInterventions(db, AGENCY_A, CONV_A, { openOnly: true })).toHaveLength(1);
    });

    it("never reports another agency's intervention as blocking this one", async () => {
      const { db } = fakeDb();
      await openIntervention(db, AGENCY_A, interventionInput());
      expect(await findOpenInterventions(db, AGENCY_B, CONV_A)).toEqual([]);
      expect(await findOpenInterventions(db, AGENCY_A, CONV_B)).toEqual([]);
    });

    it("throws on a read error rather than answering 'clear' — a gate that cannot look must not open", async () => {
      const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "timeout" } }) }) }) }) }) } as never;
      await expect(findOpenInterventions(broken, AGENCY_A, CONV_A)).rejects.toThrow(/timeout/);
    });
  });
});

describe("every query is agency-scoped", () => {
  it("each read and write filters by agency_id", async () => {
    const { db, log } = fakeDb({ conversation_intelligence: [intelligenceRow()] });
    await loadIntelligence(db, AGENCY_A, CONV_A);
    const { intervention } = await openIntervention(db, AGENCY_A, interventionInput());
    await listInterventions(db, AGENCY_A, CONV_A);
    await findOpenInterventions(db, AGENCY_A, CONV_A);
    await resolveIntervention(db, AGENCY_A, { interventionId: intervention.id, status: "RESOLVED", note: "done", actorStaffId: STAFF });
    await supersedeSignals(db, AGENCY_A, CONV_A);
    for (const entry of log.filter((row) => row.op !== "insert" && row.op !== "upsert")) {
      expect(entry.filters.some(([column, value]) => column === "agency_id" && value === AGENCY_A)).toBe(true);
    }
  });
});
