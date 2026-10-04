import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-015 (follow-up, 2026-09-27): `assignConversationAction` and `bulkUpdateConversationsAction` read a
 * conversation's state/owner, decide a patch from that snapshot, then write it. Between the read and the write,
 * another staff member's assign, a different bulk action, or the customer replying can change the row — a plain
 * `UPDATE ... WHERE agency_id = ? AND id = ?` would silently overwrite that concurrent change (last-write-wins)
 * while still reporting success against the stale plan. These tests exercise the compare-and-swap guard added to
 * both actions' writes (an extra `state`/`assigned_to_id` filter, checked via the updated row count) and confirm
 * a lost race is reported as "skipped", never silently written over.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const role = { value: "MARKETING" as string };
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
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

interface FakeConversationRow {
  id: string;
  state: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  contact_name: string | null;
}

/** The row(s) a `.select(...)...maybeSingle()`/`.in()` read returns — the "plan" snapshot each action decides from. */
let singleConversationRow: FakeConversationRow | null = null;
let bulkReadRows: FakeConversationRow[] = [];
/** The colleague `assigneeId` resolves to, when the action validates a target. */
let staffProfileRow: { id: string; full_name: string; role: string; status: string } | null = null;
/** Conversation ids whose guarded write must behave as though another writer already changed the row first
 * (the compare-and-swap filter then matches zero rows) — simulating the race these tests exist to catch. */
let conflictedIds = new Set<string>();
const conversationUpdates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "staff_profiles") {
        return {
          select: () => {
            const query = { eq: () => query, maybeSingle: async () => ({ data: staffProfileRow, error: null }) };
            return query;
          },
        };
      }
      // "conversations": a read path (.select) and a guarded write path (.update)
      return {
        select: () => {
          const query = {
            eq: () => query,
            in: async () => ({ data: bulkReadRows, error: null }),
            single: async () => ({ data: singleConversationRow, error: null }),
            maybeSingle: async () => ({ data: singleConversationRow, error: null }),
          };
          return query;
        },
        update: (patch: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          const query = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return query;
            },
            is: (column: string, value: unknown) => {
              filters[column] = value;
              return query;
            },
            select: async () => {
              conversationUpdates.push({ patch, filters });
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

const { assignConversationAction, bulkUpdateConversationsAction } = await import("./actions");

const CONV_A = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const CONV_B = "3f1d2c4e-5a6b-4c7d-8e9f-000000000002";
const TARGET = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000aa";

beforeEach(() => {
  role.value = "MARKETING";
  singleConversationRow = null;
  bulkReadRows = [];
  staffProfileRow = { id: TARGET, full_name: "Target Colleague", role: "MARKETING", status: "ACTIVE" };
  conflictedIds = new Set();
  conversationUpdates.length = 0;
});

describe("assignConversationAction — compare-and-swap on a concurrent owner change", () => {
  it("assigns an unowned open conversation and guards the write on the state/owner it just read", async () => {
    singleConversationRow = { id: CONV_A, state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Customer" };

    const result = await assignConversationAction({ conversationId: CONV_A, assigneeId: TARGET });

    expect(result).toEqual({ ok: true });
    expect(conversationUpdates).toHaveLength(1);
    expect(conversationUpdates[0].patch).toMatchObject({ assigned_to_id: TARGET, state: "HUMAN_ACTIVE" });
    // The guard compares against exactly what was read: state "AI_ACTIVE" and no prior owner.
    expect(conversationUpdates[0].filters).toMatchObject({ state: "AI_ACTIVE", assigned_to_id: null });
  });

  it("refuses instead of overwriting when another change lands between the read and the write", async () => {
    singleConversationRow = { id: CONV_A, state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Customer" };
    conflictedIds = new Set([CONV_A]); // simulates a concurrent writer already having changed this row

    const result = await assignConversationAction({ conversationId: CONV_A, assigneeId: TARGET });

    expect(result).toEqual({ ok: false, error: "Someone else changed this conversation just now. Refresh and try again." });
  });
});

describe("bulkUpdateConversationsAction — a lost race is reported as skipped, never silently overwritten", () => {
  it("assigns every conversation the guard confirms is unchanged", async () => {
    bulkReadRows = [
      { id: CONV_A, state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Customer A" },
      { id: CONV_B, state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Customer B" },
    ];

    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "ASSIGN", assigneeId: TARGET } });

    expect(result).toMatchObject({ ok: true, changed: 2, skipped: 0 });
    expect(conversationUpdates).toHaveLength(2);
  });

  it("counts a conversation someone else just reassigned as skipped, and still writes the rest", async () => {
    bulkReadRows = [
      { id: CONV_A, state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Customer A" },
      { id: CONV_B, state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Customer B" },
    ];
    conflictedIds = new Set([CONV_B]); // B was claimed by someone else after this action's read

    const result = await bulkUpdateConversationsAction({ conversationIds: [CONV_A, CONV_B], action: { kind: "ASSIGN", assigneeId: TARGET } });

    expect(result).toMatchObject({ ok: true, changed: 1, skipped: 1 });
    // Only A's write is reported as having actually happened; B's guarded update matched zero rows.
    const writtenIds = conversationUpdates.filter((update) => update.filters.id === CONV_A || update.filters.id === CONV_B).map((update) => update.filters.id);
    expect(writtenIds).toEqual([CONV_A, CONV_B]); // both were attempted
  });
});
