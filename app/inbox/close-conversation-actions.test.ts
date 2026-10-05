import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-9 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): Close, single and bulk, skipped the open-review check that
 * marking spam makes and wrote no history row, so a chat with a live complaint could be closed with the review still attached and
 * nobody could tell who closed it.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ACTOR }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ACTOR, name: "Test Actor" }), createGroupBooking: vi.fn() }));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(), changeOneLead: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
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
let reviewRows: Array<{ conversation_id: string; id: string }> = [];
let failTable: string | null = null;
let alreadyClosedIds = new Set<string>();
const updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown>; notEqual: Record<string, unknown> }> = [];
const events: Array<Record<string, unknown>> = [];

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        events.push(...(Array.isArray(rows) ? rows : [rows]));
        return { error: null };
      },
    }),
  }),
}));

function readChain(table: string, rows: unknown[]) {
  const query: Record<string, unknown> = {
    eq: () => query,
    in: () => query,
    limit: () => query,
    then: (resolve: (value: unknown) => unknown) => resolve(failTable === table ? { data: null, error: { message: "boom" } } : { data: rows, error: null }),
  };
  return query;
}

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "conversation_interventions") return { select: () => readChain("conversation_interventions", reviewRows) };
      return {
        select: () => readChain("conversations", conversationRows),
        update: (patch: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          const notEqual: Record<string, unknown> = {};
          const query = {
            eq: (column: string, value: unknown) => ((filters[column] = value), query),
            neq: (column: string, value: unknown) => ((notEqual[column] = value), query),
            is: (column: string, value: unknown) => ((filters[column] = value), query),
            select: async () => {
              updates.push({ patch, filters, notEqual });
              const matched = typeof filters.id === "string" && !alreadyClosedIds.has(filters.id);
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

const { bulkUpdateConversationsAction, closeConversation } = await import("./actions");

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
  reviewRows = [];
  failTable = null;
  alreadyClosedIds = new Set();
  updates.length = 0;
  events.length = 0;
});

describe("closeConversation", () => {
  it("closes a chat and records who closed it", async () => {
    expect(await closeConversation(CONV_A)).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ state: "CLOSED" });
    expect(updates[0].filters).toMatchObject({ agency_id: AGENCY, id: CONV_A });
    expect(events).toEqual([expect.objectContaining({ agency_id: AGENCY, conversation_id: CONV_A, kind: "CONVERSATION_CLOSED", actor_kind: "STAFF", actor_id: ACTOR, data: { actorName: "Test Actor" } })]);
  });

  it("refuses a chat with an open review, and writes nothing", async () => {
    reviewRows = [{ conversation_id: CONV_A, id: "review-1" }];
    const result = await closeConversation(CONV_A);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("open review") });
    expect(updates).toEqual([]);
    expect(events).toEqual([]);
  });

  it("does not close a chat when it cannot tell whether a review is open", async () => {
    failTable = "conversation_interventions";
    expect(await closeConversation(CONV_A)).toMatchObject({ ok: false });
    expect(updates).toEqual([]);
  });

  it("only touches a chat that is not already closed, and adds no history row for one that was", async () => {
    alreadyClosedIds = new Set([CONV_A]);
    expect(await closeConversation(CONV_A)).toEqual({ ok: true });
    expect(updates[0].notEqual).toEqual({ state: "CLOSED" });
    expect(events).toEqual([]);
  });

  it("is still refused to a role that may not close conversations", async () => {
    role.value = "FINANCE";
    expect(await closeConversation(CONV_A)).toEqual({ ok: false, error: "Not permitted." });
    expect(updates).toEqual([]);
  });
});

describe("bulkUpdateConversationsAction — close", () => {
  it("closes the chats without a review, leaves the others, and records one row per closed chat", async () => {
    conversationRows = [conversation(CONV_A), conversation(CONV_B)];
    reviewRows = [{ conversation_id: CONV_B, id: "review-1" }];
    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "CLOSE" } });
    expect(result).toEqual({ ok: true, changed: 1, skipped: 1, summary: "Closed 1 conversation. 1 was left alone." });
    expect(updates.map((update) => update.filters.id)).toEqual([CONV_A]);
    expect(events).toEqual([expect.objectContaining({ conversation_id: CONV_A, kind: "CONVERSATION_CLOSED", actor_id: ACTOR, data: { actorName: "Test Actor", bulk: true } })]);
  });

  it("changes nothing when the open reviews cannot be read", async () => {
    conversationRows = [conversation(CONV_A)];
    failTable = "conversation_interventions";
    expect(await bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "CLOSE" } })).toMatchObject({ ok: false });
    expect(updates).toEqual([]);
    expect(events).toEqual([]);
  });

  it("records nothing for a chat another writer changed first", async () => {
    conversationRows = [conversation(CONV_A)];
    alreadyClosedIds = new Set([CONV_A]);
    expect(await bulkUpdateConversationsAction({ conversationIds: [CONV_A], action: { kind: "CLOSE" } })).toMatchObject({ ok: true, changed: 0, skipped: 1 });
    expect(events).toEqual([]);
  });
});
