import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const AGENCY = "0b8e7c3a-1f4d-4e6a-9d2b-7a1c5e3f9b10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const OTHER_CONVERSATION = "6d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";
const OBJECT = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const PDF_PATH = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.pdf`;
const PNG_PATH = `${AGENCY}/outbound/${CONVERSATION}/${OBJECT}.png`;

const order: string[] = [];
const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
let provider = "WHATSAPP";
let commandContent: unknown[] = [];
let attempts = 1;
let signedUrls: Array<{ path: string; seconds: number }> = [];

const sendMedia = vi.fn();
const sendReply = vi.fn();
const authorize = vi.fn();

vi.mock("@/lib/inbox/outbound/authorize-provider-send", () => ({
  authorizeProviderSend: (...args: unknown[]) => authorize(...args),
}));
vi.mock("@/lib/inbox/autonomy/runtime", () => ({ recordAutomatedSendDecision: vi.fn(async () => undefined) }));
vi.mock("@/lib/inbox/outbound/test-agency-send-guard", () => ({ loadAgencyIsTest: async () => false }));
vi.mock("@/lib/channels/registry", () => ({
  getChannelAdapter: () => ({
    profile: { displayName: provider === "INSTAGRAM" ? "Instagram" : "WhatsApp" },
    resolveConnectionForChannelConnection: async () => ({ accountId: "acct", credentialRef: "ref", status: "CONNECTED" }),
    readToken: async () => "token",
    sendMedia,
    sendReply,
    classifyError: () => "UNKNOWN",
    reflectSendFailure: async () => undefined,
  }),
}));

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => {
    let claimed = false;
    return {
      rpc: async (name: string) => {
        if (name !== "claim_outbox_messages") return { data: null, error: null };
        if (claimed) return { data: [], error: null };
        claimed = true;
        return {
          data: [{ id: "outbox-1", agency_id: AGENCY, connection_id: "cc-1", conversation_id: CONVERSATION, message_id: "msg-1", attempts, max_attempts: 3, command: { content: commandContent } }],
          error: null,
        };
      },
      storage: {
        from: () => ({
          createSignedUrl: async (path: string, seconds: number) => {
            order.push("sign");
            signedUrls.push({ path, seconds });
            return { data: { signedUrl: `https://signed.example/${path}?t=1` }, error: null };
          },
        }),
      },
      from: (table: string) => {
        const single: Record<string, unknown> = {
          channel_connections: { provider },
          conversations: { external_conversation_id: "94771234567" },
          conversation_messages: { actor_kind: "STAFF", actor_id: "staff-1", metadata: {} },
        };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: single[table] ?? null, error: null }),
          update: (values: Record<string, unknown>) => {
            updates.push({ table, values });
            return chain;
          },
          insert: async () => ({ error: null }),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
        return chain;
      },
    };
  },
}));

const { processDueInboxOutbox } = await import("./drain");

const allow = { allowed: true, reasons: [], command: { text: "" }, automatedAuthorization: null };
const docPart = { type: "media", kind: "document", storage_path: PDF_PATH, filename: "Itinerary.pdf", mime_type: "application/pdf" };

beforeEach(() => {
  order.length = 0;
  updates.length = 0;
  signedUrls = [];
  provider = "WHATSAPP";
  attempts = 1;
  commandContent = [{ type: "text", text: "Your itinerary" }, docPart];
  sendMedia.mockReset().mockResolvedValue({ externalMessageId: "wamid.9" });
  sendReply.mockReset();
  authorize.mockReset().mockImplementation(async () => {
    order.push("authorize");
    return allow;
  });
});

const outboxUpdate = () => updates.find((entry) => entry.table === "outbox_messages")?.values;
const messageUpdate = () => updates.find((entry) => entry.table === "conversation_messages")?.values;

describe("outbox drain: a staff file", () => {
  it("signs a short-lived URL, authorizes, then sends the file with its caption, and never uses the text path", async () => {
    const result = await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(signedUrls).toEqual([{ path: PDF_PATH, seconds: 600 }]);
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(sendMedia.mock.calls[0][2]).toEqual({
      to: "94771234567",
      kind: "document",
      url: `https://signed.example/${PDF_PATH}?t=1`,
      filename: "Itinerary.pdf",
      caption: "Your itinerary",
    });
    expect(sendReply).not.toHaveBeenCalled();
    expect(outboxUpdate()).toMatchObject({ status: "SENT", provider_message_id: "wamid.9" });
    expect(messageUpdate()).toMatchObject({ external_message_id: "wamid.9", delivery_status: "SENT" });
    expect(messageUpdate()).not.toHaveProperty("delivery_error");
  });

  it("checks the policy on the caption, and signs before authorizing so nothing is read between the decision and the send", async () => {
    await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(authorize.mock.calls[0][1]).toMatchObject({ text: "Your itinerary", author: { kind: "STAFF", actorId: "staff-1" } });
    expect(order).toEqual(["sign", "authorize"]);
  });

  it("sends a file with no caption, which a text message could not", async () => {
    commandContent = [{ ...docPart, kind: "image", storage_path: PNG_PATH, filename: "photo.png" }];
    const result = await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(result.processed).toBe(1);
    expect(sendMedia.mock.calls[0][2]).not.toHaveProperty("caption");
    expect(authorize.mock.calls[0][1]).toMatchObject({ text: "" });
  });

  it("records that the file was sent but its caption was not, instead of resending the file", async () => {
    sendMedia.mockResolvedValue({ externalMessageId: "m.1", captionFailed: true });
    await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(outboxUpdate()).toMatchObject({ status: "SENT" });
    expect(messageUpdate()).toMatchObject({ delivery_status: "SENT", delivery_error: "The file was sent, but its caption was not." });
  });

  it("refuses a file that is not this conversation's, permanently, without signing or sending", async () => {
    commandContent = [{ ...docPart, storage_path: `${AGENCY}/outbound/${OTHER_CONVERSATION}/${OBJECT}.pdf` }];
    const result = await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(result.failed).toBe(1);
    expect(signedUrls).toHaveLength(0);
    expect(sendMedia).not.toHaveBeenCalled();
    expect(outboxUpdate()).toMatchObject({ status: "DEAD" });
    expect(messageUpdate()).toMatchObject({ delivery_status: "FAILED" });
  });

  it("refuses a document on Instagram, permanently, before any signing or sending", async () => {
    provider = "INSTAGRAM";
    const result = await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(result.failed).toBe(1);
    expect(sendMedia).not.toHaveBeenCalled();
    expect(outboxUpdate()).toMatchObject({ status: "DEAD", last_error: "Instagram can't send this kind of file." });
  });

  it("does not send when the policy refuses it (a closed window, someone else's chat)", async () => {
    authorize.mockImplementation(async () => ({ allowed: false, reasons: ["Take control of this conversation before replying."], command: { text: "" }, automatedAuthorization: null }));
    const result = await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(result.failed).toBe(1);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("retries a transient failure instead of giving up", async () => {
    sendMedia.mockRejectedValue(new Error("Meta timed out"));
    await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(outboxUpdate()).toMatchObject({ status: "QUEUED" });
  });

  it("still refuses an empty text command, so a file part is the only thing that lets a message go without text", async () => {
    commandContent = [];
    await processDueInboxOutbox({ budgetMs: 5_000 });
    expect(outboxUpdate()).toMatchObject({ status: "DEAD" });
    expect(sendReply).not.toHaveBeenCalled();
  });
});
