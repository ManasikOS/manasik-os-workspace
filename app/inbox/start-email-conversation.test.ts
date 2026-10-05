import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `startEmailConversation` (docs/inbox/email-channel-implementation-plan.md, Phase 3): unlike Messenger/
 * Instagram, staff can start a brand-new email conversation. Everything the action touches is replaced here;
 * the role check, the connection gate and the schema are the real ones.
 */

vi.mock("server-only", () => ({}));
const limiter = vi.hoisted(() => ({ refusal: null as string | null, calls: [] as Array<{ action: string; userId: string; agencyId: string }>, giveBack: vi.fn(async () => undefined) }));
vi.mock("@/lib/inbox/rate-limit/limiter", () => ({
  consumeInboxRateLimit: async (_db: unknown, input: { action: string; userId: string; agencyId: string }) => {
    limiter.calls.push(input);
    return limiter.refusal ? { ok: false, error: limiter.refusal } : { ok: true, giveBack: limiter.giveBack };
  },
}));
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
const loadProtectionContext = vi.fn();
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: (...args: unknown[]) => loadProtectionContext(...args) }));
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
const writeSpy = vi.fn();
let updateMatches = true;
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        const chain: { eq: () => typeof chain; maybeSingle: () => Promise<{ data: typeof existingConversation; error: null }> } = { eq: () => chain, maybeSingle: async () => ({ data: existingConversation, error: null }) };
        return chain;
      },
      insert: (row: unknown) => {
        writeSpy("insert", row);
        return {
          select: () => ({
            single: async () => (conversationError ? { data: null, error: conversationError } : { data: conversationRow, error: null }),
          }),
        };
      },
      update: (patch: unknown) => {
        writeSpy("update", patch);
        const query: { eq: () => typeof query; is: () => typeof query; select: () => Promise<{ data: Array<{ id: string }>; error: null }> } = {
          eq: () => query,
          is: () => query,
          select: async () => ({ data: updateMatches ? [{ id: existingConversation?.id ?? "conv-existing" }] : [], error: null }),
        };
        return query;
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
  loadProtectionContext.mockReset();
  loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
  rpc.mockClear();
  linkConversationToLead.mockClear();
  connectionRow = {
    id: "conn-gmail-1",
    status: "CONNECTED",
    provider_metadata: { imapHost: "imap.example.com", imapPort: 993, imapSecurity: "TLS" },
  };
  conversationError = null;
  existingConversation = null;
  writeSpy.mockClear();
  updateMatches = true;
  limiter.refusal = null;
  limiter.calls.length = 0;
  limiter.giveBack.mockClear();
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
    expect(writeSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SEC-6: counts the email against the sender's new-conversation limit", async () => {
    await startEmailConversation(input);
    expect(limiter.calls).toHaveLength(1);
    expect(limiter.calls[0]).toMatchObject({ action: "START_EMAIL_CONVERSATION", agencyId: expect.any(String), userId: expect.any(String) });
  });

  it("SEC-6: opens nothing and queues nothing when the limit is used up", async () => {
    limiter.refusal = "You have reached the limit of 20 new email conversations per hour. You can try again after 4:00 pm.";
    const result = await startEmailConversation(input);
    expect(result).toEqual({ ok: false, error: limiter.refusal });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SEC-6: does not use a slot for an address a colleague already owns", async () => {
    existingConversation = { id: "conv-existing", state: "HUMAN_ACTIVE", assigned_to_id: "someone-else", assigned_to_name: "Nadeesha", contact_name: "Amina" };
    await startEmailConversation(input);
    expect(limiter.calls).toEqual([]);
  });

  it("SEC-6: gives the use back when the email could not be queued", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "boom" } });
    expect(await startEmailConversation(input)).toMatchObject({ ok: false });
    expect(limiter.giveBack).toHaveBeenCalledTimes(1);
  });

  it("BUG-8: stops, queues nothing and changes no owner when a colleague takes the chat after the check", async () => {
    existingConversation = { id: "conv-existing", state: "AI_ACTIVE", assigned_to_id: null, assigned_to_name: null, contact_name: "Amina" };
    updateMatches = false;
    const result = await startEmailConversation(input);
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("BUG-8: a brand-new address is inserted rather than upserted over whatever appears", async () => {
    await startEmailConversation(input);
    expect(writeSpy).toHaveBeenCalledWith("insert", expect.objectContaining({ channel: "GMAIL", external_conversation_id: "customer@example.com", state: "HUMAN_ACTIVE" }));
  });

  it("reuses a closed conversation and keeps the contact name it already has", async () => {
    existingConversation = { id: "conv-existing", state: "CLOSED", assigned_to_id: "someone-else", assigned_to_name: "Nadeesha", contact_name: "Amina" };
    const result = await startEmailConversation(input);
    expect(result.ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith("update", expect.objectContaining({ contact_name: "Amina" }));
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

describe("startEmailConversation — the protection gate", () => {
  it("refuses a new email whose subject says what an open review on that address guards, and queues nothing", async () => {
    existingConversation = { id: "conv-existing", state: "HUMAN_ACTIVE", assigned_to_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", assigned_to_name: "Test", contact_name: "Nimal" };
    loadProtectionContext.mockResolvedValue({ openReviews: [{ kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "The customer says they paid" }], approvedAccountDigits: [] });
    const result = await startEmailConversation({ recipientEmail: "nimal@example.com", subject: "Payment received - thank you", body: "Thank you for writing." });
    expect(result).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
