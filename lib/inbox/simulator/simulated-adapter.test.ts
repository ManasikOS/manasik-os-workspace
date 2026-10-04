import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChannelRuntimeAdapter, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { SIMULATED_TOKEN, SimulatedProviderError, simulateChannelAdapter, simulatedFailureFor } from "./simulated-adapter";

const connection = { provider: "WHATSAPP", id: "i", status: "CONNECTED", credentialRef: "ref", displayAddress: null, fundingStatus: null, accountId: "acct" } as ResolvedChannelConnection;

function realAdapter() {
  const sendReply = vi.fn(async () => ({ externalMessageId: "wamid.REAL" }));
  const sendMedia = vi.fn(async () => ({ externalMessageId: "wamid.REAL" }));
  const sendTyping = vi.fn(async () => undefined);
  const fetchAudio = vi.fn(async () => ({ bytes: new ArrayBuffer(1), mimeType: "audio/ogg" }));
  const fetchAttachment = vi.fn(async () => ({ bytes: new ArrayBuffer(1), mimeType: "application/pdf" }));
  const readToken = vi.fn(async () => "real-token");
  const adapter = {
    provider: "WHATSAPP",
    profile: { displayName: "WhatsApp" },
    resolveConnection: async () => connection,
    resolveConnectionForChannelConnection: async () => connection,
    readToken,
    decorateReplyText: (text: string) => text,
    sendReply,
    sendMedia,
    sendTyping,
    fetchAudio,
    fetchAttachment,
    classifyError: () => "UNKNOWN" as const,
    reflectSendFailure: async () => undefined,
    reflectSendSuccess: async () => undefined,
  } as unknown as ChannelRuntimeAdapter;
  return { adapter, sendReply, sendMedia, sendTyping, fetchAudio, fetchAttachment, readToken };
}

describe("simulatedFailureFor", () => {
  it.each([
    ["sim-fail-token-dead", "TOKEN_DEAD"],
    ["94771234567-sim-fail-rate-limited", "RATE_LIMITED"],
    ["sim-fail-unfunded", "UNFUNDED"],
    ["sim-fail-outside-window", "OUTSIDE_SERVICE_WINDOW"],
    ["sim-fail-not-registered", "NOT_REGISTERED"],
    ["sim-fail-unknown", "UNKNOWN"],
    ["sim-fail-something-new", "UNKNOWN"],
  ])("%s asks for %s", (recipient, expected) => {
    expect(simulatedFailureFor(recipient)).toBe(expected);
  });

  it("asks for nothing on an ordinary recipient", () => {
    expect(simulatedFailureFor("94771234567")).toBeNull();
    expect(simulatedFailureFor("1234567890123456")).toBeNull();
  });
});

describe("simulateChannelAdapter", () => {
  it("is marked simulated, the real adapter is not, and wrapping twice changes nothing", () => {
    const { adapter } = realAdapter();
    const simulated = simulateChannelAdapter(adapter);
    expect(adapter.simulated).toBeUndefined();
    expect(simulated.simulated).toBe(true);
    expect(simulateChannelAdapter(simulated)).toBe(simulated);
  });

  it("answers a send from memory with a simulated id and never calls the real send", async () => {
    const { adapter, sendReply, sendMedia } = realAdapter();
    const simulated = simulateChannelAdapter(adapter);

    const reply = await simulated.sendReply(connection, SIMULATED_TOKEN, { to: "94771234567", text: "Hello" });
    const media = await simulated.sendMedia!(connection, SIMULATED_TOKEN, { to: "94771234567", kind: "image", url: "https://example.test/a.png", filename: "a.png" });

    expect(reply.externalMessageId).toMatch(/^sim\.whatsapp\.[0-9a-f-]{36}$/);
    expect(media.externalMessageId).toMatch(/^sim\.whatsapp\./);
    expect(sendReply).not.toHaveBeenCalled();
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("gives every send a different id", async () => {
    const simulated = simulateChannelAdapter(realAdapter().adapter);
    const first = await simulated.sendReply(connection, SIMULATED_TOKEN, { to: "1", text: "a" });
    const second = await simulated.sendReply(connection, SIMULATED_TOKEN, { to: "1", text: "a" });
    expect(first.externalMessageId).not.toBe(second.externalMessageId);
  });

  it("never reads a secret: the token is the simulated one", async () => {
    const { adapter, readToken } = realAdapter();
    expect(await simulateChannelAdapter(adapter).readToken({} as never, connection)).toBe(SIMULATED_TOKEN);
    expect(readToken).not.toHaveBeenCalled();
  });

  it("fails a send on request and classifies the failure as the class that was asked for", async () => {
    const simulated = simulateChannelAdapter(realAdapter().adapter);
    const failure = await simulated.sendReply(connection, SIMULATED_TOKEN, { to: "sim-fail-rate-limited", text: "Hello" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SimulatedProviderError);
    expect(simulated.classifyError(failure)).toBe("RATE_LIMITED");
  });

  it("leaves the classification of any other error to the real adapter", () => {
    const base = realAdapter().adapter;
    const simulated = simulateChannelAdapter({ ...base, classifyError: () => "TOKEN_DEAD" } as ChannelRuntimeAdapter);
    expect(simulated.classifyError(new Error("something else"))).toBe("TOKEN_DEAD");
  });

  it("makes no network call for typing indicators or downloads", async () => {
    const { adapter, sendTyping, fetchAudio, fetchAttachment } = realAdapter();
    const simulated = simulateChannelAdapter(adapter);

    await simulated.sendTyping!(connection, SIMULATED_TOKEN, { to: "1", customerMessageId: "m" });
    const download = await simulated.fetchAttachment!(connection, SIMULATED_TOKEN, "media-1");
    await expect(simulated.fetchAudio!(connection, SIMULATED_TOKEN, "audio-1")).rejects.toBeInstanceOf(SimulatedProviderError);

    expect(download.mimeType).toBe("image/png");
    expect(download.bytes.byteLength).toBeGreaterThan(0);
    expect(sendTyping).not.toHaveBeenCalled();
    expect(fetchAttachment).not.toHaveBeenCalled();
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it("does not invent a capability the real channel lacks", () => {
    const { adapter } = realAdapter();
    const withoutMedia = { ...adapter } as { sendMedia?: unknown; sendTyping?: unknown };
    delete withoutMedia.sendMedia;
    delete withoutMedia.sendTyping;
    const simulated = simulateChannelAdapter(withoutMedia as ChannelRuntimeAdapter);
    expect(simulated.sendMedia).toBeUndefined();
    expect(simulated.sendTyping).toBeUndefined();
  });
});
