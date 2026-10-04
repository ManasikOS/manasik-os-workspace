import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchMessengerProfileName, fetchNameFromPageInbox } = await import("./profile");

const PAGE = "1286483891218738";

/** Routes a fake Graph by URL so each test says what the inbox and the direct lookup answer. */
function graph(routes: { inbox?: () => Response; direct?: () => Response }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/me/conversations")) return routes.inbox ? routes.inbox() : new Response(JSON.stringify({ data: [] }), { status: 200 });
    return routes.direct ? routes.direct() : new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), { status: 400 });
  });
}

const inbox = (participants: Array<{ id: string; name?: string; username?: string }>) =>
  new Response(JSON.stringify({ data: [{ id: "t_1", participants: { data: participants } }] }), { status: 200 });

afterEach(() => vi.restoreAllMocks());

describe("the customer's name from the Page inbox", () => {
  it("returns the participant whose id matches, not the Page's own entry — the case that works in Development mode", async () => {
    graph({ inbox: () => inbox([{ id: "psid-9", name: "Mohamed Afras" }, { id: PAGE, name: "Test Manasik OS" }]) });
    await expect(fetchNameFromPageInbox("tok", "psid-9", "MESSENGER")).resolves.toBe("Mohamed Afras");
  });

  it("finds the customer wherever they sit in the list", async () => {
    graph({ inbox: () => inbox([{ id: PAGE, name: "Test Manasik OS" }, { id: "psid-9", name: "Fatima Rizwan" }]) });
    await expect(fetchNameFromPageInbox("tok", "psid-9", "MESSENGER")).resolves.toBe("Fatima Rizwan");
  });

  it("never returns someone else's name when the customer is not in the thread", async () => {
    graph({ inbox: () => inbox([{ id: PAGE, name: "Test Manasik OS" }, { id: "someone-else", name: "Not Them" }]) });
    await expect(fetchNameFromPageInbox("tok", "psid-9", "MESSENGER")).resolves.toBeNull();
  });

  it("asks for the customer's own thread, on the right platform, with the Page token", async () => {
    const spy = graph({ inbox: () => inbox([{ id: "psid-9", name: "A" }]) });
    await fetchNameFromPageInbox("tok", "psid-9", "MESSENGER");
    await fetchNameFromPageInbox("tok", "igsid-1", "INSTAGRAM");
    const [messengerUrl, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(messengerUrl).toContain("/me/conversations?platform=messenger&user_id=psid-9&fields=participants");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(String(spy.mock.calls[1][0])).toContain("platform=instagram&user_id=igsid-1");
  });

  it("uses an Instagram username when the participant has no display name", async () => {
    graph({ inbox: () => inbox([{ id: "igsid-1", username: "fatima" }]) });
    await expect(fetchNameFromPageInbox("tok", "igsid-1", "INSTAGRAM")).resolves.toBe("@fatima");
  });

  it("is null, without throwing, when Meta refuses or the thread is empty", async () => {
    graph({ inbox: () => new Response(JSON.stringify({ error: { message: "denied" } }), { status: 403 }) });
    await expect(fetchNameFromPageInbox("tok", "psid-9", "MESSENGER")).resolves.toBeNull();
    graph({});
    await expect(fetchNameFromPageInbox("tok", "psid-9", "MESSENGER")).resolves.toBeNull();
  });
});

describe("fetchMessengerProfileName — inbox first, direct lookup as the fallback", () => {
  it("uses the inbox name and does not call the direct lookup at all when it has one", async () => {
    const spy = graph({ inbox: () => inbox([{ id: "psid-9", name: "Mohamed Afras" }]) });
    await expect(fetchMessengerProfileName("tok", "psid-9")).resolves.toBe("Mohamed Afras");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the direct lookup when the inbox has no name — an app that has profile access", async () => {
    graph({ direct: () => new Response(JSON.stringify({ first_name: "Fatima", last_name: "Rizwan" }), { status: 200 }) });
    await expect(fetchMessengerProfileName("tok", "psid-9")).resolves.toBe("Fatima Rizwan");
  });

  it("is null when neither route has a name, leaving the placeholder in place", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    graph({});
    await expect(fetchMessengerProfileName("tok", "psid-9")).resolves.toBeNull();
  });
});
