import { describe, expect, it } from "vitest";

import { parseMessengerWebhook, type MessengerMessagingEvent, type MessengerWebhookPayload } from "@/lib/channels/messenger/webhook";

const IG_ACCOUNT = "ig-1784";
const IGSID = "igsid-9";

const wrap = (...events: MessengerMessagingEvent[]): MessengerWebhookPayload => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: 1, messaging: events }],
});

const parse = (payload: MessengerWebhookPayload) => parseMessengerWebhook(payload, "INSTAGRAM");

describe("parseMessengerWebhook for Instagram", () => {
  it("only accepts the instagram object, and Messenger only accepts the page object", () => {
    expect(parseMessengerWebhook({ object: "page", entry: [] }, "INSTAGRAM")).toBeNull();
    expect(parseMessengerWebhook({ object: "instagram", entry: [] }, "MESSENGER")).toBeNull();
    expect(parseMessengerWebhook({ object: "instagram", entry: [] }, "INSTAGRAM")).toEqual([]);
  });

  it("reads a customer message: the sender is the IGSID and the account is entry.id", () => {
    expect(parse(wrap({ sender: { id: IGSID }, recipient: { id: IG_ACCOUNT }, timestamp: 5, message: { mid: "ig-m1", text: "Umrah in March?" } }))).toEqual([
      { kind: "message", viaPostback: false, pageId: IG_ACCOUNT, psid: IGSID, mid: "ig-m1", text: "Umrah in March?", contentKind: "text", attachments: [], timestampMs: 5 },
    ]);
  });

  it("reads an echo of a message the account sent: the customer is the recipient", () => {
    const [event] = parse(wrap({ sender: { id: IG_ACCOUNT }, recipient: { id: IGSID }, message: { mid: "ig-e1", text: "Sent from the app", is_echo: true } })) ?? [];
    expect(event).toMatchObject({ kind: "echo", pageId: IG_ACCOUNT, psid: IGSID, mid: "ig-e1", appId: null });
  });

  it("ignores a message the customer unsent — there is nothing left to answer", () => {
    expect(parse(wrap({ sender: { id: IGSID }, message: { mid: "ig-m2", is_deleted: true } }))).toEqual([]);
  });

  it("ignores the account messaging itself", () => {
    expect(parse(wrap({ sender: { id: IG_ACCOUNT }, recipient: { id: IG_ACCOUNT }, message: { mid: "ig-m3", text: "note to self", is_self: true } }))).toEqual([]);
  });

  it("treats a shared post or reel as a document-type message with no text, never as typed text", () => {
    const [event] = parse(wrap({ sender: { id: IGSID }, message: { mid: "ig-m4", attachments: [{ type: "ig_reel", payload: { url: "https://cdn/r" } }] } })) ?? [];
    expect(event).toMatchObject({ kind: "message", contentKind: "other", text: "" });
  });

  it("uses the read event's own timestamp as the watermark, because Instagram names a message rather than a time", () => {
    expect(parse(wrap({ sender: { id: IGSID }, recipient: { id: IG_ACCOUNT }, timestamp: 1_700_000_005_000, read: { mid: "ig-m1" } }))).toEqual([
      { kind: "read", pageId: IG_ACCOUNT, psid: IGSID, watermarkMs: 1_700_000_005_000 },
    ]);
  });

  it("prefers Messenger's explicit read watermark when there is one", () => {
    const events = parseMessengerWebhook(
      { object: "page", entry: [{ id: "page-1", messaging: [{ sender: { id: "p" }, timestamp: 9, read: { watermark: 4 } }] }] },
      "MESSENGER",
    );
    expect(events).toEqual([{ kind: "read", pageId: "page-1", psid: "p", watermarkMs: 4 }]);
  });
});
