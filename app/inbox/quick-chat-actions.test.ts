import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Quick Chat actions are agency-scoped and refuse anyone who may not use the popup: the deployment flag is off, the role may not use
 * it, or the number is not a full international number. The read actions send nothing; the record send is Finance and Visa only.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "user-1" }) }));

let role = "OPERATIONS";
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role, agencyId: "agency-1", staffId: "staff-1", name: "Amina" }),
}));

const filters: Array<[string, unknown]> = [];
let conversation: Record<string, unknown> | null = null;
let messages: Array<Record<string, unknown>> = [];
let templates: Array<Record<string, unknown>> = [];

vi.mock("next/server", () => ({ after: (task: () => unknown) => void task() }));
vi.mock("@/lib/inbox/outbox/drain", () => ({ processDueInboxOutbox: async () => undefined }));

let openReviews: unknown[] = [];
let protectionUnreadable = false;
vi.mock("@/lib/data/inbox-risk-repository", () => ({
  loadProtectionContext: async () => {
    if (protectionUnreadable) throw new Error("unreadable");
    return { openReviews, approvedAccountDigits: [] };
  },
}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { message: string } | null } = { data: [{ message_id: "msg-1", outbox_id: "out-1" }], error: null };

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (column: string, value: unknown) => {
        filters.push([`${table}.${column}`, value]);
        return query;
      };
      query.order = () => query;
      // The template list ends at `.order(...)`, so awaiting that query must resolve to the rows.
      if (table === "whatsapp_templates") query.then = (resolve: (value: unknown) => void) => resolve({ data: templates, error: null });
      query.limit = async () => ({ data: messages, error: null });
      query.maybeSingle = async () => ({ data: conversation, error: null });
      return query;
    },
  }),
}));

vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/data/whatsapp-billing-repository", () => ({
  findLatestTemplateRates: async (_db: unknown, _agency: string, _country: unknown, categories: string[]) =>
    Object.fromEntries(categories.filter((category) => category === "UTILITY").map((category) => [category, { amount: 0.004, currency: "USD" }])),
}));

vi.mock("@/lib/inbox/start-chat-consent", () => ({
  checkStartChatConsent: async () => ({ allowed: true }),
}));

import {
  loadQuickChatTemplatesAction,
  loadQuickChatThreadAction,
  resolveQuickChatTargetAction,
  sendQuickChatRecordMessageAction,
} from "./quick-chat-actions";

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  role = "OPERATIONS";
  conversation = null;
  messages = [];
  templates = [];
  filters.length = 0;
  rpcCalls.length = 0;
  rpcResult = { data: [{ message_id: "msg-1", outbox_id: "out-1" }], error: null };
  openReviews = [];
  protectionUnreadable = false;
  vi.stubEnv("QUICK_CHAT_ENABLED", "1");
});

describe("resolveQuickChatTargetAction", () => {
  it("refuses everyone while the deployment flag is off", async () => {
    vi.stubEnv("QUICK_CHAT_ENABLED", "");
    expect(await resolveQuickChatTargetAction({ channel: "WHATSAPP", to: "94771234567" })).toEqual({ ok: false, error: "Not permitted." });
  });

  it.each(["CEO", "GUIDE"])("refuses %s, which has no way to send from the popup", async (blocked) => {
    role = blocked;
    expect(await resolveQuickChatTargetAction({ channel: "WHATSAPP", to: "94771234567" })).toEqual({ ok: false, error: "Not permitted." });
  });

  it("refuses a number that is not a full international number", async () => {
    const result = await resolveQuickChatTargetAction({ channel: "WHATSAPP", to: "0771234" });
    expect(result.ok).toBe(false);
  });

  it("looks the conversation up inside the caller's agency, by digits only", async () => {
    const result = await resolveQuickChatTargetAction({ channel: "WHATSAPP", to: "+94 77 123 4567" });
    expect(result).toMatchObject({ ok: true, digits: "94771234567", target: { kind: "NEEDS_TEMPLATE", reason: "NEW_NUMBER" } });
    expect(filters).toContainEqual(["conversations.agency_id", "agency-1"]);
    expect(filters).toContainEqual(["conversations.external_conversation_id", "94771234567"]);
  });

  it("answers READY for an open window on the sender's own chat", async () => {
    conversation = {
      id: CONVERSATION_ID,
      state: "HUMAN_ACTIVE",
      assigned_to_id: "staff-1",
      assigned_to_name: "Amina",
      service_window_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      contact_name: "Fathima",
    };
    const result = await resolveQuickChatTargetAction({ channel: "WHATSAPP", to: "94771234567" });
    expect(result).toMatchObject({ ok: true, contactName: "Fathima", target: { kind: "READY", conversationId: CONVERSATION_ID } });
  });
});

describe("loadQuickChatThreadAction", () => {
  it("refuses a role that cannot use the popup, and an id that is not a uuid", async () => {
    role = "GUIDE";
    expect(await loadQuickChatThreadAction({ conversationId: CONVERSATION_ID })).toEqual({ ok: false, error: "Not permitted." });
    role = "OPERATIONS";
    expect((await loadQuickChatThreadAction({ conversationId: "nope" })).ok).toBe(false);
  });

  it("does not return messages for a conversation outside the agency", async () => {
    conversation = null;
    messages = [{ id: "m", role: "user", actor_kind: "CUSTOMER", content: "secret", created_at: "2030-01-01T00:00:00Z" }];
    const result = await loadQuickChatThreadAction({ conversationId: CONVERSATION_ID });
    expect(result.ok).toBe(false);
    expect(filters).toContainEqual(["conversations.agency_id", "agency-1"]);
  });

  it("returns a trimmed thread, scoped to the agency", async () => {
    conversation = { id: CONVERSATION_ID };
    messages = [
      { id: "m1", role: "user", actor_kind: "CUSTOMER", actor_name_snapshot: null, content: "Salaam", message_type: "TEXT", delivery_status: null, delivery_error: null, created_at: "2030-01-01T10:00:00Z" },
    ];
    const result = await loadQuickChatThreadAction({ conversationId: CONVERSATION_ID });
    expect(result).toMatchObject({ ok: true, messages: [{ id: "m1", direction: "IN", text: "Salaam" }] });
    expect(filters).toContainEqual(["conversation_messages.agency_id", "agency-1"]);
  });
});

describe("loadQuickChatTemplatesAction", () => {
  it("offers templates to Inbox roles only, and refuses a number that is not international", async () => {
    role = "VISA";
    expect(await loadQuickChatTemplatesAction({ channel: "WHATSAPP", to: "94771234567" })).toEqual({ ok: false, error: "Not permitted." });
    role = "OPERATIONS";
    expect((await loadQuickChatTemplatesAction({ channel: "WHATSAPP", to: "12" })).ok).toBe(false);
  });

  it("returns only this agency's approved templates, with a charge where Meta has reported one", async () => {
    templates = [
      { id: "t1", name: "receipt", language: "en", category: "UTILITY", components: [] },
      { id: "t2", name: "offer", language: "en", category: "MARKETING", components: [] },
    ];
    const result = await loadQuickChatTemplatesAction({ channel: "WHATSAPP", to: "94771234567" });

    expect(filters).toContainEqual(["whatsapp_templates.agency_id", "agency-1"]);
    expect(filters).toContainEqual(["whatsapp_templates.status", "APPROVED"]);
    expect(result).toMatchObject({
      ok: true,
      templates: [
        { id: "t1", projected_charge: 0.004, charge_currency: "USD" },
        { id: "t2", projected_charge: null, charge_currency: null },
      ],
    });
  });
});

describe("sendQuickChatRecordMessageAction", () => {
  const input = { conversationId: CONVERSATION_ID, body: "Your receipt is attached to your file.", clientIdempotencyKey: "33333333-3333-4333-8333-333333333333" };
  const openChat = (overrides: Record<string, unknown> = {}) => ({
    id: CONVERSATION_ID,
    channel: "WHATSAPP",
    state: "HUMAN_ACTIVE",
    assigned_to_id: "staff-1",
    assigned_to_name: "Rizwan",
    service_window_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    role = "FINANCE";
    conversation = openChat();
  });

  it.each(["ADMIN", "MARKETING", "OPERATIONS", "CEO", "GUIDE"])("refuses %s: the Inbox's own send, or no send at all, applies", async (other) => {
    role = other;
    expect(await sendQuickChatRecordMessageAction(input)).toEqual({ ok: false, error: "Not permitted." });
    expect(rpcCalls).toHaveLength(0);
  });

  it.each(["FINANCE", "VISA"])("sends for %s through the record function, scoped to the caller's agency", async (allowed) => {
    role = allowed;
    expect(await sendQuickChatRecordMessageAction(input)).toEqual({ ok: true, messageId: "msg-1" });
    expect(rpcCalls).toEqual([
      { name: "enqueue_record_text_message", args: { p_conversation_id: CONVERSATION_ID, p_body: input.body, p_client_idempotency_key: input.clientIdempotencyKey } },
    ]);
    expect(filters).toContainEqual(["conversations.agency_id", "agency-1"]);
  });

  it("refuses without calling the database when the window has closed, the chat is closed, or it is not WhatsApp", async () => {
    conversation = openChat({ service_window_expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await sendQuickChatRecordMessageAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("24-hour reply window") });
    conversation = openChat({ service_window_expires_at: null });
    expect((await sendQuickChatRecordMessageAction(input)).ok).toBe(false);
    conversation = openChat({ state: "CLOSED" });
    expect(await sendQuickChatRecordMessageAction(input)).toEqual({ ok: false, error: "This conversation is closed." });
    conversation = openChat({ channel: "GMAIL" });
    expect((await sendQuickChatRecordMessageAction(input)).ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses a chat a colleague owns, and names them", async () => {
    conversation = openChat({ assigned_to_id: "staff-2", assigned_to_name: "Rizwan" });
    expect(await sendQuickChatRecordMessageAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("Rizwan") });
    expect(rpcCalls).toHaveLength(0);
  });

  it("does not send when the open reviews cannot be read (unknown is not clear)", async () => {
    protectionUnreadable = true;
    expect(await sendQuickChatRecordMessageAction(input)).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });

  it("says the database's refusals in words, and hides any other failure", async () => {
    rpcResult = { data: null, error: { message: "outside the reply window" } };
    expect(await sendQuickChatRecordMessageAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("24-hour reply window") });
    rpcResult = { data: null, error: { message: "relation public.something does not exist" } };
    expect(await sendQuickChatRecordMessageAction(input)).toEqual({ ok: false, error: "The message could not be sent. Please try again." });
  });

  it("refuses an empty message, an over-long one, and extra fields", async () => {
    expect((await sendQuickChatRecordMessageAction({ ...input, body: "   " })).ok).toBe(false);
    expect((await sendQuickChatRecordMessageAction({ ...input, body: "x".repeat(4001) })).ok).toBe(false);
    expect((await sendQuickChatRecordMessageAction({ ...input, subject: "hi" })).ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});
