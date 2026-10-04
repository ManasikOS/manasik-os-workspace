import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createGroupBooking = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const loadOfferCandidates = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
vi.mock("@/lib/data/departure-groups", () => ({ createGroupBooking: (...args: unknown[]) => createGroupBooking(...args) }));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ loadOfferCandidates: (...args: unknown[]) => loadOfferCandidates(...args) }));

const { conversationPilgrimProfileExecutor, conversationTravellerRelationshipExecutor } = await import("./conversation-profile");
const { conversationFeedbackRequestExecutor, conversationPackageRecommendationExecutor } = await import("./conversation-recommendation");
const { conversationSeatHoldExecutor, roomForHold, MAX_SEATS_PER_HOLD } = await import("./conversation-seat-hold");
const { getExecutor } = await import("@/lib/agent/kernel/proposals/registry");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENCY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MESSAGE = "e0000000-0000-4000-8000-000000000001";
const LEAD = "10000000-0000-4000-8000-000000000001";
const BOOKING = "b0000000-0000-4000-8000-000000000001";
const GROUP = "90000000-0000-4000-8000-000000000001";
const AMINA = "70000000-0000-4000-8000-000000000001";
const YUSUF = "70000000-0000-4000-8000-000000000002";
const STRANGER = "70000000-0000-4000-8000-0000000000ff";
const PACKAGE = "80000000-0000-4000-8000-000000000001";
const SURVEY = "50000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;

/** Tables with eq / is / in filters, insert (with scripted errors and a row count), update and head-count selects. */
function fakeDb(tables: Record<string, Row[]>, options: { insertError?: Record<string, { code?: string; message: string }> } = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{ table: string; values: Row; eq: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const eq: Record<string, unknown> = {};
      let mode: "select" | "insert" | "update" = "select";
      let head = false;
      let payload: Row = {};
      let max = Infinity;
      const matching = () => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const run = () => {
        if (mode === "insert") {
          const failure = options.insertError?.[table];
          if (failure) return { data: null, error: failure };
          inserts.push({ table, row: payload });
          tables[table] = [...(tables[table] ?? []), { ...payload }];
          return { data: [{ id: `new-${inserts.length}`, ...payload }], error: null };
        }
        if (mode === "update") {
          updates.push({ table, values: payload, eq: { ...eq } });
          return { data: matching(), error: null };
        }
        if (head) return { data: null, count: (tables[table] ?? []).length, error: null };
        return { data: matching().slice(0, max), error: null };
      };
      const builder: Record<string, unknown> = {
        select: (_columns?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return builder; },
        insert: (value: Row) => { mode = "insert"; payload = value; return builder; },
        update: (value: Row) => { mode = "update"; payload = value; return builder; },
        eq: (column: string, value: unknown) => { eq[column] = value; filters.push((row) => row[column] === value); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
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
  return { db: db as never, inserts, updates, tables };
}

/** A booked customer with two travellers; the lead has a phone, a party of two and no room preference. */
const seed = (overrides: { booked?: boolean } = {}): Record<string, Row[]> => {
  const booked = overrides.booked ?? true;
  return {
    conversations: [{ id: CONVERSATION, agency_id: AGENCY, contact_name: "Amina", contact_phone: "94770000000", lead_id: LEAD }],
    conversation_messages: [{ id: MESSAGE, agency_id: AGENCY, conversation_id: CONVERSATION, direction: "INBOUND", created_at: "2026-09-21" }],
    leads: [{ id: LEAD, agency_id: AGENCY, reference: "LD-1042", full_name: "Amina Rizvi", mobile: "94771111111", email: "amina@example.test", journey_type: "UMRAH", room_preference: "UNDECIDED", adults: 2, children: 0, booking_id: booked ? BOOKING : null, selected_departure_group_id: GROUP }],
    departure_group_bookings: booked ? [{ id: BOOKING, agency_id: AGENCY, departure_group_id: GROUP }] : [],
    departure_group_pilgrims: booked ? [{ id: AMINA, agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: "pl1", full_name_snapshot: "Amina" }, { id: YUSUF, agency_id: AGENCY, booking_id: BOOKING, pilgrim_id: "pl2", full_name_snapshot: "Yusuf" }] : [],
    departure_groups: [{ id: GROUP, agency_id: AGENCY, group_name: "December Umrah", seat_hold_expiry_hours: 36 }],
    pilgrims: [],
    packages: [{ id: PACKAGE, agency_id: AGENCY, title: "Umrah Gold", internal_code: "UG-01", journey_type: "UMRAH", status: "Open for Sale" }],
    surveys: [{ id: SURVEY, agency_id: AGENCY, title: "Post-trip", is_active: true }],
  };
};

const ctx = (db: never, agencyId = AGENCY) => ({ agencyId, subjectId: CONVERSATION, actor: { id: "s1", name: "Sales Sam", agencyId }, role: "MARKETING" as const, db });
/** Typed loosely on purpose: each test names only the fields it cares about, and the executor's own schema is what is under test. */
const base = (overrides: Record<string, unknown> = {}): never => ({ conversationId: CONVERSATION, sourceMessageId: MESSAGE, note: "", labels: {}, ...overrides }) as never;

describe("CONVERSATION_PILGRIM_PROFILE", () => {
  const seedEnquiry = () => seed({ booked: false });

  it("creates the profile from the lead, in this agency, with both source columns", async () => {
    const { db, inserts } = fakeDb(seedEnquiry());
    expect(await conversationPilgrimProfileExecutor.execute(base(), ctx(db))).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({ agency_id: AGENCY, full_name: "Amina Rizvi", whatsapp_number: "94771111111", email: "amina@example.test", origin_lead_id: LEAD, source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
    expect(String(inserts[0].row.reference)).toMatch(/^PL-\d{4}-\d{4}$/);
  });

  it("refuses when this agency already has a profile with that number, but ignores another agency's", async () => {
    const own = seedEnquiry();
    own.pilgrims = [{ id: "x", agency_id: AGENCY, whatsapp_number: "94771111111" }];
    const refused = fakeDb(own);
    expect(await conversationPilgrimProfileExecutor.execute(base(), ctx(refused.db))).toEqual({ ok: false, error: "A traveller profile with this phone number already exists." });
    expect(refused.inserts).toHaveLength(0);

    const foreign = seedEnquiry();
    foreign.pilgrims = [{ id: "y", agency_id: OTHER_AGENCY, whatsapp_number: "94771111111" }];
    const allowed = fakeDb(foreign);
    expect(await conversationPilgrimProfileExecutor.execute(base(), ctx(allowed.db))).toEqual({ ok: true });
  });

  it("is not available to a customer who already has a traveller record", async () => {
    const { db, inserts } = fakeDb(seed());
    expect(await conversationPilgrimProfileExecutor.execute(base(), ctx(db))).toEqual({ ok: false, error: "This customer already has a traveller record." });
    expect(inserts).toHaveLength(0);
  });

  it("retries a clashing reference and fails cleanly on any other error", async () => {
    const clash = fakeDb(seedEnquiry(), { insertError: { pilgrims: { code: "23505", message: "duplicate key value violates unique constraint pilgrims_reference_key" } } });
    expect(await conversationPilgrimProfileExecutor.execute(base(), ctx(clash.db))).toMatchObject({ ok: false });
    const other = fakeDb(seedEnquiry(), { insertError: { pilgrims: { message: "boom" } } });
    expect(await conversationPilgrimProfileExecutor.execute(base(), ctx(other.db))).toEqual({ ok: false, error: "Could not create the traveller profile: boom" });
  });
});

describe("CONVERSATION_TRAVELLER_RELATIONSHIP", () => {
  const relation = (overrides: Record<string, unknown> = {}) => base({ fromTravellerId: AMINA, toTravellerId: YUSUF, relationship: "SPOUSE", isMahram: true, ...overrides });

  it("records the relationship on this booking with both source columns", async () => {
    const { db, inserts } = fakeDb(seed());
    expect(await conversationTravellerRelationshipExecutor.execute(relation(), ctx(db))).toEqual({ ok: true });
    expect(inserts[0]).toMatchObject({ table: "booking_traveller_relationships" });
    expect(inserts[0].row).toMatchObject({ agency_id: AGENCY, booking_id: BOOKING, departure_group_id: GROUP, from_pilgrim_id: AMINA, to_pilgrim_id: YUSUF, relationship: "SPOUSE", is_mahram: true, created_by_name: "Sales Sam", source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
  });

  it("a MAHRAM relationship always counts as a mahram", async () => {
    const { db, inserts } = fakeDb(seed());
    await conversationTravellerRelationshipExecutor.execute(relation({ relationship: "MAHRAM", isMahram: false }), ctx(db));
    expect(inserts[0].row.is_mahram).toBe(true);
  });

  it("refuses a traveller who is not on this customer's booking", async () => {
    const { db, inserts } = fakeDb(seed());
    expect(await conversationTravellerRelationshipExecutor.execute(relation({ toTravellerId: STRANGER }), ctx(db))).toEqual({ ok: false, error: "Both travellers must be on this customer's booking." });
    expect(inserts).toHaveLength(0);
  });

  it("refuses the same traveller twice, at the boundary", () => {
    expect(conversationTravellerRelationshipExecutor.schema.safeParse(relation({ toTravellerId: AMINA })).success).toBe(false);
    expect(conversationTravellerRelationshipExecutor.schema.safeParse(relation({ relationship: "NEIGHBOUR" })).success).toBe(false);
  });

  it("explains a pair that is already recorded, and needs a booking with two travellers", async () => {
    const dup = fakeDb(seed(), { insertError: { booking_traveller_relationships: { code: "23505", message: "duplicate" } } });
    expect(await conversationTravellerRelationshipExecutor.execute(relation(), ctx(dup.db))).toEqual({ ok: false, error: "That relationship is already recorded for these two travellers." });
    const none = fakeDb(seed({ booked: false }));
    expect(await conversationTravellerRelationshipExecutor.execute(relation(), ctx(none.db))).toEqual({ ok: false, error: "This customer has no booking yet." });
  });

  it("keeps two different pairs open at once, and dedupes the same pair", () => {
    const a = conversationTravellerRelationshipExecutor.fingerprint(relation());
    expect(conversationTravellerRelationshipExecutor.fingerprint(relation())).toBe(a);
    expect(conversationTravellerRelationshipExecutor.fingerprint(relation({ fromTravellerId: YUSUF, toTravellerId: AMINA }))).not.toBe(a);
  });

  it("describes the pair by the names the server put in the labels", async () => {
    const pack = await conversationTravellerRelationshipExecutor.loadPack(CONVERSATION, AGENCY, fakeDb(seed()).db);
    const { humanDiff } = conversationTravellerRelationshipExecutor.describe(relation({ labels: { fromTravellerId: "Amina", toTravellerId: "Yusuf" } }), pack!);
    expect(humanDiff.find((line) => line.field === "traveller")?.to).toBe("Amina");
    expect(humanDiff.find((line) => line.field === "of traveller")?.to).toBe("Yusuf");
  });
});

describe("CONVERSATION_PACKAGE_RECOMMENDATION", () => {
  it("records a note on the lead — and never changes the lead's chosen package", async () => {
    const { db, inserts, updates } = fakeDb(seed());
    expect(await conversationPackageRecommendationExecutor.execute(base({ packageId: PACKAGE, note: "Family of four" }), ctx(db))).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ table: "lead_notes" });
    expect(inserts[0].row).toMatchObject({ agency_id: AGENCY, lead_id: LEAD, author_name: "Sales Sam", source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
    expect(String(inserts[0].row.body)).toContain("Umrah Gold (UG-01)");
    expect(String(inserts[0].row.body)).toContain("Family of four");
    expect(updates.filter((update) => update.table === "leads")).toHaveLength(0);
  });

  it("refuses a package that is not this agency's, or is no longer open for sale", async () => {
    const foreign = seed();
    foreign.packages = [{ id: PACKAGE, agency_id: OTHER_AGENCY, title: "Theirs", status: "Open for Sale" }];
    const a = fakeDb(foreign);
    expect(await conversationPackageRecommendationExecutor.execute(base({ packageId: PACKAGE }), ctx(a.db))).toEqual({ ok: false, error: "That package could not be found." });
    const closed = seed();
    closed.packages = [{ id: PACKAGE, agency_id: AGENCY, title: "Old", status: "Sales Closed" }];
    const b = fakeDb(closed);
    expect(await conversationPackageRecommendationExecutor.execute(base({ packageId: PACKAGE }), ctx(b.db))).toEqual({ ok: false, error: "That package is no longer open for sale." });
    expect(a.inserts.length + b.inserts.length).toBe(0);
  });

  it("needs a linked lead", async () => {
    const tables = seed();
    tables.conversations = [{ id: CONVERSATION, agency_id: AGENCY, contact_name: "Amina", lead_id: null }];
    const { db } = fakeDb(tables);
    expect(await conversationPackageRecommendationExecutor.execute(base({ packageId: PACKAGE }), ctx(db))).toEqual({ ok: false, error: "Link this conversation to a lead first." });
  });
});

describe("CONVERSATION_FEEDBACK_REQUEST", () => {
  it("adds one marketing task naming the survey, with both source columns — and sends nothing", async () => {
    const { db, inserts } = fakeDb(seed());
    expect(await conversationFeedbackRequestExecutor.execute(base({ surveyId: SURVEY }), ctx(db))).toEqual({ ok: true });
    const task = inserts.find((entry) => entry.table === "departure_group_tasks")!;
    expect(task.row).toMatchObject({ agency_id: AGENCY, departure_group_id: GROUP, category: "MARKETING", status: "OPEN", source_conversation_id: CONVERSATION, source_message_id: MESSAGE });
    expect(String(task.row.description)).toContain('"Post-trip"');
  });

  it("refuses a survey that is off, another agency's, or missing", async () => {
    const off = seed();
    off.surveys = [{ id: SURVEY, agency_id: AGENCY, title: "Post-trip", is_active: false }];
    expect(await conversationFeedbackRequestExecutor.execute(base({ surveyId: SURVEY }), ctx(fakeDb(off).db))).toEqual({ ok: false, error: "That survey is switched off." });
    const foreign = seed();
    foreign.surveys = [{ id: SURVEY, agency_id: OTHER_AGENCY, title: "Theirs", is_active: true }];
    expect(await conversationFeedbackRequestExecutor.execute(base({ surveyId: SURVEY }), ctx(fakeDb(foreign).db))).toEqual({ ok: false, error: "That survey could not be found." });
  });
});

describe("CONVERSATION_SEAT_HOLD", () => {
  const offer = (overrides: Record<string, unknown> = {}) => ({
    facts: { groupId: GROUP, groupName: "December Umrah", availableSeats: 6, occupancyPrices: { TRIPLE: 195_000, QUAD: 180_000 }, ...overrides },
    internal: { isSellable: true },
  });
  const enquiry = () => seed({ booked: false });

  beforeEach(() => {
    createGroupBooking.mockReset();
    loadOfferCandidates.mockReset();
    loadOfferCandidates.mockResolvedValue([offer()]);
    createGroupBooking.mockResolvedValue({ ok: true, result: { bookingId: "bk-new", bookingReference: "LD-1042" } });
  });

  it("holds the seats as HELD (never confirmed) on the group's own hold period, priced from the live offer", async () => {
    const { db } = fakeDb(enquiry());
    const before = Date.now();
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 2 }), ctx(db))).toEqual({ ok: true });
    const [input, options] = createGroupBooking.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(input).toMatchObject({ departureGroupId: GROUP, leadId: LEAD, bookingStatus: "HELD", travellerCount: 2, roomOccupancyPreference: "TRIPLE", packagePricePerPerson: 195_000, amountPaid: 0, primaryContactName: "Amina Rizvi", primaryContactPhone: "94771111111" });
    const hours = (new Date(String(input.seatHoldExpiresAt)).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(35.9);
    expect(hours).toBeLessThan(36.1);
    // The booking engine is told the agency, so nothing it does can cross into another one.
    expect(options).toMatchObject({ agencyId: AGENCY, actor: { name: "Sales Sam", agencyId: AGENCY } });
  });

  it("reads the offer for THIS agency only", async () => {
    await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(fakeDb(enquiry()).db));
    expect(loadOfferCandidates).toHaveBeenCalledWith(expect.anything(), "UMRAH", [GROUP], { agencyId: AGENCY });
  });

  it("links the hold to the lead and to the conversation, only where they were empty", async () => {
    const { db, updates } = fakeDb(enquiry());
    await conversationSeatHoldExecutor.execute(base({ seats: 2 }), ctx(db));
    expect(updates.find((update) => update.table === "leads")).toMatchObject({ values: { booking_id: "bk-new" }, eq: { agency_id: AGENCY, id: LEAD } });
    expect(updates.find((update) => update.table === "departure_group_bookings")).toMatchObject({ values: { source_conversation_id: CONVERSATION, source_message_id: MESSAGE }, eq: { agency_id: AGENCY, id: "bk-new" } });
  });

  it("refuses more seats than remain, a closed departure, and a room with no price — holding nothing", async () => {
    loadOfferCandidates.mockResolvedValueOnce([offer({ availableSeats: 1 })]);
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 2 }), ctx(fakeDb(enquiry()).db))).toEqual({ ok: false, error: "Only 1 seat(s) remain on December Umrah." });
    loadOfferCandidates.mockResolvedValueOnce([{ ...offer(), internal: { isSellable: false } }]);
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(fakeDb(enquiry()).db))).toEqual({ ok: false, error: "That departure is not open for sale right now." });
    loadOfferCandidates.mockResolvedValueOnce([offer({ occupancyPrices: { QUAD: 180_000 } })]);
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(fakeDb(enquiry()).db))).toEqual({ ok: false, error: "No price is set for a triple room on this departure." });
    loadOfferCandidates.mockResolvedValueOnce([]);
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(fakeDb(enquiry()).db))).toMatchObject({ ok: false });
    expect(createGroupBooking).not.toHaveBeenCalled();
  });

  it("refuses a customer who already has a booking or hold, or no phone number", async () => {
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(fakeDb(seed()).db))).toEqual({ ok: false, error: "This customer already has a booking or a seat hold." });
    const noPhone = enquiry();
    noPhone.leads = [{ ...noPhone.leads[0], mobile: "" }];
    noPhone.conversations = [{ ...noPhone.conversations[0], contact_phone: null }];
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(fakeDb(noPhone).db))).toEqual({ ok: false, error: "Add the customer's phone number to their lead first." });
    expect(createGroupBooking).not.toHaveBeenCalled();
  });

  it("passes the booking engine's own refusal straight through, and links nothing", async () => {
    createGroupBooking.mockResolvedValueOnce({ ok: false, error: "Booking reference LD-1042 is already in use." });
    const { db, updates } = fakeDb(enquiry());
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(db))).toEqual({ ok: false, error: "Booking reference LD-1042 is already in use." });
    expect(updates).toHaveLength(0);
  });

  it("still succeeds if only the lead link fails, because the seats ARE held", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tables = enquiry();
    const { db } = fakeDb(tables);
    const original = (db as { from: (t: string) => unknown }).from.bind(db);
    (db as { from: (t: string) => unknown }).from = (table: string) => {
      const builder = original(table) as Record<string, unknown>;
      if (table === "leads") {
        return new Proxy(builder, { get: (target, key: string) => (key === "then" ? (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "link failed" } }).then(resolve) : target[key]) });
      }
      return builder;
    };
    expect(await conversationSeatHoldExecutor.execute(base({ seats: 1 }), ctx(db))).toEqual({ ok: true });
  });

  it("bounds the seats at the boundary, and uses the group's default tier when the lead has no room", () => {
    expect(conversationSeatHoldExecutor.schema.safeParse(base({ seats: 0 })).success).toBe(false);
    expect(conversationSeatHoldExecutor.schema.safeParse(base({ seats: MAX_SEATS_PER_HOLD + 1 })).success).toBe(false);
    expect(conversationSeatHoldExecutor.schema.safeParse(base({ seats: 2.5 })).success).toBe(false);
    expect(roomForHold("UNDECIDED")).toBe("TRIPLE");
    expect(roomForHold("QUAD")).toBe("QUAD");
    expect(roomForHold(null)).toBe("TRIPLE");
  });

  it("is a MEDIUM-risk request under the same capability that gates creating a booking", () => {
    expect(conversationSeatHoldExecutor).toMatchObject({ module: "leads", requiredCapability: "convertToBooking", risk: "MEDIUM" });
  });
});

describe("registry", () => {
  it("registers every new kind under the module that owns what it writes", () => {
    expect(getExecutor("CONVERSATION_PILGRIM_PROFILE")).toMatchObject({ module: "pilgrims", requiredCapability: "createPilgrim" });
    expect(getExecutor("CONVERSATION_TRAVELLER_RELATIONSHIP")).toMatchObject({ module: "pilgrims", requiredCapability: "manageTravelAndRooming" });
    expect(getExecutor("CONVERSATION_SEAT_HOLD")).toMatchObject({ module: "leads", requiredCapability: "convertToBooking" });
    expect(getExecutor("CONVERSATION_PACKAGE_RECOMMENDATION")).toMatchObject({ module: "leads", requiredCapability: "addNote" });
    expect(getExecutor("CONVERSATION_FEEDBACK_REQUEST")).toMatchObject({ module: "inbox", requiredCapability: "convertConversation" });
  });
});
