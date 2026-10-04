import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => undefined, NextResponse: class {} }));
vi.mock("@/lib/agent/whatsapp/drain", () => ({ processDueJobs: async () => ({ processed: 0, failed: 0 }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import type { ChannelConnectionRecord } from "@/lib/data/channel-connection-repository";
import type { ParsedMessengerEvent } from "@/lib/channels/messenger/webhook";

const { processMessengerEvents } = await import("@/lib/channels/messenger/webhook-handler");
const { VOICE_DISABLED_TEXT } = await import("@/lib/inbox/media/voice-note");
const { messengerChannelAdapter } = await import("@/lib/channels/messenger/adapter");
const { instagramChannelAdapter } = await import("./adapter");

const VOICE_URL = "https://scontent.cdninstagram.com/v/voice.mp4";

const connection: ChannelConnectionRecord = {
  id: "cc-ig",
  agency_id: "agency-1",
  provider: "INSTAGRAM",
  provider_account_id: "ig-1",
  display_name: "@royal",
  status: "CONNECTED",
  credential_ref: "ref",
  ai_enabled: true,
  credential_expires_at: null,
};
const db = {} as never;

function harness() {
  return {
    ingest: vi.fn(async () => ({ status: "stored" as const, conversation: {} as never, message: {} as never, jobId: "job-1" })),
    messageExists: vi.fn(async () => false),
    getContactName: vi.fn(async () => "Fatima"),
    enqueueJob: vi.fn(async () => "j"),
    patchDelivery: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
  };
}

const voiceMessage = (over: Partial<Extract<ParsedMessengerEvent, { kind: "message" }>> = {}): ParsedMessengerEvent => ({
  kind: "message",
  viaPostback: false,
  pageId: "ig-1",
  psid: "igsid-1",
  mid: "m1",
  text: "",
  contentKind: "audio",
  attachments: [{ type: "audio", url: VOICE_URL }],
  timestampMs: 1,
  ...over,
});

const run = (event: ParsedMessengerEvent, options: { agentAllowed?: boolean } = {}) => {
  const deps = harness();
  return processMessengerEvents(db, connection, [event], { agentAllowed: options.agentAllowed ?? true, channel: "INSTAGRAM" }, deps as never).then(() => deps);
};

describe("voice notes on Messenger and Instagram", () => {
  it("retains the recording for Inbox playback without queuing transcription", async () => {
    const deps = await run(voiceMessage());
    expect(deps.ingest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        content: VOICE_DISABLED_TEXT,
        messageType: "AUDIO",
        agentJobKind: "PROCESS_INBOUND",
        metadata: expect.objectContaining({ raw_type: "audio", attachments: [{ type: "audio", url: VOICE_URL }] }),
      }),
    );
    const metadata = (deps.ingest.mock.calls[0] as unknown as [unknown, { metadata: Record<string, unknown> }])[1].metadata;
    expect(metadata).not.toHaveProperty("media_url");
  });

  it("uses the same non-transcription path when the assistant will not answer", async () => {
    const deps = await run(voiceMessage(), { agentAllowed: false });
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ content: VOICE_DISABLED_TEXT, agentJobKind: "PROCESS_INBOUND" }));
  });

  it("uses the typed-text placeholder when the payload carried no URL", async () => {
    const deps = await run(voiceMessage({ attachments: [{ type: "audio", url: null }] }));
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ content: VOICE_DISABLED_TEXT, agentJobKind: "PROCESS_INBOUND" }));
  });

  it("leaves a typed message untouched", async () => {
    const deps = await run(voiceMessage({ contentKind: "text", text: "Umrah in March?", attachments: [] }));
    expect(deps.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ content: "Umrah in March?", agentJobKind: "PROCESS_INBOUND" }));
  });
});

describe("the Page-channel adapters can fetch audio", () => {
  it("both provide fetchAudio, and refuse a URL that is not on a Meta host", async () => {
    for (const adapter of [messengerChannelAdapter, instagramChannelAdapter]) {
      expect(adapter.fetchAudio).toBeTypeOf("function");
      await expect(
        adapter.fetchAudio!({ provider: adapter.provider, id: "c", status: "CONNECTED", credentialRef: "r", displayAddress: null, fundingStatus: null, accountId: "a" }, "tok", "https://evil.example.com/a.mp4"),
      ).rejects.toMatchObject({ permanent: true });
    }
  });
});
