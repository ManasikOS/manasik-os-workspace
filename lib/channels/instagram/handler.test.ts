import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined, NextResponse: class {} }));
vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: async () => ({ processed: 0, failed: 0 }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { ChannelConnectionRecord } from "@/lib/data/channel-connection-repository";
import type { ParsedMessengerEvent } from "@/lib/channels/messenger/webhook";

const { processMessengerEvents } = await import("@/lib/channels/messenger/webhook-handler");
const { reconcileEcho, INSTAGRAM_INBOX_LABEL } = await import("@/lib/channels/messenger/echo");
const { profileDisplayName, needsProfileName, fetchMessengerProfileName, INSTAGRAM_NAME_PLACEHOLDER } = await import("@/lib/channels/messenger/profile");

const connection: ChannelConnectionRecord = {
  id: "cc-ig",
  agency_id: "agency-1",
  provider: "INSTAGRAM",
  provider_account_id: "ig-1784",
  display_name: "@royal",
  status: "CONNECTED",
  credential_ref: "ref",
  ai_enabled: true,
  credential_expires_at: null,
};

const db = {} as never;
const NOW = new Date("2026-09-19T10:00:00.000Z");

function harness(name: string | null = null) {
  return {
    ingest: vi.fn(async () => ({ status: "stored" as const, conversation: {} as never, message: {} as never, jobId: "job-1" })),
    messageExists: vi.fn(async () => false),
    getContactName: vi.fn(async () => name),
    enqueueJob: vi.fn(async () => "echo-job"),
    patchDelivery: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
  };
}

const run = (events: ParsedMessengerEvent[], deps: ReturnType<typeof harness>) =>
  processMessengerEvents(db, connection, events, { agentAllowed: true, ownAppId: "555", now: () => NOW, channel: "INSTAGRAM" }, deps as never);

const message = (over = {}): ParsedMessengerEvent => ({
  kind: "message",
  viaPostback: false,
  pageId: "ig-1784",
  psid: "igsid-1",
  mid: "ig-m1",
  text: "Umrah in March?",
  contentKind: "text",
  attachments: [],
  timestampMs: 1,
  ...over,
});

describe("the Page-channel handler serving Instagram", () => {
  it("stores the message as an INSTAGRAM conversation, scoped to this connection, with no phone and the Instagram placeholder name", async () => {
    const deps = harness();
    const result = await run([message()], deps);
    expect(deps.ingest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        provider: "INSTAGRAM",
        connectionId: "cc-ig",
        externalConversationId: "igsid-1",
        contactName: INSTAGRAM_NAME_PLACEHOLDER,
        normalizedPhone: null,
        externalMessageId: "ig-m1",
      }),
    );
    expect(deps.getContactName).toHaveBeenCalledWith(db, "agency-1", "INSTAGRAM", "igsid-1");
    expect(result.jobIds).toEqual(["job-1"]);
    expect(result.profilePsids).toEqual(["igsid-1"]);
  });

  it("drops an event for a different Instagram account than the connection's", async () => {
    const deps = harness();
    await run([message({ pageId: "someone-elses-ig" })], deps);
    expect(deps.ingest).not.toHaveBeenCalled();
  });

  it("defers an unrecognised echo as an INSTAGRAM job, so the reconcile step records it against the right channel", async () => {
    const deps = harness("Fatima");
    await run([{ kind: "echo", pageId: "ig-1784", psid: "igsid-1", mid: "ig-e1", text: "Hi", contentKind: "text", attachments: [], timestampMs: 1, appId: null }], deps);
    expect(deps.enqueueJob).toHaveBeenCalledWith(db, expect.objectContaining({ kind: "RECONCILE_ECHO", payload: expect.objectContaining({ channel: "INSTAGRAM", psid: "igsid-1", mid: "ig-e1" }) }));
  });

  it("marks outbound messages read on the INSTAGRAM conversation", async () => {
    const deps = harness();
    await run([{ kind: "read", pageId: "ig-1784", psid: "igsid-1", watermarkMs: 99 }], deps);
    expect(deps.markRead).toHaveBeenCalledWith(db, { agencyId: "agency-1", channel: "INSTAGRAM", externalConversationId: "igsid-1", upToMs: 99 });
  });
});

describe("reconcileEcho on Instagram", () => {
  it("records a colleague's reply as staff on the Instagram conversation and hands it to a person", async () => {
    const markHandled = vi.fn(async () => ({ id: "conv-1" }) as never);
    const insertMessage = vi.fn(async () => ({}) as never);
    const result = await reconcileEcho(
      db,
      "agency-1",
      { channel: "INSTAGRAM", connectionId: "cc-ig", pageId: "ig-1784", psid: "igsid-1", mid: "ig-e1", text: "We can help", messageType: "TEXT", contactName: "Fatima" },
      { messageExists: vi.fn(async () => false), markHandled, insertMessage } as never,
    );
    expect(result).toBe("RECORDED_AS_PERSON");
    expect(markHandled).toHaveBeenCalledWith(db, expect.objectContaining({ channel: "INSTAGRAM", waId: "igsid-1", connectionId: "cc-ig" }));
    expect(insertMessage).toHaveBeenCalledWith(db, expect.objectContaining({ actorName: INSTAGRAM_INBOX_LABEL, metadata: { source: "instagram_inbox" } }));
  });

  it("treats a job queued before Instagram existed (no channel) as Messenger", async () => {
    const markHandled = vi.fn(async () => ({ id: "conv-1" }) as never);
    await reconcileEcho(
      db,
      "agency-1",
      { connectionId: "cc-ms", pageId: "page-1", psid: "psid-1", mid: "e1", text: "Hi", messageType: "TEXT", contactName: "Fatima" },
      { messageExists: vi.fn(async () => false), markHandled, insertMessage: vi.fn(async () => ({}) as never) } as never,
    );
    expect(markHandled).toHaveBeenCalledWith(db, expect.objectContaining({ channel: "MESSENGER" }));
  });
});

describe("Instagram customer names", () => {
  it("falls back to the @handle when the profile has no display name", () => {
    expect(profileDisplayName({ name: "Fatima Rizwan", username: "fatima" })).toBe("Fatima Rizwan");
    expect(profileDisplayName({ username: "fatima" })).toBe("@fatima");
    expect(profileDisplayName({ username: "  " })).toBeNull();
  });

  it("treats both placeholders as needing a lookup", () => {
    expect(needsProfileName(INSTAGRAM_NAME_PLACEHOLDER)).toBe(true);
    expect(needsProfileName("Messenger customer")).toBe(true);
    expect(needsProfileName("Fatima")).toBe(false);
  });

  it("asks Instagram for name and username, where Messenger asks for first and last name", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ name: "Fatima Rizwan", username: "fatima" }), { status: 200 }));
    await expect(fetchMessengerProfileName("tok", "igsid-1", "INSTAGRAM")).resolves.toBe("Fatima Rizwan");
    // The Page inbox is asked first; the direct lookup (name and username) follows when the inbox has no name.
    expect(fetchSpy.mock.calls.map((call) => String(call[0])).some((url) => url.includes("fields=name,username"))).toBe(true);
    fetchSpy.mockRestore();
  });
});
