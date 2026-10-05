import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-7 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the WhatsApp webhook answers every request with a bad signature 401, but stores
 * only a limited number of "rejected" stubs a minute, so a flood cannot grow whatsapp_webhook_events.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: vi.fn() }));
vi.mock("@/lib/inbox/intelligence/register-handlers", () => ({}));
vi.mock("@/lib/inbox/jobs/drain", () => ({ drainRealtimeLaneAfterWebhook: vi.fn() }));
vi.mock("@/lib/inbox/worker/mode", () => ({ isInboxWorkerActive: () => false }));
vi.mock("@/lib/data/whatsapp-connection-repository", () => ({ markWebhookVerified: vi.fn(), recordConnectionEvent: vi.fn() }));
vi.mock("@/lib/data/whatsapp-billing-repository", () => ({ findMessageAttribution: vi.fn(), upsertMessageCharge: vi.fn(), upsertVolumeTierIfEarlier: vi.fn(), syncTemplateStatus: vi.fn() }));
vi.mock("@/lib/inbox/delivery/delivery-updates", () => ({ recordMessageDelivery: vi.fn() }));
vi.mock("@/lib/whatsapp/inbound-ingest", () => ({
  extractMessageText: vi.fn(),
  extractMessageType: vi.fn(),
  ingestWhatsAppInboundMessages: vi.fn(),
  isReactionMessage: vi.fn(),
  storableInboundMessageIds: vi.fn(() => []),
}));
vi.mock("@/lib/inbox/media/unsupported-notice", () => ({ isUnsupportedWhatsAppMessage: vi.fn(), sendWhatsAppUnsupportedNotice: vi.fn() }));

let storedStubs = 0;
const recorded: Array<{ agencyId: string | null; signatureValid: boolean; payload: unknown }> = [];
vi.mock("@/lib/data/whatsapp-repository", () => ({
  insertMessage: vi.fn(),
  markConversationHandledFromBusinessApp: vi.fn(),
  resolveAgencyForPhoneNumberId: vi.fn(async () => null),
  recordWebhookEvent: vi.fn(async (_db: unknown, input: { agencyId: string | null; signatureValid: boolean; payload: unknown }) => {
    recorded.push(input);
    if (!input.signatureValid) storedStubs += 1;
    return true;
  }),
}));

vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => resolve({ count: storedStubs, error: null });
      return query;
    },
  }),
}));

const { handleWebhookDelivery } = await import("./webhook-handler");
const { resetUnsignedEventThrottle, UNSIGNED_EVENT_STUBS_PER_MINUTE } = await import("@/lib/security/unsigned-event-throttle");

const identity = { verifyToken: "verify", appSecret: "platform-secret" };
const unsigned = (header: string | null = "sha256=0000") =>
  new Request("https://example.test/api/webhooks/whatsapp", { method: "POST", body: JSON.stringify({ entry: [] }), headers: header ? { "x-hub-signature-256": header } : {} }) as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-05T10:00:10.000Z"));
  resetUnsignedEventThrottle();
  storedStubs = 0;
  recorded.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("handleWebhookDelivery — requests with a bad signature", () => {
  it("answers 401 and stores a rejected stub, with no agency and only a size, while there is room", async () => {
    const response = await handleWebhookDelivery(unsigned(), identity);
    expect(response.status).toBe(401);
    expect(recorded).toEqual([{ agencyId: null, externalEventId: expect.any(String), payload: { rejected: "invalid_signature", bytes: expect.any(Number) }, signatureValid: false }]);
  });

  it("SEC-7: a flood of 200 is all answered 401, but only a minute's worth of stubs are stored", async () => {
    const statuses = new Set<number>();
    for (let request = 0; request < 200; request += 1) statuses.add((await handleWebhookDelivery(unsigned(), identity)).status);
    expect([...statuses]).toEqual([401]);
    expect(recorded).toHaveLength(UNSIGNED_EVENT_STUBS_PER_MINUTE);
  });

  it("SEC-7: a missing signature header is throttled the same way", async () => {
    for (let request = 0; request < 100; request += 1) await handleWebhookDelivery(unsigned(null), identity);
    expect(recorded).toHaveLength(UNSIGNED_EVENT_STUBS_PER_MINUTE);
  });

  it("stores stubs again in the next minute, so the diagnostic does not go dark", async () => {
    for (let request = 0; request < 100; request += 1) await handleWebhookDelivery(unsigned(), identity);
    storedStubs = 0;
    vi.setSystemTime(Date.parse("2026-10-05T10:01:10.000Z"));
    await handleWebhookDelivery(unsigned(), identity);
    expect(recorded).toHaveLength(UNSIGNED_EVENT_STUBS_PER_MINUTE + 1);
  });

  it("never throttles a correctly signed request: only the stubs for bad ones are limited", async () => {
    const { createHmac } = await import("node:crypto");
    const body = JSON.stringify({ entry: [] });
    const signed = new Request("https://example.test/api/webhooks/whatsapp", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", identity.appSecret).update(body).digest("hex")}` },
    }) as never;
    storedStubs = UNSIGNED_EVENT_STUBS_PER_MINUTE * 10;
    const response = await handleWebhookDelivery(signed, identity);
    expect(response.status).toBe(200);
    expect(recorded.some((entry) => entry.signatureValid)).toBe(true);
  });
});
