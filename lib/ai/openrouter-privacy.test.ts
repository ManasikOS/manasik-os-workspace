import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithProviderPreferences, openRouterProviderPreferences } from "@/lib/ai/openrouter-privacy";

afterEach(() => vi.unstubAllEnvs());

describe("openRouterProviderPreferences", () => {
  it("adds nothing until a policy is set", () => {
    expect(openRouterProviderPreferences()).toEqual({});
    vi.stubEnv("OPENROUTER_DATA_POLICY", "");
    expect(openRouterProviderPreferences()).toEqual({});
    vi.stubEnv("OPENROUTER_DATA_POLICY", "allow");
    expect(openRouterProviderPreferences()).toEqual({});
  });

  it("denies data collection for `deny`, and also requires zero retention for `zdr`", () => {
    vi.stubEnv("OPENROUTER_DATA_POLICY", "deny");
    expect(openRouterProviderPreferences()).toEqual({ provider: { data_collection: "deny" } });
    vi.stubEnv("OPENROUTER_DATA_POLICY", " ZDR ");
    expect(openRouterProviderPreferences()).toEqual({ provider: { data_collection: "deny", zdr: true } });
  });
});

describe("fetchWithProviderPreferences", () => {
  const send = async (body: unknown) => {
    const base = vi.fn(async () => new Response("{}"));
    await fetchWithProviderPreferences(base as never)("https://openrouter.ai/api/v1/messages", { method: "POST", body: body as string });
    // The wrapper's second argument to the underlying fetch is the request init that carries the body.
    return ((base.mock.calls[0] as unknown[])[1] as RequestInit | undefined)?.body;
  };

  it("leaves the request untouched when no policy is set", async () => {
    const original = JSON.stringify({ model: "m", messages: [] });
    expect(await send(original)).toBe(original);
  });

  it("adds the provider preferences to a JSON body when a policy is set", async () => {
    vi.stubEnv("OPENROUTER_DATA_POLICY", "deny");
    const sent = JSON.parse((await send(JSON.stringify({ model: "m", messages: [] }))) as string);
    expect(sent).toEqual({ model: "m", messages: [], provider: { data_collection: "deny" } });
  });

  it("never overwrites a provider the caller chose, and ignores bodies that are not JSON objects", async () => {
    vi.stubEnv("OPENROUTER_DATA_POLICY", "deny");
    const chosen = JSON.stringify({ model: "m", provider: { only: ["x"] } });
    expect(await send(chosen)).toBe(chosen);
    expect(await send("not json")).toBe("not json");
    expect(await send("[1,2]")).toBe("[1,2]");
  });
});
