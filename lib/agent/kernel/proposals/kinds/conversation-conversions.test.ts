import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { conversationComplaintCaseExecutor } = await import("./conversation-complaint");
const {
  conversationDocumentRequestExecutor,
  conversationGuideEscalationExecutor,
  conversationPaymentFollowUpExecutor,
  conversationRoomingRequestExecutor,
  conversationTransportRequirementExecutor,
  conversationVisaTaskExecutor,
} = await import("./conversation-tasks");
const { getExecutor } = await import("@/lib/agent/kernel/proposals/registry");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION = "c0000000-0000-4000-8000-000000000002";
const MESSAGE = "e0000000-0000-4000-8000-000000000001";
const FOREIGN_MESSAGE = "e0000000-0000-4000-8000-000000000009";
const LEAD = "10000000-0000-4000-8000-000000000001";
const BOOKING = "b0000000-0000-4000-8000-000000000001";
const GROUP = "90000000-0000-4000-8000-000000000001";
const PILGRIM = "70000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;

/** Tables with eq / is / not-is filters, order, limit, and insert (recorded, returning an id). */
function fakeDb(tables: Record<string, Row[]>, options: { insertError?: Record<string, string> } = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "insert" = "select";
      let payload: Row = {};
      let max = Infinity;
      const run = () => {
        if (mode === "insert") {
          const failure = options.insertError?.[table];
          if (failure) return { data: null, error: { message: failure } };
          const row = { id: `new-${inserts.length + 1}`, ...payload };
          inserts.push({ table, row: payload });
          return { data: [row], error: null };
        }
        return { data: (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, max), error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (value: Row) => { mode = "insert"; payload = value; return builder; },
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
        not: (column: string, operator: string, value: unknown) => { if (operator === "is") filters.push((row) => (row[column] ?? null) !== value); return builder; },
        order: () => builder,
        limit: (count: number) => { max = count; return builder; },
        maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
        single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  };
  return { db: db as never, inserts };
}

const seed = (): Record<string, Row[]> => ({
  conversations: [{ id: CONVERSATION, agency_id: AGENCY, contact_name: "Amina", lead_id: LEAD }],
  conversation_messages: [
    { id: MESSAGE, agency_id: AGENCY, conversation_id: CONVERSATION, direction: "INBOUND", created_at: "2026-09-21" },
    // A message that belongs to a DIFFERENT conversation of the same agency.
    { id: FOREIGN_MESSAGE, agency_id: AGENCY, conversation_id: OTHER_CONVERSATION, direction: "INBOUND", created_at: "2026-09-21" },
  ],
  leads: [{ id: LEAD, agency_id: AGENCY, reference: "LD-1042", booking_id: BOOKING, selected_departure_group_id: null }],
  departure_group_bookings: [{ id: BOOKING, agency_id: AGENCY, departure_group_id: GROUP }],
  departure_group_pilgrims: [{ agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: PILGRIM }],
  departure_groups: [{ id: GROUP, agency_id: AGENCY, group_name: "December Umrah" }],
});

const ctx = (db: never, agencyId = AGENCY) => ({ agencyId, subjectId: CONVERSATION, actor: { id: "s1", name: "Sales Sam", agencyId }, role: "MARKETING" as const, db });
const payload = (overrides: Record<string, unknown> = {}) => ({ conversationId: CONVERSATION, sourceMessageId: MESSAGE, note: "Wants to pray together", labels: {}, ...overrides });

const TASK_EXECUTORS = [
  [conversationDocumentRequestExecutor, "OPERATIONS"],
  [conversationVisaTaskExecutor, "VISA"],
  [conversationPaymentFollowUpExecutor, "FINANCE"],
  [conversationRoomingRequestExecutor, "OPERATIONS"],
  [conversationTransportRequirementExecutor, "OPERATIONS"],
  [conversationGuideEscalationExecutor, "GUIDE"],
] as const;

describe("task-shaped conversions", () => {
  it.each(TASK_EXECUTORS)("%s creates ONE task carrying both source columns", async (executor, category) => {
    const { db, inserts } = fakeDb(seed());
    expect(await executor.execute(payload(), ctx(db))).toEqual({ ok: true });
    const task = inserts.find((entry) => entry.table === "departure_group_tasks")!;
    expect(task.row).toMatchObject({
      agency_id: AGENCY,
      departure_group_id: GROUP,
      category,
      status: "OPEN",
      source_conversation_id: CONVERSATION,
      source_message_id: MESSAGE,
    });
    expect(String(task.row.description)).toContain("Wants to pray together");
    expect(String(task.row.description)).toContain(`/inbox?conversation=${CONVERSATION}`);
  });

  it("uses the booking's group, and refuses when the customer has no departure group at all", async () => {
    const tables = seed();
    tables.leads = [{ id: LEAD, agency_id: AGENCY, reference: "LD-1042", booking_id: null, selected_departure_group_id: null }];
    const { db, inserts } = fakeDb(tables);
    expect(await conversationRoomingRequestExecutor.execute(payload(), ctx(db))).toEqual({ ok: false, error: "Select a departure group for this customer first." });
    expect(inserts).toHaveLength(0);
  });

  it("refuses a message that belongs to another conversation, so it can never become the source", async () => {
    const { db, inserts } = fakeDb(seed());
    const result = await conversationDocumentRequestExecutor.execute(payload({ sourceMessageId: FOREIGN_MESSAGE }), ctx(db));
    expect(result).toEqual({ ok: false, error: "The message this points back at is no longer in this conversation." });
    expect(inserts).toHaveLength(0);
  });

  it("cannot reach another agency's conversation", async () => {
    const { db, inserts } = fakeDb(seed());
    expect(await conversationVisaTaskExecutor.execute(payload(), ctx(db, OTHER_AGENCY))).toEqual({ ok: false, error: "That conversation no longer exists." });
    expect(inserts).toHaveLength(0);
  });

  it("leaves nothing behind when the insert fails", async () => {
    const { db, inserts } = fakeDb(seed(), { insertError: { departure_group_tasks: "boom" } });
    const result = await conversationGuideEscalationExecutor.execute(payload(), ctx(db));
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("supersedes the request when the group changes between the preview and the approval", async () => {
    const before = seed();
    const after = seed();
    after.departure_group_bookings = [{ id: BOOKING, agency_id: AGENCY, departure_group_id: "90000000-0000-4000-8000-000000000002" }];
    after.departure_groups = [{ id: "90000000-0000-4000-8000-000000000002", agency_id: AGENCY, group_name: "January Umrah" }];
    const packBefore = await conversationRoomingRequestExecutor.loadPack(CONVERSATION, AGENCY, fakeDb(before).db);
    const packAfter = await conversationRoomingRequestExecutor.loadPack(CONVERSATION, AGENCY, fakeDb(after).db);
    expect(conversationRoomingRequestExecutor.dependencySnapshot(payload(), packBefore!)).not.toEqual(conversationRoomingRequestExecutor.dependencySnapshot(payload(), packAfter!));
  });

  it("describes what it will create without hand-written text", async () => {
    const pack = await conversationDocumentRequestExecutor.loadPack(CONVERSATION, AGENCY, fakeDb(seed()).db);
    const { humanDiff } = conversationDocumentRequestExecutor.describe(payload(), pack!);
    expect(humanDiff.map((line) => line.field)).toEqual(["task", "team", "departure group", "note"]);
    expect(humanDiff[0].to).toBe("Request documents — Amina (LD-1042)");
  });
});

describe("complaint case conversion", () => {
  it("opens one support case for the booking's traveller, carrying both source columns", async () => {
    const { db, inserts } = fakeDb(seed());
    expect(await conversationComplaintCaseExecutor.execute(payload(), ctx(db))).toEqual({ ok: true });
    const caseRow = inserts.find((entry) => entry.table === "pilgrim_support_requests")!.row;
    expect(caseRow).toMatchObject({ agency_id: AGENCY, pilgrim_id: PILGRIM, category: "COMPLAINT", status: "OPEN", source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
    expect(inserts.some((entry) => entry.table === "support_case_events")).toBe(true);
  });

  it("refuses rather than attaching the case to the wrong person when no traveller is linked", async () => {
    const tables = seed();
    tables.departure_group_pilgrims = [{ agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: null }];
    const { db, inserts } = fakeDb(tables);
    const result = await conversationComplaintCaseExecutor.execute(payload(), ctx(db));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("no traveller record");
    expect(inserts).toHaveLength(0);
  });

  it("still succeeds if only the opening note on the case's timeline fails", async () => {
    const { db } = fakeDb(seed(), { insertError: { support_case_events: "timeline down" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await conversationComplaintCaseExecutor.execute(payload(), ctx(db))).toEqual({ ok: true });
  });
});

describe("registry and capability", () => {
  it("registers every conversion kind against the Inbox module and its own capability", () => {
    for (const kind of ["CONVERSATION_DOCUMENT_REQUEST", "CONVERSATION_VISA_TASK", "CONVERSATION_PAYMENT_FOLLOW_UP", "CONVERSATION_ROOMING_REQUEST", "CONVERSATION_TRANSPORT_REQUIREMENT", "CONVERSATION_GUIDE_ESCALATION", "CONVERSATION_COMPLAINT_CASE"]) {
      const executor = getExecutor(kind);
      expect(executor, kind).not.toBeNull();
      expect(executor).toMatchObject({ module: "inbox", subjectType: "CONVERSATION", requiredCapability: "convertConversation" });
      expect(["LOW", "MEDIUM"]).toContain(executor!.risk);
    }
  });

  it("dedupes to one open request per conversation and kind", () => {
    expect(conversationDocumentRequestExecutor.fingerprint(payload())).toBe(`CONVERSATION_DOCUMENT_REQUEST:${CONVERSATION}`);
    expect(conversationDocumentRequestExecutor.fingerprint(payload({ note: "different note" }))).toBe(conversationDocumentRequestExecutor.fingerprint(payload()));
  });

  it("rejects an over-long note and a malformed id at the boundary", () => {
    expect(conversationDocumentRequestExecutor.schema.safeParse(payload({ note: "x".repeat(301) })).success).toBe(false);
    expect(conversationDocumentRequestExecutor.schema.safeParse(payload({ conversationId: "nope" })).success).toBe(false);
  });
});
