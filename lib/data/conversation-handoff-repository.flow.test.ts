import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  attachHandoffNarration,
  buildHandoffForConversation,
  createConversationHandoff,
  handoffNeedsNarration,
  loadConversationHandoff,
} = await import("./conversation-handoff-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const LEAD = "10000000-0000-4000-8000-000000000001";
const BOOKING = "b0000000-0000-4000-8000-000000000001";
const OTHER_BOOKING = "b0000000-0000-4000-8000-000000000002";
const GROUP = "90000000-0000-4000-8000-000000000001";
const MY_TRAVELLER = "70000000-0000-4000-8000-000000000001";
const NEIGHBOUR_TRAVELLER = "70000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

/** In-memory tables with eq / is / in filters, insert, update and a scripted insert failure. */
function fakeDb(tables: Record<string, Row[]>, options: { insertError?: { code: string; message: string } } = {}) {
  const log: Array<{ table: string; op: string; eq: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const eq: Record<string, unknown> = {};
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      let max = Infinity;
      let orderBy: { column: string; ascending: boolean } | null = null;
      const matching = () => {
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (!orderBy) return rows;
        const { column, ascending } = orderBy;
        return [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
      };
      const run = () => {
        log.push({ table, op: mode, eq: { ...eq } });
        if (mode === "insert") {
          if (options.insertError) return { data: null, error: options.insertError };
          const row = { id: `new-${(tables[table] ?? []).length + 1}`, created_at: "2026-09-21T10:00:00Z", acknowledged_at: null, acknowledged_by: null, ...payload };
          tables[table] = [...(tables[table] ?? []), row];
          return { data: [row], error: null };
        }
        if (mode === "update") {
          const rows = matching();
          for (const row of rows) Object.assign(row, payload);
          return { data: rows, error: null };
        }
        return { data: matching().slice(0, max), error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (value: Row) => { mode = "insert"; payload = value; return builder; },
        update: (value: Row) => { mode = "update"; payload = value; return builder; },
        eq: (column: string, value: unknown) => { eq[column] = value; filters.push((row) => row[column] === value); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
        order: (column: string, opts?: { ascending?: boolean }) => { orderBy = { column, ascending: opts?.ascending ?? true }; return builder; },
        limit: (count: number) => { max = count; return builder; },
        maybeSingle: async () => { const result = run(); return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error }; },
        single: async () => { const result = run(); return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error }; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  };
  return { db: db as never, log, tables };
}

const seed = (): Record<string, Row[]> => ({
  conversations: [{ id: CONVERSATION, agency_id: AGENCY, lead_id: LEAD, contact_name: "Amina", contact_phone: "+94770000000" }],
  leads: [{ id: LEAD, agency_id: AGENCY, booking_id: BOOKING }],
  departure_group_bookings: [
    { id: BOOKING, agency_id: AGENCY, lead_id: LEAD, booking_status: "CONFIRMED", booking_reference: "BK-1", currency: "LKR", outstanding_balance: 0, departure_group_id: GROUP, booked_at: "2026-09-01", departure_groups: { group_name: "December Umrah", departure_date: "2026-12-01", return_date: "2026-12-12" } },
    // A newer confirmed booking of the same lead that the chat was NOT about.
    { id: OTHER_BOOKING, agency_id: AGENCY, lead_id: LEAD, booking_status: "CONFIRMED", booking_reference: "BK-2", currency: "LKR", outstanding_balance: 0, departure_group_id: GROUP, booked_at: "2026-09-15", departure_groups: { group_name: "December Umrah", departure_date: "2026-12-01", return_date: "2026-12-12" } },
  ],
  departure_group_pilgrims: [
    { id: MY_TRAVELLER, agency_id: AGENCY, booking_id: BOOKING },
    { id: NEIGHBOUR_TRAVELLER, agency_id: AGENCY, booking_id: "b0000000-0000-4000-8000-0000000000ff" },
  ],
  departure_group_pilgrim_documents: [
    { pilgrim_id: MY_TRAVELLER, agency_id: AGENCY, departure_group_id: GROUP, name: "Passport scan", status: "NOT_SUBMITTED", required: true },
    { pilgrim_id: MY_TRAVELLER, agency_id: AGENCY, departure_group_id: GROUP, name: "Vaccination certificate", status: "SUBMITTED", required: true },
    { pilgrim_id: MY_TRAVELLER, agency_id: AGENCY, departure_group_id: GROUP, name: "Optional photo", status: "NOT_SUBMITTED", required: false },
    // Another customer's traveller in the same group — must never count against this handoff.
    { pilgrim_id: NEIGHBOUR_TRAVELLER, agency_id: AGENCY, departure_group_id: GROUP, name: "Passport scan", status: "NOT_SUBMITTED", required: true },
    { pilgrim_id: NEIGHBOUR_TRAVELLER, agency_id: OTHER_AGENCY, departure_group_id: GROUP, name: "Passport scan", status: "NOT_SUBMITTED", required: true },
  ],
  departure_group_readiness_items: [
    { agency_id: AGENCY, departure_group_id: GROUP, label: "Hotel confirmation", status: "IN_PROGRESS", required: true },
    { agency_id: AGENCY, departure_group_id: GROUP, label: "Group photo", status: "NOT_STARTED", required: false },
  ],
  conversation_intelligence: [{ agency_id: AGENCY, conversation_id: CONVERSATION, commercial_stage: "BOOKED" }],
  conversation_messages: [{ agency_id: AGENCY, conversation_id: CONVERSATION, direction: "INBOUND", content: "Please seat us together", created_at: "2026-09-02" }],
});

describe("buildHandoffForConversation", () => {
  it("counts only this booking's own travellers, not the rest of the departure group", async () => {
    const { db } = fakeDb(seed());
    const built = await buildHandoffForConversation(db, AGENCY, CONVERSATION);
    expect(built?.handoff.openItems).toContainEqual({ kind: "DOCUMENT", label: "Passport scan", count: 1 });
    expect(built?.handoff.openItems.filter((item) => item.label === "Passport scan")).toHaveLength(1);
  });

  it("reports a submitted document as awaiting verification and ignores optional items", async () => {
    const { db } = fakeDb(seed());
    const built = await buildHandoffForConversation(db, AGENCY, CONVERSATION);
    expect(built?.handoff.openItems).toContainEqual({ kind: "DOCUMENT_REVIEW", label: "Vaccination certificate", count: 1 });
    expect(built?.handoff.openItems.some((item) => item.label === "Optional photo" || item.label === "Group photo")).toBe(false);
    expect(built?.handoff.openItems).toContainEqual({ kind: "READINESS", label: "Hotel confirmation", count: 1 });
  });

  it("hands over the booking the lead was converted into, not merely the newest confirmed one", async () => {
    const { db } = fakeDb(seed());
    const built = await buildHandoffForConversation(db, AGENCY, CONVERSATION);
    expect(built?.bookingId).toBe(BOOKING);
    expect((built?.handoff.summary.booking as { reference: string }).reference).toBe("BK-1");
  });

  it("falls back to the newest confirmed booking when the lead has no linked booking", async () => {
    const tables = seed();
    tables.leads = [{ id: LEAD, agency_id: AGENCY, booking_id: null }];
    const built = await buildHandoffForConversation(fakeDb(tables).db, AGENCY, CONVERSATION);
    expect(built?.bookingId).toBe(OTHER_BOOKING);
  });

  it("returns nothing without a confirmed booking, and never reads another agency's conversation", async () => {
    const tables = seed();
    tables.departure_group_bookings = tables.departure_group_bookings.map((row) => ({ ...row, booking_status: "PROVISIONAL" }));
    expect(await buildHandoffForConversation(fakeDb(tables).db, AGENCY, CONVERSATION)).toBeNull();
    expect(await buildHandoffForConversation(fakeDb(seed()).db, OTHER_AGENCY, CONVERSATION)).toBeNull();
  });

  it("scopes every read to the agency", async () => {
    const { db, log } = fakeDb(seed());
    await buildHandoffForConversation(db, AGENCY, CONVERSATION);
    const reads = log.filter((entry) => entry.op === "select");
    expect(reads.length).toBeGreaterThanOrEqual(7);
    for (const read of reads) expect(read.eq.agency_id, read.table).toBe(AGENCY);
  });
});

describe("createConversationHandoff", () => {
  const input = () => ({ agencyId: AGENCY, conversationId: CONVERSATION, bookingId: BOOKING, createdBy: "s1", handoff: { summary: { customer: { name: "Amina" } }, openItems: [] } });

  it("stores one handoff and reports it as created", async () => {
    const { db, tables } = fakeDb({ conversation_handoffs: [] });
    const result = await createConversationHandoff(db, input());
    expect(result.created).toBe(true);
    expect(tables.conversation_handoffs).toHaveLength(1);
  });

  it("returns the stored handoff on a repeat call instead of writing another", async () => {
    const { db, tables } = fakeDb({ conversation_handoffs: [] });
    await createConversationHandoff(db, input());
    const again = await createConversationHandoff(db, input());
    expect(again.created).toBe(false);
    expect(tables.conversation_handoffs).toHaveLength(1);
  });

  it("returns the winner when a second click loses the race on the unique booking index", async () => {
    const winner = { id: "w1", agency_id: AGENCY, conversation_id: CONVERSATION, booking_id: BOOKING, summary: {}, open_items: [], customer_expectations: {}, sentiment: null, created_at: "2026-09-21T10:00:00Z", acknowledged_at: null, acknowledged_by: null };
    const tables: Record<string, Row[]> = { conversation_handoffs: [] };
    const { db } = fakeDb(tables, { insertError: { code: "23505", message: "duplicate key" } });
    // The winning row appears between the first read and the failed insert.
    const originalFrom = (db as { from: (t: string) => unknown }).from.bind(db);
    let reads = 0;
    (db as { from: (t: string) => unknown }).from = (table: string) => {
      if (table === "conversation_handoffs" && ++reads === 2) tables.conversation_handoffs = [winner];
      return originalFrom(table);
    };
    const result = await createConversationHandoff(db, input());
    expect(result).toMatchObject({ created: false, record: { id: "w1" } });
  });
});

describe("attachHandoffNarration", () => {
  const row = (overrides: Row = {}): Row => ({ id: "h1", agency_id: AGENCY, conversation_id: CONVERSATION, booking_id: BOOKING, summary: { keep: "facts" }, open_items: [{ kind: "PAYMENT", label: "x", count: 1 }], customer_expectations: { items: [], source: "RULES", note: "off" }, sentiment: null, created_at: "2026-09-21T10:00:00Z", acknowledged_at: null, acknowledged_by: null, ...overrides });

  it("fills in the prose of an unacknowledged handoff and leaves the facts alone", async () => {
    const { db, tables } = fakeDb({ conversation_handoffs: [row()] });
    const updated = await attachHandoffNarration(db, { agencyId: AGENCY, handoffId: "h1", customerExpectations: { items: ["Sit together"], source: "LLM" }, sentiment: "NEUTRAL" });
    expect(updated?.customerExpectations.items).toEqual(["Sit together"]);
    expect(tables.conversation_handoffs[0].summary).toEqual({ keep: "facts" });
    expect(tables.conversation_handoffs[0].open_items).toEqual([{ kind: "PAYMENT", label: "x", count: 1 }]);
  });

  it("never rewrites expectations that already exist, or a handoff Operations has acknowledged", async () => {
    const written = row({ customer_expectations: { items: ["Sit together"], source: "LLM" } });
    const acknowledged = row({ acknowledged_at: "2026-09-22T10:00:00Z", acknowledged_by: "s2" });
    for (const existing of [written, acknowledged]) {
      const { db, tables } = fakeDb({ conversation_handoffs: [existing] });
      expect(await attachHandoffNarration(db, { agencyId: AGENCY, handoffId: "h1", customerExpectations: { items: ["Overwrite"] }, sentiment: "ANGRY" })).toBeNull();
      expect(tables.conversation_handoffs[0].customer_expectations).toBe(existing.customer_expectations);
    }
  });

  it("cannot touch another agency's handoff", async () => {
    const { db } = fakeDb({ conversation_handoffs: [row()] });
    expect(await attachHandoffNarration(db, { agencyId: OTHER_AGENCY, handoffId: "h1", customerExpectations: { items: ["x"] }, sentiment: null })).toBeNull();
  });
});

describe("loadConversationHandoff and handoffNeedsNarration", () => {
  it("only returns a handoff of the caller's own agency", async () => {
    const stored = { id: "h1", agency_id: AGENCY, conversation_id: CONVERSATION, booking_id: BOOKING, summary: {}, open_items: [], customer_expectations: {}, sentiment: null, created_at: "2026-09-21T10:00:00Z", acknowledged_at: null, acknowledged_by: null };
    const { db } = fakeDb({ conversation_handoffs: [stored] });
    expect(await loadConversationHandoff(db, AGENCY, CONVERSATION)).toMatchObject({ id: "h1" });
    expect(await loadConversationHandoff(db, OTHER_AGENCY, CONVERSATION)).toBeNull();
  });

  it("asks for narration only while nothing was written and nobody has acknowledged", () => {
    const base = { id: "h", conversationId: "c", bookingId: "b", summary: {}, openItems: [], createdAt: "", acknowledgedAt: null, acknowledgedBy: null, sentiment: null };
    expect(handoffNeedsNarration({ ...base, customerExpectations: {} })).toBe(true);
    expect(handoffNeedsNarration({ ...base, customerExpectations: { items: ["x"] } })).toBe(false);
    expect(handoffNeedsNarration({ ...base, customerExpectations: {}, acknowledgedAt: "2026-09-22" })).toBe(false);
  });
});
