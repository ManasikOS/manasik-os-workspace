import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-1 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): take control, hand back to the assistant and a template send must not
 * move a chat away from the colleague who owns it, must not reopen a closed chat, and must write over the row they checked only.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COLLEAGUE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CONVERSATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const role = { value: "MARKETING" as string };

vi.mock("@/lib/inbox/lead-linking", () => ({ linkConversationToLead: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent/whatsapp/phone", () => ({ waIdToMobile: (digits: string) => digits }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ME }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: AGENCY, staffId: ME, name: "Me" }), createGroupBooking: vi.fn() }));
const loadProtectionContext = vi.fn();
vi.mock("@/lib/data/inbox-risk-repository", () => ({ loadProtectionContext: (...args: unknown[]) => loadProtectionContext(...args) }));
const sendApprovedTemplate = vi.fn();
vi.mock("@/lib/whatsapp/send-template-message", () => ({ sendApprovedTemplate: (...args: unknown[]) => sendApprovedTemplate(...args) }));
import { createFakeClaimsAdmin } from "@/lib/inbox/template-send-claims-fake";
const events: Array<Record<string, unknown>> = [];
let fakeAdmin = createFakeClaimsAdmin();
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => fakeAdmin.admin }));

let conversationRow: { id: string; state: string; assigned_to_id: string | null; assigned_to_name: string | null; channel: string; contact_phone: string; external_conversation_id: string } | null;
let openReviews: Array<{ id: string }>;
let writeMatchesRows = true;
let upsertFails = false;
let templateText = "Hello";
const updates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = [];
const rpcCalls: string[] = [];

function chain(result: () => unknown, onUpdate?: { patch: Record<string, unknown> }) {
  const filters: Record<string, unknown> = {};
  if (onUpdate) updates.push({ patch: onUpdate.patch, filters });
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "is", "in", "limit", "select"]) {
    query[method] = (column: string, value?: unknown) => { if (method === "eq" || method === "is") filters[column] = value ?? null; return query; };
  }
  query.maybeSingle = async () => result();
  query.single = async () => result();
  query.then = (resolve: (value: unknown) => unknown) => resolve(result());
  return query;
}

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    rpc: async (name: string) => { rpcCalls.push(name); return { data: null, error: null }; },
    from: (table: string) => {
      if (table === "conversation_interventions") return { select: () => chain(() => ({ data: openReviews, error: null })) };
      return {
        select: () => chain(() => ({ data: conversationRow, error: null })),
        upsert: () => chain(() => (upsertFails ? { data: null, error: { message: "boom" } } : { data: { id: CONVERSATION }, error: null })),
        update: (patch: Record<string, unknown>) => chain(() => ({ data: writeMatchesRows ? [{ id: CONVERSATION }] : [], error: null }), { patch }),
      };
    },
  }),
}));

import { releaseToAi, sendConversationTemplateAction, startWhatsAppChat, takeControl } from "./actions";

/** The history rows the actions wrote (everything the fake admin received that is not a send claim). */
const ownerEvents = () => fakeAdmin.otherInserts.map((entry) => entry.row);

const row = (state: string, owner: string | null) => ({
  id: CONVERSATION, state, assigned_to_id: owner, assigned_to_name: owner ? "Nimal" : null,
  channel: "WHATSAPP", contact_phone: "94771234567", external_conversation_id: "94771234567",
});

beforeEach(() => {
  role.value = "MARKETING";
  conversationRow = row("AI_ACTIVE", null);
  openReviews = [];
  writeMatchesRows = true;
  upsertFails = false;
  updates.length = 0;
  events.length = 0;
  rpcCalls.length = 0;
  fakeAdmin = createFakeClaimsAdmin();
  sendApprovedTemplate.mockReset();
  loadProtectionContext.mockReset();
  loadProtectionContext.mockResolvedValue({ openReviews: [], approvedAccountDigits: [] });
  // Like the real sender: the Inbox's text check runs on the filled-in template before anything goes out.
  sendApprovedTemplate.mockImplementation(async (args: { checkRenderedText?: (text: string) => Promise<string | null> }) => {
    const refusal = await args.checkRenderedText?.(templateText);
    if (refusal) return { ok: false, reason: "SEND_FAILED", error: refusal };
    return { ok: true, externalMessageId: "wamid.1", renderedText: templateText, bodyParameters: [], template: { id: TEMPLATE, name: "t", language: "en", category: "UTILITY" } };
  });
  templateText = "Hello";
});

describe("takeControl", () => {
  it("takes an unowned chat, only if it is still as read, and records the owner change", async () => {
    expect(await takeControl(CONVERSATION)).toEqual({ ok: true });
    expect(updates[0].patch).toMatchObject({ state: "HUMAN_ACTIVE", assigned_to_id: ME });
    expect(updates[0].filters).toMatchObject({ state: "AI_ACTIVE", assigned_to_id: null });
    expect(ownerEvents()[0]).toMatchObject({ kind: "OWNER_CHANGED", conversation_id: CONVERSATION });
  });
  it("refuses a colleague's chat and writes nothing", async () => {
    conversationRow = row("HUMAN_ACTIVE", COLLEAGUE);
    const result = await takeControl(CONVERSATION);
    expect(result).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
    expect(ownerEvents()).toHaveLength(0);
  });
  it("refuses a closed chat instead of reopening it", async () => {
    conversationRow = row("CLOSED", null);
    expect(await takeControl(CONVERSATION)).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
  it("reports a lost race instead of overwriting, and records nothing", async () => {
    writeMatchesRows = false;
    expect(await takeControl(CONVERSATION)).toEqual({ ok: false, error: "Someone else changed this conversation just now. Refresh and try again." });
    expect(ownerEvents()).toHaveLength(0);
  });
  it("writes no history row when the person already owned the chat", async () => {
    conversationRow = row("HUMAN_REQUESTED", ME);
    expect(await takeControl(CONVERSATION)).toEqual({ ok: true });
    expect(ownerEvents()).toHaveLength(0);
  });
});

describe("releaseToAi", () => {
  it("lets the owner hand back a chat with no open review, clearing the owner", async () => {
    conversationRow = row("HUMAN_ACTIVE", ME);
    expect(await releaseToAi(CONVERSATION)).toEqual({ ok: true });
    expect(updates[0].patch).toEqual({ state: "AI_RESUMED", assigned_to_id: null, assigned_to_name: null });
    expect(ownerEvents()[0]).toMatchObject({ kind: "OWNER_CHANGED" });
  });
  it("refuses while a review is open", async () => {
    conversationRow = row("HUMAN_ACTIVE", ME);
    openReviews = [{ id: "r1" }];
    expect(await releaseToAi(CONVERSATION)).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
  it("refuses a colleague's chat unless the caller is an administrator", async () => {
    conversationRow = row("HUMAN_ACTIVE", COLLEAGUE);
    expect(await releaseToAi(CONVERSATION)).toMatchObject({ ok: false });
    role.value = "ADMIN";
    expect(await releaseToAi(CONVERSATION)).toEqual({ ok: true });
  });
});

describe("sendConversationTemplateAction", () => {
  const KEY = "99999999-9999-4999-8999-999999999999";
  const input = { conversationId: CONVERSATION, templateId: TEMPLATE, bodyParameters: [], clientIdempotencyKey: KEY };
  it("sends nothing when a colleague owns the chat", async () => {
    conversationRow = row("HUMAN_ACTIVE", COLLEAGUE);
    expect(await sendConversationTemplateAction(input)).toMatchObject({ ok: false });
    expect(sendApprovedTemplate).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
  it("sends on an unowned chat, takes it only if still unowned, and records the owner change", async () => {
    expect(await sendConversationTemplateAction(input)).toEqual({ ok: true });
    expect(rpcCalls).toEqual(["record_staff_template_message"]);
    expect(updates[0].filters).toMatchObject({ assigned_to_id: null });
    expect(ownerEvents()[0]).toMatchObject({ kind: "OWNER_CHANGED" });
  });
  it("sends nothing when the filled-in template says what an open review guards", async () => {
    loadProtectionContext.mockResolvedValue({ openReviews: [{ kind: "PAYMENT_CLAIM", severity: "BLOCK", headline: "The customer says they paid" }], approvedAccountDigits: [] });
    templateText = "Good news, we have received your payment. Thank you!";
    const result = await sendConversationTemplateAction(input);
    expect(result).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
  it("sends nothing when the open reviews cannot be read", async () => {
    loadProtectionContext.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendConversationTemplateAction(input)).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });
  it("sends once when the same attempt is submitted twice (double click), and answers the repeat as done", async () => {
    expect(await sendConversationTemplateAction(input)).toEqual({ ok: true });
    expect(await sendConversationTemplateAction(input)).toEqual({ ok: true });
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toEqual(["record_staff_template_message"]);
  });
  it("does not send a second time while the first attempt is still running", async () => {
    const first = sendConversationTemplateAction(input);
    const second = await sendConversationTemplateAction(input);
    await first;
    expect(second).toMatchObject({ ok: false });
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(1);
  });
  it("lets the same attempt be tried again after a refusal that sent nothing", async () => {
    sendApprovedTemplate.mockResolvedValueOnce({ ok: false, reason: "TEMPLATE_NOT_APPROVED", error: "That template is no longer approved." });
    expect(await sendConversationTemplateAction(input)).toMatchObject({ ok: false });
    expect(await sendConversationTemplateAction(input)).toEqual({ ok: true });
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(2);
  });
  it("never sends a second time after Meta accepted the first, even if saving it in the CRM failed", async () => {
    writeMatchesRows = false;
    expect(await sendConversationTemplateAction(input)).toMatchObject({ ok: false });
    writeMatchesRows = true;
    expect(await sendConversationTemplateAction(input)).toEqual({ ok: true });
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(1);
    expect([...fakeAdmin.rows.values()][0]).toMatchObject({ status: "SENT", external_message_id: "wamid.1" });
  });
  it("refuses an attempt without a key, before anything is sent", async () => {
    expect(await sendConversationTemplateAction({ ...input, clientIdempotencyKey: undefined })).toMatchObject({ ok: false });
    expect(sendApprovedTemplate).not.toHaveBeenCalled();
  });
  it("does not report success when someone took the chat after the send", async () => {
    writeMatchesRows = false;
    expect(await sendConversationTemplateAction(input)).toMatchObject({ ok: false });
  });
});

describe("startWhatsAppChat — one send per attempt", () => {
  const KEY = "88888888-8888-4888-8888-888888888888";
  const start = () => startWhatsAppChat({ phoneNumber: "+94 77 123 4567", contactName: "Nimal", templateId: TEMPLATE, bodyParameters: [], clientIdempotencyKey: KEY });
  beforeEach(() => { conversationRow = null; });

  it("sends the template once when the same attempt is submitted twice, and returns the same chat both times", async () => {
    expect(await start()).toEqual({ ok: true, conversationId: CONVERSATION });
    expect(await start()).toEqual({ ok: true, conversationId: CONVERSATION });
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(1);
  });
  it("records the send as soon as Meta accepts it, so a failure opening the chat cannot lead to a second send", async () => {
    upsertFails = true;
    expect(await start()).toMatchObject({ ok: false });
    upsertFails = false;
    const retry = await start();
    expect(retry).toMatchObject({ ok: false });
    expect((retry as { error: string }).error).toContain("already sent");
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(1);
    expect([...fakeAdmin.rows.values()][0]).toMatchObject({ status: "SENT", external_message_id: "wamid.1" });
  });
  it("lets the attempt be repeated after a refusal that sent nothing", async () => {
    sendApprovedTemplate.mockResolvedValueOnce({ ok: false, reason: "MISSING_VARIABLES", error: "Fill in every template variable before sending." });
    expect(await start()).toMatchObject({ ok: false });
    expect(await start()).toEqual({ ok: true, conversationId: CONVERSATION });
    expect(sendApprovedTemplate).toHaveBeenCalledTimes(2);
  });
  it("refuses an attempt without a key, before anything is sent", async () => {
    const result = await startWhatsAppChat({ phoneNumber: "+94771234567", templateId: TEMPLATE, bodyParameters: [] } as never);
    expect(result).toMatchObject({ ok: false });
    expect(sendApprovedTemplate).not.toHaveBeenCalled();
  });
});
