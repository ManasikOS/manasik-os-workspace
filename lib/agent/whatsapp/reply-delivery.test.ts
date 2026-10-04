import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChannelRuntimeAdapter, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { getChannelProfile } from "@/lib/channels/profile";
import type { DeliverReplyDeps } from "./reply-delivery";

const { deliverAgentReply, ReplyNotSentError } = await import("./reply-delivery");

const connection = (overrides: Partial<ResolvedChannelConnection> = {}): ResolvedChannelConnection => ({
  provider: "WHATSAPP",
  id: "int-1",
  status: "CONNECTED",
  credentialRef: "vault-ref",
  displayAddress: "+94112223344",
  fundingStatus: "FUNDED",
  accountId: "phone-1",
  ...overrides,
});

function fakeAdapter(overrides: Partial<ChannelRuntimeAdapter> = {}) {
  const adapter = {
    provider: "WHATSAPP",
    profile: getChannelProfile("WHATSAPP"),
    resolveConnection: vi.fn(async () => connection()),
    resolveConnectionForChannelConnection: vi.fn(),
    readToken: vi.fn(async () => "token"),
    decorateReplyText: vi.fn((text: string) => text),
    sendReply: vi.fn(async () => ({ externalMessageId: "wamid.OUT1" })),
    classifyError: vi.fn(() => "UNKNOWN" as const),
    reflectSendFailure: vi.fn(async () => undefined),
    reflectSendSuccess: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ChannelRuntimeAdapter;
  return adapter;
}

const deps = () => ({
  insertMessage: vi.fn(async () => null),
  touchLastOutbound: vi.fn(async () => undefined),
  authorize: vi.fn<DeliverReplyDeps["authorize"]>(async (_db, input) => ({
    allowed: true,
    simulated: false,
    reasons: [],
    command: { text: input.text },
    automatedAuthorization: { allowed: true, reasons: [], level: "L3", surface: "INBOX_REPLY" },
  })),
  recordDecision: vi.fn(async () => undefined),
});

const base = {
  db: {} as never,
  agencyId: "agency-1",
  conversation: { id: "conv-1", external_conversation_id: "94771234567" },
  reply: "Hello there",
  buttons: [] as { id: string; title: string }[],
};

describe("deliverAgentReply", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("sends plain text to the customer's channel id and records it as an AI message", async () => {
    const adapter = fakeAdapter();
    const d = deps();
    const result = await deliverAgentReply({ ...base, adapter }, d);

    expect(result).toEqual({ status: "SENT", externalMessageId: "wamid.OUT1" });
    expect(adapter.sendReply).toHaveBeenCalledWith(expect.objectContaining({ id: "int-1" }), "token", {
      to: "94771234567",
      text: "Hello there",
      buttons: undefined,
    });
    expect(d.insertMessage).toHaveBeenCalledWith(base.db, {
      agencyId: "agency-1",
      conversationId: "conv-1",
      externalMessageId: "wamid.OUT1",
      role: "assistant",
      actorKind: "AI",
      content: "Hello there",
      messageType: "TEXT",
      metadata: {},
      deliveryStatus: "SENT",
    });
    expect(d.touchLastOutbound).toHaveBeenCalledWith(base.db, "conv-1");
    expect(adapter.reflectSendSuccess).toHaveBeenCalledTimes(1);
  });

  it("refuses before contacting the provider when the autonomy gate is closed", async () => {
    const adapter = fakeAdapter();
    const d = deps();
    d.authorize.mockResolvedValueOnce({
      allowed: false,
      simulated: false,
      reasons: ["L1 requires approval"],
      command: { text: base.reply },
      automatedAuthorization: { allowed: false, reasons: ["L1 requires approval"], level: "L1", surface: "INBOX_REPLY" },
    });
    await expect(deliverAgentReply({ ...base, adapter }, d)).resolves.toEqual({ status: "SKIPPED", reason: "AUTONOMY_REFUSED" });
    expect(adapter.sendReply).not.toHaveBeenCalled();
    expect(d.recordDecision).toHaveBeenCalledWith(base.db, expect.objectContaining({ decision: "REFUSED" }));
  });

  it("sends nothing when the agency is a test agency but the adapter is the real one", async () => {
    const adapter = fakeAdapter();
    const d = deps();
    d.authorize.mockResolvedValueOnce({
      allowed: true,
      simulated: true,
      reasons: [],
      command: { text: base.reply },
      automatedAuthorization: { allowed: true, reasons: [], level: "L3", surface: "INBOX_REPLY" },
    });
    await expect(deliverAgentReply({ ...base, adapter }, d)).rejects.toThrow(/nothing was sent/);
    expect(adapter.sendReply).not.toHaveBeenCalled();
  });

  it("sends through the simulator for a test agency and records the simulated id", async () => {
    const real = fakeAdapter();
    const { simulateChannelAdapter } = await import("@/lib/inbox/simulator/simulated-adapter");
    const adapter = simulateChannelAdapter(real);
    const d = deps();
    d.authorize.mockResolvedValueOnce({
      allowed: true,
      simulated: true,
      reasons: [],
      command: { text: base.reply },
      automatedAuthorization: { allowed: true, reasons: [], level: "L3", surface: "INBOX_REPLY" },
    });
    const result = await deliverAgentReply({ ...base, adapter }, d);
    expect(result).toEqual({ status: "SENT", externalMessageId: expect.stringMatching(/^sim\.whatsapp\./) });
    expect(real.sendReply).not.toHaveBeenCalled();
  });

  it("sends and stores the decorated text, and records buttons as an interactive message", async () => {
    const buttons = [{ id: "action_book_now", title: "Book Now 📅" }];
    const adapter = fakeAdapter({ decorateReplyText: vi.fn(() => "Hello there\n\n📞 Call us: +94112223344") });
    const d = deps();
    await deliverAgentReply({ ...base, adapter, buttons }, d);

    expect(adapter.sendReply).toHaveBeenCalledWith(expect.anything(), "token", {
      to: "94771234567",
      text: "Hello there\n\n📞 Call us: +94112223344",
      buttons,
    });
    expect(d.insertMessage).toHaveBeenCalledWith(
      base.db,
      expect.objectContaining({
        content: "Hello there\n\n📞 Call us: +94112223344",
        messageType: "INTERACTIVE",
        metadata: { interactive_buttons: buttons },
      }),
    );
  });

  it("throws (job retries) when the channel has no connection or credential", async () => {
    const missing = fakeAdapter({ resolveConnection: vi.fn(async () => null) });
    await expect(deliverAgentReply({ ...base, adapter: missing }, deps())).rejects.toThrow(
      "No connected WhatsApp integration for this agency — cannot send the reply.",
    );
    const noCredential = fakeAdapter({ resolveConnection: vi.fn(async () => connection({ credentialRef: null })) });
    await expect(deliverAgentReply({ ...base, adapter: noCredential }, deps())).rejects.toThrow(/No connected WhatsApp integration/);
  });

  it("completes without sending when the connection is known-bad", async () => {
    for (const status of ["ERROR", "UNFUNDED", "RESTRICTED", "DISCONNECTED"]) {
      const adapter = fakeAdapter({ resolveConnection: vi.fn(async () => connection({ status })) });
      const d = deps();
      const result = await deliverAgentReply({ ...base, adapter }, d);
      expect(result).toEqual({ status: "SKIPPED", reason: "CONNECTION_NOT_READY" });
      expect(adapter.sendReply).not.toHaveBeenCalled();
      expect(d.insertMessage).not.toHaveBeenCalled();
    }
  });

  it("throws when the vault has no token", async () => {
    const adapter = fakeAdapter({ readToken: vi.fn(async () => null) });
    await expect(deliverAgentReply({ ...base, adapter }, deps())).rejects.toThrow("Could not read the WhatsApp access token from Vault.");
  });

  it.each(["TOKEN_DEAD", "UNFUNDED"] as const)("reflects %s on the connection and stops without retrying or recording", async (errorClass) => {
    const failure = new Error("boom");
    const adapter = fakeAdapter({
      sendReply: vi.fn(async () => {
        throw failure;
      }),
      classifyError: vi.fn(() => errorClass),
    });
    const d = deps();
    const result = await deliverAgentReply({ ...base, adapter }, d);

    expect(result).toEqual({ status: "SKIPPED", reason: errorClass });
    expect(adapter.reflectSendFailure).toHaveBeenCalledWith(base.db, expect.objectContaining({ id: "int-1" }), "agency-1", errorClass, failure);
    expect(d.insertMessage).not.toHaveBeenCalled();
    expect(adapter.reflectSendSuccess).not.toHaveBeenCalled();
  });

  it("rethrows a rate limit, marked as certainly not sent, so the job's bounded retry applies", async () => {
    const failure = new Error("slow down");
    const adapter = fakeAdapter({
      sendReply: vi.fn(async () => {
        throw failure;
      }),
      classifyError: vi.fn(() => "RATE_LIMITED" as const),
    });
    const thrown = await deliverAgentReply({ ...base, adapter }, deps()).catch((error) => error);
    // Marked so a guarded caller knows the customer did NOT get the message and may retry; the original error is kept as the reason.
    expect(thrown).toBeInstanceOf(ReplyNotSentError);
    expect((thrown as InstanceType<typeof ReplyNotSentError>).reason).toBe(failure);
    expect((thrown as Error).message).toBe("slow down");
    expect(adapter.reflectSendFailure).not.toHaveBeenCalled();
  });

  it.each(["OUTSIDE_SERVICE_WINDOW", "NOT_REGISTERED", "UNKNOWN"] as const)("swallows %s rather than retrying blind, and records nothing", async (errorClass) => {
    const adapter = fakeAdapter({
      sendReply: vi.fn(async () => {
        throw new Error("nope");
      }),
      classifyError: vi.fn(() => errorClass),
    });
    const d = deps();
    const result = await deliverAgentReply({ ...base, adapter }, d);
    expect(result).toEqual({ status: "SKIPPED", reason: "SEND_FAILED" });
    expect(adapter.reflectSendFailure).not.toHaveBeenCalled();
    expect(d.insertMessage).not.toHaveBeenCalled();
  });

  it("names the channel in its errors", async () => {
    const adapter = fakeAdapter({
      profile: getChannelProfile("INSTAGRAM"),
      resolveConnection: vi.fn(async () => null),
    });
    await expect(deliverAgentReply({ ...base, adapter }, deps())).rejects.toThrow("No connected Instagram integration");
  });
});
