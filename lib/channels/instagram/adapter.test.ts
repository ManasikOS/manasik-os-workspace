import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { instagramChannelAdapter: adapter } = await import("./adapter");
const { getChannelAdapter, hasChannelAdapter } = await import("@/lib/channels/registry");
const { InstagramApiError, getLinkedInstagramAccount, sendInstagramAction } = await import("./client");
const { MetaGraphError } = await import("@/lib/meta/graph");

import type { ResolvedChannelConnection } from "@/lib/channels/adapter";

const connection: ResolvedChannelConnection = {
  provider: "INSTAGRAM",
  id: "cc-ig",
  status: "CONNECTED",
  credentialRef: "ref",
  displayAddress: null,
  fundingStatus: null,
  accountId: "ig-1784",
};

let counter = 0;
function mockSends() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse((init as RequestInit).body as string) });
    counter += 1;
    return new Response(JSON.stringify({ recipient_id: "igsid-1", message_id: `ig.${counter}` }), { status: 200 });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("instagramChannelAdapter.sendReply", () => {
  it("sends through /me/messages with the customer's IGSID, and without Messenger's messaging_type", async () => {
    const calls = mockSends();
    const result = await adapter.sendReply(connection, "page-token", { to: "igsid-1", text: "Salam, how can I help?" });

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toMatch(/\/me\/messages$/);
    expect(calls[0].body).toEqual({ recipient: { id: "igsid-1" }, message: { text: "Salam, how can I help?" } });
    expect(calls[0].body).not.toHaveProperty("messaging_type");
    expect(result).toEqual({ externalMessageId: expect.stringMatching(/^ig\./) });
  });

  it("does not need the connection's account id to send", async () => {
    const calls = mockSends();
    await expect(adapter.sendReply({ ...connection, accountId: null }, "t", { to: "igsid-1", text: "Hi" })).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("puts quick replies on the only message", async () => {
    const calls = mockSends();
    await adapter.sendReply(connection, "t", { to: "igsid-1", text: "Ready?", buttons: [{ id: "action_book_now", title: "Book Now 📅" }] });
    expect((calls[0].body.message as { quick_replies: unknown[] }).quick_replies).toHaveLength(1);
  });

  it("splits a reply over Instagram's byte limit, in order, counting bytes rather than characters", async () => {
    const calls = mockSends();
    // 400 Sinhala letters are 400 characters but 1200 UTF-8 bytes — over the 1000-byte limit though far under 1000 characters.
    const sinhala = "අ".repeat(400);
    const result = await adapter.sendReply(connection, "t", { to: "igsid-1", text: sinhala, buttons: [{ id: "x", title: "Book" }] });

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(Buffer.byteLength((call.body.message as { text: string }).text, "utf8")).toBeLessThanOrEqual(1000);
    }
    expect(calls.map((call) => (call.body.message as { text: string }).text).join("")).toBe(sinhala);
    // Quick replies ride only on the last part.
    expect(calls.slice(0, -1).every((call) => !("quick_replies" in (call.body.message as object)))).toBe(true);
    expect("quick_replies" in (calls[calls.length - 1].body.message as object)).toBe(true);
    // Every part's id is reported so every part's echo is recognised as ours.
    expect(result.partMessageIds).toHaveLength(calls.length);
    expect(result.externalMessageId).toBe(result.partMessageIds?.[calls.length - 1]);
  });

  it("refuses to send an empty message", async () => {
    mockSends();
    await expect(adapter.sendReply(connection, "t", { to: "igsid-1", text: "   " })).rejects.toThrow("empty Instagram message");
  });
});

describe("instagramChannelAdapter typing and errors", () => {
  it("marks the customer's message seen, then shows typing", async () => {
    const calls = mockSends();
    await adapter.sendTyping?.(connection, "t", { to: "igsid-1", customerMessageId: "m" });
    expect(calls.map((call) => call.body.sender_action)).toEqual(["mark_seen", "typing_on"]);
  });

  it("classifies a dead token, the reply window and rate limits with the shared vocabulary", () => {
    const err = (code: number, subcode?: number, status = 400) => new MetaGraphError("x", status, { error: { code, error_subcode: subcode } });
    expect(adapter.classifyError(err(190))).toBe("TOKEN_DEAD");
    expect(adapter.classifyError(err(10, 2534022))).toBe("OUTSIDE_SERVICE_WINDOW");
    expect(adapter.classifyError(err(4))).toBe("RATE_LIMITED");
    expect(adapter.classifyError(new InstagramApiError("x", 400, { error: { code: 190 } }))).toBe("TOKEN_DEAD");
    expect(adapter.classifyError(new Error("plain"))).toBe("UNKNOWN");
  });

  it("marks a dead token as needing a reconnect, in Instagram's own words", async () => {
    const updates: unknown[] = [];
    const db = { from: () => ({ update: (fields: unknown) => (updates.push(fields), { eq: async () => ({}) }) }) } as never;
    await adapter.reflectSendFailure(db, connection, "agency-1", "TOKEN_DEAD", new Error("expired"));
    expect(updates[0]).toMatchObject({ status: "ERROR", last_error: "Instagram rejected the stored access token — reconnect the Instagram account." });
  });
});

describe("registry and profile", () => {
  it("registers Instagram with its own adapter and the byte-limited profile", () => {
    expect(hasChannelAdapter("INSTAGRAM")).toBe(true);
    expect(getChannelAdapter("INSTAGRAM")).toBe(adapter);
    expect(adapter.profile).toMatchObject({ displayName: "Instagram", maxTextUnit: "bytes", maxTextSize: 1000, identifiesByPhone: false });
  });
});

describe("Instagram Graph helpers", () => {
  it("reads the Instagram account linked to a Page, or null when none is linked", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ instagram_business_account: { id: "ig-1", username: "royal", name: "Royal" }, id: "p" }), { status: 200 }));
    await expect(getLinkedInstagramAccount("page-1", "tok")).resolves.toEqual({ id: "ig-1", username: "royal", name: "Royal" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "page-1" }), { status: 200 }));
    await expect(getLinkedInstagramAccount("page-1", "tok")).resolves.toBeNull();
  });

  it("sends a sender action for the customer", async () => {
    const calls = mockSends();
    await sendInstagramAction("tok", "igsid-1", "typing_on");
    expect(calls[0].body).toEqual({ recipient: { id: "igsid-1" }, sender_action: "typing_on" });
  });
});

describe("instagramChannelAdapter with an Instagram Login connection", () => {
  const loginConnection: ResolvedChannelConnection = { ...connection, accountId: "17841429904911692", connectMethod: "INSTAGRAM_LOGIN" };

  it("sends to graph.instagram.com through the account's own /messages edge, not /me/messages on the Page host", async () => {
    const calls = mockSends();
    await adapter.sendReply(loginConnection, "ig-token", { to: "igsid-1", text: "Salam" });

    const requested = new URL(calls[0].url);
    expect(requested.host).toBe("graph.instagram.com");
    expect(requested.pathname).toMatch(/\/17841429904911692\/messages$/);
    expect(calls[0].body).toEqual({ recipient: { id: "igsid-1" }, message: { text: "Salam" } });
  });

  it("still sends a Facebook-Page connection through /me/messages on graph.facebook.com (regression)", async () => {
    const calls = mockSends();
    await adapter.sendReply({ ...connection, connectMethod: null }, "page-token", { to: "igsid-1", text: "Salam" });

    const requested = new URL(calls[0].url);
    expect(requested.host).toBe("graph.facebook.com");
    expect(requested.pathname).toMatch(/\/me\/messages$/);
  });

  it("refuses to send when the connection has no Instagram account id, rather than posting to the wrong edge", async () => {
    mockSends();
    await expect(adapter.sendReply({ ...loginConnection, accountId: null }, "t", { to: "igsid-1", text: "Hi" })).rejects.toThrow("no Instagram account id");
  });

  it("marks seen and shows typing through the account's own edge", async () => {
    const calls = mockSends();
    await adapter.sendTyping?.(loginConnection, "t", { to: "igsid-1", customerMessageId: "m" });
    expect(calls.map((call) => new URL(call.url).host)).toEqual(["graph.instagram.com", "graph.instagram.com"]);
    expect(calls.map((call) => call.body.sender_action)).toEqual(["mark_seen", "typing_on"]);
  });

  it("splits a long reply by bytes on this path too, quick replies on the last part only", async () => {
    const calls = mockSends();
    const sinhala = "අ".repeat(400);
    await adapter.sendReply(loginConnection, "t", { to: "igsid-1", text: sinhala, buttons: [{ id: "x", title: "Book" }] });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((call) => new URL(call.url).host === "graph.instagram.com")).toBe(true);
    expect("quick_replies" in (calls[calls.length - 1].body.message as object)).toBe(true);
  });
});
