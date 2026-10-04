import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { recordWebhookEvent } from "./whatsapp-repository";

/** A database whose event insert always collides (a redelivery) and whose message lookup returns the given stored ids. */
function whatsappWebhookRetryDb(storedMessageIds: string[]) {
  const messageQuery = {
    select: vi.fn(() => messageQuery),
    eq: vi.fn(() => messageQuery),
    in: vi.fn(async (_column: string, ids: string[]) => ({
      data: ids.filter((id) => storedMessageIds.includes(id)).map((id) => ({ external_message_id: id })),
      error: null,
    })),
  };

  return {
    from: vi.fn((table: string) =>
      table === "whatsapp_webhook_events"
        ? {
            insert: vi.fn(async () => ({ error: { code: "23505" } })),
          }
        : messageQuery,
    ),
    messageQuery,
  };
}

const base = { agencyId: "agency-id", externalEventId: "wamid.1", payload: {}, signatureValid: true };

describe("recordWebhookEvent failed-ingest retry", () => {
  it("retries a duplicate inbound webhook when its message was never stored", async () => {
    const db = whatsappWebhookRetryDb([]);
    await expect(recordWebhookEvent(db as never, { ...base, expectedMessageIds: ["wamid.1"] })).resolves.toBe(true);
  });

  it("keeps a successfully stored inbound webhook idempotent", async () => {
    const db = whatsappWebhookRetryDb(["wamid.1"]);
    await expect(recordWebhookEvent(db as never, { ...base, expectedMessageIds: ["wamid.1"] })).resolves.toBe(false);
  });

  it("retries a batched delivery when only its first message was stored", async () => {
    // Meta batched two messages; the event key is the first id. The first was stored, the second's ingest failed, so
    // Meta redelivers. It must be processed again or the second message is lost for good.
    const db = whatsappWebhookRetryDb(["wamid.1"]);
    await expect(recordWebhookEvent(db as never, { ...base, expectedMessageIds: ["wamid.1", "wamid.2"] })).resolves.toBe(true);
  });

  it("treats a batched delivery as a duplicate only when every message is stored", async () => {
    const db = whatsappWebhookRetryDb(["wamid.1", "wamid.2"]);
    await expect(recordWebhookEvent(db as never, { ...base, expectedMessageIds: ["wamid.1", "wamid.2"] })).resolves.toBe(false);
  });

  it("scopes the stored-message lookup to the agency", async () => {
    const db = whatsappWebhookRetryDb(["wamid.1"]);
    await recordWebhookEvent(db as never, { ...base, expectedMessageIds: ["wamid.1"] });
    expect(db.messageQuery.eq).toHaveBeenCalledWith("agency_id", "agency-id");
  });

  it("is a plain duplicate when the delivery carries no messages (a status callback)", async () => {
    const db = whatsappWebhookRetryDb([]);
    await expect(recordWebhookEvent(db as never, { ...base })).resolves.toBe(false);
    await expect(recordWebhookEvent(db as never, { ...base, expectedMessageIds: [] })).resolves.toBe(false);
  });

  it("never reprocesses a delivery whose agency is unresolved", async () => {
    const db = whatsappWebhookRetryDb([]);
    await expect(recordWebhookEvent(db as never, { ...base, agencyId: null, expectedMessageIds: ["wamid.1"] })).resolves.toBe(false);
  });
});
