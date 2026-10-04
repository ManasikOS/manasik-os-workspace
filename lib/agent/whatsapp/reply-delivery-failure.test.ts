import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChannelRuntimeAdapter, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { getChannelProfile } from "@/lib/channels/profile";
import type { DeliverReplyDeps } from "./reply-delivery";

const { deliverAgentReply } = await import("./reply-delivery");
const { MetaGraphError } = await import("@/lib/meta/graph");

const APP_NOT_LIVE = "Cannot message users who are not admins, developers or testers of the app until pages_messaging permission is reviewed and the app is live.";

function adapterFor(provider: "MESSENGER" | "INSTAGRAM" | "WHATSAPP", failure: unknown) {
  const connection: ResolvedChannelConnection = { provider, id: "c", status: "CONNECTED", credentialRef: "r", displayAddress: null, fundingStatus: null, accountId: "acct" };
  return {
    provider,
    profile: getChannelProfile(provider),
    resolveConnection: vi.fn(async () => connection),
    readToken: vi.fn(async () => "tok"),
    decorateReplyText: vi.fn((text: string) => text),
    sendReply: vi.fn(async () => {
      throw failure;
    }),
    classifyError: vi.fn(() => "UNKNOWN" as const),
    reflectSendFailure: vi.fn(async () => undefined),
    reflectSendSuccess: vi.fn(async () => undefined),
  } as unknown as ChannelRuntimeAdapter;
}

const input = (adapter: ChannelRuntimeAdapter) => ({
  db: {} as never,
  adapter,
  agencyId: "agency-1",
  conversation: { id: "conv-1", external_conversation_id: "psid-1" },
  reply: "Hello!",
  buttons: [],
});

const deps = () => ({
  insertMessage: vi.fn(async () => null),
  touchLastOutbound: vi.fn(async () => undefined),
  authorize: vi.fn<DeliverReplyDeps["authorize"]>(async (_db, request) => ({
    allowed: true,
    simulated: false,
    reasons: [],
    command: { text: request.text },
    automatedAuthorization: { allowed: true, reasons: [], level: "L3" as const, surface: "INBOX_REPLY" as const },
  })),
  recordDecision: vi.fn(async () => undefined),
});

describe("a reply that cannot be delivered on Messenger or Instagram", () => {
  it("leaves a system note in the conversation saying why, in words a person can act on", async () => {
    const d = deps();
    const failure = new MetaGraphError("Messenger Graph API 400", 400, { error: { message: APP_NOT_LIVE, code: 10 } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await deliverAgentReply(input(adapterFor("MESSENGER", failure)), d);

    expect(result).toEqual({ status: "SKIPPED", reason: "SEND_FAILED" });
    expect(d.insertMessage).toHaveBeenCalledTimes(1);
    expect(d.insertMessage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        agencyId: "agency-1",
        conversationId: "conv-1",
        role: "system",
        actorKind: "SYSTEM",
        messageType: "SYSTEM",
        metadata: { source: "send_failed", error_class: "UNKNOWN" },
        content: expect.stringContaining("could not be delivered on Messenger"),
      }),
    );
    const content = (d.insertMessage.mock.calls[0] as unknown as [unknown, { content: string }])[1].content;
    expect(content).toContain("App roles → Testers");
  });

  it("does the same on Instagram, naming Instagram", async () => {
    const d = deps();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await deliverAgentReply(input(adapterFor("INSTAGRAM", new Error("boom"))), d);
    const content = (d.insertMessage.mock.calls[0] as unknown as [unknown, { content: string }])[1].content;
    expect(content).toContain("could not be delivered on Instagram");
  });

  it("does not add anything for WhatsApp — its behaviour is unchanged", async () => {
    const d = deps();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deliverAgentReply(input(adapterFor("WHATSAPP", new Error("boom"))), d)).resolves.toEqual({ status: "SKIPPED", reason: "SEND_FAILED" });
    expect(d.insertMessage).not.toHaveBeenCalled();
  });

  it("does not let a failure to write the note fail the job", async () => {
    const d = { ...deps(), insertMessage: vi.fn(async () => Promise.reject(new Error("db down"))) };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deliverAgentReply(input(adapterFor("MESSENGER", new Error("boom"))), d as never)).resolves.toEqual({ status: "SKIPPED", reason: "SEND_FAILED" });
  });

  it("never puts the token or the raw error text in the note", async () => {
    const d = deps();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await deliverAgentReply(input(adapterFor("MESSENGER", new Error("token EAAB-secret leaked"))), d);
    const content = (d.insertMessage.mock.calls[0] as unknown as [unknown, { content: string }])[1].content;
    expect(content).not.toContain("EAAB-secret");
  });
});
