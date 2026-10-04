import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseMessengerWebhook } from "@/lib/channels/messenger/webhook";
import { verifyMetaSignature } from "@/lib/meta/signature";
import { storableInboundMessageIds } from "@/lib/whatsapp/inbound-ingest";
import { whatsAppWebhookExternalEventId } from "@/lib/whatsapp/webhook-handler";
import {
  assertSimulatedAccountId,
  deliverDuplicateWebhook,
  deliverSignedWebhook,
  pageDelivery,
  pageImageMessage,
  pageTextMessage,
  requestWebhookHandshake,
  signMetaWebhookBody,
  whatsappImageMessage,
  whatsappStatus,
  whatsappTextMessage,
} from "./inbound-payloads";

const NUMBER = { phoneNumberId: "sim-phone-1" };
const SECRET = "test-app-secret";

describe("the simulator refuses real account ids", () => {
  it.each(["123456789012345", "+94771234567", "page-1", "", "simulator"])("rejects %j", (id) => {
    expect(() => assertSimulatedAccountId(id, "the number")).toThrow(/must start with "sim-"/);
  });

  it.each(["sim-phone-1", "SIM_page.9", "sim.ig"])("accepts %s", (id) => {
    expect(() => assertSimulatedAccountId(id, "the number")).not.toThrow();
  });

  it("is applied by every builder", () => {
    expect(() => whatsappTextMessage({ phoneNumberId: "109876543210987" }, { from: "94771234567", text: "hi" })).toThrow(/Refusing/);
    expect(() => whatsappImageMessage({ phoneNumberId: "109876543210987" }, { from: "94771234567" })).toThrow(/Refusing/);
    expect(() => whatsappStatus({ phoneNumberId: "109876543210987" }, { messageId: "m", recipientId: "r", status: "read" })).toThrow(/Refusing/);
    expect(() => pageTextMessage("MESSENGER", "104455667788", { senderId: "psid-1", text: "hi" })).toThrow(/Refusing/);
    expect(() => pageImageMessage("INSTAGRAM", "1784140000000", { senderId: "igsid-1" })).toThrow(/Refusing/);
    expect(() => pageDelivery("MESSENGER", "104455667788", { senderId: "psid-1", mids: ["m"] })).toThrow(/Refusing/);
  });
});

describe("WhatsApp payloads", () => {
  it("builds a text message the app's own parsers read, addressed by phone_number_id", () => {
    const payload = whatsappTextMessage(NUMBER, { from: "94771234567", text: "Umrah in March?", messageId: "wamid.A", timestampSeconds: 1_700_000_000 });
    const value = payload.entry?.[0].changes?.[0].value;

    expect(value?.metadata?.phone_number_id).toBe("sim-phone-1");
    expect(value?.messages?.[0]).toMatchObject({ id: "wamid.A", from: "94771234567", type: "text", text: { body: "Umrah in March?" }, timestamp: "1700000000" });
    expect(storableInboundMessageIds(payload)).toEqual(["wamid.A"]);
    expect(whatsAppWebhookExternalEventId(payload)).toBeTruthy();
  });

  it("builds an image message with a media id and mime type", () => {
    const payload = whatsappImageMessage(NUMBER, { from: "94771234567", mediaId: "media-1", caption: "my passport" });
    expect(payload.entry?.[0].changes?.[0].value?.messages?.[0]).toMatchObject({ type: "image", image: { id: "media-1", mime_type: "image/png", caption: "my passport" } });
  });

  it("gives each default message a different id, so two sends are two messages", () => {
    const first = whatsappTextMessage(NUMBER, { from: "1", text: "a" }).entry?.[0].changes?.[0].value?.messages?.[0].id;
    const second = whatsappTextMessage(NUMBER, { from: "1", text: "a" }).entry?.[0].changes?.[0].value?.messages?.[0].id;
    expect(first).not.toBe(second);
  });

  it("builds a delivery receipt, with an error entry only for a failure", () => {
    const delivered = whatsappStatus(NUMBER, { messageId: "sim.whatsapp.1", recipientId: "94771234567", status: "delivered" }).entry?.[0].changes?.[0].value?.statuses?.[0];
    const failed = whatsappStatus(NUMBER, { messageId: "sim.whatsapp.1", recipientId: "94771234567", status: "failed", errorCode: 131047 }).entry?.[0].changes?.[0].value?.statuses?.[0];
    expect(delivered).toMatchObject({ id: "sim.whatsapp.1", status: "delivered", recipient_id: "94771234567" });
    expect(delivered?.errors).toBeUndefined();
    expect(failed?.errors?.[0].code).toBe(131047);
  });
});

describe("Messenger and Instagram payloads", () => {
  it("builds a Messenger text message the real parser reads", () => {
    const events = parseMessengerWebhook(pageTextMessage("MESSENGER", "sim-page-1", { senderId: "psid-9", text: "Salam", mid: "m1", timestampMs: 5 }));
    expect(events).toEqual([
      { kind: "message", viaPostback: false, pageId: "sim-page-1", psid: "psid-9", mid: "m1", text: "Salam", contentKind: "text", attachments: [], timestampMs: 5 },
    ]);
  });

  it("builds an Instagram message under the instagram object", () => {
    const payload = pageTextMessage("INSTAGRAM", "sim-ig-1", { senderId: "igsid-9", text: "Hello", mid: "ig-1" });
    expect(payload.object).toBe("instagram");
    expect(parseMessengerWebhook(payload, "INSTAGRAM")?.[0]).toMatchObject({ kind: "message", pageId: "sim-ig-1", psid: "igsid-9", text: "Hello" });
    expect(parseMessengerWebhook(payload, "MESSENGER")).toBeNull();
  });

  it("builds an image message the real parser classifies as an image", () => {
    const [event] = parseMessengerWebhook(pageImageMessage("MESSENGER", "sim-page-1", { senderId: "psid-9", mid: "m2" })) ?? [];
    expect(event).toMatchObject({ kind: "message", contentKind: "image" });
  });

  it("builds a delivery receipt the real parser reads", () => {
    const events = parseMessengerWebhook(pageDelivery("MESSENGER", "sim-page-1", { senderId: "psid-9", mids: ["sim.messenger.1"], watermarkMs: 9 }));
    expect(events?.[0]).toMatchObject({ kind: "delivery", pageId: "sim-page-1", psid: "psid-9" });
  });
});

describe("signing", () => {
  it("produces a signature the app's own verifier accepts, over the exact bytes", () => {
    const body = JSON.stringify(whatsappTextMessage(NUMBER, { from: "1", text: "hi" }));
    expect(verifyMetaSignature(body, signMetaWebhookBody(body, SECRET), SECRET)).toBe(true);
  });

  it("is rejected for another secret and for a changed body", () => {
    const body = JSON.stringify({ a: 1 });
    const signature = signMetaWebhookBody(body, SECRET);
    expect(verifyMetaSignature(body, signature, "other-secret")).toBe(false);
    expect(verifyMetaSignature(`${body} `, signature, SECRET)).toBe(false);
  });

  it("will not sign without a secret", () => {
    expect(() => signMetaWebhookBody("{}", "")).toThrow(/app secret/);
  });
});

describe("delivery", () => {
  const fakeFetch = (status = 200, text = "ok") => vi.fn<typeof fetch>(async () => new Response(text, { status }));

  it("posts the signed raw body to the channel's webhook route", async () => {
    const fetchImpl = fakeFetch();
    const payload = whatsappTextMessage(NUMBER, { from: "1", text: "hi" });

    const result = await deliverSignedWebhook({ baseUrl: "https://staging.example.test", channel: "WHATSAPP", payload, appSecret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ status: 200, body: "ok" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://staging.example.test/api/webhooks/whatsapp");
    const body = String(init?.body);
    expect(verifyMetaSignature(body, (init?.headers as Record<string, string>)["X-Hub-Signature-256"], SECRET)).toBe(true);
  });

  it.each([
    ["MESSENGER", "/api/webhooks/messenger"],
    ["INSTAGRAM", "/api/webhooks/instagram"],
  ] as const)("routes %s to %s", async (channel, path) => {
    const fetchImpl = fakeFetch();
    await deliverSignedWebhook({ baseUrl: "https://x.test", channel, payload: pageTextMessage(channel, "sim-1", { senderId: "u", text: "t" }), appSecret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).pathname).toBe(path);
  });

  it("can send a forged or unsigned event on purpose", async () => {
    const forged = fakeFetch(401);
    const unsigned = fakeFetch(401);
    const payload = whatsappTextMessage(NUMBER, { from: "1", text: "hi" });

    await deliverSignedWebhook({ baseUrl: "https://x.test", channel: "WHATSAPP", payload, appSecret: SECRET, signatureOverride: "sha256=deadbeef", fetchImpl: forged as unknown as typeof fetch });
    await deliverSignedWebhook({ baseUrl: "https://x.test", channel: "WHATSAPP", payload, appSecret: SECRET, signatureOverride: null, fetchImpl: unsigned as unknown as typeof fetch });

    expect((forged.mock.calls[0][1]?.headers as Record<string, string>)["X-Hub-Signature-256"]).toBe("sha256=deadbeef");
    expect((unsigned.mock.calls[0][1]?.headers as Record<string, string>)["X-Hub-Signature-256"]).toBeUndefined();
  });

  it("redelivers the identical bytes for a duplicate", async () => {
    const fetchImpl = fakeFetch();
    const payload = whatsappTextMessage(NUMBER, { from: "1", text: "hi", messageId: "wamid.DUP" });

    await deliverDuplicateWebhook({ baseUrl: "https://x.test", channel: "WHATSAPP", payload, appSecret: SECRET, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toBe(String(fetchImpl.mock.calls[1][1]?.body));
  });

  it("asks for the subscription handshake with the token and a challenge", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("the-challenge", { status: 200 }));

    const result = await requestWebhookHandshake({ baseUrl: "https://x.test", channel: "MESSENGER", verifyToken: "tok", challenge: "the-challenge", fetchImpl: fetchImpl as unknown as typeof fetch });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/webhooks/messenger");
    expect(url.searchParams.get("hub.mode")).toBe("subscribe");
    expect(url.searchParams.get("hub.verify_token")).toBe("tok");
    expect(url.searchParams.get("hub.challenge")).toBe("the-challenge");
    expect(result).toMatchObject({ status: 200, body: "the-challenge", challenge: "the-challenge" });
  });
});
