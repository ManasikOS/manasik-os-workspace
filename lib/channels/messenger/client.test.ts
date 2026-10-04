import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const client = await import("./client");
const { MetaGraphError } = await import("@/lib/meta/graph");

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, error: Record<string, unknown>) => new Response(JSON.stringify({ error }), { status });

afterEach(() => vi.restoreAllMocks());

function lastCall(fetchMock: { mock: { calls: unknown[][] } }) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : null };
}

describe("sending", () => {
  it("posts a RESPONSE text to the Page's messages edge with the Page token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ recipient_id: "psid-1", message_id: "m.abc" }));
    await expect(client.sendMessengerText("page-token", "page-1", "psid-1", "Salam")).resolves.toEqual({ messageId: "m.abc" });

    const { url, init, body } = lastCall(fetchMock);
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/page-1\/messages$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer page-token");
    expect(body).toEqual({ messaging_type: "RESPONSE", recipient: { id: "psid-1" }, message: { text: "Salam" } });
  });

  it("fails loudly if Meta accepts a send but returns no message id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ recipient_id: "psid-1" }));
    await expect(client.sendMessengerText("t", "p", "u", "x")).rejects.toThrow("Messenger send returned no message id");
  });

  it("attaches quick replies with truncated titles and the machine id as payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ message_id: "m.q" }));
    await client.sendMessengerQuickReplies("t", "page-1", "psid-1", "Ready?", [
      { id: "action_book_now", title: "Book Now 📅" },
      { id: "long", title: "A title that is far too long for Meta" },
    ]);
    expect(lastCall(fetchMock).body.message).toEqual({
      text: "Ready?",
      quick_replies: [
        { content_type: "text", title: "Book Now 📅", payload: "action_book_now" },
        { content_type: "text", title: "A title that is far", payload: "long" },
      ],
    });
  });

  it("sends typing/seen as a sender action with no retries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ recipient_id: "psid-1" }));
    await client.sendMessengerAction("t", "page-1", "psid-1", "typing_on");
    expect(lastCall(fetchMock).body).toEqual({ recipient: { id: "psid-1" }, sender_action: "typing_on" });
  });

  it("throws MessengerApiError carrying Meta's error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fail(400, { message: "bad", code: 190 }));
    const error = (await client.sendMessengerText("t", "p", "u", "x").catch((e) => e)) as InstanceType<typeof client.MessengerApiError>;
    expect(error).toBeInstanceOf(client.MessengerApiError);
    expect(error).toBeInstanceOf(MetaGraphError);
    expect(error.body).toEqual({ error: { message: "bad", code: 190 } });
  });
});

describe("classifyMessengerError", () => {
  const err = (status: number, code: number, subcode?: number) =>
    new client.MessengerApiError("x", status, { error: { code, ...(subcode ? { error_subcode: subcode } : {}) } });

  it("maps Meta's codes onto the shared classes", () => {
    expect(client.classifyMessengerError(err(400, 190))).toBe("TOKEN_DEAD");
    expect(client.classifyMessengerError(err(400, 102))).toBe("TOKEN_DEAD");
    expect(client.classifyMessengerError(err(400, 10, 2018278))).toBe("OUTSIDE_SERVICE_WINDOW");
    for (const code of [4, 17, 32, 613]) expect(client.classifyMessengerError(err(400, code))).toBe("RATE_LIMITED");
    expect(client.classifyMessengerError(new client.MessengerApiError("x", 429, null))).toBe("RATE_LIMITED");
  });

  it("does not call an unrelated permission error a window error, and never retries the unknown", () => {
    expect(client.classifyMessengerError(err(400, 10))).toBe("UNKNOWN");
    expect(client.classifyMessengerError(err(400, 100))).toBe("UNKNOWN");
    expect(client.classifyMessengerError(new Error("network"))).toBe("UNKNOWN");
  });
});

describe("subscription", () => {
  it("subscribes to exactly the fields the webhook handles", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ success: true }));
    await client.subscribePageToApp("page-1", "t");
    expect(lastCall(fetchMock).body).toEqual({
      subscribed_fields: ["messages", "messaging_postbacks", "message_deliveries", "message_reads", "message_echoes"],
    });
  });

  it("recognises our app on the Page only when it receives messages", () => {
    const subs = [
      { appId: "other", fields: ["messages"] },
      { appId: "ours", fields: ["message_reads"] },
    ];
    expect(client.isSubscribedToMessages(subs, "ours")).toBe(false);
    expect(client.isSubscribedToMessages([...subs, { appId: "ours", fields: ["messages", "message_echoes"] }], "ours")).toBe(true);
    expect(client.isSubscribedToMessages([], "ours")).toBe(false);
  });

  it("reads the readback into app ids and fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ data: [{ id: "ours", subscribed_fields: ["messages"] }, {}] }));
    await expect(client.listPageSubscriptions("page-1", "t")).resolves.toEqual([
      { appId: "ours", fields: ["messages"] },
      { appId: null, fields: [] },
    ]);
  });
});

describe("page discovery", () => {
  it("takes Page ids from the granular scopes that concern Pages only", () => {
    expect(
      client.pageIdsFromGranularScopes([
        { scope: "pages_messaging", targetIds: ["p1", "p2"] },
        { scope: "pages_show_list", targetIds: ["p2"] },
        { scope: "whatsapp_business_management", targetIds: ["waba"] },
      ]),
    ).toEqual(["p1", "p2"]);
  });

  it("lists Pages from /me/accounts with their tokens", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ data: [{ id: "p1", name: "Royal Al-Fathima", access_token: "tok-1" }, { id: "no-token" }] }));
    await expect(client.listGrantedPages("user", [])).resolves.toEqual([{ id: "p1", name: "Royal Al-Fathima", accessToken: "tok-1" }]);
  });

  it("falls back to reading each granted Page directly when /me/accounts gives nothing (system-user token)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fail(400, { message: "not a user token", code: 100 }))
      .mockResolvedValueOnce(ok({ id: "p9", name: "Kandy Branch", access_token: "tok-9" }));
    await expect(client.listGrantedPages("sys", ["p9"])).resolves.toEqual([{ id: "p9", name: "Kandy Branch", accessToken: "tok-9" }]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/p9?fields=id,name,access_token");
  });

  it("offers only the Pages Meta says were granted, even if /me/accounts lists more", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ data: [{ id: "p1", name: "A", access_token: "t1" }, { id: "p2", name: "B", access_token: "t2" }] }),
    );
    await expect(client.listGrantedPages("user", ["p2"])).resolves.toEqual([{ id: "p2", name: "B", accessToken: "t2" }]);
  });

  it("does not throw when a granted Page cannot be read; it is simply not offered", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fail(403, { message: "no access", code: 200 }));
    await expect(client.listGrantedPages("user", ["p1"])).resolves.toEqual([]);
  });
});
