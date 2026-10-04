import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/inbox-sla-repository", () => ({ loadSlaSettings: async () => ({ calendar: null, timezone: "Asia/Colombo" }) }));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({ loadIntelligence: async () => null }));

const { assignConversationOwner, resolveHandoffOwner } = await import("./inbox-routing-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-09-21T10:00:00Z");

type Row = Record<string, unknown>;

/** Honours `eq`, `in` and `is null`, records every filter and update, and lets a test decide what `update` returns. */
function fakeDb(seed: Record<string, Row[]>, insertError: { message: string } | null = null) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const filters: Array<[string, string, unknown]> = [];
  const updates: Array<{ table: string; patch: Row; where: Array<[string, unknown]> }> = [];

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const where: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    const matching = () => rows.filter((row) => where.every(([column, value]) => {
      if (value === null) return row[column] == null;
      if (Array.isArray(value)) return value.includes(row[column]);
      if (value && typeof value === "object" && "lte" in value) return String(row[column]) <= String(value.lte);
      if (value && typeof value === "object" && "gt" in value) return String(row[column]) > String(value.gt);
      return row[column] === value;
    }));
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push([table, column, value]), where.push([column, value]), builder),
      in: (column: string, value: unknown[]) => (where.push([column, value]), builder),
      is: (column: string, value: null) => (where.push([column, value]), builder),
      lte: (column: string, value: string) => (where.push([column, { lte: value }]), builder),
      gt: (column: string, value: string) => (where.push([column, { gt: value }]), builder),
      order: () => builder,
      limit: () => builder,
      update: (next: Row) => ((patch = next), builder),
      upsert: () => builder,
      insert: (row: Row) => (rows.push(row), Promise.resolve({ error: insertError })),
      maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (patch) {
          updates.push({ table, patch, where: [...where] });
          const hit = matching();
          for (const row of hit) Object.assign(row, patch);
          return resolve({ data: hit, error: null });
        }
        return resolve({ data: matching(), error: null });
      },
    };
    return builder;
  }
  return { db: { from } as never, tables, updates, filters };
}

const staff = (id: string, over: Row = {}): Row => ({ id, agency_id: AGENCY, full_name: `Staff ${id}`, role: "MARKETING", status: "ACTIVE", access_starts_on: null, access_ends_on: null, last_assigned_at: null, ...over });
const seed = (over: Record<string, Row[]> = {}) => ({
  inbox_routing_policy: [{ agency_id: AGENCY, sticky_enabled: true, group_threshold: 10, load_balance_mode: "LEAST_LOADED", respect_shifts: true, coordinator_role_by_queue: {} }],
  staff_profiles: [staff("a"), staff("b")],
  staff_availability: [
    { agency_id: AGENCY, staff_id: "a", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
    { agency_id: AGENCY, staff_id: "b", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
  ],
  conversation_queue_membership: [] as Row[],
  conversations: [{ id: "c1", agency_id: AGENCY, lead_id: "lead-1", assigned_to_id: null, assigned_to_name: null }],
  leads: [{ id: "lead-1", agency_id: AGENCY, assigned_to_id: null }],
  ai_settings: [{ agency_id: AGENCY, default_lead_owner_id: null }],
  ...over,
});

const run = (db: never, over: Partial<{ partySize: number | null; intentCode: string | null }> = {}) => assignConversationOwner(db, { agencyId: AGENCY, conversationId: "c1", now: NOW, partySize: null, intentCode: null, ...over });

describe("assignConversationOwner", () => {
  it("does nothing for an agency with no policy row: routing is off and behaviour is unchanged", async () => {
    const fake = fakeDb(seed({ inbox_routing_policy: [] }));
    expect(await run(fake.db)).toEqual({ status: "SKIPPED", reason: "The agency has no routing policy." });
    expect(fake.updates).toEqual([]);
  });

  it("a new enquiry from a known customer reaches their existing owner", async () => {
    const fake = fakeDb(seed({ leads: [{ id: "lead-1", agency_id: AGENCY, assigned_to_id: "b" }] }));
    expect(await run(fake.db)).toMatchObject({ status: "ASSIGNED", decision: { ownerId: "b", step: "STICKY" } });
    expect(fake.tables.conversations[0]).toMatchObject({ assigned_to_id: "b", assigned_to_name: "Staff b" });
  });

  it("an unknown 12-person enquiry reaches the group coordinator", async () => {
    const fake = fakeDb(seed({ staff_profiles: [staff("sales"), staff("ops", { role: "OPERATIONS" })], staff_availability: [
      { agency_id: AGENCY, staff_id: "sales", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
      { agency_id: AGENCY, staff_id: "ops", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
    ], leads: [{ id: "lead-1", agency_id: AGENCY, assigned_to_id: null }] }));
    expect(await run(fake.db, { partySize: 12, intentCode: "GROUP_ENQUIRY" })).toMatchObject({ status: "ASSIGNED", decision: { ownerId: "ops", step: "COORDINATOR" } });
  });

  it("records why routing chose this owner, so the history can say so", async () => {
    const fake = fakeDb(seed({ leads: [{ id: "lead-1", agency_id: AGENCY, assigned_to_id: "b" }] }));
    await run(fake.db);
    expect(fake.tables.conversation_events).toEqual([
      expect.objectContaining({ agency_id: AGENCY, conversation_id: "c1", kind: "OWNER_ASSIGNED_BY_ROUTING", actor_kind: "SYSTEM", actor_id: null, data: expect.objectContaining({ to_id: "b", to_name: "Staff b", step: "STICKY", reason: expect.any(String) }) }),
    ]);
  });

  it("still assigns when the reason cannot be recorded", async () => {
    const fake = fakeDb(seed(), { message: "no grant" });
    expect(await run(fake.db)).toMatchObject({ status: "ASSIGNED" });
    expect(fake.tables.conversations[0].assigned_to_id).toBeTruthy();
  });

  it("records when the owner was last assigned, so ties rotate", async () => {
    const fake = fakeDb(seed());
    await run(fake.db);
    const stamped = fake.updates.find((update) => update.table === "staff_profiles");
    expect(stamped?.patch).toEqual({ last_assigned_at: NOW.toISOString() });
    expect(fake.tables.staff_profiles.find((row) => row.id === "a")?.last_assigned_at).toBe(NOW.toISOString());
  });

  it("the write only lands while the conversation is still unowned: it never overwrites an owner", async () => {
    const fake = fakeDb(seed({ conversations: [{ id: "c1", agency_id: AGENCY, lead_id: "lead-1", assigned_to_id: "someone", assigned_to_name: "Someone" }] }));
    expect(await run(fake.db)).toEqual({ status: "SKIPPED", reason: "Someone else already owns this conversation." });
    expect(fake.tables.conversations[0].assigned_to_id).toBe("someone");
    expect(fake.updates.find((update) => update.table === "conversations")?.where).toContainEqual(["assigned_to_id", null]);
  });

  it("an off-shift, on-leave or deactivated staff member is never assigned: the conversation stays unassigned", async () => {
    const fake = fakeDb(seed({ staff_profiles: [staff("off", { status: "DEACTIVATED" }), staff("leave"), staff("later", { access_starts_on: "2026-10-01" })], staff_availability: [
      { agency_id: AGENCY, staff_id: "off", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
      { agency_id: AGENCY, staff_id: "leave", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
      { agency_id: AGENCY, staff_id: "leave", kind: "LEAVE", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
      { agency_id: AGENCY, staff_id: "later", kind: "SHIFT", starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-09-22T00:00:00Z" },
    ] }));
    expect(await run(fake.db)).toMatchObject({ status: "UNASSIGNED" });
    expect(fake.tables.conversations[0].assigned_to_id).toBeNull();
    expect(fake.updates).toEqual([]);
  });

  it("counts each person's waiting conversations, weighted by priority, and gives the new one to the lighter load", async () => {
    const fake = fakeDb(
      seed({
        conversation_queue_membership: [
          { agency_id: AGENCY, queue_code: "NEEDS_REPLY", conversation_id: "x1", priority_rank: 0 },
          { agency_id: AGENCY, queue_code: "NEEDS_REPLY", conversation_id: "x2", priority_rank: 300 },
        ],
        conversations: [
          { id: "c1", agency_id: AGENCY, lead_id: "lead-1", assigned_to_id: null },
          { id: "x1", agency_id: AGENCY, assigned_to_id: "a" },
          { id: "x2", agency_id: AGENCY, assigned_to_id: "a" },
        ],
      }),
    );
    expect(await run(fake.db)).toMatchObject({ decision: { ownerId: "b", step: "LEAST_LOADED" } });
  });

  it("honours a dynamic Inbox sendMessage denial even when the base role can send", async () => {
    const fake = fakeDb(seed({
      staff_profiles: [staff("a", { role_id: "role-a" }), staff("b")],
      role_permissions: [{ role_id: "role-a", module: "inbox", capabilities: { sendMessage: false } }],
    }));
    expect(await run(fake.db)).toMatchObject({ decision: { ownerId: "b", step: "LEAST_LOADED" } });
  });

  it("names the agency on every read and write", async () => {
    const fake = fakeDb(seed());
    await run(fake.db);
    for (const table of ["inbox_routing_policy", "staff_profiles", "staff_availability", "conversations", "conversation_queue_membership"]) expect(fake.filters, table).toContainEqual([table, "agency_id", AGENCY]);
    for (const update of fake.updates) expect(update.where, update.table).toContainEqual(["agency_id", AGENCY]);
  });
});

describe("resolveHandoffOwner — the AI handoff", () => {
  it("with no policy it is the configured default owner, exactly as before, even when that person is off shift", async () => {
    const fake = fakeDb(seed({ inbox_routing_policy: [], staff_profiles: [staff("boss", { status: "DEACTIVATED" })], ai_settings: [{ agency_id: AGENCY, default_lead_owner_id: "boss" }] }));
    expect(await resolveHandoffOwner(fake.db, { agencyId: AGENCY, conversationId: "c1", now: NOW })).toEqual({ id: "boss", name: "Staff boss" });
    expect(fake.updates).toEqual([]);
  });

  it("with no policy and no default owner it is nobody, as before", async () => {
    const fake = fakeDb(seed({ inbox_routing_policy: [] }));
    expect(await resolveHandoffOwner(fake.db, { agencyId: AGENCY, conversationId: "c1", now: NOW })).toEqual({ id: null, name: null });
  });

  it("with a policy it is the chain, and the person is stamped", async () => {
    const fake = fakeDb(seed({ leads: [{ id: "lead-1", agency_id: AGENCY, assigned_to_id: "b" }] }));
    expect(await resolveHandoffOwner(fake.db, { agencyId: AGENCY, conversationId: "c1", now: NOW })).toEqual({ id: "b", name: "Staff b" });
    expect(fake.tables.staff_profiles.find((row) => row.id === "b")?.last_assigned_at).toBe(NOW.toISOString());
  });
});
