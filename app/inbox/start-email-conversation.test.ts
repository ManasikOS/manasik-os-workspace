import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `startEmailConversation` (docs/inbox/email-channel-implementation-plan.md, Phase 3): unlike Messenger/
 * Instagram, staff can start a brand-new email conversation. Everything the action touches is replaced here;
 * the role check, the connection gate and the schema are the real ones.
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
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "Email" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
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
  acknowledgeConversationHandoff: vi.fn(), buildHandoffForConversation: vi.fn(), createConversationHandoff: vi.fn(),
  loadConversationHandoff: vi.fn(async () => null), attachHandoffNarration: vi.fn(), handoffNeedsNarration: () => false,
}));
vi.mock("@/lib/data/staff-notifications", () => ({ notifyConversationWaiting: vi.fn(async () => ({ ok: true, notified: 0 })), listActiveStaffIdsByRole: async () => [] }));
vi.mock("@/lib/ai/surfaces/inbox/handoff-narrate", () => ({ narrateHandoffExpectations: vi.fn() }));
vi.mock("@/lib/data/conversation-intelligence-repository", () => ({ loadIntelligence: vi.fn(), listInterventions: vi.fn(), acknowledgeIntervention: vi.fn(), resolveIntervention: vi.fn() }));
vi.mock("@/lib/inbox/attachments/staged-file", () => ({ verifyStagedAttachment: vi.fn(), createStaffAttachmentUpload: vi.fn() }));

const linkConversationToLead = vi.fn();
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: (...args: unknown[]) => linkConversationToLead(...args) }));

const rpc = vi.fn<(...args: unknown[]) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }));
const conversationRow = { id: "conv-email-1" };
let conversationError: { message: string } | null = null;
let existingConversation: { id: string; state: string; assigned_to_id: string | null; assigned_to_name: string | null; contact_name: string | null } | null = null;
const upsertSpy = vi.fn();
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const chain: { eq: () => typeof chain; maybeSingle: () => Promise<{ data: typeof existingConversation; error: null }> } = { eq: () => chain, maybeSingle: async () => ({ data: existingConversation, error: null }) };
        return chain;
      },
      upsert: (row: unknown) => {
        upsertSpy(row);
        return {
        select: () => ({
          single: async () => (conversationError ? { data: null, error: conversationError } : { data: conversationRow, error: null }),
        }),
        };
      },
    }),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

let connectionRow: { id: string; status: string; provider_metadata?: Record<string, unknown> } | null = {
  id: "conn-gmail-1",
  status: "CONNECTED",
  provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS" },
};
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: connectionRow, error: null }) }),
        }),
      }),
    }),
  }),
}));

const { loadEmailComposeMailboxReadinessAction, startEmailConversation } = await import("./actions");

beforeEach(() => {
  role.value = "MARKETING";
  rpc.mockClear();
  linkConversationToLead.mockClear();
  connectionRow = {
    id: "conn-gmail-1",
    status: "CONNECTED",
    provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS" },
  };
  conversationError = null;
  existingConversation = null;
  upsertSpy.mockClear();
});

describe("startEmailConversation", () => {
  const input = { recipientEmail: "Customer@Example.com", subject: "Your Umrah package", body: "Hello there" };

  it("creates the conversation, links the lead by email, and queues the first message", async () => {
    const result = await startEmailConversation(input);
    expect(result).toEqual({ ok: true, conversationId: "conv-email-1" });
    expect(linkConversationToLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      provider: "GMAIL", externalSubjectId: "customer@example.com", email: "customer@example.com", normalizedPhone: null,
    }));
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.objectContaining({
      p_conversation_id: "conv-email-1", p_body: "Hello there", p_subject: "Your Umrah package", p_cc: null, p_bcc: null,
    }));
  });

  it("refuses an address a colleague already owns, without sending or reassigning anything", async () => {
    existingConversation = { id: "conv-existing", state: "HUMAN_ACTIVE", assigned_to_id: "someone-else", assigned_to_name: "Nadeesha", contact_name: "Amina" };
    const result = await startEmailConversation(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Nadeesha");
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reuses a closed conversation and keeps the contact name it already has", async () => {
    existingConversation = { id: "conv-existing", state: "CLOSED", assigned_to_id: "someone-else", assigned_to_name: "Nadeesha", contact_name: "Amina" };
    const result = await startEmailConversation(input);
    expect(result.ok).toBe(true);
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({ contact_name: "Amina" }));
  });

  it("lowercases and trims the recipient address before it reaches any downstream call", async () => {
    await startEmailConversation({ ...input, recipientEmail: "  Customer@Example.com  " });
    expect(linkConversationToLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: "customer@example.com" }));
  });

  it("refuses when no mailbox is connected, without creating a conversation", async () => {
    connectionRow = null;
    const result = await startEmailConversation(input);
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when the mailbox is saved but not yet CONNECTED (no IMAP configured)", async () => {
    connectionRow = { id: "conn-gmail-1", status: "NOT_CONNECTED" };
    const result = await startEmailConversation(input);
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a stale CONNECTED row when its IMAP settings are missing", async () => {
    connectionRow = { id: "conn-gmail-1", status: "CONNECTED", provider_metadata: {} };

    const result = await startEmailConversation(input);

    expect(result).toEqual({
      ok: false,
      error: "Connect a mailbox with IMAP enabled in Settings → Email before composing.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a subject, unlike an ordinary reply", async () => {
    const result = await startEmailConversation({ ...input, subject: "" });
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient address before touching the database", async () => {
    const result = await startEmailConversation({ ...input, recipientEmail: "not-an-email" });
    expect(result).toMatchObject({ ok: false });
    expect(linkConversationToLead).not.toHaveBeenCalled();
  });

  it("a role that cannot send is refused before anything is read", async () => {
    role.value = "FINANCE";
    const result = await startEmailConversation(input);
    expect(result).toEqual({ ok: false, error: "Not permitted." });
    expect(linkConversationToLead).not.toHaveBeenCalled();
  });

  it("passes cc/bcc through when the composer supplied them", async () => {
    await startEmailConversation({ ...input, cc: ["cc@example.com"], bcc: ["bcc@example.com"] });
    expect(rpc).toHaveBeenCalledWith("enqueue_inbox_text_message", expect.objectContaining({ p_cc: ["cc@example.com"], p_bcc: ["bcc@example.com"] }));
  });
});

describe("loadEmailComposeMailboxReadinessAction", () => {
  it("reads the newly saved IMAP configuration instead of relying on the Inbox snapshot", async () => {
    connectionRow = {
      id: "conn-gmail-1",
      status: "CONNECTED",
      provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS" },
    };
    await expect(loadEmailComposeMailboxReadinessAction()).resolves.toBe(true);

    connectionRow = { id: "conn-gmail-1", status: "NOT_CONNECTED" };
    await expect(loadEmailComposeMailboxReadinessAction()).resolves.toBe(false);
  });
});
