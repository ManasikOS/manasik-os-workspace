import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-6 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): translating a message and preparing an offer message are open to every role that can
 * work the Inbox, so each is counted against the sender's hour and the agency's day. A refused one never reaches the model (translate) or the live
 * price and seat check (offer).
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const limiter = vi.hoisted(() => ({ refusal: null as string | null, calls: [] as Array<{ action: string; userId: string; agencyId: string }> }));
vi.mock("@/lib/inbox/rate-limit/limiter", () => ({
  consumeInboxRateLimit: async (_db: unknown, input: { action: string; userId: string; agencyId: string }) => {
    limiter.calls.push(input);
    return limiter.refusal ? { ok: false, error: limiter.refusal } : { ok: true, giveBack: async () => undefined };
  },
}));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const MESSAGE = "3f1d2c4e-5a6b-4c7d-8e9f-0000000000a1";
const role = { value: "MARKETING" as string };

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ME }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ME, name: "Test" }), createGroupBooking: vi.fn() }));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(), changeOneLead: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: vi.fn() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "WhatsApp" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: vi.fn() }));
vi.mock("@/lib/inbox/conversation-booking", () => ({ deriveBookingFromLead: vi.fn() }));
vi.mock("@/lib/ai/surfaces/inbox/workflows", () => ({ suggestConversationReply: vi.fn() }));
vi.mock("@/lib/ai/trust/consent-gate", () => ({ checkConsent: vi.fn() }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: vi.fn() }));
vi.mock("@/lib/copilot/sales/knowledge-context", () => ({ loadCopilotKnowledgeContext: vi.fn() }));
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
vi.mock("@/lib/inbox/attachments/staged-file", () => ({ verifyStagedAttachment: vi.fn(), createStaffAttachmentUpload: vi.fn() }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const translateInboxText = vi.fn();
vi.mock("@/lib/ai/surfaces/inbox/translation", () => ({ translateInboxText: (...args: unknown[]) => translateInboxText(...args) }));

const loadIntelligence = vi.fn();
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({
  loadIntelligence: (...args: unknown[]) => loadIntelligence(...args),
  listInterventions: vi.fn(),
  acknowledgeIntervention: vi.fn(async () => ({})),
  resolveIntervention: vi.fn(async () => ({})),
}));
const checkStoredOffer = vi.fn();
vi.mock("@/lib/data/inbox-offer-repository", () => ({ checkStoredOffer: (...args: unknown[]) => checkStoredOffer(...args) }));
const loadReplyContextPack = vi.fn();
vi.mock("@/lib/inbox/reply-context", () => ({ loadReplyContextPack: (...args: unknown[]) => loadReplyContextPack(...args) }));
const composeOfferReply = vi.fn();
vi.mock("@/lib/inbox/intelligence/offer", () => ({ composeOfferReply: (...args: unknown[]) => composeOfferReply(...args), composeFollowUp: vi.fn() }));

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) query[method] = () => query;
      query.maybeSingle = async () => ({ data: { content: "Assalamu alaikum" }, error: null });
      return query;
    },
  }),
}));

const { prepareOfferMessageAction, translateInboxTextAction } = await import("./actions");

beforeEach(() => {
  role.value = "MARKETING";
  limiter.refusal = null;
  limiter.calls.length = 0;
  translateInboxText.mockReset();
  translateInboxText.mockResolvedValue({ value: { translation: "Peace be upon you", detectedLanguage: "Arabic", confidence: 0.9 }, source: "LLM", note: null, runId: "run-1" });
  loadIntelligence.mockReset();
  loadIntelligence.mockResolvedValue({ matchedOffer: { departureGroupId: "group-1", alternatives: [] } });
  checkStoredOffer.mockReset();
  checkStoredOffer.mockResolvedValue("OK");
  loadReplyContextPack.mockReset();
  loadReplyContextPack.mockResolvedValue({ consent: null, facts: {}, history: [] });
  composeOfferReply.mockReset();
  composeOfferReply.mockReturnValue("Here is a departure that fits.");
});

const translateInput = { conversationId: CONVERSATION, messageId: MESSAGE, targetLanguage: "English" };
const offerInput = { conversationId: CONVERSATION, kind: "REPLY" };

describe("translateInboxTextAction", () => {
  it("counts the translation against the sender's limit, then translates", async () => {
    expect(await translateInboxTextAction(translateInput)).toMatchObject({ ok: true, translation: "Peace be upon you" });
    expect(limiter.calls).toEqual([{ action: "TRANSLATE", userId: ME, agencyId: AGENCY }]);
  });

  it("never calls the model when the limit is used up", async () => {
    limiter.refusal = "You have reached the limit of 60 translations per hour. You can try again after 4:00 pm.";
    expect(await translateInboxTextAction(translateInput)).toEqual({ ok: false, error: limiter.refusal });
    expect(translateInboxText).not.toHaveBeenCalled();
  });

  it("does not use a slot for a request that was refused earlier (a role that cannot open the Inbox)", async () => {
    role.value = "GUIDE";
    expect(await translateInboxTextAction(translateInput)).toMatchObject({ ok: false });
    expect(limiter.calls).toEqual([]);
  });

  it("does not use a slot when there is nothing to translate", async () => {
    expect(await translateInboxTextAction({ conversationId: "not-a-uuid" })).toMatchObject({ ok: false });
    expect(limiter.calls).toEqual([]);
  });
});

describe("prepareOfferMessageAction", () => {
  it("counts the request against the sender's limit, then prepares the message", async () => {
    expect(await prepareOfferMessageAction(offerInput)).toEqual({ ok: true, text: "Here is a departure that fits." });
    expect(limiter.calls).toEqual([{ action: "PREPARE_OFFER", userId: ME, agencyId: AGENCY }]);
  });

  it("prepares nothing when the limit is used up", async () => {
    limiter.refusal = "You have reached the limit of 120 offer messages per hour. You can try again after 4:00 pm.";
    expect(await prepareOfferMessageAction(offerInput)).toEqual({ ok: false, error: limiter.refusal });
    expect(composeOfferReply).not.toHaveBeenCalled();
  });

  it("does not use a slot when Copilot has no offer for the conversation", async () => {
    loadIntelligence.mockResolvedValue({ matchedOffer: null });
    expect(await prepareOfferMessageAction(offerInput)).toMatchObject({ ok: false });
    expect(limiter.calls).toEqual([]);
  });
});
