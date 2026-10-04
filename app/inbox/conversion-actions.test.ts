import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const session = { role: "MARKETING", roleId: null as string | null, agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null, staffId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as string | null, name: "Sales Sam" };
const previewConversion = vi.fn<(...args: unknown[]) => Promise<{ ok: true; proposalId: string; title: string; humanDiff: never[]; note: string }>>(async () => ({ ok: true, proposalId: "p1", title: "t", humanDiff: [], note: "" }));
const confirmConversion = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }));
const dismissConversion = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }));
const listOfferedConversions = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
const loadChoicesForConversion = vi.fn<(...args: unknown[]) => Promise<{ ok: true; fields: unknown[] }>>(async () => ({ ok: true, fields: [] }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: session.staffId }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ ...session }) }));
vi.mock("@/lib/inbox/conversions/service", () => ({
  previewConversion: (...args: unknown[]) => previewConversion(...args),
  confirmConversion: (...args: unknown[]) => confirmConversion(...args),
  dismissConversion: (...args: unknown[]) => dismissConversion(...args),
  listOfferedConversions: (...args: unknown[]) => listOfferedConversions(...args),
  loadChoicesForConversion: (...args: unknown[]) => loadChoicesForConversion(...args),
}));

const { confirmConversationConversionAction, dismissConversationConversionAction, loadConversationConversionsAction, loadConversionChoicesAction, previewConversationConversionAction } = await import("./conversion-actions");
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const PROPOSAL = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  for (const fn of [previewConversion, confirmConversion, dismissConversion, listOfferedConversions, loadChoicesForConversion]) fn.mockClear();
  session.role = "MARKETING";
  session.agencyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  session.staffId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
});

describe("conversion actions", () => {
  it("previews for the signed-in person's agency, ignoring an agency named in the request", async () => {
    const result = await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_VISA_TASK", note: "hi", agencyId: "someone-else" });
    expect(result).toMatchObject({ ok: true });
    expect(previewConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: session.agencyId, staffId: session.staffId, role: "MARKETING" }), { conversationId: CONVERSATION, kind: "CONVERSATION_VISA_TASK", note: "hi", params: {} });
  });

  it("refuses roles without the Inbox conversion capability before touching anything", async () => {
    for (const role of ["FINANCE", "VISA", "GUIDE", "CEO"]) {
      session.role = role;
      expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_VISA_TASK" })).toMatchObject({ ok: false });
      expect(await confirmConversationConversionAction({ proposalId: PROPOSAL })).toMatchObject({ ok: false });
      expect(await dismissConversationConversionAction({ proposalId: PROPOSAL })).toMatchObject({ ok: false });
      expect(await loadConversationConversionsAction({ conversationId: CONVERSATION })).toMatchObject({ ok: false });
      expect(await loadConversionChoicesAction({ conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD" })).toMatchObject({ ok: false });
    }
    for (const fn of [previewConversion, confirmConversion, dismissConversion, listOfferedConversions, loadChoicesForConversion]) expect(fn).not.toHaveBeenCalled();
  });

  it("refuses an account with no agency or staff record", async () => {
    session.agencyId = null;
    expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_VISA_TASK" })).toEqual({ ok: false, error: "Your account is not linked to an agency." });
    expect(previewConversion).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind, a malformed id and an over-long note at the boundary", async () => {
    expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_REFUND_PAYMENT" })).toMatchObject({ ok: false });
    expect(await previewConversationConversionAction({ conversationId: "nope", kind: "CONVERSATION_VISA_TASK" })).toMatchObject({ ok: false });
    expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_VISA_TASK", note: "x".repeat(301) })).toMatchObject({ ok: false });
    expect(await confirmConversationConversionAction({ proposalId: "nope" })).toMatchObject({ ok: false });
    expect(previewConversion).not.toHaveBeenCalled();
    expect(confirmConversion).not.toHaveBeenCalled();
  });

  it("confirms and cancels through the service for the signed-in agency", async () => {
    expect(await confirmConversationConversionAction({ proposalId: PROPOSAL })).toEqual({ ok: true });
    expect(await dismissConversationConversionAction({ proposalId: PROPOSAL })).toEqual({ ok: true });
    expect(confirmConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: session.agencyId }), PROPOSAL);
    expect(dismissConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: session.agencyId }), PROPOSAL);
  });

  it("passes the person's choices through to the service untouched, for it to check against what it offered", async () => {
    await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD", params: { seats: 3 } });
    expect(previewConversion).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ params: { seats: 3 } }));
  });

  it("rejects a choice that is not a plain string, number or yes/no", async () => {
    expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD", params: { seats: { $gt: 0 } } })).toMatchObject({ ok: false });
    expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_PACKAGE_RECOMMENDATION", params: { packageId: "x".repeat(201) } })).toMatchObject({ ok: false });
    expect(previewConversion).not.toHaveBeenCalled();
  });

  it("loads the choices for the signed-in agency, and rejects an unknown kind", async () => {
    expect(await loadConversionChoicesAction({ conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD" })).toEqual({ ok: true, fields: [] });
    expect(loadChoicesForConversion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agencyId: session.agencyId }), { conversationId: CONVERSATION, kind: "CONVERSATION_SEAT_HOLD" });
    expect(await loadConversionChoicesAction({ conversationId: CONVERSATION, kind: "CONVERSATION_REFUND_PAYMENT" })).toMatchObject({ ok: false });
  });

  it("turns a service failure into a plain message, not a crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    previewConversion.mockRejectedValueOnce(new Error("db down"));
    expect(await previewConversationConversionAction({ conversationId: CONVERSATION, kind: "CONVERSATION_VISA_TASK" })).toEqual({ ok: false, error: "This could not be prepared. Please try again." });
  });
});
