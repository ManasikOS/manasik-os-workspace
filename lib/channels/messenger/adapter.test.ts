import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { messengerChannelAdapter: adapter } = await import("./adapter");
const { getChannelAdapter, hasChannelAdapter } = await import("@/lib/channels/registry");
const { MessengerApiError } = await import("./client");

import type { ResolvedChannelConnection } from "@/lib/channels/adapter";

const connection: ResolvedChannelConnection = {
  provider: "MESSENGER",
  id: "cc-1",
  status: "CONNECTED",
  credentialRef: "ref",
  displayAddress: null,
  fundingStatus: null,
  accountId: "page-1",
};

let counter = 0;
function mockSends() {
  const bodies: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse((init as RequestInit).body as string));
    counter += 1;
    return new Response(JSON.stringify({ message_id: `m.${counter}` }), { status: 200 });
  });
  return bodies;
}

afterEach(() => vi.restoreAllMocks());

describe("messengerChannelAdapter.sendReply", () => {
  it("sends a short reply as one message and reports no parts", async () => {
    const bodies = mockSends();
    const result = await adapter.sendReply(connection, "tok", { to: "psid-1", text: "Salam, how can I help?" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ recipient: { id: "psid-1" }, message: { text: "Salam, how can I help?" } });
    expect(result.partMessageIds).toBeUndefined();
    expect(result.externalMessageId).toMatch(/^m\./);
  });

  it("puts quick replies on the only message", async () => {
    const bodies = mockSends();
    await adapter.sendReply(connection, "tok", { to: "psid-1", text: "Ready?", buttons: [{ id: "action_book_now", title: "Book Now 📅" }] });
    expect((bodies[0].message as { quick_replies: unknown[] }).quick_replies).toHaveLength(1);
  });

  it("splits a reply over Messenger's 2000-character limit, in order, with quick replies only on the last part", async () => {
    const bodies = mockSends();
    const text = Array.from({ length: 90 }, (_, i) => `Paragraph ${i} ${"x".repeat(40)}.`).join("\n\n"); // ~4500 chars
    const result = await adapter.sendReply(connection, "tok", { to: "psid-1", text, buttons: [{ id: "b", title: "Confirm" }] });

    expect(bodies.length).toBeGreaterThan(1);
    bodies.forEach((body, index) => {
      const message = body.message as { text: string; quick_replies?: unknown[] };
      expect(message.text.length).toBeLessThanOrEqual(2000);
      expect(Boolean(message.quick_replies)).toBe(index === bodies.length - 1);
    });
    expect(result.partMessageIds).toHaveLength(bodies.length);
    expect(result.externalMessageId).toBe(result.partMessageIds![bodies.length - 1]);
  });

  it("refuses to send nothing, and without a Page id", async () => {
    mockSends();
    await expect(adapter.sendReply(connection, "tok", { to: "u", text: "   " })).rejects.toThrow("Cannot send an empty Messenger message.");
    await expect(adapter.sendReply({ ...connection, accountId: null }, "tok", { to: "u", text: "hi" })).rejects.toThrow("Messenger connection has no Page id.");
  });

  it("rethrows Meta's error so the drain can classify it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad", code: 190 } }), { status: 400 }));
    const error = await adapter.sendReply(connection, "tok", { to: "u", text: "hi" }).catch((e) => e);
    expect(error).toBeInstanceOf(MessengerApiError);
    expect(adapter.classifyError(error)).toBe("TOKEN_DEAD");
  });
});

describe("messengerChannelAdapter.sendTyping", () => {
  it("marks the message seen, then shows typing, addressed to the customer", async () => {
    const bodies = mockSends();
    await adapter.sendTyping!(connection, "tok", { to: "psid-1", customerMessageId: "m.in" });
    expect(bodies).toEqual([
      { recipient: { id: "psid-1" }, sender_action: "mark_seen" },
      { recipient: { id: "psid-1" }, sender_action: "typing_on" },
    ]);
  });
});

describe("messengerChannelAdapter.reflectSendFailure", () => {
  const fakeDb = () => {
    const updates: Array<Record<string, unknown>> = [];
    const db = { from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: async () => void updates.push(patch) }) }) };
    return { db: db as never, updates };
  };

  it("marks a dead token as needing a reconnect", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db, updates } = fakeDb();
    await adapter.reflectSendFailure(db, connection, "agency-1", "TOKEN_DEAD", new Error("expired"));
    expect(updates[0]).toMatchObject({ status: "ERROR", last_error: "Messenger rejected the stored access token — reconnect the Page." });
  });

  it("leaves the connection alone for failures a reconnect would not fix", async () => {
    const { db, updates } = fakeDb();
    for (const errorClass of ["RATE_LIMITED", "OUTSIDE_SERVICE_WINDOW", "UNFUNDED", "UNKNOWN"] as const) {
      await adapter.reflectSendFailure(db, connection, "agency-1", errorClass, new Error("x"));
    }
    expect(updates).toEqual([]);
  });
});

describe("registry", () => {
  it("sends on Messenger, and Instagram has its own adapter", () => {
    expect(hasChannelAdapter("MESSENGER")).toBe(true);
    expect(getChannelAdapter("MESSENGER")).toBe(adapter);
    expect(hasChannelAdapter("INSTAGRAM")).toBe(true);
    expect(getChannelAdapter("INSTAGRAM")).not.toBe(adapter);
  });

  it("describes Messenger honestly: no funding, no public number to append", () => {
    expect(adapter.decorateReplyText("Hi", [{ id: "action_book_now", title: "x" }], connection)).toBe("Hi");
    expect(adapter.profile.displayName).toBe("Messenger");
    expect(adapter.profile.businessCanStartConversation).toBe(false);
  });
});
