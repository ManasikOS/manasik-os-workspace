import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  exchangeForLongLivedToken,
  exchangeInstagramLoginCode,
  fetchInstagramLoginCustomerName,
  getInstagramLoginLabel,
  getInstagramLoginProfile,
  isSubscribedToLoginMessages,
  listInstagramLoginSubscriptions,
  sendInstagramLoginAction,
  sendInstagramLoginQuickReplies,
  sendInstagramLoginText,
  subscribeInstagramLoginAccount,
  InstagramLoginApiError,
} = await import("./client");

afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The error a call rejects with (fails the test if it resolves). */
async function rejection(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to reject.");
}

describe("exchangeInstagramLoginCode", () => {
  const input = { code: "the-code", appId: "ig-app", appSecret: "ig-secret", redirectUri: "https://x.test/api/oauth/instagram-login/callback" };

  it("posts a form body to Instagram's token endpoint and reads the token from the documented data[] wrapper", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ data: [{ access_token: "short-token", user_id: "1", permissions: "a,b" }] }));
    await expect(exchangeInstagramLoginCode(input)).resolves.toEqual({ accessToken: "short-token" });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.instagram.com/oauth/access_token");
    expect(init.method).toBe("POST");
    const form = init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      client_id: "ig-app",
      client_secret: "ig-secret",
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code: "the-code",
    });
  });

  it("also accepts the flat response shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ access_token: "flat-token", user_id: 1 }));
    await expect(exchangeInstagramLoginCode(input)).resolves.toEqual({ accessToken: "flat-token" });
  });

  it("reports Meta's own error text, and never the secret or the code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ error_type: "OAuthException", code: 400, error_message: "Invalid authorization code" }, 400));
    const failure = await rejection(exchangeInstagramLoginCode(input));
    expect(failure).toBeInstanceOf(InstagramLoginApiError);
    expect(failure.message).toBe("Instagram rejected the sign-in: Invalid authorization code");
    expect(failure.message).not.toContain("ig-secret");
    expect(failure.message).not.toContain("the-code");
  });

  it("fails clearly when Meta answers success without a token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ data: [{}] }));
    await expect(exchangeInstagramLoginCode(input)).rejects.toThrow("did not return an access token");
  });
});

describe("exchangeForLongLivedToken", () => {
  it("swaps the short token for a 60-day one and reports its lifetime", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ access_token: "long-token", token_type: "bearer", expires_in: 5184000 }));
    await expect(exchangeForLongLivedToken({ shortToken: "short", appSecret: "sec" })).resolves.toEqual({ accessToken: "long-token", expiresInSeconds: 5184000 });

    const requested = new URL(String(spy.mock.calls[0][0]));
    expect(`${requested.origin}${requested.pathname}`).toBe("https://graph.instagram.com/access_token");
    expect(requested.searchParams.get("grant_type")).toBe("ig_exchange_token");
  });

  it("does not put the URL, and so the secret or the token, into an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ error: { message: "Invalid OAuth 2.0 Access Token", code: 190 } }, 400));
    const failure = await rejection(exchangeForLongLivedToken({ shortToken: "short-token-value", appSecret: "secret-value" }));
    expect(failure.message).toBe("Instagram could not issue a long-lived token: Invalid OAuth 2.0 Access Token");
    expect(failure.message).not.toMatch(/secret-value|short-token-value/);
  });

  it("reports an unknown lifetime as null rather than guessing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ access_token: "long-token" }));
    await expect(exchangeForLongLivedToken({ shortToken: "s", appSecret: "x" })).resolves.toEqual({ accessToken: "long-token", expiresInSeconds: null });
  });
});

describe("getInstagramLoginProfile", () => {
  it("uses user_id (the professional account id webhooks carry), never the app-scoped id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ user_id: "17841429904911692", username: "manasikos", id: "28847206491542882" }));
    await expect(getInstagramLoginProfile("tok")).resolves.toEqual({ userId: "17841429904911692", username: "manasikos", name: null });
  });

  it("refuses a profile with no user_id instead of falling back to the app-scoped id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ username: "manasikos", id: "28847206491542882" }));
    await expect(getInstagramLoginProfile("tok")).rejects.toThrow("did not say which account");
  });

  it("sends the token in the Authorization header, never in the URL", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ user_id: 1, username: "u" }));
    await getInstagramLoginProfile("secret-token");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(new URL(url).host).toBe("graph.instagram.com");
  });

  it("labels the account by username, then name, then id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ user_id: 1, username: "royal" }));
    await expect(getInstagramLoginLabel("t")).resolves.toBe("@royal");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ user_id: 1, name: "Royal Al-Fathima" }));
    await expect(getInstagramLoginLabel("t")).resolves.toBe("Royal Al-Fathima");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ user_id: 7 }));
    await expect(getInstagramLoginLabel("t")).resolves.toBe("Instagram account 7");
  });
});

describe("fetchInstagramLoginCustomerName", () => {
  it("asks Instagram's User Profile API on the account's own token, not the Page host", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ name: "Fatima Rizwan", username: "fatima.r", id: "igsid-1" }));
    await expect(fetchInstagramLoginCustomerName("secret-token", "igsid-1")).resolves.toBe("Fatima Rizwan");

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    const requested = new URL(url);
    expect(requested.host).toBe("graph.instagram.com");
    expect(requested.pathname).toMatch(/\/igsid-1$/);
    expect(requested.searchParams.get("fields")).toBe("name,username");
    expect(url).not.toContain("secret-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("shows a customer with no display name by their @handle instead of leaving the placeholder", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ username: "fatima.r" }));
    await expect(fetchInstagramLoginCustomerName("t", "igsid-1")).resolves.toBe("@fatima.r");
  });

  it("returns null, without throwing, when Instagram refuses, so the placeholder simply stays", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ error: { message: "Unsupported get request", code: 100 } }, 400));
    await expect(fetchInstagramLoginCustomerName("t", "igsid-1")).resolves.toBeNull();
  });

  it("returns null when the profile has neither a name nor a handle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ id: "igsid-1" }));
    await expect(fetchInstagramLoginCustomerName("t", "igsid-1")).resolves.toBeNull();
  });
});

describe("account subscription", () => {
  it("subscribes the account itself to the message fields, not a Page", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ success: true }));
    await subscribeInstagramLoginAccount("tok");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    const requested = new URL(url);
    expect(requested.pathname).toMatch(/\/me\/subscribed_apps$/);
    expect(requested.searchParams.get("subscribed_fields")).toBe("messages,messaging_seen,messaging_postbacks");
    expect(init.method).toBe("POST");
  });

  it("reads the subscribed fields back and only counts an account that receives messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ data: [{ subscribed_fields: ["messages", "messaging_seen"] }] }));
    await expect(listInstagramLoginSubscriptions("tok").then(isSubscribedToLoginMessages)).resolves.toBe(true);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ data: [{ subscribed_fields: ["comments"] }] }));
    await expect(listInstagramLoginSubscriptions("tok").then(isSubscribedToLoginMessages)).resolves.toBe(false);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({ data: [] }));
    await expect(listInstagramLoginSubscriptions("tok").then(isSubscribedToLoginMessages)).resolves.toBe(false);
  });
});

describe("sending", () => {
  const mockSend = () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse((init as RequestInit).body as string) });
      return json({ recipient_id: "igsid-1", message_id: "ig.1" });
    });
    return calls;
  };

  it("posts to the Instagram account's own /messages edge on graph.instagram.com", async () => {
    const calls = mockSend();
    await expect(sendInstagramLoginText("tok", "17841429904911692", "igsid-1", "Salam")).resolves.toEqual({ messageId: "ig.1" });
    const requested = new URL(calls[0].url);
    expect(requested.host).toBe("graph.instagram.com");
    expect(requested.pathname).toMatch(/\/17841429904911692\/messages$/);
    expect(calls[0].body).toEqual({ recipient: { id: "igsid-1" }, message: { text: "Salam" } });
  });

  it("adds the human-agent tag only when asked", async () => {
    const calls = mockSend();
    await sendInstagramLoginText("tok", "ig", "igsid-1", "Hi", "HUMAN_AGENT");
    expect(calls[0].body).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });

  it("truncates quick reply titles and caps them at 13", async () => {
    const calls = mockSend();
    const replies = Array.from({ length: 15 }, (_, index) => ({ id: `r${index}`, title: "A very long quick reply title indeed" }));
    await sendInstagramLoginQuickReplies("tok", "ig", "igsid-1", "Pick", replies);
    const sent = (calls[0].body.message as { quick_replies: Array<{ title: string; payload: string }> }).quick_replies;
    expect(sent).toHaveLength(13);
    expect(sent[0].title.length).toBeLessThanOrEqual(20);
    expect(sent[0].payload).toBe("r0");
  });

  it("sends a typing/seen action for the customer", async () => {
    const calls = mockSend();
    await sendInstagramLoginAction("tok", "ig", "igsid-1", "typing_on");
    expect(calls[0].body).toEqual({ recipient: { id: "igsid-1" }, sender_action: "typing_on" });
  });

  it("fails when Meta answers without a message id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({}));
    await expect(sendInstagramLoginText("tok", "ig", "igsid-1", "Hi")).rejects.toThrow("no message id");
  });
});
