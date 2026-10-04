import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FIX3 (docs/inbox/fixing-plan.md): a shown reply — generated fresh or served
 * from the approved answer cache — must meter the AI-assisted-conversation
 * counter exactly once, through `suggestConversationReplyAction`, the one
 * place either kind of reply reaches staff. This isolates that action with
 * its own minimal mocks rather than reusing `actions.protection.test.ts`'s
 * shared admin-client stub, which has no `.from()` implementation.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "staff-1" }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "MARKETING", agencyId: AGENCY, staffId: "staff-1", name: "Test" }),
  createGroupBooking: vi.fn(),
}));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: vi.fn() }));
vi.mock("@/lib/inbox/clear-chats", () => ({ CLEAR_ALL_CHATS_PHRASE: "x", clearAgencyConversations: vi.fn() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "WhatsApp" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: vi.fn() }));
vi.mock("@/lib/inbox/conversation-booking", () => ({ deriveBookingFromLead: vi.fn() }));
vi.mock("@/lib/ai/trust/consent-gate", () => ({ checkConsent: vi.fn() }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: vi.fn() }));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ loadCopilotKnowledgeContext: vi.fn() }));
vi.mock("@/lib/data/inbox-offer-repository", () => ({ checkStoredOffer: vi.fn() }));
vi.mock("@/lib/data/identity-graph-repository", () => ({ confirmIdentityLink: vi.fn(), rejectIdentityLinks: vi.fn(), unlinkIdentityLink: vi.fn() }));
vi.mock("@/app/(main)/leads/copilot-actions", () => ({ saveQuoteDraftAction: vi.fn() }));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({ loadIntelligence: vi.fn(), listInterventions: vi.fn(), acknowledgeIntervention: vi.fn(), resolveIntervention: vi.fn() }));
vi.mock("@/lib/data/conversation-handoff-repository", () => ({
  acknowledgeConversationHandoff: vi.fn(), buildHandoffForConversation: vi.fn(), createConversationHandoff: vi.fn(),
  loadConversationHandoff: vi.fn(async () => null), attachHandoffNarration: vi.fn(), handoffNeedsNarration: vi.fn(),
}));
vi.mock("@/lib/data/staff-notifications", () => ({ listActiveStaffIdsByRole: async () => [], notifyConversationWaiting: vi.fn() }));
vi.mock("@/lib/ai/surfaces/inbox/handoff-narrate", () => ({ narrateHandoffExpectations: vi.fn() }));
vi.mock("@/lib/data/inbox-composer-presence-repository", () => ({ claimComposerPresence: vi.fn(), releaseComposerPresence: vi.fn(), syncConcurrentComposerSignal: vi.fn() }));

const loadProtectionContext = vi.fn<(...args: unknown[]) => Promise<{ openReviews: unknown[]; approvedAccountDigits: string[] }>>(async () => ({ openReviews: [], approvedAccountDigits: [] }));
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: (...args: unknown[]) => loadProtectionContext(...args) }));

const resolveEntitlements = vi.fn<(...args: unknown[]) => Promise<{ autonomyCeiling: string }>>(async () => ({ autonomyCeiling: "L2" }));
vi.mock("@/lib/billing/entitlements", () => ({ resolveEntitlements: (...args: unknown[]) => resolveEntitlements(...args) }));

const meterAiConversation = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/lib/billing/meter", () => ({
  meterAiConversation: (...args: unknown[]) => meterAiConversation(...args),
  utcMonthStart: () => "2026-09-01",
}));

const loadReplyContextPack = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ consent: null, facts: {}, history: [], knowledgeVersion: 1 }));
vi.mock("@/lib/inbox/reply-context", () => ({ loadReplyContextPack: (...args: unknown[]) => loadReplyContextPack(...args) }));

const loadInboxReplyPack = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
vi.mock("@/lib/inbox/reply-pack-loader", () => ({ loadInboxReplyPack: (...args: unknown[]) => loadInboxReplyPack(...args) }));

const suggestConversationReply = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/ai/surfaces/inbox/workflows", () => ({ suggestConversationReply: (...args: unknown[]) => suggestConversationReply(...args) }));

const surfaceSettingsRow = { enabled: true, mode: "ACTIVE", autonomy: { level: "L2" } };
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => (table === "ai_surface_settings" ? { data: surfaceSettingsRow, error: null } : { data: null, error: null }) }),
        }),
      }),
    }),
  }),
}));

let proposalInsertResult: { data: { id: string } | null; error: { message: string } | null } = { data: { id: "proposal-1" }, error: null };
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => proposalInsertResult }) }),
    }),
  }),
}));

const { suggestConversationReplyAction } = await import("./actions");

beforeEach(() => {
  loadProtectionContext.mockClear();
  resolveEntitlements.mockClear();
  meterAiConversation.mockClear();
  loadReplyContextPack.mockClear();
  loadInboxReplyPack.mockClear();
  suggestConversationReply.mockReset();
  proposalInsertResult = { data: { id: "proposal-1" }, error: null };
});

describe("suggestConversationReplyAction — FIX3 AI-assisted conversation metering", () => {
  it("meters once when a freshly generated draft is shown to staff", async () => {
    suggestConversationReply.mockResolvedValue({ value: { reply: "Your package starts at $2,500." }, source: "LLM", note: null, runId: "run-1" });

    const result = await suggestConversationReplyAction(CONVERSATION);

    expect(result).toMatchObject({ ok: true, reply: "Your package starts at $2,500." });
    expect(meterAiConversation).toHaveBeenCalledOnce();
    expect(meterAiConversation).toHaveBeenCalledWith(expect.anything(), { agencyId: AGENCY, conversationId: CONVERSATION, periodStart: "2026-09-01" });
  });

  it("meters once when an approved answer-cache hit is shown to staff — the same unit as a generated draft", async () => {
    suggestConversationReply.mockResolvedValue({ value: { reply: "Cached answer", cacheEntryId: "cache-1" }, source: "RULES", note: "Approved agency answer cache", runId: null });

    const result = await suggestConversationReplyAction(CONVERSATION);

    expect(result).toMatchObject({ ok: true, reply: "Cached answer" });
    expect(meterAiConversation).toHaveBeenCalledOnce();
  });

  it("does not meter when Copilot could not draft anything", async () => {
    suggestConversationReply.mockResolvedValue({ value: null, source: "RULES", note: "No facts to ground a reply", runId: null });

    const result = await suggestConversationReplyAction(CONVERSATION);

    expect(result).toMatchObject({ ok: false });
    expect(meterAiConversation).not.toHaveBeenCalled();
  });

  it("does not meter when the reply was drafted but its review evidence could not be recorded", async () => {
    suggestConversationReply.mockResolvedValue({ value: { reply: "Hello" }, source: "LLM", note: null, runId: "run-1" });
    proposalInsertResult = { data: null, error: { message: "insert failed" } };

    const result = await suggestConversationReplyAction(CONVERSATION);

    expect(result).toMatchObject({ ok: false });
    expect(meterAiConversation).not.toHaveBeenCalled();
  });
});
