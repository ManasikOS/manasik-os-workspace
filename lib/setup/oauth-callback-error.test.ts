import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasOAuthProviderError, oauthProviderErrorMessage } from "./oauth-callback-error";

/** SEC-10 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the text on screen after an OAuth error is ours, never the URL's. */

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("hasOAuthProviderError", () => {
  it("is true when either parameter is present, and false when neither is", () => {
    expect(hasOAuthProviderError({ error: "access_denied" })).toBe(true);
    expect(hasOAuthProviderError({ description: "something" })).toBe(true);
    expect(hasOAuthProviderError({ error: "", description: null })).toBe(false);
    expect(hasOAuthProviderError({})).toBe(false);
  });
});

describe("oauthProviderErrorMessage", () => {
  it("says the connection was cancelled when the person declined, for each way a provider says so", () => {
    for (const error of ["access_denied", "ACCESS_DENIED", "user_denied", "user_cancelled_login", "user_cancelled_authorize"]) {
      expect(oauthProviderErrorMessage({ provider: "WhatsApp", error }), error).toBe("The WhatsApp connection was cancelled. Click Connect to try again.");
    }
  });

  it("says the connection did not complete for any other error, and points an admin at the logs", () => {
    expect(oauthProviderErrorMessage({ provider: "Google Ads", error: "server_error" })).toBe(
      "The Google Ads connection did not complete. Click Connect to try again, and ask an admin to check the logs if it keeps happening.",
    );
    expect(oauthProviderErrorMessage({ provider: "Meta Ads", error: null, description: "only a description" })).toContain("did not complete");
  });

  it("never returns any of the URL's words, whatever they say", () => {
    const hostile = "Your account is locked. Call +94 77 000 0000 or visit https://evil.example/login now";
    for (const error of ["access_denied", "server_error", hostile]) {
      const message = oauthProviderErrorMessage({ provider: "Messenger", error, description: hostile });
      expect(message).not.toMatch(/locked|evil|\+94|call/i);
    }
  });

  it("keeps the provider's own words in the server log, on one capped line", () => {
    oauthProviderErrorMessage({ provider: "Instagram", error: "server_error", description: `line one\nline two\r\n${"x".repeat(1000)}` });
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [label, json] = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0];
    expect(label).toBe("Instagram sign-in returned an error:");
    expect(json).not.toMatch(/[\r\n]/);
    const logged = JSON.parse(json) as { error: string; description: string };
    expect(logged.error).toBe("server_error");
    expect(logged.description.startsWith("line one line two")).toBe(true);
    expect(logged.description.length).toBeLessThanOrEqual(300);
  });
});
