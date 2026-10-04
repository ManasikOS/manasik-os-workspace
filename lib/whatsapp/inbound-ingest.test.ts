import { describe, expect, it } from "vitest";

import { extractMessageText, extractMessageType, ingestWhatsAppInboundMessages, isReactionMessage, storableInboundMessageIds } from "./inbound-ingest";
import type { WhatsAppWebhookPayload } from "@/lib/types/whatsapp";

type InboundWebhookMessage = NonNullable<NonNullable<NonNullable<WhatsAppWebhookPayload["entry"]>[number]["changes"]>[number]["value"]>["messages"] extends Array<infer M> | undefined ? M : never;

function payloadWith(message: InboundWebhookMessage): WhatsAppWebhookPayload {
  return { entry: [{ changes: [{ value: { messages: [message] } }] }] };
}

describe("storableInboundMessageIds", () => {
  it.each(["contacts", "location", "order", "interactive", "button", "unknown"])("does not replay a refused %s message as missing", (type) => {
    expect(storableInboundMessageIds(payloadWith({ id: "unsupported-1", from: "15550001111", type }))).toEqual([]);
  });

  it("refuses a burst once per sender without storing messages or queuing AI work", async () => {
    const payload: WhatsAppWebhookPayload = { entry: [{ changes: [{ value: { messages: [
      { id: "contact-1", from: "15550001111", type: "contacts" },
      { id: "location-1", from: "15550001111", type: "location" },
      { id: "unknown-1", from: "15550002222", type: "future_media_type" },
      { id: "reaction-1", from: "15550003333", type: "reaction" },
    ] } }] }] };
    // No database methods: any attempted persistence or model work fails this test.
    expect(await ingestWhatsAppInboundMessages({} as never, "agency-1", payload)).toEqual({
      enqueuedJobIds: [], enrichQueued: false,
      unsupportedNoticeRecipients: ["15550001111", "15550002222"],
    });
  });

  it("does not store a tapped emoji reaction as a message of its own", () => {
    const payload = payloadWith({ id: "wamid.reaction1", from: "15550001111", type: "reaction", reaction: { message_id: "wamid.original", emoji: "👍" } });
    expect(storableInboundMessageIds(payload)).toEqual([]);
  });

  it("still stores an ordinary text message", () => {
    const payload = payloadWith({ id: "wamid.text1", from: "15550001111", type: "text", text: { body: "Hi" } });
    expect(storableInboundMessageIds(payload)).toEqual(["wamid.text1"]);
  });
});

describe("extractMessageText / extractMessageType on a reaction (defensive, in case one ever reaches them)", () => {
  it("never resolves to a non-empty TEXT message that could pass for a real one", () => {
    const reaction = { type: "reaction", reaction: { message_id: "wamid.original", emoji: "👍" } };
    expect(extractMessageText(reaction)).toBe("");
    expect(extractMessageType(reaction)).toBe("TEXT");
  });
});

describe("isReactionMessage", () => {
  it("recognises a reaction on either an inbound message or a message_echoes entry (same shape)", () => {
    expect(isReactionMessage({ type: "reaction" })).toBe(true);
    expect(isReactionMessage({ type: "text" })).toBe(false);
    expect(isReactionMessage({})).toBe(false);
  });
});
