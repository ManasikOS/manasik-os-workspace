import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-9 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): AGENTS.md requires every read and write to be agency-scoped, but these actions
 * named the conversation by id alone and relied on row security to keep other agencies out. Row security still holds, but it is the only barrier:
 * a loosened policy (see SEC-1) would have exposed every agency. Each now names the agency itself.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONVERSATION = "3f1d2c4e-5a6b-4c7d-8e9f-000000000001";
const GROUP = "44444444-4444-4444-8444-444444444444";
const MENTIONED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const account = { agencyId: AGENCY as string | null };

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ME }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: "ADMIN", agencyId: account.agencyId, staffId: ME, name: "Me" }), createGroupBooking: vi.fn() }));
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: vi.fn(), pricePerPerson: vi.fn(), selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));
vi.mock("@/lib/data/leads-repository", () => ({ loadLeadStore: vi.fn(async () => ({ leads: [], packages: [] })), changeOneLead: vi.fn(), persistLeadStore: vi.fn(), snapshotLeadStore: vi.fn() }));
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: vi.fn() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: vi.fn(async () => undefined) }));
vi.mock("@/lib/channels/profile", () => ({ getChannelProfile: () => ({ displayName: "WhatsApp" }) }));
vi.mock("@/lib/channels/registry", () => ({ hasChannelAdapter: () => true }));
const linkConversationToLead = vi.fn();
vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: (...args: unknown[]) => linkConversationToLead(...args) }));
vi.mock("@/lib/inbox/conversions/source-link", () => ({ stampConversationSource: vi.fn(async () => true) }));
vi.mock("@/lib/inbox/conversation-booking", () => ({ deriveBookingFromLead: vi.fn() }));
vi.mock("@/lib/inbox/reply-context", () => ({ loadReplyContextPack: vi.fn() }));
vi.mock("@/lib/ai/surfaces/inbox/workflows", () => ({ suggestConversationReply: vi.fn() }));
vi.mock("@/lib/ai/trust/consent-gate", () => ({ checkConsent: vi.fn() }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: (digits: string) => digits }));
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
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

interface Call {
  table: string;
  op: "select" | "insert" | "upsert" | "delete" | "update";
  filters: Record<string, unknown>;
  payload?: unknown;
}
const calls: Call[] = [];
let noteInsertFails = false;
let mentionsInsertFails = false;

/** A conversation is only "found" when the query names this agency, like the real table where the other agency's row is simply not there. */
function answer(call: Call) {
  if (call.table === "conversations" && call.op === "select") {
    return call.filters.agency_id === AGENCY
      ? { data: { id: CONVERSATION, lead_id: null, channel: "WHATSAPP", external_conversation_id: "94771234567", contact_name: "Nimal", contact_phone: "94771234567" }, error: null }
      : { data: null, error: null };
  }
  if (call.table === "conversation_notes" && call.op === "insert") return noteInsertFails ? { data: null, error: { message: "boom" } } : { data: { id: "note-1" }, error: null };
  if (call.table === "note_mentions" && call.op === "insert") return { data: null, error: mentionsInsertFails ? { message: "boom" } : null };
  if (call.table === "staff_profiles") return { data: [{ id: MENTIONED }], error: null };
  return { data: null, error: null };
}

function builder(table: string, op: Call["op"], payload?: unknown) {
  const call: Call = { table, op, filters: {}, payload };
  calls.push(call);
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit", "gt", "not", "ilike", "gte"]) {
    query[method] = (column?: string, value?: unknown) => {
      if (method === "eq" && column) call.filters[column] = value;
      return query;
    };
  }
  query.single = async () => answer(call);
  query.maybeSingle = async () => answer(call);
  query.then = (resolve: (value: unknown) => unknown) => resolve(answer(call));
  return query;
}

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => builder(table, "select"),
      insert: (payload: unknown) => builder(table, "insert", payload),
      upsert: (payload: unknown) => builder(table, "upsert", payload),
      update: (payload: unknown) => builder(table, "update", payload),
      delete: () => builder(table, "delete"),
    }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));

const { addInternalNote, captureConversationLead, createBookingFromConversation, saveConversationDraft, selectConversationDepartureGroup } = await import("./actions");

const reads = (table: string) => calls.filter((call) => call.table === table && call.op === "select");

beforeEach(() => {
  account.agencyId = AGENCY;
  calls.length = 0;
  noteInsertFails = false;
  mentionsInsertFails = false;
  linkConversationToLead.mockReset();
  linkConversationToLead.mockResolvedValue({ lead: { id: "lead-1", reference: "LD-1", full_name: "Nimal", mobile: "94771234567", stage: "NEW_LEAD" }, source: "EXISTING" });
});

describe("captureConversationLead", () => {
  it("reads the conversation within the caller's agency before handing anything to the lead linker", async () => {
    expect(await captureConversationLead(CONVERSATION)).toEqual({ ok: true });
    expect(reads("conversations")[0].filters).toEqual({ agency_id: AGENCY, id: CONVERSATION });
    expect(linkConversationToLead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: AGENCY, conversationId: CONVERSATION }));
  });

  it("links nothing for a conversation that is not in the caller's agency", async () => {
    // The conversation belongs to AGENCY; a caller from another agency names their own, so the read finds nothing.
    account.agencyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(await captureConversationLead(CONVERSATION)).toEqual({ ok: false, error: "Conversation not found." });
    expect(linkConversationToLead).not.toHaveBeenCalled();
  });
});

describe("addInternalNote", () => {
  it("names the agency on the note and on each mention, instead of leaving it to the column default", async () => {
    expect(await addInternalNote(CONVERSATION, "Customer prefers evening calls", [MENTIONED])).toEqual({ ok: true });
    const note = calls.find((call) => call.table === "conversation_notes" && call.op === "insert");
    expect(note?.payload).toMatchObject({ agency_id: AGENCY, conversation_id: CONVERSATION, author_id: ME });
    const mentions = calls.find((call) => call.table === "note_mentions" && call.op === "insert");
    expect(mentions?.payload).toEqual([{ agency_id: AGENCY, note_id: "note-1", mentioned_user_id: MENTIONED }]);
  });

  it("scopes the clean-up of a note whose mentions could not be saved to the agency", async () => {
    mentionsInsertFails = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await addInternalNote(CONVERSATION, "Hello", [MENTIONED])).toMatchObject({ ok: false });
    const cleanup = calls.find((call) => call.table === "conversation_notes" && call.op === "delete");
    expect(cleanup?.filters).toEqual({ agency_id: AGENCY, id: "note-1" });
  });

  it("refuses an account with no agency before writing anything, even when nobody is mentioned", async () => {
    account.agencyId = null;
    expect(await addInternalNote(CONVERSATION, "Hello", [])).toEqual({ ok: false, error: "No agency resolved for your account." });
    expect(calls).toEqual([]);
  });
});

describe("saveConversationDraft", () => {
  it("names the agency on the saved draft", async () => {
    expect(await saveConversationDraft(CONVERSATION, "Dear customer,")).toEqual({ ok: true });
    const save = calls.find((call) => call.table === "conversation_drafts" && call.op === "upsert");
    expect(save?.payload).toEqual({ agency_id: AGENCY, conversation_id: CONVERSATION, author_id: ME, body: "Dear customer," });
  });

  it("scopes clearing a draft to the agency as well as the conversation and the author", async () => {
    expect(await saveConversationDraft(CONVERSATION, "")).toEqual({ ok: true });
    const clear = calls.find((call) => call.table === "conversation_drafts" && call.op === "delete");
    expect(clear?.filters).toEqual({ agency_id: AGENCY, conversation_id: CONVERSATION, author_id: ME });
  });

  it("refuses an account with no agency before writing anything", async () => {
    account.agencyId = null;
    expect(await saveConversationDraft(CONVERSATION, "Hello")).toEqual({ ok: false, error: "No agency resolved for your account." });
    expect(calls).toEqual([]);
  });
});

describe("createBookingFromConversation", () => {
  it("reads the conversation within the caller's agency", async () => {
    await createBookingFromConversation(CONVERSATION);
    expect(reads("conversations")[0].filters).toEqual({ agency_id: AGENCY, id: CONVERSATION });
  });
});

describe("selectConversationDepartureGroup", () => {
  it("reads the conversation within the caller's agency", async () => {
    await selectConversationDepartureGroup({ conversationId: CONVERSATION, departureGroupId: GROUP });
    expect(reads("conversations")[0].filters).toEqual({ agency_id: AGENCY, id: CONVERSATION });
  });

  it("refuses an account with no agency before reading anything", async () => {
    account.agencyId = null;
    expect(await selectConversationDepartureGroup({ conversationId: CONVERSATION, departureGroupId: GROUP })).toEqual({ ok: false, error: "Not permitted to select a departure group." });
    expect(calls).toEqual([]);
  });
});
