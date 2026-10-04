import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { whatsappChannelAdapter } = await import("./whatsapp-adapter");
const { messengerChannelAdapter } = await import("./messenger/adapter");
const { instagramChannelAdapter } = await import("./instagram/adapter");

import type { ResolvedChannelConnection } from "@/lib/channels/adapter";

const URL_ = "https://project.supabase.co/storage/v1/object/sign/inbox-attachments/a/outbound/c/x.pdf?token=abc";

const whatsapp: ResolvedChannelConnection = { provider: "WHATSAPP", id: "wi-1", status: "CONNECTED", credentialRef: "r", displayAddress: null, fundingStatus: "FUNDED", accountId: "phone-1" };
const messenger: ResolvedChannelConnection = { provider: "MESSENGER", id: "cc-m", status: "CONNECTED", credentialRef: "r", displayAddress: null, fundingStatus: null, accountId: "page-1" };
const instagram: ResolvedChannelConnection = { provider: "INSTAGRAM", id: "cc-i", status: "CONNECTED", credentialRef: "r", displayAddress: null, fundingStatus: null, accountId: "ig-1" };
const instagramLogin: ResolvedChannelConnection = { ...instagram, connectMethod: "INSTAGRAM_LOGIN" };

type Sent = { url: string; body: Record<string, unknown> };

/** Records every Graph call; `failOn` makes the nth call (1-based) answer with an error. */
function mockGraph(options: { failOn?: number } = {}) {
  const calls: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse((init as RequestInit).body as string) });
    if (options.failOn === calls.length) return new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), { status: 400 });
    const n = calls.length;
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${n}` }], message_id: `m.${n}`, recipient_id: "u" }), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("WhatsApp: a file by link", () => {
  it("sends a document with its caption and the file name customers see", async () => {
    const calls = mockGraph();
    const result = await whatsappChannelAdapter.sendMedia!(whatsapp, "tok", { to: "94771234567", kind: "document", url: URL_, filename: "Itinerary.pdf", caption: "Your itinerary" });
    expect(result).toEqual({ externalMessageId: "wamid.1" });
    expect(calls[0].url).toMatch(/\/phone-1\/messages$/);
    expect(calls[0].body).toEqual({
      messaging_product: "whatsapp",
      to: "94771234567",
      type: "document",
      document: { link: URL_, caption: "Your itinerary", filename: "Itinerary.pdf" },
    });
  });

  it("sends a photo without a caption or a file name", async () => {
    const calls = mockGraph();
    await whatsappChannelAdapter.sendMedia!(whatsapp, "tok", { to: "94771234567", kind: "image", url: URL_, filename: "photo.png" });
    expect(calls[0].body).toEqual({ messaging_product: "whatsapp", to: "94771234567", type: "image", image: { link: URL_ } });
  });

  it("refuses a connection with no phone number id, before any call", async () => {
    const calls = mockGraph();
    await expect(whatsappChannelAdapter.sendMedia!({ ...whatsapp, accountId: null }, "tok", { to: "1", kind: "image", url: URL_, filename: "a.png" })).rejects.toThrow("no phone number id");
    expect(calls).toHaveLength(0);
  });
});

describe("Messenger: an attachment, then its caption as a text", () => {
  it("sends a document as a file attachment that is not cached as a reusable id", async () => {
    const calls = mockGraph();
    const result = await messengerChannelAdapter.sendMedia!(messenger, "tok", { to: "psid-1", kind: "document", url: URL_, filename: "Itinerary.pdf" });
    expect(result).toEqual({ externalMessageId: "m.1" });
    expect(calls[0].url).toMatch(/\/page-1\/messages$/);
    expect(calls[0].body).toEqual({
      messaging_type: "RESPONSE",
      recipient: { id: "psid-1" },
      message: { attachment: { type: "file", payload: { url: URL_, is_reusable: false } } },
    });
  });

  it("sends a photo as an image, then the caption, and reports both ids so each echo is recognised as ours", async () => {
    const calls = mockGraph();
    const result = await messengerChannelAdapter.sendMedia!(messenger, "tok", { to: "psid-1", kind: "image", url: URL_, filename: "a.png", caption: "Here you go" });
    expect(calls).toHaveLength(2);
    expect((calls[0].body.message as { attachment: { type: string } }).attachment.type).toBe("image");
    expect(calls[1].body.message).toEqual({ text: "Here you go" });
    expect(result).toEqual({ externalMessageId: "m.2", partMessageIds: ["m.1", "m.2"] });
  });

  it("does not resend the file when only the caption fails: the file is out, and the result says the caption was not", async () => {
    const calls = mockGraph({ failOn: 2 });
    const result = await messengerChannelAdapter.sendMedia!(messenger, "tok", { to: "psid-1", kind: "image", url: URL_, filename: "a.png", caption: "Here you go" });
    expect(result).toEqual({ externalMessageId: "m.1", captionFailed: true });
    expect(calls.filter((call) => "attachment" in (call.body.message as object))).toHaveLength(1);
  });

  it("raises when the file itself fails, so the outbox can retry it", async () => {
    mockGraph({ failOn: 1 });
    await expect(messengerChannelAdapter.sendMedia!(messenger, "tok", { to: "psid-1", kind: "image", url: URL_, filename: "a.png", caption: "x" })).rejects.toThrow();
  });
});

describe("Instagram: photos only", () => {
  it("sends a photo through /me/messages for a Page connection", async () => {
    const calls = mockGraph();
    await instagramChannelAdapter.sendMedia!(instagram, "tok", { to: "igsid-1", kind: "image", url: URL_, filename: "a.png" });
    expect(calls[0].url).toMatch(/\/me\/messages$/);
    expect(calls[0].body).toEqual({ recipient: { id: "igsid-1" }, message: { attachment: { type: "image", payload: { url: URL_, is_reusable: false } } } });
  });

  it("sends a photo through the account's own edge for an Instagram Login connection", async () => {
    const calls = mockGraph();
    await instagramChannelAdapter.sendMedia!(instagramLogin, "tok", { to: "igsid-1", kind: "image", url: URL_, filename: "a.png" });
    expect(calls[0].url).toContain("/ig-1/messages");
  });

  it("refuses a document with a plain message, before any call: Instagram cannot carry one", async () => {
    const calls = mockGraph();
    await expect(instagramChannelAdapter.sendMedia!(instagram, "tok", { to: "igsid-1", kind: "document", url: URL_, filename: "a.pdf" })).rejects.toThrow("can't send documents");
    expect(calls).toHaveLength(0);
  });
});
