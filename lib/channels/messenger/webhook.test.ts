import { describe, expect, it } from "vitest";

import { parseMessengerWebhook, type MessengerMessagingEvent, type MessengerWebhookPayload } from "./webhook";

const PAGE = "page-1";
const PSID = "psid-9";

const wrap = (...groups: MessengerMessagingEvent[][]): MessengerWebhookPayload => ({
  object: "page",
  entry: [{ id: PAGE, time: 1, messaging: groups.flat() }],
});

describe("parseMessengerWebhook", () => {
  it("is null for a delivery that is not for the Messenger page object", () => {
    expect(parseMessengerWebhook({ object: "instagram", entry: [] })).toBeNull();
    expect(parseMessengerWebhook({ object: "whatsapp_business_account" })).toBeNull();
    expect(parseMessengerWebhook({})).toBeNull();
  });

  it("reads a customer text message: sender is the customer, the Page is entry.id", () => {
    const events = parseMessengerWebhook(
      wrap([{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 1_700_000_000_000, message: { mid: "m1", text: "Salam, Umrah in March?" } }]),
    );
    expect(events).toEqual([
      {
        kind: "message",
        viaPostback: false,
        pageId: PAGE,
        psid: PSID,
        mid: "m1",
        text: "Salam, Umrah in March?",
        contentKind: "text",
        attachments: [],
        timestampMs: 1_700_000_000_000,
      },
    ]);
  });

  it("classifies attachment-only messages by their first attachment", () => {
    const kinds = (type: string) =>
      (parseMessengerWebhook(wrap([{ sender: { id: PSID }, message: { mid: "m", attachments: [{ type, payload: { url: "https://cdn/x" } }] } }])) ?? [])[0];
    expect(kinds("image")).toMatchObject({ contentKind: "image", text: "", attachments: [{ type: "image", url: "https://cdn/x" }] });
    expect(kinds("audio")).toMatchObject({ contentKind: "audio" });
    expect(kinds("video")).toMatchObject({ contentKind: "video" });
    expect(kinds("file")).toMatchObject({ contentKind: "file" });
    expect(kinds("location")).toMatchObject({ contentKind: "location" });
    expect(kinds("fallback")).toMatchObject({ contentKind: "other" });
  });

  it("answers text as text even when an attachment came with it", () => {
    const [event] = parseMessengerWebhook(
      wrap([{ sender: { id: PSID }, message: { mid: "m", text: "see photo", attachments: [{ type: "image", payload: { url: "u" } }] } }]),
    )!;
    expect(event).toMatchObject({ contentKind: "text", text: "see photo" });
  });

  it("treats a quick-reply tap as its typed title", () => {
    const [event] = parseMessengerWebhook(wrap([{ sender: { id: PSID }, message: { mid: "m", text: "Book Now", quick_reply: { payload: "book" } } }]))!;
    expect(event).toMatchObject({ kind: "message", text: "Book Now", viaPostback: false });
  });

  it("folds a postback into an ordinary message using its title", () => {
    const [event] = parseMessengerWebhook(wrap([{ sender: { id: PSID }, timestamp: 5, postback: { mid: "pb1", title: "Get started", payload: "START" } }]))!;
    expect(event).toMatchObject({ kind: "message", viaPostback: true, mid: "pb1", text: "Get started", contentKind: "text" });
  });

  it("gives a postback with no mid a stable synthetic id so a redelivery stays idempotent", () => {
    const parse = () => parseMessengerWebhook(wrap([{ sender: { id: PSID }, timestamp: 5, postback: { title: "Hi", payload: "P" } }]))![0];
    const first = parse() as { mid: string };
    expect(first.mid).toBe(`postback:${PAGE}:${PSID}:5:P`);
    expect((parse() as { mid: string }).mid).toBe(first.mid);
  });

  it("reads an echo with the customer from recipient.id, and the sending app when Meta names one", () => {
    const events = parseMessengerWebhook(
      wrap([{ sender: { id: PAGE }, recipient: { id: PSID }, message: { mid: "e1", text: "Reply", is_echo: true, app_id: 123456 } }]),
    )!;
    expect(events).toEqual([
      expect.objectContaining({ kind: "echo", psid: PSID, mid: "e1", text: "Reply", appId: "123456", pageId: PAGE }),
    ]);
  });

  it("has no app id for an echo Meta does not attribute to an app", () => {
    const [event] = parseMessengerWebhook(wrap([{ sender: { id: PAGE }, recipient: { id: PSID }, message: { mid: "e2", text: "hi", is_echo: true } }]))!;
    expect(event).toMatchObject({ kind: "echo", appId: null });
  });

  it("reads delivery receipts by message id and read receipts by watermark", () => {
    const events = parseMessengerWebhook(
      wrap(
        [{ sender: { id: PSID }, delivery: { mids: ["a", "b"], watermark: 10 } }],
        [{ sender: { id: PSID }, read: { watermark: 20 } }],
      ),
    )!;
    expect(events).toEqual([
      { kind: "delivery", pageId: PAGE, psid: PSID, mids: ["a", "b"], watermarkMs: 10 },
      { kind: "read", pageId: PAGE, psid: PSID, watermarkMs: 20 },
    ]);
  });

  it("ignores events with no usable identity or that it does not act on", () => {
    const events = parseMessengerWebhook(
      wrap(
        [{ message: { mid: "no-sender", text: "x" } }],
        [{ sender: { id: PSID }, message: { text: "no mid" } }],
        [{ sender: { id: PAGE }, message: { mid: "echo-no-recipient", is_echo: true } }],
        [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 1 }], // e.g. a reaction/referral — nothing we act on
      ),
    );
    expect(events).toEqual([]);
  });

  it("keeps entries for different Pages separate", () => {
    const events = parseMessengerWebhook({
      object: "page",
      entry: [
        { id: "page-A", messaging: [{ sender: { id: "u1" }, message: { mid: "1", text: "a" } }] },
        { id: "page-B", messaging: [{ sender: { id: "u2" }, message: { mid: "2", text: "b" } }] },
        { messaging: [{ sender: { id: "u3" }, message: { mid: "3", text: "no page id" } }] },
      ],
    })!;
    expect(events.map((e) => [e.kind, e.pageId])).toEqual([
      ["message", "page-A"],
      ["message", "page-B"],
    ]);
  });
});
