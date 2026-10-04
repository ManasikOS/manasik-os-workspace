import { beforeEach, describe, expect, it, vi } from "vitest";

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

let insertedRow: Record<string, unknown> | null = null;
let insertResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "saved_replies") throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: Record<string, unknown>) => {
          insertedRow = row;
          return {
            select: () => ({
              single: async () => insertResult,
            }),
          };
        },
      };
    },
  }),
}));

const { createSavedReplyAction } = await import("./actions");

beforeEach(() => {
  role.value = "MARKETING";
  insertedRow = null;
  insertResult = { data: { id: "r1", title: "Payment reminder", body: "Your balance is due.", language: null, providers: [] }, error: null };
});

describe("createSavedReplyAction", () => {
  it.each(["ADMIN", "MARKETING", "OPERATIONS"])("allows %s to create a saved reply", async (roleName) => {
    role.value = roleName;
    const result = await createSavedReplyAction({ title: "Payment reminder", body: "Your balance is due.", isPrivate: false });
    expect(result).toEqual({ ok: true, reply: { id: "r1", title: "Payment reminder", body: "Your balance is due.", language: null, providers: [] } });
    expect(insertedRow).toMatchObject({ title: "Payment reminder", body: "Your balance is due.", is_private: false, owner_id: null });
  });

  it.each(["CEO", "FINANCE", "VISA", "GUIDE"])("refuses %s before touching the database", async (roleName) => {
    role.value = roleName;
    const result = await createSavedReplyAction({ title: "Payment reminder", body: "Your balance is due.", isPrivate: false });
    expect(result).toEqual({ ok: false, error: "Your role cannot create saved replies." });
    expect(insertedRow).toBeNull();
  });

  it("sets owner_id to the acting staff member when marked private", async () => {
    await createSavedReplyAction({ title: "Personal note", body: "Only I see this.", isPrivate: true });
    expect(insertedRow).toMatchObject({ owner_id: ACTOR, is_private: true });
  });

  it("rejects an empty title at the boundary", async () => {
    const result = await createSavedReplyAction({ title: "  ", body: "Body text.", isPrivate: false });
    expect(result.ok).toBe(false);
    expect(insertedRow).toBeNull();
  });

  it("rejects an empty body at the boundary", async () => {
    const result = await createSavedReplyAction({ title: "Title", body: "   ", isPrivate: false });
    expect(result.ok).toBe(false);
    expect(insertedRow).toBeNull();
  });

  it("turns a database error into a plain message, not a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    insertResult = { data: null, error: { message: "constraint violation" } };
    const result = await createSavedReplyAction({ title: "Title", body: "Body", isPrivate: false });
    expect(result.ok).toBe(false);
  });
});
