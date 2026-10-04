import { describe, expect, it } from "vitest";

import {
  SETUP_RETURN_TTL_SECONDS,
  createSetupReturnToken,
  resolveConnectorReturnUrl,
  verifySetupReturnToken,
} from "./setup-return";

const secret = "test-secret";
const base = { userId: "user-1", provider: "whatsapp" as const, secret, now: 1_000_000 };

describe("setup return token", () => {
  it("verifies for the same user and provider within the window", () => {
    const token = createSetupReturnToken(base);
    expect(verifySetupReturnToken(token, { ...base, now: base.now + 60_000 })).toBe(true);
  });

  it("expires after 15 minutes", () => {
    expect(SETUP_RETURN_TTL_SECONDS).toBe(900);
    const token = createSetupReturnToken(base);
    expect(verifySetupReturnToken(token, { ...base, now: base.now + 899_000 })).toBe(true);
    expect(verifySetupReturnToken(token, { ...base, now: base.now + 901_000 })).toBe(false);
  });

  it("is bound to the user and the provider", () => {
    const token = createSetupReturnToken(base);
    expect(verifySetupReturnToken(token, { ...base, userId: "user-2" })).toBe(false);
    expect(verifySetupReturnToken(token, { ...base, provider: "messenger" })).toBe(false);
  });

  it("rejects a tampered token, a wrong secret and garbage", () => {
    const token = createSetupReturnToken(base);
    const [exp, provider, sig] = token.split(".");
    expect(verifySetupReturnToken(`${Number(exp) + 999999}.${provider}.${sig}`, base)).toBe(false);
    expect(verifySetupReturnToken(token, { ...base, secret: "other" })).toBe(false);
    expect(verifySetupReturnToken("nonsense", base)).toBe(false);
    expect(verifySetupReturnToken("", base)).toBe(false);
  });

  it("refuses to sign without a secret", () => {
    expect(() => createSetupReturnToken({ ...base, secret: "" })).toThrow();
    expect(verifySetupReturnToken("1.whatsapp.abc", { ...base, secret: "" })).toBe(false);
  });
});

describe("resolveConnectorReturnUrl", () => {
  const origin = "https://crm.example.com";

  it("returns to the setup channels step with the provider on success", () => {
    const url = new URL(resolveConnectorReturnUrl({ origin, provider: "whatsapp", status: "connected", message: "ok" }));
    expect(url.pathname).toBe("/setup");
    expect(url.searchParams.get("step")).toBe("channels");
    expect(url.searchParams.get("connected")).toBe("whatsapp");
  });

  it("returns to the same step with the reason on failure", () => {
    const url = new URL(resolveConnectorReturnUrl({ origin, provider: "instagram", status: "error", message: "Cancelled" }));
    expect(url.pathname).toBe("/setup");
    expect(url.searchParams.get("connector_error")).toBe("instagram");
    expect(url.searchParams.get("message")).toBe("Cancelled");
  });

  it("caps the message length and only ever resolves to /setup", () => {
    const url = new URL(resolveConnectorReturnUrl({ origin, provider: "meta_ads", status: "error", message: "x".repeat(500) }));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/setup");
    expect((url.searchParams.get("message") ?? "").length).toBeLessThanOrEqual(200);
  });
});
