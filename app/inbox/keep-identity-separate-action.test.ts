import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-7 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): "Create separate lead" closed the identity suggestions for good and only
 * then tried to create the lead. When that failed (several leads share the number, or any error), the suggestions stayed closed and no lead
 * existed. Now the suggestions are reopened when the lead could not be created.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const role = { value: "ADMIN" as string };

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ACTOR }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ACTOR, name: "Test Actor" }), createGroupBooking: vi.fn() }));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(), changeOneLead: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: vi.fn() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "WhatsApp" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
vi.mock("@/lib/inbox/conversation-booking", () => ({ deriveBookingFromLead: vi.fn() }));
vi.mock("@/lib/inbox/reply-context", () => ({ loadReplyContextPack: vi.fn() }));
vi.mock("@/lib/ai/surfaces/inbox/workflows", () => ({ suggestConversationReply: vi.fn() }));
vi.mock("@/lib/ai/trust/consent-gate", () => ({ checkConsent: vi.fn() }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: (digits: string) => digits }));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ loadCopilotKnowledgeContext: vi.fn() }));
vi.mock("@/lib/data/inbox-offer-repository", () => ({ checkStoredOffer: vi.fn() }));
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

const rejectIdentityLinks = vi.fn();
const recordIdentityKeptSeparate = vi.fn(async () => undefined);
const restoreRejectedIdentityLinks = vi.fn();
vi.mock("@/lib/data/identity-graph-repository", () => ({
  confirmIdentityLink: vi.fn(),
  unlinkIdentityLink: vi.fn(),
  rejectIdentityLinks: (...args: unknown[]) => rejectIdentityLinks(...args),
  recordIdentityKeptSeparate: (...args: unknown[]) => recordIdentityKeptSeparate(...(args as [])),
  restoreRejectedIdentityLinks: (...args: unknown[]) => restoreRejectedIdentityLinks(...args),
}));

const linkConversationToLead = vi.fn();
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: (...args: unknown[]) => linkConversationToLead(...args) }));
vi.mock("@/lib/inbox/conversions/source-link", () => ({ stampConversationSource: vi.fn(async () => true) }));

let adminLeadId: string | null = null;
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) query[method] = () => query;
      query.maybeSingle = async () => ({ data: { lead_id: adminLeadId }, error: null });
      return query;
    },
  }),
}));
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) query[method] = () => query;
      query.maybeSingle = async () => ({ data: { id: CONVERSATION, channel: "WHATSAPP", external_conversation_id: "94771234567", contact_name: "Nimal", contact_phone: "94771234567" }, error: null });
      return query;
    },
  }),
}));

const { keepIdentitySeparateAction } = await import("./actions");

const links = [{ id: "link-1", candidateLeadId: "lead-a" }, { id: "link-2", candidateLeadId: "lead-b" }];

beforeEach(() => {
  role.value = "ADMIN";
  adminLeadId = null;
  rejectIdentityLinks.mockReset();
  rejectIdentityLinks.mockResolvedValue({ ok: true, rejected: 2, identityId: "ident-1", links });
  recordIdentityKeptSeparate.mockClear();
  restoreRejectedIdentityLinks.mockReset();
  restoreRejectedIdentityLinks.mockResolvedValue({ ok: true });
  linkConversationToLead.mockReset();
  linkConversationToLead.mockResolvedValue({ lead: { id: "lead-new", reference: "LD-1", full_name: "Nimal", mobile: "94771234567", stage: "NEW_LEAD" }, source: "CREATED" });
});

describe("keepIdentitySeparateAction", () => {
  it("keeps the suggestions closed and records the decision when the separate lead is created", async () => {
    expect(await keepIdentitySeparateAction({ conversationId: CONVERSATION })).toEqual({ ok: true });
    expect(restoreRejectedIdentityLinks).not.toHaveBeenCalled();
    expect(recordIdentityKeptSeparate).toHaveBeenCalledWith(expect.anything(), { agencyId: AGENCY, identityId: "ident-1", links, actorId: ACTOR });
  });

  it("BUG-7: reopens the suggestions, and records nothing, when several leads share the number", async () => {
    linkConversationToLead.mockResolvedValue({ lead: null, source: "AMBIGUOUS" });
    const result = await keepIdentitySeparateAction({ conversationId: CONVERSATION });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Multiple leads") });
    expect(restoreRejectedIdentityLinks).toHaveBeenCalledWith(expect.anything(), { agencyId: AGENCY, linkIds: ["link-1", "link-2"] });
    expect(recordIdentityKeptSeparate).not.toHaveBeenCalled();
  });

  it("BUG-7: reopens the suggestions when creating the lead throws", async () => {
    linkConversationToLead.mockRejectedValue(new Error("database down"));
    const result = await keepIdentitySeparateAction({ conversationId: CONVERSATION });
    expect(result).toMatchObject({ ok: false });
    expect(restoreRejectedIdentityLinks).toHaveBeenCalledTimes(1);
    expect(recordIdentityKeptSeparate).not.toHaveBeenCalled();
  });

  it("keeps the decision when the failure came after the lead was already linked to the conversation", async () => {
    linkConversationToLead.mockRejectedValue(new Error("late failure"));
    adminLeadId = "lead-new";
    expect(await keepIdentitySeparateAction({ conversationId: CONVERSATION })).toMatchObject({ ok: false });
    expect(restoreRejectedIdentityLinks).not.toHaveBeenCalled();
    expect(recordIdentityKeptSeparate).toHaveBeenCalledTimes(1);
  });

  it("says so when the suggestions could not be reopened either", async () => {
    linkConversationToLead.mockResolvedValue({ lead: null, source: "AMBIGUOUS" });
    restoreRejectedIdentityLinks.mockResolvedValue({ ok: false, error: "boom" });
    const result = await keepIdentitySeparateAction({ conversationId: CONVERSATION });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("could not be reopened") });
  });

  it("changes nothing for a role that cannot create leads, and when nothing could be rejected", async () => {
    role.value = "FINANCE";
    expect(await keepIdentitySeparateAction({ conversationId: CONVERSATION })).toMatchObject({ ok: false });
    expect(rejectIdentityLinks).not.toHaveBeenCalled();
    role.value = "ADMIN";
    rejectIdentityLinks.mockResolvedValue({ ok: false, error: "That conversation could not be found." });
    expect(await keepIdentitySeparateAction({ conversationId: CONVERSATION })).toEqual({ ok: false, error: "That conversation could not be found." });
    expect(linkConversationToLead).not.toHaveBeenCalled();
  });
});
