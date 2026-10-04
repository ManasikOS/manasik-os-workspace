import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The handler module also imports the job drain and next/server for its I/O shell; only the pure
// per-connection logic is under test here.
vi.mock("next/server", () => ({ after: () => undefined, NextResponse: class {} }));
vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: async () => ({ processed: 0, failed: 0 }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { ChannelConnectionRecord } from "@/lib/data/channel-connection-repository";

import type { ParsedMessengerEvent } from "./webhook";

const { processMessengerEvents } = await import("./webhook-handler");
const { ECHO_RECONCILE_DELAY_MS } = await import("./echo");
const { VOICE_DISABLED_TEXT } = await import("@/lib/inbox/media/voice-note");

const connection: ChannelConnectionRecord = {
  id: "cc-1",
  agency_id: "agency-1",
  provider: "MESSENGER",
  provider_account_id: "page-1",
  display_name: "Royal Al-Fathima",
  status: "CONNECTED",
  credential_ref: "ref",
  ai_enabled: true,
  credential_expires_at: null,
};

const db = {} as never;
const NOW = new Date("2026-09-19T10:00:00.000Z");

function harness(overrides: { exists?: (mid: string) => boolean; name?: string | null; jobId?: string | null } = {}) {
  const deps = {
    ingest: vi.fn(async () => ({
      status: "stored" as const,
      conversation: {} as never,
      message: {} as never,
      jobId: overrides.jobId === undefined ? "job-1" : overrides.jobId,
    })),
    messageExists: vi.fn(async (_db: unknown, _agency: string, mid: string) => overrides.exists?.(mid) ?? false),
    getContactName: vi.fn(async () => (overrides.name === undefined ? null : overrides.name)),
    enqueueJob: vi.fn(async () => "echo-job-1"),
    patchDelivery: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
  };
  return deps;
}

const run = (events: ParsedMessengerEvent[], deps: ReturnType<typeof harness>, options: { agentAllowed?: boolean; ownAppId?: string } = {}) =>
  processMessengerEvents(db, connection, events, { agentAllowed: options.agentAllowed ?? true, ownAppId: options.ownAppId, now: () => NOW }, deps as never);

const message = (over: Partial<Extract<ParsedMessengerEvent, { kind: "message" }>> = {}): ParsedMessengerEvent => ({
  kind: "message",
  viaPostback: false,
  pageId: "page-1",
  psid: "psid-1",
  mid: "m1",
  text: "Umrah in March?",
  contentKind: "text",
  attachments: [],
  timestampMs: 1,
  ...over,
});

const echo = (over: Partial<Extract<ParsedMessengerEvent, { kind: "echo" }>> = {}): ParsedMessengerEvent => ({
  kind: "echo",
  pageId: "page-1",
  psid: "psid-1",
  mid: "e1",
  text: "Hi from the team",
  contentKind: "text",
  attachments: [],
  timestampMs: 1,
  appId: null,
  ...over,
});

describe("processMessengerEvents — customer messages", () => {
  it("stores the message through the shared ingest path, scoped to this connection, with no phone", async () => {
    const deps = harness();
    const result = await run([message()], deps);

    expect(deps.ingest).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      provider: "MESSENGER",
      connectionId: "cc-1",
      agentAllowed: true,
      externalConversationId: "psid-1",
      contactName: "Messenger customer",
      normalizedPhone: null,
      externalMessageId: "m1",
      content: "Umrah in March?",
      messageType: "TEXT",
      metadata: { raw_type: "text", via_postback: false },
      agentJobKind: "PROCESS_INBOUND",
    });
    expect(result.jobIds).toEqual(["job-1"]);
  });

  it("skips a message it already holds without touching the conversation (a replay must not extend the reply window)", async () => {
    const deps = harness({ exists: (mid) => mid === "m1" });
    const result = await run([message()], deps);
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.getContactName).not.toHaveBeenCalled();
    expect(result.jobIds).toEqual([]);
  });

  it("passes the assistant's off switch through, so a disabled connection stores but never queues", async () => {
    const deps = harness({ jobId: null });
    const result = await run([message()], deps, { agentAllowed: false });
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ agentAllowed: false }));
    expect(result.jobIds).toEqual([]);
  });

  it("keeps a real stored name and does not ask Meta for it again", async () => {
    const deps = harness({ name: "Fatima Rizwan" });
    const result = await run([message()], deps);
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ contactName: "Fatima Rizwan" }));
    expect(result.profilePsids).toEqual([]);
  });

  it("asks for a profile name once per customer when the stored name is missing or the placeholder", async () => {
    for (const name of [null, "", "Messenger customer"]) {
      const deps = harness({ name });
      const result = await run([message({ mid: "a" }), message({ mid: "b" })], deps);
      expect(result.profilePsids).toEqual(["psid-1"]);
    }
  });

  it("gives a voice note the not-transcribed text and an audio type, with the attachment kept for a later phase", async () => {
    const deps = harness();
    await run([message({ contentKind: "audio", text: "", attachments: [{ type: "audio", url: "https://cdn/v.mp4" }] })], deps);
    expect(deps.ingest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        content: VOICE_DISABLED_TEXT,
        messageType: "AUDIO",
        metadata: { raw_type: "audio", via_postback: false, attachments: [{ type: "audio", url: "https://cdn/v.mp4" }] },
      }),
    );
  });

  it("stores an image with empty text and an image type (the agent is told a picture arrived)", async () => {
    const deps = harness();
    await run([message({ contentKind: "image", text: "", attachments: [{ type: "image", url: "u" }] })], deps);
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ content: "", messageType: "IMAGE" }));
  });

  it("marks a tapped button as such", async () => {
    const deps = harness();
    await run([message({ viaPostback: true, text: "Get started" })], deps);
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ content: "Get started", metadata: { raw_type: "text", via_postback: true } }));
  });

  it("ignores events addressed to a different Page than the resolved connection", async () => {
    const deps = harness();
    const result = await run([message({ pageId: "someone-elses-page" }), echo({ pageId: "someone-elses-page" })], deps);
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.enqueueJob).not.toHaveBeenCalled();
    expect(result).toEqual({ jobIds: [], enrichQueued: false, echoDeferred: false, profilePsids: [] });
  });
});

describe("processMessengerEvents — echoes (F6)", () => {
  it("ignores an echo from our own app outright", async () => {
    const deps = harness();
    const result = await run([echo({ appId: "555" })], deps, { ownAppId: "555" });
    expect(deps.enqueueJob).not.toHaveBeenCalled();
    expect(result.echoDeferred).toBe(false);
  });

  it("ignores an echo whose message we already hold", async () => {
    const deps = harness({ exists: (mid) => mid === "e1" });
    await run([echo()], deps);
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });

  it("defers an unrecognised echo by the reconcile delay instead of silencing the assistant at once", async () => {
    const deps = harness({ name: "Fatima" });
    const result = await run([echo({ appId: "999" })], deps, { ownAppId: "555" });

    expect(deps.enqueueJob).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      kind: "RECONCILE_ECHO",
      payload: { channel: "MESSENGER", connectionId: "cc-1", pageId: "page-1", psid: "psid-1", mid: "e1", text: "Hi from the team", messageType: "TEXT", contactName: "Fatima" },
      runAfter: new Date(NOW.getTime() + ECHO_RECONCILE_DELAY_MS),
    });
    expect(result.echoDeferred).toBe(true);
  });

  it("defers an echo Meta does not attribute to any app (a person in the Page inbox)", async () => {
    const deps = harness();
    const result = await run([echo({ appId: null })], deps, { ownAppId: "555" });
    expect(result.echoDeferred).toBe(true);
  });

  it("still defers when our own app id is not configured, never assuming an echo is ours", async () => {
    const deps = harness();
    const result = await run([echo({ appId: "555" })], deps, { ownAppId: undefined });
    expect(result.echoDeferred).toBe(true);
  });
});

describe("processMessengerEvents — receipts", () => {
  it("marks each delivered message id as delivered, tolerating one we do not hold", async () => {
    const deps = harness();
    deps.patchDelivery.mockRejectedValueOnce(new Error("no such message"));
    await run([{ kind: "delivery", pageId: "page-1", psid: "psid-1", mids: ["a", "b"], watermarkMs: 5 }], deps);
    expect(deps.patchDelivery).toHaveBeenCalledTimes(2);
    expect(deps.patchDelivery).toHaveBeenCalledWith(db, "a", "agency-1", { deliveryStatus: "DELIVERED" });
    expect(deps.patchDelivery).toHaveBeenCalledWith(db, "b", "agency-1", { deliveryStatus: "DELIVERED" });
  });

  it("marks outbound messages read up to the customer's watermark", async () => {
    const deps = harness();
    await run([{ kind: "read", pageId: "page-1", psid: "psid-1", watermarkMs: 1_700_000_000_000 }], deps);
    expect(deps.markRead).toHaveBeenCalledWith(db, { agencyId: "agency-1", channel: "MESSENGER", externalConversationId: "psid-1", upToMs: 1_700_000_000_000 });
  });

  it("does nothing for a read receipt with no watermark", async () => {
    const deps = harness();
    await run([{ kind: "read", pageId: "page-1", psid: "psid-1", watermarkMs: null }], deps);
    expect(deps.markRead).not.toHaveBeenCalled();
  });
});
