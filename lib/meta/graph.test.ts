import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { metaGraphFetch, MetaGraphError, describeMetaError, graphBaseUrl } = await import("./graph");
const { WhatsAppSendError } = await import("@/lib/whatsapp/client");

const target = { host: "facebook", version: "v25.0" } as const;

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("graphBaseUrl", () => {
  it("targets the Facebook or Instagram Graph host", () => {
    expect(graphBaseUrl(target)).toBe("https://graph.facebook.com/v25.0");
    expect(graphBaseUrl({ host: "instagram", version: "v25.0" })).toBe("https://graph.instagram.com/v25.0");
  });
});

describe("metaGraphFetch", () => {
  it("returns the parsed body and sends the bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, { ok: true }));
    await expect(metaGraphFetch(target, "/123/messages", "tok", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/123/messages");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok", "Content-Type": "application/json" });
  });

  it("surfaces Meta's own explanation, preferring the user-facing message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(400, { error: { message: "dev text", error_user_msg: "Friendly text", code: 100 } }));
    await expect(metaGraphFetch(target, "/x", "t", { retries: 0 })).rejects.toMatchObject({
      name: "MetaGraphError",
      status: 400,
      message: "Graph API 400 on /x: Friendly text",
    });
  });

  it("falls back to a status-only message when Meta gives no explanation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 403 }));
    await expect(metaGraphFetch(target, "/x", "t", { retries: 0 })).rejects.toThrow("Graph API 403 on /x");
  });

  it("retries 5xx and 429 with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respond(503, {}))
      .mockResolvedValueOnce(respond(429, {}))
      .mockResolvedValueOnce(respond(200, { done: true }));
    const pending = metaGraphFetch(target, "/x", "t");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not retry a 4xx", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(400, { error: { message: "bad" } }));
    await expect(metaGraphFetch(target, "/x", "t")).rejects.toBeInstanceOf(MetaGraphError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the caller's own error class when asked, so existing instanceof checks keep working", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(400, { error: { message: "bad", code: 190 } }));
    const error = (await metaGraphFetch(target, "/x", "t", { retries: 0, errorClass: WhatsAppSendError, label: "WhatsApp Graph API" }).catch(
      (e) => e,
    )) as InstanceType<typeof WhatsAppSendError>;
    expect(error).toBeInstanceOf(WhatsAppSendError);
    expect(error).toBeInstanceOf(MetaGraphError);
    expect(error.message).toBe("WhatsApp Graph API 400 on /x: bad");
    expect(error.body).toEqual({ error: { message: "bad", code: 190 } });
  });
});

describe("describeMetaError", () => {
  it("reads error_user_msg first, then message, else undefined", () => {
    expect(describeMetaError({ error: { message: "m", error_user_msg: "u" } })).toBe("u");
    expect(describeMetaError({ error: { message: "m" } })).toBe("m");
    expect(describeMetaError(null)).toBeUndefined();
  });
});
