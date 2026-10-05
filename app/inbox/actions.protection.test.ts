import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The protection gate is enforced in the Server Actions themselves (MI4.2): a client that calls `sendStaffMessage` directly, with
 * no button in sight, is refused exactly like one that clicked. Everything the action touches is replaced; the gate, the role
 * rules and the schemas are the real ones.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const role = { value: "MARKETING" as string, agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null };
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: role.agencyId, staffId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Test" }), createGroupBooking: vi.fn() }));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: vi.fn() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "WhatsApp" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: vi.fn() }));
vi.mock("@/lib/inbox/conversation-booking", () => ({ deriveBookingFromLead: vi.fn() }));
vi.mock("@/lib/inbox/reply-context", () => ({ loadReplyContextPack: vi.fn() }));
vi.mock("@/lib/ai/surfaces/inbox/workflows", () => ({ suggestConversationReply: vi.fn() }));
vi.mock("@/lib/ai/trust/consent-gate", () => ({ checkConsent: vi.fn() }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: vi.fn() }));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ loadCopilotKnowledgeContext: vi.fn() }));
vi.mock("@/lib/data/inbox-offer-repository", () => ({ checkStoredOffer: vi.fn() }));
vi.mock("@/lib/data/identity-graph-repository", () => ({ confirmIdentityLink: vi.fn(), rejectIdentityLinks: vi.fn(), unlinkIdentityLink: vi.fn() }));
vi.mock("@/app/(main)/leads/copilot-actions", () => ({ saveQuoteDraftAction: vi.fn() }));

const rpc = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ error: null }));
const conversationRow = { 
  id: "c1", 
  channel: "WHATSAPP", 
  state: "HUMAN_ACTIVE", 
  service_window_expires_at: (null as unknown) as string | null, 
  assigned_to_id: null as string | null, 
  assigned_to_name: null as string | null 
};const conversationUpdates: Array<Record<string, unknown>> = [];
/** Every `.eq(column, value)` a `.select(...)` read chained, in order — so a test can confirm a query was scoped
 * by `agency_id` at the query itself, not only by the value the caller happened to pass in. */
const conversationReadFilters: Array<{ column: string; value: unknown }> = [];
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const query = {
          eq: (column: string, value: unknown) => {
            conversationReadFilters.push({ column, value });
            return query;
          },
          single: async () => ({ data: conversationRow, error: null }),
          maybeSingle: async () => ({ data: conversationRow, error: null }),
        };
        return query;
      },
      update: (patch: Record<string, unknown>) => {
        conversationUpdates.push(patch);
        // Chainable like the real client: .eq/.is narrow the write, .select asks for the rows it changed, and awaiting it settles.
        const write: Record<string, unknown> = {};
        write.eq = () => write;
        write.is = () => write;
        write.select = () => write;
        write.then = (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: "c1" }], error: null });
        return write;
      },
    }),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));

const loadProtectionContext = vi.fn();
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: (...args: unknown[]) => loadProtectionContext(...args) }));

const claimComposerPresence = vi.fn();
const releaseComposerPresence = vi.fn();
const syncConcurrentComposerSignal = vi.fn();
vi.mock("@/lib/data/inbox-composer-presence-repository", () => ({
  claimComposerPresence: (...args: unknown[]) => claimComposerPresence(...args),
  releaseComposerPresence: (...args: unknown[]) => releaseComposerPresence(...args),
  syncConcurrentComposerSignal: (...args: unknown[]) => syncConcurrentComposerSignal(...args),
}));

const acknowledgeConversationHandoff = vi.fn();
const buildHandoffForConversation = vi.fn();
const createConversationHandoff = vi.fn();
const loadConversationHandoff = vi.fn(async () => null as unknown);
const attachHandoffNarration = vi.fn();
vi.mock("@/lib/data/conversation-handoff-repository", () => ({
  acknowledgeConversationHandoff: (...args: unknown[]) => acknowledgeConversationHandoff(...args),
  buildHandoffForConversation: (...args: unknown[]) => buildHandoffForConversation(...args),
  createConversationHandoff: (...args: unknown[]) => createConversationHandoff(...args),
  loadConversationHandoff: (...args: unknown[]) => (loadConversationHandoff as (...a: unknown[]) => unknown)(...args),
  attachHandoffNarration: (...args: unknown[]) => attachHandoffNarration(...args),
  handoffNeedsNarration: (record: { acknowledgedAt: string | null; customerExpectations: { items?: string[] } }) => record.acknowledgedAt === null && !(record.customerExpectations.items?.length),
}));
const notifyConversationWaiting = vi.fn(async () => ({ ok: true, notified: 1 }));
vi.mock("@/lib/data/staff-notifications", () => ({
  notifyConversationWaiting: (...args: unknown[]) => (notifyConversationWaiting as (...a: unknown[]) => unknown)(...args),
  listActiveStaffIdsByRole: async () => ["ops-1", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
}));
const narrateHandoffExpectations = vi.fn();
vi.mock("@/lib/ai/surfaces/inbox/handoff-narrate", () => ({
  narrateHandoffExpectations: (...args: unknown[]) => narrateHandoffExpectations(...args),
}));

const listInterventions = vi.fn();
const acknowledgeIntervention = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));
const resolveIntervention = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  loadIntelligence: vi.fn(),
  listInterventions: (...args: unknown[]) => listInterventions(...args),
  acknowledgeIntervention: (...args: unknown[]) => acknowledgeIntervention(...args),
  resolveIntervention: (...args: unknown[]) => resolveIntervention(...args),
}));

const verifyStagedAttachment = vi.fn();
const createStaffAttachmentUpload = vi.fn();
vi.mock("@/lib/inbox/attachments/staged-file", () => ({
  verifyStagedAttachment: (...args: unknown[]) => verifyStagedAttachment(...args),
  createStaffAttachmentUpload: (...args: unknown[]) => createStaffAttachmentUpload(...args),
}));

const {
  acknowledgeConversationHandoffAction,
  prepareStaffAttachmentUpload,
  claimConversationComposerAction,
  createConversationHandoffAction,
  releaseConversationComposerAction,
  sendStaffMessage,
  scheduleConversationFollowUp,
  updateInterventionAction,
} = await import("./actions");

const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const REVIEW_ID = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000ee";
const paymentReview = { kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "The customer says they paid, but no payment is recorded" };

beforeEach(() => {
  rpc.mockClear();
  conversationUpdates.length = 0;
  conversationReadFilters.length = 0;
  conversationRow.state = "HUMAN_ACTIVE";
  conversationRow.channel = "WHATSAPP";
  conversationRow.service_window_expires_at = null;
  conversationRow.assigned_to_id = null;
  conversationRow.assigned_to_name = null;
  loadProtectionContext.mockReset();
  listInterventions.mockReset();
  acknowledgeIntervention.mockClear();
  resolveIntervention.mockClear();
  claimComposerPresence.mockReset();
  releaseComposerPresence.mockReset();
  syncConcurrentComposerSignal.mockReset();
  acknowledgeConversationHandoff.mockReset();
  buildHandoffForConversation.mockReset();
  createConversationHandoff.mockReset();
  narrateHandoffExpectations.mockReset();
  loadConversationHandoff.mockReset();
  loadConversationHandoff.mockResolvedValue(null);
  attachHandoffNarration.mockReset();
  notifyConversationWaiting.mockClear();
  role.value = "MARKETING";
});

describe("Sales to Operations handoff actions", () => {
  it("stores deterministic facts plus only the guarded narration", async () => {
    const deterministic = { summary: { booking: { reference: "BK-100" } }, openItems: [] };
    buildHandoffForConversation.mockResolvedValue({ bookingId: REVIEW_ID, handoff: deterministic, customerMessages: ["Please call me before departure"] });
    narrateHandoffExpectations.mockResolvedValue({ value: { expectations: ["Call before departure"], sentiment: "CONCERNED", confidence: 0.88 }, source: "LLM", note: null });
    createConversationHandoff.mockResolvedValue({ created: true, record: { id: REVIEW_ID, conversationId: CONVERSATION, bookingId: REVIEW_ID, ...deterministic, customerExpectations: { items: ["Call before departure"], source: "LLM", confidence: 0.88 }, sentiment: "CONCERNED", createdAt: "2026-09-21T10:00:00Z", acknowledgedAt: null, acknowledgedBy: null } });
    const result = await createConversationHandoffAction({ conversationId: CONVERSATION });
    expect(result).toMatchObject({ ok: true, created: true, handoff: { sentiment: "CONCERNED" } });
    expect(notifyConversationWaiting).toHaveBeenCalledWith(expect.objectContaining({ agencyId: role.agencyId, conversationId: CONVERSATION, recipientIds: ["ops-1"] }), expect.anything());
    expect(createConversationHandoff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agencyId: role.agencyId,
      conversationId: CONVERSATION,
      createdBy: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      handoff: deterministic,
      customerExpectations: expect.objectContaining({ source: "LLM", confidence: 0.88 }),
    }));
  });

  const stored = (overrides: Record<string, unknown> = {}) => ({ id: REVIEW_ID, conversationId: CONVERSATION, bookingId: REVIEW_ID, summary: {}, openItems: [], customerExpectations: { items: ["Call before departure"], source: "LLM" }, sentiment: "NEUTRAL", createdAt: "2026-09-21T10:00:00Z", acknowledgedAt: null, acknowledgedBy: null, ...overrides });

  it("a repeat click returns the stored handoff without another model call or notification", async () => {
    buildHandoffForConversation.mockResolvedValue({ bookingId: REVIEW_ID, handoff: { summary: {}, openItems: [] }, customerMessages: ["hello"] });
    loadConversationHandoff.mockResolvedValue(stored());
    await expect(createConversationHandoffAction({ conversationId: CONVERSATION })).resolves.toMatchObject({ ok: true, created: false });
    expect(narrateHandoffExpectations).not.toHaveBeenCalled();
    expect(createConversationHandoff).not.toHaveBeenCalled();
    expect(notifyConversationWaiting).not.toHaveBeenCalled();
  });

  it("a stored handoff that never got its summary is completed on the next click, without notifying again", async () => {
    buildHandoffForConversation.mockResolvedValue({ bookingId: REVIEW_ID, handoff: { summary: {}, openItems: [] }, customerMessages: ["hello"] });
    loadConversationHandoff.mockResolvedValue(stored({ customerExpectations: { items: [], source: "RULES", note: "off" } }));
    narrateHandoffExpectations.mockResolvedValue({ value: { expectations: ["Call before departure"], sentiment: "NEUTRAL", confidence: 0.9 }, source: "LLM", note: null });
    attachHandoffNarration.mockResolvedValue(stored());
    await expect(createConversationHandoffAction({ conversationId: CONVERSATION })).resolves.toMatchObject({ ok: true, created: false });
    expect(attachHandoffNarration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: role.agencyId, handoffId: REVIEW_ID }));
    expect(createConversationHandoff).not.toHaveBeenCalled();
    expect(notifyConversationWaiting).not.toHaveBeenCalled();
  });

  it("a narration that fails still hands the booking over, with the reason recorded", async () => {
    buildHandoffForConversation.mockResolvedValue({ bookingId: REVIEW_ID, handoff: { summary: {}, openItems: [] }, customerMessages: ["hello"] });
    narrateHandoffExpectations.mockResolvedValue({ value: null, source: "RULES", note: "AI surface is turned off" });
    createConversationHandoff.mockResolvedValue({ created: true, record: stored({ customerExpectations: { items: [], source: "RULES", note: "AI surface is turned off" }, sentiment: null }) });
    await expect(createConversationHandoffAction({ conversationId: CONVERSATION })).resolves.toMatchObject({ ok: true, created: true });
    expect(createConversationHandoff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerExpectations: { items: [], source: "RULES", note: "AI surface is turned off" } }));
  });

  it("refuses a role without reply access before reading anything", async () => {
    role.value = "FINANCE";
    await expect(createConversationHandoffAction({ conversationId: CONVERSATION })).resolves.toMatchObject({ ok: false });
    expect(buildHandoffForConversation).not.toHaveBeenCalled();
  });

  it("records the Operations actor and rejects other roles", async () => {
    role.value = "OPERATIONS";
    await expect(acknowledgeConversationHandoffAction({ handoffId: REVIEW_ID })).resolves.toEqual({ ok: true });
    expect(acknowledgeConversationHandoff).toHaveBeenCalledWith(expect.anything(), role.agencyId, REVIEW_ID, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    role.value = "VISA";
    await expect(acknowledgeConversationHandoffAction({ handoffId: REVIEW_ID })).resolves.toMatchObject({ ok: false });
  });
});

describe("composer presence actions — a warning is never a reply lock", () => {
  it("uses the authenticated staff and agency, not values from the browser", async () => {
    claimComposerPresence.mockResolvedValue({
      status: "CLAIMED",
      presence: { staffId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", at: "2026-09-21T10:00:00.000Z" },
    });
    await expect(claimConversationComposerAction({ conversationId: CONVERSATION })).resolves.toMatchObject({ ok: true, status: "CLAIMED" });
    expect(claimComposerPresence).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agencyId: role.agencyId,
      conversationId: CONVERSATION,
      staffId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }));
  });

  it("rejects malformed input and a role without reply access", async () => {
    expect(await claimConversationComposerAction({ conversationId: "not-a-uuid" })).toMatchObject({ ok: false });
    role.value = "FINANCE";
    expect(await releaseConversationComposerAction({ conversationId: CONVERSATION })).toEqual({ ok: false, error: "Not permitted to reply here." });
    expect(releaseComposerPresence).not.toHaveBeenCalled();
  });
});

describe("sendStaffMessage — the gate is enforced on the server", () => {
  it("refuses a payment confirmation while the payment review is open, and sends nothing", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [paymentReview], approvedAccountDigits: [] });
    const result = await sendStaffMessage(CONVERSATION, "Good news, we have received your payment. Thank you!");
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("Resolve it first");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a payment confirmation that is only in the email subject", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [paymentReview], approvedAccountDigits: [] });
    const result = await sendStaffMessage(CONVERSATION, "Thank you for writing to us.", null, undefined, null, { subject: "Payment received - thank you" });
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a message that only acknowledges", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [paymentReview], approvedAccountDigits: [] });
    expect(await sendStaffMessage(CONVERSATION, "Thank you, a colleague is checking your payment and will come back to you.")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps a human staff send available at 200% AI allowance", async () => {
    // Human sending deliberately has no entitlement/budget dependency: an exhausted AI allowance may degrade models,
    // but must never silence a customer conversation.
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    expect(await sendStaffMessage(CONVERSATION, "A staff member is replying directly.")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.objectContaining({ p_conversation_id: CONVERSATION }));
  });

  it("resolving the review unblocks: with nothing open the same words go out", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    expect(await sendStaffMessage(CONVERSATION, "Good news, we have received your payment. Thank you!")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed: if the open reviews cannot be read, nothing is sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loadProtectionContext.mockRejectedValue(new Error("exploded"));
    const result = await sendStaffMessage(CONVERSATION, "Hello");
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads the reviews for THIS agency and conversation, never one the client names", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    await sendStaffMessage(CONVERSATION, "Hello");
    expect(loadProtectionContext).toHaveBeenCalledWith(expect.anything(), role.agencyId, CONVERSATION);
  });

  it("a role that cannot send is refused before the gate is even read", async () => {
    role.value = "FINANCE";
    expect(await sendStaffMessage(CONVERSATION, "Hello")).toEqual({ ok: false, error: "Not permitted." });
    expect(loadProtectionContext).not.toHaveBeenCalled();
  });
});

describe("sendStaffMessage — email subject/cc/bcc (docs/inbox/email-channel-implementation-plan.md, Phase 3)", () => {
  beforeEach(() => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
  });

  it("passes subject/cc/bcc through to the RPC when the composer supplied them", async () => {
    await sendStaffMessage(CONVERSATION, "Hello", null, undefined, null, { subject: "Re: Your trip", cc: ["cc@example.com"], bcc: [] });
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.objectContaining({ p_subject: "Re: Your trip", p_cc: ["cc@example.com"], p_bcc: null }));
  });

  it("sends null for every email field on a plain reply, never an empty string or array", async () => {
    await sendStaffMessage(CONVERSATION, "Hello");
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.objectContaining({ p_subject: null, p_cc: null, p_bcc: null }));
  });

  it("sends an email reply even when the stored service window is long past: email has no 24h reply window", async () => {
    conversationRow.channel = "GMAIL";
    conversationRow.service_window_expires_at = new Date(Date.now() - 72 * 3_600_000).toISOString();
    expect(await sendStaffMessage(CONVERSATION, "Hello")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.anything());
  });

  it("still refuses a WhatsApp reply outside its 24h window", async () => {
    conversationRow.service_window_expires_at = new Date(Date.now() - 3_600_000).toISOString();
    expect(await sendStaffMessage(CONVERSATION, "Hello")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid Cc address before it reaches the RPC", async () => {
    const result = await sendStaffMessage(CONVERSATION, "Hello", null, undefined, null, { cc: ["not-an-email"] });
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("sendStaffMessage — exact idempotency (SC6)", () => {
  const KEY = "5b0f6c1e-9d3a-4e2b-8c7d-0123456789ab";
  const MESSAGE_ID = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000aa";

  it("passes the browser's key to the database, so a retry cannot create a second message", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    await sendStaffMessage(CONVERSATION, "Hello", null, KEY);
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.objectContaining({ p_client_idempotency_key: KEY }));
  });

  it("reuses the same key on a retry: both calls name the same message, so the database (unique on the key) returns the one it stored", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    rpc.mockResolvedValue({ data: [{ message_id: MESSAGE_ID, outbox_id: "o1" }], error: null });
    const first = await sendStaffMessage(CONVERSATION, "Hello", null, KEY);
    const retry = await sendStaffMessage(CONVERSATION, "Hello", null, KEY);
    expect(first).toEqual({ ok: true, messageId: MESSAGE_ID });
    expect(retry).toEqual({ ok: true, messageId: MESSAGE_ID });
    const keys = rpc.mock.calls.map((call) => (call[1] as { p_client_idempotency_key: string }).p_client_idempotency_key);
    expect(keys).toEqual([KEY, KEY]);
  });

  it("gives a deliberate second send of identical text a different key, so it is a different message", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    await sendStaffMessage(CONVERSATION, "Ok", null, "11111111-1111-4111-8111-111111111111");
    await sendStaffMessage(CONVERSATION, "Ok", null, "22222222-2222-4222-8222-222222222222");
    const keys = rpc.mock.calls.map((call) => (call[1] as { p_client_idempotency_key: string }).p_client_idempotency_key);
    expect(new Set(keys).size).toBe(2);
  });

  it("still works for a caller that supplies no key: a fresh one is generated, as before", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    await sendStaffMessage(CONVERSATION, "Hello");
    const key = (rpc.mock.calls[0][1] as { p_client_idempotency_key: string }).p_client_idempotency_key;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a key that is not a UUID before anything is written", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    const result = await sendStaffMessage(CONVERSATION, "Hello", null, "not-a-uuid");
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not report a canonical id when the database returned none", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    rpc.mockResolvedValue({ error: null });
    expect(await sendStaffMessage(CONVERSATION, "Hello", null, KEY)).toEqual({ ok: true });
  });
});

describe("sendStaffMessage — a failed send does not leave the chat taken over", () => {
  it("puts the chat back as it was when the message could not be queued after taking control", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    conversationRow.state = "AI_RESUMED";
    rpc.mockResolvedValueOnce({ data: null, error: { message: "queue is down" } });
    const result = await sendStaffMessage(CONVERSATION, "Hello");
    expect(result).toMatchObject({ ok: false });
    expect(conversationUpdates).toHaveLength(2);
    expect(conversationUpdates[0]).toMatchObject({ state: "HUMAN_ACTIVE" });
    expect(conversationUpdates[1]).toEqual({ state: "AI_RESUMED", assigned_to_id: null, assigned_to_name: null });
  });

  it("does not touch the chat when it was already with a person and the queue failed", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await sendStaffMessage(CONVERSATION, "Hello");
    expect(conversationUpdates).toHaveLength(0);
  });

  it("never hands the browser a raw database message", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint "pg_internal_idx"' } });
    const result = (await sendStaffMessage(CONVERSATION, "Hello")) as { ok: false; error: string };
    expect(result.error).not.toContain("pg_internal_idx");
  });
});

describe("scheduleConversationFollowUp — input is validated at the boundary", () => {
  it("refuses a conversation id that is not a UUID, an unknown type and a non-string time", async () => {
    role.value = "ADMIN";
    await expect(scheduleConversationFollowUp({ conversationId: "not-a-uuid", dueAt: "2999-01-01T00:00:00Z", type: "CALL" })).resolves.toMatchObject({ ok: false });
    await expect(scheduleConversationFollowUp({ conversationId: CONVERSATION, dueAt: "2999-01-01T00:00:00Z", type: "NOT_A_TYPE" as never })).resolves.toMatchObject({ ok: false });
    await expect(scheduleConversationFollowUp({ conversationId: CONVERSATION, dueAt: 12 as never, type: "CALL" })).resolves.toMatchObject({ ok: false });
  });
});

describe("updateInterventionAction — who may close a review", () => {
  const open = (kind = "PAYMENT_CLAIM") => listInterventions.mockResolvedValue([{ id: REVIEW_ID, kind, severity: "BLOCK", status: "OPEN" }]);
  const decide = (decision: "ACKNOWLEDGE" | "RESOLVE" | "DISMISS", note = "") => updateInterventionAction({ conversationId: CONVERSATION, interventionId: REVIEW_ID, decision, note });

  it("Finance resolves a payment claim with a note, and the actor is recorded", async () => {
    role.value = "FINANCE";
    open();
    expect(await decide("RESOLVE", "Found it on the 20 Sept statement, recorded.")).toEqual({ ok: true });
    expect(resolveIntervention).toHaveBeenCalledWith(expect.anything(), role.agencyId, expect.objectContaining({ interventionId: REVIEW_ID, status: "RESOLVED", note: "Found it on the 20 Sept statement, recorded.", actorStaffId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
  });

  it("a sales colleague cannot close a money review, even by calling the action directly", async () => {
    role.value = "MARKETING";
    open();
    const result = await decide("RESOLVE", "Looks fine");
    expect(result).toEqual({ ok: false, error: "Only Finance or an Admin can close this review." });
    expect(resolveIntervention).not.toHaveBeenCalled();
  });

  it("a sales colleague may close a non-money review", async () => {
    role.value = "MARKETING";
    open("GROUP_FULL");
    expect(await decide("DISMISS", "Waitlist offered.")).toEqual({ ok: true });
    expect(resolveIntervention).toHaveBeenCalledWith(expect.anything(), role.agencyId, expect.objectContaining({ status: "DISMISSED" }));
  });

  it("closing needs a note: resolving or dismissing with none is refused", async () => {
    role.value = "FINANCE";
    open();
    for (const decision of ["RESOLVE", "DISMISS"] as const) expect(await decide(decision, "   ")).toEqual({ ok: false, error: "Write a short note before you close this review." });
    expect(resolveIntervention).not.toHaveBeenCalled();
  });

  it("the person who may close a review may also say 'I am on it' without a note", async () => {
    role.value = "FINANCE";
    open();
    expect(await decide("ACKNOWLEDGE")).toEqual({ ok: true });
    expect(acknowledgeIntervention).toHaveBeenCalledWith(expect.anything(), role.agencyId, REVIEW_ID);
  });

  it("Finance cannot close, or take, a complaint or medical-urgency review: it cannot reply in the Inbox (SEC-5)", async () => {
    role.value = "FINANCE";
    for (const kind of ["COMPLAINT", "MEDICAL_URGENCY"]) {
      open(kind);
      expect(await decide("RESOLVE", "Handled.")).toEqual({ ok: false, error: "Your role cannot close this review." });
      expect(await decide("ACKNOWLEDGE")).toEqual({ ok: false, error: "Your role cannot close this review." });
    }
    expect(resolveIntervention).not.toHaveBeenCalled();
    expect(acknowledgeIntervention).not.toHaveBeenCalled();
  });

  it("a role without Inbox access is refused before any review is read", async () => {
    role.value = "GUIDE";
    open();
    expect(await decide("ACKNOWLEDGE")).toEqual({ ok: false, error: "Your role cannot work on Inbox reviews." });
    expect(listInterventions).not.toHaveBeenCalled();
  });

  it("reports a lost race instead of success when the acknowledge changed nothing", async () => {
    role.value = "FINANCE";
    open();
    acknowledgeIntervention.mockResolvedValueOnce(null);
    expect(await decide("ACKNOWLEDGE")).toMatchObject({ ok: false });
  });

  it("treats acknowledging a review that is already acknowledged as done", async () => {
    role.value = "FINANCE";
    listInterventions.mockResolvedValue([{ id: REVIEW_ID, kind: "PAYMENT_CLAIM", severity: "BLOCK", status: "ACKNOWLEDGED" }]);
    acknowledgeIntervention.mockResolvedValueOnce(null);
    expect(await decide("ACKNOWLEDGE")).toEqual({ ok: true });
  });

  it("a review that is not open on this conversation cannot be touched", async () => {
    role.value = "FINANCE";
    listInterventions.mockResolvedValue([]);
    expect(await decide("RESOLVE", "x")).toEqual({ ok: false, error: "That review is already closed, or is not on this conversation." });
  });

  it("reads only the open reviews of the caller's own agency", async () => {
    role.value = "FINANCE";
    open();
    await decide("ACKNOWLEDGE");
    expect(listInterventions).toHaveBeenCalledWith(expect.anything(), role.agencyId, CONVERSATION, { openOnly: true });
  });

  it("rejects a malformed request at the boundary", async () => {
    expect(await updateInterventionAction({ conversationId: "nope", interventionId: REVIEW_ID, decision: "RESOLVE", note: "x" })).toMatchObject({ ok: false });
    expect(await updateInterventionAction({ conversationId: CONVERSATION, interventionId: REVIEW_ID, decision: "DELETE" })).toMatchObject({ ok: false });
  });
});

describe("sendStaffMessage with a file (F1)", () => {
  const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PATH = `${AGENCY}/outbound/${CONVERSATION}/9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f.pdf`;
  const ref = { path: PATH, filename: "Itinerary.pdf", mimeType: "application/pdf" };
  const verified = { ok: true, path: PATH, filename: "Itinerary.pdf", mimeType: "application/pdf", byteSize: 4321, checksumSha256: "a".repeat(64) };

  beforeEach(() => {
    role.value = "MARKETING";
    verifyStagedAttachment.mockReset().mockResolvedValue(verified);
    createStaffAttachmentUpload.mockReset();
    loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
  });

  it("queues the file through the media function, using the size and checksum read from storage, not anything the browser said", async () => {
    expect(await sendStaffMessage(CONVERSATION, "Your itinerary", null, undefined, { ...ref, filename: "spoofed.exe" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_media_message", {
      p_conversation_id: CONVERSATION,
      p_caption: "Your itinerary",
      p_client_idempotency_key: expect.any(String),
      p_storage_path: PATH,
      p_filename: "Itinerary.pdf",
      p_mime_type: "application/pdf",
      p_byte_size: 4321,
      p_checksum_sha256: "a".repeat(64),
      p_subject: null,
      p_cc: null,
      p_bcc: null,
    });
  });

  it("reads the stored file for the session's own agency and the conversation's own channel, never ones the client names", async () => {
    await sendStaffMessage(CONVERSATION, "", null, undefined, ref);
    expect(verifyStagedAttachment).toHaveBeenCalledWith(expect.anything(), { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", ref });
  });

  it("lets a file go with no text at all", async () => {
    expect(await sendStaffMessage(CONVERSATION, "", null, undefined, ref)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_media_message", expect.objectContaining({ p_caption: "" }));
  });

  it("still refuses a message with neither text nor a file", async () => {
    expect(await sendStaffMessage(CONVERSATION, "   ")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a caption over 1,000 characters", async () => {
    expect(await sendStaffMessage(CONVERSATION, "x".repeat(1001), null, undefined, ref)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends nothing when the stored file is refused, and says why", async () => {
    verifyStagedAttachment.mockResolvedValue({ ok: false, error: "This PDF contains a script or launch action, so it can't be sent." });
    expect(await sendStaffMessage(CONVERSATION, "Here", null, undefined, ref)).toEqual({ ok: false, error: "This PDF contains a script or launch action, so it can't be sent." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed file reference at the boundary", async () => {
    expect(await sendStaffMessage(CONVERSATION, "Hi", null, undefined, { path: "", filename: "", mimeType: "" })).toEqual({ ok: false, error: "Attach the file again." });
    expect(verifyStagedAttachment).not.toHaveBeenCalled();
  });

  it("still applies the protection gate to the caption", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [paymentReview], approvedAccountDigits: [] });
    const result = await sendStaffMessage(CONVERSATION, "Good news, we have received your payment. Thank you!", null, undefined, ref);
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a role that cannot send is refused before the file is read", async () => {
    role.value = "FINANCE";
    expect(await sendStaffMessage(CONVERSATION, "Hi", null, undefined, ref)).toEqual({ ok: false, error: "Not permitted." });
    expect(verifyStagedAttachment).not.toHaveBeenCalled();
  });
});

describe("prepareStaffAttachmentUpload (F1)", () => {
  const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const request = { conversationId: CONVERSATION, filename: "Itinerary.pdf", mimeType: "application/pdf", byteSize: 200_000 };

  beforeEach(() => {
    role.value = "MARKETING";
    createStaffAttachmentUpload.mockReset().mockResolvedValue({ ok: true, path: "p", token: "t", filename: "Itinerary.pdf" });
  });

  it("issues an upload for the session's agency and the conversation's own channel", async () => {
    expect(await prepareStaffAttachmentUpload(request)).toEqual({ ok: true, path: "p", token: "t", filename: "Itinerary.pdf" });
    expect(createStaffAttachmentUpload).toHaveBeenCalledWith(expect.anything(), { agencyId: AGENCY, conversationId: CONVERSATION, channel: "WHATSAPP", filename: "Itinerary.pdf", mimeType: "application/pdf" });
  });

  it("reads the conversation scoped to this agency, not just by its id (defense in depth alongside RLS)", async () => {
    await prepareStaffAttachmentUpload(request);
    expect(conversationReadFilters).toContainEqual({ column: "agency_id", value: AGENCY });
    expect(conversationReadFilters).toContainEqual({ column: "id", value: CONVERSATION });
  });

  it("refuses a role that cannot send, a disallowed type and an oversized file, all before issuing anything", async () => {
    role.value = "FINANCE";
    expect(await prepareStaffAttachmentUpload(request)).toEqual({ ok: false, error: "Not permitted." });
    role.value = "MARKETING";
    expect(await prepareStaffAttachmentUpload({ ...request, mimeType: "application/x-msdownload" })).toMatchObject({ ok: false });
    expect(await prepareStaffAttachmentUpload({ ...request, byteSize: 11 * 1024 * 1024 })).toMatchObject({ ok: false });
    expect(createStaffAttachmentUpload).not.toHaveBeenCalled();
  });

  it("refuses a closed conversation", async () => {
    conversationRow.state = "CLOSED";
    expect(await prepareStaffAttachmentUpload(request)).toEqual({ ok: false, error: "This conversation is closed." });
    expect(createStaffAttachmentUpload).not.toHaveBeenCalled();
  });
});
