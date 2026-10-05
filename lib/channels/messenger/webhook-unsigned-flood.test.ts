import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-7 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the Messenger and Instagram webhook answers every request with a bad signature 401,
 * but stores only a limited number of "rejected" stubs a minute, so a flood cannot grow channel_webhook_events.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: vi.fn() }));
vi.mock("@/lib/inbox/intelligence/register-handlers", () => ({}));
vi.mock("@/lib/inbox/jobs/drain", () => ({ drainRealtimeLaneAfterWebhook: vi.fn() }));
vi.mock("@/lib/inbox/worker/mode", () => ({ isInboxWorkerActive: () => false }));
vi.mock("@/lib/channels/instagram/login/client", () => ({ fetchInstagramLoginCustomerName: vi.fn() }));
vi.mock("@/lib/channels/instagram/login/oauth", () => ({ isInstagramLoginMetadata: vi.fn() }));
vi.mock("@/lib/channels/messenger/profile", () => ({ applyMessengerProfileName: vi.fn(), fetchMessengerProfileName: vi.fn() }));
vi.mock("@/lib/channels/vault", () => ({ readChannelToken: vi.fn() }));
vi.mock("@/lib/channels/messenger/process-events", () => ({ processMessengerEvents: vi.fn() }));

let storedStubs = 0;
const recorded: Array<{ provider: string; agencyId: string | null; signatureValid: boolean; payload: unknown }> = [];
vi.mock("@/lib/data/channel-connection-repository", () => ({
  isAgencyAssistantEnabled: vi.fn(),
  resolveConnectionByAccountId: vi.fn(),
  touchConnectionInbound: vi.fn(),
  recordChannelWebhookEvent: vi.fn(async (_db: unknown, input: { provider: string; agencyId: string | null; signatureValid: boolean; payload: unknown }) => {
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

const { handleMessengerDelivery } = await import("./webhook-handler");
const { resetUnsignedEventThrottle, UNSIGNED_EVENT_STUBS_PER_MINUTE } = await import("@/lib/security/unsigned-event-throttle");

const unsigned = (header: string | null = "sha256=0000") =>
  new Request("https://example.test/api/webhooks/messenger", { method: "POST", body: JSON.stringify({ object: "page", entry: [] }), headers: header ? { "x-hub-signature-256": header } : {} }) as never;

beforeEach(() => {
  vi.stubEnv("META_APP_SECRET", "platform-secret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-05T10:00:10.000Z"));
  resetUnsignedEventThrottle();
  storedStubs = 0;
  recorded.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("handleMessengerDelivery — requests with a bad signature", () => {
  it("answers 401 and stores a rejected stub, with no agency and only a size, while there is room", async () => {
    const response = await handleMessengerDelivery(unsigned(), "MESSENGER");
    expect(response.status).toBe(401);
    expect(recorded).toEqual([{ provider: "MESSENGER", agencyId: null, connectionId: null, externalEventId: expect.any(String), payload: { rejected: "invalid_signature", bytes: expect.any(Number) }, signatureValid: false }]);
  });

  it("SEC-7: a flood of 200 is all answered 401, but only a minute's worth of stubs are stored", async () => {
    const statuses = new Set<number>();
    for (let request = 0; request < 200; request += 1) {
      // Different bodies so none collapses into another as a byte-identical redelivery.
      const flood = new Request("https://example.test/api/webhooks/messenger", { method: "POST", body: JSON.stringify({ object: "page", n: request }), headers: { "x-hub-signature-256": "sha256=0000" } }) as never;
      statuses.add((await handleMessengerDelivery(flood, "MESSENGER")).status);
    }
    expect([...statuses]).toEqual([401]);
    expect(recorded).toHaveLength(UNSIGNED_EVENT_STUBS_PER_MINUTE);
  });

  it("Instagram traffic shares the same budget as Messenger, since it is the same table", async () => {
    for (let request = 0; request < 100; request += 1) await handleMessengerDelivery(unsigned(), request % 2 === 0 ? "MESSENGER" : "INSTAGRAM");
    expect(recorded).toHaveLength(UNSIGNED_EVENT_STUBS_PER_MINUTE);
  });
});
