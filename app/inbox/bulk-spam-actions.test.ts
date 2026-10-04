import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PRD-03: bulk mark-spam and restore. Every selected conversation must belong to the caller's agency or nothing is changed
 * (fail closed), a conversation with a booking or an open review is never marked, a fact that cannot be read stops the whole
 * change, and each write is guarded on the state and lifecycle it was planned against.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ACTOR }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ACTOR, name: "Test Actor" }), createGroupBooking: vi.fn() }));
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
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: vi.fn() }));
vi.mock("@/lib/data/inbox-composer-presence-repository", () => ({ claimComposerPresence: vi.fn(), releaseComposerPresence: vi.fn(), syncConcurrentComposerSignal: vi.fn() }));
vi.mock("@/lib/data/conversation-handoff-repository", () => ({
  acknowledgeConversationHandoff: vi.fn(),
  buildHandoffForConversation: vi.fn(),
  createConversationHandoff: vi.fn(),
  loadConversationHandoff: vi.fn(async () => null),
  attachHandoffNarration: vi.fn(),
  handoffNeedsNarration: () => false,
}));
vi.mock("@/lib/data/staff-notifications", () => ({
  notifyConversationWaiting: vi.fn(async () => ({ ok: true, notified: 1 })),
  notifyWorkflowCreated: vi.fn(async () => undefined),
  listActiveStaffIdsByRole: async () => [],
}));
vi.mock("@/lib/ai/surfaces/inbox/handoff-narrate", () => ({ narrateHandoffExpectations: vi.fn() }));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  loadIntelligence: vi.fn(),
  listInterventions: vi.fn(),
  acknowledgeIntervention: vi.fn(async () => ({})),
  resolveIntervention: vi.fn(async () => ({})),
}));
vi.mock("@/lib/inbox/attachments/staged-file", () => ({ verifyStagedAttachment: vi.fn(), createStaffAttachmentUpload: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const role = { value: "MARKETING" as string };
const CONV_A = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const CONV_B = "3f1d2c4e-5a6b-4c7d-8e9f-000000000002";
const LEAD_A = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a1";
const LEAD_B = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000b1";

interface FakeConversation {
  id: string;
  state: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  contact_name: string | null;
  lifecycle_status: string | null;
  lead_id: string | null;
}

let conversationRows: FakeConversation[] = [];
let leadRows: Array<{ id: string; stage: string; booking_id: string | null }> = [];
let reviewRows: Array<{ conversation_id: string }> = [];
let failTable: string | null = null;
let conflictedIds = new Set<string>();
const readFilters: Array<{ table: string; column: string; value: unknown }> = [];
const updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
const events: Array<Record<string, unknown>> = [];

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ACTOR }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ACTOR, name: "Test Actor" }), createGroupBooking: vi.fn() }));
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (rows: Array<Record<string, unknown>>) => {
        events.push(...rows);
        return { error: null };
      },
    }),
  }),
}));

function readChain(table: string, rows: unknown[]) {
  const query: Record<string, unknown> = {
    eq: (column: string, value: unknown) => (readFilters.push({ table, column, value }), query),
    in: () => query,
    then: (resolve: (value: unknown) => unknown) =>
      resolve(failTable === table ? { data: null, error: { message: "boom" } } : { data: rows, error: null }),
  };
  return query;
}

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "leads") return { select: () => readChain("leads", leadRows) };
      if (table === "conversation_interventions") return { select: () => readChain("conversation_interventions", reviewRows) };
      return {
        select: () => readChain("conversations", conversationRows),
        update: (patch: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          const query = {
            eq: (column: string, value: unknown) => ((filters[column] = value), query),
            is: (column: string, value: unknown) => ((filters[column] = value), query),
            select: async () => {
              updates.push({ patch, filters });
              const matched = typeof filters.id === "string" && !conflictedIds.has(filters.id);
              return matched ? { data: [{ id: filters.id }], error: null } : { data: [], error: null };
            },
          };
          return query;
        },
      };
    },
    rpc: async () => ({ error: null }),
  }),
}));

const { bulkUpdateConversationsAction } = await import("./actions");

const conversation = (id: string, overrides: Partial<FakeConversation> = {}): FakeConversation => ({
  id,
  state: "AI_ACTIVE",
  assigned_to_id: null,
  assigned_to_name: null,
  contact_name: "Customer",
  lifecycle_status: "OPEN",
  lead_id: null,
  ...overrides,
});

beforeEach(() => {
  role.value = "MARKETING";
  conversationRows = [];
  leadRows = [];
  reviewRows = [];
  failTable = null;
  conflictedIds = new Set();
  readFilters.length = 0;
  updates.length = 0;
  events.length = 0;
});

describe("bulkUpdateConversationsAction — mark spam", () => {
  it("marks conversations as spam with a one-field change guarded on the state and lifecycle it planned against", async () => {
    conversationRows = [conversation(CONV_A), conversation(CONV_B, { state: "HUMAN_ACTIVE", assigned_to_id: "s1" })];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "MARK_SPAM" } });
    expect(result).toEqual({ ok: true, changed: 2, skipped: 0, summary: "Marked 2 conversations as spam." });
    expect(updates).toHaveLength(2);
    expect(updates[0].patch).toEqual({ lifecycle_status: "SPAM" });
    expect(updates[0].filters).toMatchObject({ agency_id: AGENCY, id: CONV_A, state: "AI_ACTIVE", lifecycle_status: "OPEN" });
    expect(updates[1].filters).toMatchObject({ id: CONV_B, state: "HUMAN_ACTIVE" });
  });

  it("scopes every read to the caller's agency", async () => {
    conversationRows = [conversation(CONV_A, { lead_id: LEAD_A })];
    leadRows = [{ id: LEAD_A, stage: "NEW", booking_id: null }];
    await bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "MARK_SPAM" } });
    for (const table of ["conversations", "leads", "conversation_interventions"]) {
      expect(readFilters).toContainEqual({ table, column: "agency_id", value: AGENCY });
    }
  });

  it("refuses a role that cannot close conversations, before reading or writing anything", async () => {
    role.value = "FINANCE";
    conversationRows = [conversation(CONV_A)];
    await expect(bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "MARK_SPAM" } })).resolves.toEqual({ ok: false, error: "Not permitted." });
    await expect(bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "UNMARK_SPAM" } })).resolves.toEqual({ ok: false, error: "Not permitted." });
    expect(readFilters).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("fails closed when any selected conversation is not the caller's, changing nothing at all", async () => {
    conversationRows = [conversation(CONV_A)];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "MARK_SPAM" } });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(/nothing was changed/i);
    expect(updates).toEqual([]);
  });

  it("never marks a conversation whose lead has a booking or that has an open review", async () => {
    conversationRows = [conversation(CONV_A, { lead_id: LEAD_A }), conversation(CONV_B, { lead_id: LEAD_B })];
    leadRows = [
      { id: LEAD_A, stage: "BOOKED", booking_id: "booking-1" },
      { id: LEAD_B, stage: "NEW", booking_id: null },
    ];
    reviewRows = [{ conversation_id: CONV_B }];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "MARK_SPAM" } });
    expect(result).toMatchObject({ ok: true, changed: 0, skipped: 2 });
    expect(updates).toEqual([]);
  });

  it("changes nothing when a safety fact cannot be read", async () => {
    conversationRows = [conversation(CONV_A, { lead_id: LEAD_A })];
    leadRows = [{ id: LEAD_A, stage: "NEW", booking_id: null }];
    for (const table of ["leads", "conversation_interventions"]) {
      failTable = table;
      const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "MARK_SPAM" } });
      expect(result).toMatchObject({ ok: false });
      expect(updates).toEqual([]);
    }
  });

  it("counts a conversation another writer just changed as skipped instead of overwriting it", async () => {
    conversationRows = [conversation(CONV_A), conversation(CONV_B)];
    conflictedIds = new Set([CONV_B]);
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "MARK_SPAM" } });
    expect(result).toMatchObject({ ok: true, changed: 1, skipped: 1 });
  });

  it("records one audit event per marked conversation", async () => {
    conversationRows = [conversation(CONV_A), conversation(CONV_B)];
    await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "MARK_SPAM" } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ agency_id: AGENCY, kind: "SPAM_MARKED", actor_kind: "STAFF", actor_id: ACTOR });
    expect(events.map((event) => event.conversation_id).sort()).toEqual([CONV_A, CONV_B]);
  });
});

describe("bulkUpdateConversationsAction — restore from spam", () => {
  it("restores each conversation from its own state and audits it", async () => {
    conversationRows = [conversation(CONV_A, { lifecycle_status: "SPAM" }), conversation(CONV_B, { lifecycle_status: "SPAM", state: "CLOSED" })];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "UNMARK_SPAM" } });
    expect(result).toEqual({ ok: true, changed: 2, skipped: 0, summary: "Restored 2 conversations from spam." });
    expect(updates.map((update) => update.patch)).toEqual([{ lifecycle_status: "OPEN" }, { lifecycle_status: "CLOSED" }]);
    expect(updates[0].filters).toMatchObject({ lifecycle_status: "SPAM" });
    expect(events.map((event) => event.kind)).toEqual(["SPAM_RESTORED", "SPAM_RESTORED"]);
  });

  it("will not restore a conversation whose lead is still marked spam", async () => {
    conversationRows = [conversation(CONV_A, { lifecycle_status: "SPAM", lead_id: LEAD_A })];
    leadRows = [{ id: LEAD_A, stage: "SPAM", booking_id: null }];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "UNMARK_SPAM" } });
    expect(result).toMatchObject({ ok: true, changed: 0, skipped: 1 });
    expect(updates).toEqual([]);
  });

  it("fails closed for a foreign id on restore too", async () => {
    conversationRows = [conversation(CONV_A, { lifecycle_status: "SPAM" })];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "UNMARK_SPAM" } });
    expect(result).toMatchObject({ ok: false });
    expect(updates).toEqual([]);
  });
});

describe("bulkUpdateConversationsAction — input boundary", () => {
  it("rejects unknown action kinds and extra fields", async () => {
    conversationRows = [conversation(CONV_A)];
    for (const action of [{ kind: "DELETE" }, { kind: "MARK_SPAM", force: true }, { kind: "SEND" }]) {
      const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A], action });
      expect(result.ok).toBe(false);
    }
    expect(updates).toEqual([]);
  });
});
