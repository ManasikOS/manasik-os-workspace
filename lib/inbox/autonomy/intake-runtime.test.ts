import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  resolveEntitlements: vi.fn(async () => ({ autonomyCeiling: "L3" })),
  ensureLead: vi.fn(async () => ({ lead: { id: "lead-1" } })),
  deliver: vi.fn(async () => ({ status: "SENT", externalMessageId: "out-1" })),
  assignOwner: vi.fn(async () => ({ id: "staff-1", name: "Owner" })),
}));
vi.mock("@/lib/billing/entitlements", () => ({ resolveEntitlements: mocks.resolveEntitlements }));
vi.mock("@/lib/agent/whatsapp/lead-capture", () => ({ ensureLeadForConversation: mocks.ensureLead }));
vi.mock("@/lib/agent/whatsapp/reply-delivery", () => ({ deliverAgentReply: mocks.deliver }));
vi.mock("@/lib/agent/whatsapp/tools/handoff", () => ({ assignOwner: mocks.assignOwner }));

const { runBoundedInboxIntake } = await import("./intake-runtime");

/**
 * `inbox_intake_states` is stateful here (unlike every other table) so a test can call `runBoundedInboxIntake`
 * more than once and see what an earlier call actually persisted — needed to exercise FIX4's claim-then-read
 * idempotency path (a second call for the same first message must see the first call's row, not a fresh `null`).
 * A plain `.insert()` on a row that already exists simulates the real primary-key conflict Postgres would raise.
 */
function fakeDb(state: Record<string, unknown> | null, content: string, surface = { enabled: true, mode: "ACTIVE", autonomy: { level: "L3" } }) {
  const writes: Array<{ table: string; operation: string; payload: unknown }> = [];
  let intakeState = state;
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  const responseFor = (table: string) => {
    if (table === "ai_surface_settings") return { data: surface, error: null };
    if (table === "conversation_messages") return { data: { content }, error: null };
    if (table === "inbox_intake_states") return { data: intakeState, error: null };
    return { data: null, error: null };
  };
  const from = vi.fn((table: string) => {
    let operation = "select";
    let payload: unknown;
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => responseFor(table),
      update: (value: unknown) => { operation = "update"; payload = value; writes.push({ table, operation, payload }); return query; },
      insert: (value: unknown) => {
        operation = "insert"; payload = value; writes.push({ table, operation, payload });
        if (table === "inbox_intake_states") {
          if (intakeState) return { then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "duplicate key value violates unique constraint \"inbox_intake_states_pkey\"" } }) };
          intakeState = payload as Record<string, unknown>;
        }
        return query;
      },
      upsert: (value: unknown) => {
        operation = "upsert"; payload = value; writes.push({ table, operation, payload });
        if (table === "inbox_intake_states") intakeState = payload as Record<string, unknown>;
        return query;
      },
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string, params: unknown) => {
    rpcCalls.push({ name, params });
    return { data: true, error: null };
  });
  return { db: { from, rpc } as never, writes, rpcCalls };
}

const conversation = { id: "conv-1", contact_name: "Customer", external_conversation_id: "external-1" } as never;
const adapter = {} as never;

describe("bounded intake runtime", () => {
  beforeEach(() => {
    mocks.deliver.mockClear();
    mocks.ensureLead.mockClear();
    mocks.assignOwner.mockClear();
  });

  it("starts L3 intake with a deterministic qualifying question and a provisional lead", async () => {
    const { db, writes, rpcCalls } = fakeDb(null, "I am interested in Umrah");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;

    await expect(runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-1" })).resolves.toBe(true);

    expect(mocks.ensureLead).toHaveBeenCalledOnce();
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ autonomy_source: "INTAKE_FLOW", autonomy_action: "QUALIFYING_QUESTION", intake_reply_key: "ASK_DATES" }) }));
    expect(writes).toContainEqual(expect.objectContaining({ table: "inbox_intake_states", operation: "upsert", payload: expect.objectContaining({ step: "DATES", last_message_id: "message-1" }) }));
    // FIX3: the first L3 intake turn is a qualifying AI-conversation metering boundary.
    expect(rpcCalls).toEqual([{ name: "meter_ai_conversation", params: expect.objectContaining({ p_agency_id: "agency-1", p_conversation_id: "conv-1" }) }]);
  });

  it("never starts while a staff member is already handling the conversation (state HUMAN_ACTIVE)", async () => {
    const { db, writes } = fakeDb(null, "I am interested in Umrah");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;
    const humanActiveConversation = { id: "conv-1", contact_name: "Customer", external_conversation_id: "external-1", state: "HUMAN_ACTIVE" } as never;

    await expect(runBoundedInboxIntake({ context, conversation: humanActiveConversation, adapter, messageId: "message-1" })).resolves.toBe(false);

    expect(mocks.ensureLead).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.assignOwner).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("never starts while handling_mode is HUMAN_ACTIVE even if state has not caught up yet", async () => {
    const { db, writes } = fakeDb(null, "I am interested in Umrah");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;
    const humanActiveConversation = { id: "conv-1", contact_name: "Customer", external_conversation_id: "external-1", handling_mode: "HUMAN_ACTIVE" } as never;

    await expect(runBoundedInboxIntake({ context, conversation: humanActiveConversation, adapter, messageId: "message-1" })).resolves.toBe(false);

    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("FIX12: leaves the existing WhatsApp worker path alone when Inbox intake is disabled", async () => {
    const { db, writes } = fakeDb(null, "I am interested in Umrah", { enabled: false, mode: "ACTIVE", autonomy: { level: "L3" } });
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;

    await expect(runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-1" })).resolves.toBe(false);

    expect(mocks.ensureLead).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("hands over after the fourth answer without invoking a booking or payment path, and does not re-meter a later turn", async () => {
    const stored = { step: "PASSPORT_READINESS", answers: { DATES: "December", DEPARTURE_CITY: "Colombo", ROOM_ARRANGEMENT: "Quad" }, stalled_turns: 0, last_message_id: "old-message", last_reply_key: "ASK_PASSPORT_READINESS" };
    const { db, writes, rpcCalls } = fakeDb(stored, "Ready");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: "lead-1", channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;

    await runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-4" });

    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.assignOwner).toHaveBeenCalledOnce();
    expect(writes).toContainEqual(expect.objectContaining({ table: "conversations", operation: "update", payload: expect.objectContaining({ state: "HUMAN_REQUESTED" }) }));
    expect(writes.some((write) => /booking|payment/i.test(write.table))).toBe(false);
    // Only the first turn (no existing state) meters; this is turn four.
    expect(rpcCalls).toHaveLength(0);
  });

  it("FIX4: hands over a first message that asks about price, never asking the dates question", async () => {
    const { db } = fakeDb(null, "What is the price of the December package?");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;

    await expect(runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-1" })).resolves.toBe(true);

    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.assignOwner).toHaveBeenCalledOnce();
  });

  it("FIX4: skips the redundant dates question when the first message already names a period", async () => {
    const { db } = fakeDb(null, "Hi, we would like to travel in December");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;

    await runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-1" });

    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ intake_reply_key: "ASK_DEPARTURE_CITY" }) }));
  });

  it("FIX4: a genuinely duplicate first message (same messageId redelivered) sends nothing a second time", async () => {
    const { db, writes } = fakeDb(null, "I am interested in Umrah");
    const context = { agencyId: "agency-1", conversationId: "conv-1", leadId: null, channel: "WHATSAPP", profile: { displayName: "WhatsApp" }, locale: "en", db } as never;

    await runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-1" });
    await runBoundedInboxIntake({ context, conversation, adapter, messageId: "message-1" });

    expect(mocks.deliver).toHaveBeenCalledOnce();
    expect(mocks.ensureLead).toHaveBeenCalledOnce();
    // The first call claims the row with a plain insert; the second sees it already exists and never attempts another insert.
    expect(writes.filter((write) => write.table === "inbox_intake_states" && write.operation === "insert")).toHaveLength(1);
  });
});
