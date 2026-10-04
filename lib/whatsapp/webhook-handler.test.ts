import { describe, expect, it, vi } from "vitest";

import type { WhatsAppWebhookPayload } from "@/lib/types/whatsapp";

vi.mock("server-only", () => ({}));

import { storableInboundMessageIds, whatsAppWebhookExternalEventId } from "./webhook-handler";

function whatsappStatusPayload(
  status: string,
  timestamp: string,
): WhatsAppWebhookPayload {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: "wamid.1", status, timestamp }],
            },
          },
        ],
      },
    ],
  };
}

describe("whatsAppWebhookExternalEventId", () => {
  it("keeps delivery transitions for the same message distinct", () => {
    expect(
      whatsAppWebhookExternalEventId(whatsappStatusPayload("sent", "100")),
    ).toBe("wamid.1:sent:100");
    expect(
      whatsAppWebhookExternalEventId(whatsappStatusPayload("read", "101")),
    ).toBe("wamid.1:read:101");
  });
});

describe("storableInboundMessageIds", () => {
  const delivery = (messages: Array<Record<string, unknown>>) =>
    ({ entry: [{ changes: [{ value: { messages } }] }] }) as unknown as WhatsAppWebhookPayload;

  it("lists every message of a batched delivery, not just the first", () => {
    expect(
      storableInboundMessageIds(
        delivery([
          { id: "wamid.1", from: "94771234567", type: "text" },
          { id: "wamid.2", from: "94771234567", type: "text" },
        ]),
      ),
    ).toEqual(["wamid.1", "wamid.2"]);
  });

  it("leaves out unsupported media, which is never stored, so a redelivery does not re-send the notice", () => {
    expect(
      storableInboundMessageIds(
        delivery([
          { id: "wamid.1", from: "94771234567", type: "text" },
          { id: "wamid.2", from: "94771234567", type: "video" },
          { id: "wamid.3", from: "94771234567", type: "sticker" },
        ]),
      ),
    ).toEqual(["wamid.1"]);
  });

  it("leaves out messages the handler skips for lacking a sender or id, and status-only deliveries", () => {
    expect(storableInboundMessageIds(delivery([{ id: "wamid.1", type: "text" }, { from: "94771234567", type: "text" }]))).toEqual([]);
    expect(storableInboundMessageIds(whatsappStatusPayload("sent", "100"))).toEqual([]);
  });
});
