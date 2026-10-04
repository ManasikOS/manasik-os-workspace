import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { confirmConversion, dismissConversion, loadChoicesForConversion, previewConversion, listOfferedConversions, RECENT_CONVERSION_WINDOW_MS } = await import("./service");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MESSAGE = "e0000000-0000-4000-8000-000000000001";
const LEAD = "10000000-0000-4000-8000-000000000001";
const GROUP = "90000000-0000-4000-8000-000000000001";
const STAFF = "d0000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;

/**
 * An in-memory database rich enough for the REAL proposal kernel: insert (with the open-proposal unique index), select with
 * eq / gte / is / not filters, update, and recorded writes.
 */
function fakeDb(tables: Record<string, Row[]>) {
  let counter = 0;
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      let max = Infinity;
      const matching = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const run = () => {
        if (mode === "insert") {
          if (table === "agent_proposals") {
            const clash = (tables[table] ?? []).some((row) => row.status === "PROPOSED" && row.subject_type === payload.subject_type && row.subject_id === payload.subject_id && row.fingerprint === payload.fingerprint);
            if (clash) return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          const row: Row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, status: "PROPOSED", ...payload };
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
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        gte: (column: string, value: string) => { filters.push((row) => String(row[column] ?? "") >= value); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
        not: (column: string, operator: string, value: unknown) => { if (operator === "is") filters.push((row) => (row[column] ?? null) !== value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
        order: () => builder,
        limit: (count: number) => { max = count; return builder; },
        maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
        single: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  };
  return { db: db as never, tables };
}

const seed = (): Record<string, Row[]> => ({
  conversations: [{ id: CONVERSATION, agency_id: AGENCY, contact_name: "Amina", lead_id: LEAD }],
  conversation_messages: [{ id: MESSAGE, agency_id: AGENCY, conversation_id: CONVERSATION, direction: "INBOUND", created_at: "2026-09-21" }],
  leads: [{ id: LEAD, agency_id: AGENCY, reference: "LD-1042", booking_id: null, selected_departure_group_id: GROUP }],
  departure_groups: [{ id: GROUP, agency_id: AGENCY, group_name: "December Umrah" }],
  departure_group_tasks: [],
  agent_proposals: [],
  agent_proposal_events: [],
});

const actor = (role: "MARKETING" | "FINANCE" | "OPERATIONS" = "MARKETING", agencyId = AGENCY) => ({ agencyId, role, roleId: null, staffId: STAFF, name: "Sales Sam" });
const ask = (overrides: Record<string, unknown> = {}) => ({ conversationId: CONVERSATION, kind: "CONVERSATION_DOCUMENT_REQUEST" as const, note: "Passport copy please", ...overrides });

describe("preview → confirm", () => {
  it("writes a request first and creates NOTHING until it is confirmed", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor(), ask());
    expect(preview).toMatchObject({ ok: true, title: "Request documents — Amina (LD-1042)" });
    expect(tables.departure_group_tasks).toHaveLength(0);
    expect(tables.agent_proposals).toHaveLength(1);
    expect(tables.agent_proposals[0]).toMatchObject({ status: "PROPOSED", module: "inbox", subject_type: "CONVERSATION", required_capability: "convertConversation" });
  });

  it("records the PERSON who asked on the audit trail, and pings no one", async () => {
    const { db, tables } = fakeDb(seed());
    await previewConversion(db, actor(), ask());
    expect(tables.agent_proposal_events[0]).toMatchObject({ event: "PROPOSED", actor_id: STAFF, actor_name: "Sales Sam" });
  });

  it("confirming creates exactly one task pointing back at the conversation and the message", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor(), ask());
    if (!preview.ok) throw new Error(preview.error);
    expect(await confirmConversion(db, actor(), preview.proposalId)).toEqual({ ok: true });
    expect(tables.departure_group_tasks).toHaveLength(1);
    expect(tables.departure_group_tasks[0]).toMatchObject({ agency_id: AGENCY, source_conversation_id: CONVERSATION, source_message_id: MESSAGE, category: "OPERATIONS" });
    expect(tables.agent_proposals[0].status).toBe("EXECUTED");
  });

  it("refuses an option the conversation cannot support, naming why", async () => {
    const tables = seed();
    tables.leads = [{ id: LEAD, agency_id: AGENCY, reference: "LD-1042", booking_id: null, selected_departure_group_id: null }];
    const { db } = fakeDb(tables);
    expect(await previewConversion(db, actor(), ask())).toEqual({ ok: false, error: "Select a departure group for this customer first." });
    expect(tables.agent_proposals).toHaveLength(0);
  });
});

describe("cancel", () => {
  it("a cancelled request leaves no object and no partial write", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor(), ask());
    if (!preview.ok) throw new Error(preview.error);
    expect(await dismissConversion(db, actor(), preview.proposalId)).toEqual({ ok: true });
    expect(tables.agent_proposals[0]).toMatchObject({ status: "REJECTED" });
    expect(tables.departure_group_tasks).toHaveLength(0);
    // A cancelled request can no longer be confirmed.
    expect(await confirmConversion(db, actor(), preview.proposalId)).toMatchObject({ ok: false });
    expect(tables.departure_group_tasks).toHaveLength(0);
  });
});

describe("double-click and retry", () => {
  it("a second preview while one is open shows the SAME request instead of a second one", async () => {
    const { db, tables } = fakeDb(seed());
    const first = await previewConversion(db, actor(), ask());
    const second = await previewConversion(db, actor(), ask());
    expect(first.ok && second.ok && first.proposalId === second.proposalId).toBe(true);
    expect(tables.agent_proposals).toHaveLength(1);
  });

  it("two confirmations create ONE object", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor(), ask());
    if (!preview.ok) throw new Error(preview.error);
    const results = [await confirmConversion(db, actor(), preview.proposalId), await confirmConversion(db, actor(), preview.proposalId)];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(tables.departure_group_tasks).toHaveLength(1);
  });

  it("a fresh request right after one was carried out is refused; after the window it is allowed", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor(), ask());
    if (!preview.ok) throw new Error(preview.error);
    await confirmConversion(db, actor(), preview.proposalId);
    const executedAt = new Date(String(tables.agent_proposals[0].executed_at)).getTime();

    const tooSoon = await previewConversion(db, actor(), ask(), executedAt + 1_000);
    expect(tooSoon).toMatchObject({ ok: false });
    expect((tooSoon as { error: string }).error).toContain("just created");

    const later = await previewConversion(db, actor(), ask(), executedAt + RECENT_CONVERSION_WINDOW_MS + 60_000);
    expect(later.ok).toBe(true);
  });
});

describe("capability is enforced on the server, not by the menu", () => {
  it("a role without the Inbox capability is refused at approval and nothing is created", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor("MARKETING"), ask());
    if (!preview.ok) throw new Error(preview.error);
    const outcome = await confirmConversion(db, actor("FINANCE"), preview.proposalId);
    expect(outcome).toEqual({ ok: false, error: "Your role cannot approve this kind of proposal." });
    expect(tables.departure_group_tasks).toHaveLength(0);
    expect(tables.agent_proposals[0].status).toBe("PROPOSED");
  });
});

describe("agency isolation", () => {
  it("cannot preview another agency's conversation", async () => {
    const { db, tables } = fakeDb(seed());
    expect(await previewConversion(db, actor("MARKETING", OTHER_AGENCY), ask())).toEqual({ ok: false, error: "That conversation could not be found." });
    expect(tables.agent_proposals).toHaveLength(0);
    expect(await listOfferedConversions(db, actor("MARKETING", OTHER_AGENCY), CONVERSATION)).toBeNull();
  });

  it("cannot confirm or cancel another agency's request, and never decides a proposal of any other kind", async () => {
    const { db, tables } = fakeDb(seed());
    const preview = await previewConversion(db, actor(), ask());
    if (!preview.ok) throw new Error(preview.error);
    expect(await confirmConversion(db, actor("MARKETING", OTHER_AGENCY), preview.proposalId)).toEqual({ ok: false, error: "That request could not be found." });
    expect(await dismissConversion(db, actor("MARKETING", OTHER_AGENCY), preview.proposalId)).toEqual({ ok: false, error: "That request could not be found." });

    // A departure-ops proposal in the same agency is not this service's to decide.
    tables.agent_proposals.push({ id: "00000000-0000-4000-8000-0000000000aa", agency_id: AGENCY, subject_type: "DEPARTURE_GROUP", kind: "ROOMS_GENERATE", status: "PROPOSED" });
    expect(await confirmConversion(db, actor(), "00000000-0000-4000-8000-0000000000aa")).toEqual({ ok: false, error: "That request could not be found." });
    expect(tables.agent_proposals.find((row) => row.id === "00000000-0000-4000-8000-0000000000aa")?.status).toBe("PROPOSED");
  });
});

describe("listOfferedConversions", () => {
  it("returns the menu for a conversation with its reasons", async () => {
    const { db } = fakeDb(seed());
    const options = await listOfferedConversions(db, actor(), CONVERSATION);
    expect(options).toHaveLength(12);
    expect(options?.find((option) => option.kind === "CONVERSATION_COMPLAINT_CASE")).toMatchObject({ available: false });
    expect(options?.find((option) => option.kind === "CONVERSATION_VISA_TASK")).toMatchObject({ available: true });
  });
});

/* ── conversions that ask the person to choose ─────────────────────────────── */

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const AMINA = "70000000-0000-4000-8000-000000000001";
const YUSUF = "70000000-0000-4000-8000-000000000002";
const SARA = "70000000-0000-4000-8000-000000000003";
const PACKAGE = "80000000-0000-4000-8000-000000000001";

/** A booked customer with three travellers, one open package and one survey. */
const bookedSeed = (): Record<string, Row[]> => ({
  ...seed(),
  leads: [{ id: LEAD, agency_id: AGENCY, reference: "LD-1042", full_name: "Amina Rizvi", mobile: "9477", journey_type: "UMRAH", room_preference: "TRIPLE", adults: 3, children: 0, booking_id: BOOKING, selected_departure_group_id: GROUP }],
  departure_group_bookings: [{ id: BOOKING, agency_id: AGENCY, departure_group_id: GROUP }],
  departure_group_pilgrims: [
    { id: AMINA, agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: "pl1", full_name_snapshot: "Amina" },
    { id: YUSUF, agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: "pl2", full_name_snapshot: "Yusuf" },
    { id: SARA, agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: "pl3", full_name_snapshot: "Sara" },
  ],
  departure_groups: [{ id: GROUP, agency_id: AGENCY, group_name: "December Umrah", available_seats: 5 }],
  booking_traveller_relationships: [],
  lead_notes: [],
  packages: [{ id: PACKAGE, agency_id: AGENCY, title: "Umrah Gold", internal_code: "UG-01", status: "Open for Sale" }],
  surveys: [],
});

const relate = (overrides: Record<string, unknown> = {}) => ({
  conversationId: CONVERSATION,
  kind: "CONVERSATION_TRAVELLER_RELATIONSHIP" as const,
  note: "",
  params: { fromTravellerId: AMINA, relationship: "SPOUSE", toTravellerId: YUSUF, isMahram: true },
  ...overrides,
});

describe("conversions that ask the person to choose", () => {
  it("offers only this booking's travellers, and this agency's open packages, as choices", async () => {
    const tables = bookedSeed();
    tables.packages = [...tables.packages, { id: "80000000-0000-4000-8000-0000000000ff", agency_id: OTHER_AGENCY, title: "Theirs", status: "Open for Sale" }, { id: "80000000-0000-4000-8000-0000000000fe", agency_id: AGENCY, title: "Closed one", status: "Sales Closed" }];
    const { db } = fakeDb(tables);

    const travellers = await loadChoicesForConversion(db, actor("OPERATIONS"), { conversationId: CONVERSATION, kind: "CONVERSATION_TRAVELLER_RELATIONSHIP" });
    expect(travellers).toMatchObject({ ok: true });
    const from = travellers.ok ? travellers.fields.find((field) => field.name === "fromTravellerId") : null;
    expect(from?.options?.map((option) => option.label)).toEqual(["Amina", "Yusuf", "Sara"]);

    const packages = await loadChoicesForConversion(db, actor("MARKETING"), { conversationId: CONVERSATION, kind: "CONVERSATION_PACKAGE_RECOMMENDATION" });
    expect(packages.ok && packages.fields[0].options).toEqual([{ value: PACKAGE, label: "Umrah Gold (UG-01)" }]);
  });

  it("offers a seat count bounded by the seats left, defaulting to the party size", async () => {
    const { db } = fakeDb(bookedSeed());
    const result = await loadChoicesForConversion(db, actor("MARKETING"), { conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD" });
    // Booked customers cannot hold more seats — the need is checked before any choices are offered.
    expect(result).toEqual({ ok: false, error: "This customer already has a booking or a seat hold." });

    const enquiry = bookedSeed();
    enquiry.leads = [{ ...enquiry.leads[0], booking_id: null }];
    const seats = await loadChoicesForConversion(fakeDb(enquiry).db, actor("MARKETING"), { conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD" });
    expect(seats.ok && seats.fields[0]).toMatchObject({ name: "seats", min: 1, max: 5, defaultValue: 3 });
  });

  it("creates the relationship end to end, through the kernel, with both source columns", async () => {
    const { db, tables } = fakeDb(bookedSeed());
    const preview = await previewConversion(db, actor("OPERATIONS"), relate());
    if (!preview.ok) throw new Error(preview.error);
    // The review says who, by name — the labels came from the server's own list, not the browser.
    expect(preview.humanDiff.find((line) => line.field === "traveller")?.to).toBe("Amina");
    expect(preview.humanDiff.find((line) => line.field === "of traveller")?.to).toBe("Yusuf");
    expect(tables.booking_traveller_relationships).toHaveLength(0);

    expect(await confirmConversion(db, actor("OPERATIONS"), preview.proposalId)).toEqual({ ok: true });
    expect(tables.booking_traveller_relationships).toHaveLength(1);
    expect(tables.booking_traveller_relationships[0]).toMatchObject({ agency_id: AGENCY, booking_id: BOOKING, from_pilgrim_id: AMINA, to_pilgrim_id: YUSUF, source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
  });

  it("refuses a traveller id the server never offered, before writing any request", async () => {
    const { db, tables } = fakeDb(bookedSeed());
    const forged = await previewConversion(db, actor("OPERATIONS"), relate({ params: { fromTravellerId: "70000000-0000-4000-8000-0000000000ff", relationship: "SPOUSE", toTravellerId: YUSUF } }));
    expect(forged).toMatchObject({ ok: false });
    expect(tables.agent_proposals).toHaveLength(0);
  });

  it("keeps two different pairs open at once, and shows the SAME request for the same pair", async () => {
    const { db, tables } = fakeDb(bookedSeed());
    const first = await previewConversion(db, actor("OPERATIONS"), relate());
    const other = await previewConversion(db, actor("OPERATIONS"), relate({ params: { fromTravellerId: AMINA, relationship: "PARENT", toTravellerId: SARA } }));
    const again = await previewConversion(db, actor("OPERATIONS"), relate());
    expect(first.ok && other.ok && again.ok).toBe(true);
    expect(tables.agent_proposals).toHaveLength(2);
    expect(first.ok && again.ok && first.proposalId === again.proposalId).toBe(true);
    expect(first.ok && other.ok && first.proposalId !== other.proposalId).toBe(true);
  });

  it("records a package recommendation as a note on the lead, naming the package the server offered", async () => {
    const { db, tables } = fakeDb(bookedSeed());
    const preview = await previewConversion(db, actor("MARKETING"), { conversationId: CONVERSATION, kind: "CONVERSATION_PACKAGE_RECOMMENDATION", note: "For the family", params: { packageId: PACKAGE } });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.humanDiff.find((line) => line.field === "note on lead")?.to).toBe("Recommended: Umrah Gold (UG-01)");
    expect(await confirmConversion(db, actor("MARKETING"), preview.proposalId)).toEqual({ ok: true });
    expect(tables.lead_notes[0]).toMatchObject({ agency_id: AGENCY, lead_id: LEAD, source_conversation_id: CONVERSATION });
  });
});

describe("each kind runs under the capability of the module that owns what it writes", () => {
  it("greys out what the person's role cannot do, with the reason — and refuses it at preview", async () => {
    const { db, tables } = fakeDb(bookedSeed());
    // Sales may raise work from a chat but may not create a traveller profile or record a traveller relationship by hand.
    const menu = await listOfferedConversions(db, actor("MARKETING"), CONVERSATION);
    expect(menu?.find((option) => option.kind === "CONVERSATION_DOCUMENT_REQUEST")).toMatchObject({ available: true });
    expect(menu?.find((option) => option.kind === "CONVERSATION_TRAVELLER_RELATIONSHIP")).toMatchObject({ available: false, reason: "Your role cannot do this." });

    expect(await previewConversion(db, actor("MARKETING"), relate())).toEqual({ ok: false, error: "Your role cannot do this." });
    expect(tables.agent_proposals).toHaveLength(0);
    // Operations can.
    expect((await listOfferedConversions(db, actor("OPERATIONS"), CONVERSATION))?.find((option) => option.kind === "CONVERSATION_TRAVELLER_RELATIONSHIP")).toMatchObject({ available: true });
  });

  it("refuses to load choices for an option the role cannot use", async () => {
    const { db } = fakeDb(bookedSeed());
    expect(await loadChoicesForConversion(db, actor("MARKETING"), { conversationId: CONVERSATION, kind: "CONVERSATION_TRAVELLER_RELATIONSHIP" })).toEqual({ ok: false, error: "Your role cannot do this." });
  });

  it("keeps enforcing it at approval, even for a request written by someone who could", async () => {
    const { db, tables } = fakeDb(bookedSeed());
    const preview = await previewConversion(db, actor("OPERATIONS"), relate());
    if (!preview.ok) throw new Error(preview.error);
    expect(await confirmConversion(db, actor("MARKETING"), preview.proposalId)).toEqual({ ok: false, error: "Your role cannot approve this kind of proposal." });
    expect(tables.booking_traveller_relationships).toHaveLength(0);
  });
});
