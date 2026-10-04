import { describe, expect, it } from "vitest";

import { buildMessengerLoginUrl, MESSENGER_OAUTH_STATE_PREFIX } from "./oauth-redirect";

describe("buildMessengerLoginUrl", () => {
  const url = new URL(
    buildMessengerLoginUrl({
      appId: "123",
      configId: "cfg-9",
      redirectUri: "https://crm.example.com/",
      state: `${MESSENGER_OAUTH_STATE_PREFIX}abc`,
      graphVersion: "v25.0",
    }),
  );

  it("goes to Facebook Login for Business with a configuration rather than scopes", () => {
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("config_id")).toBe("cfg-9");
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("asks for a code and carries the CSRF state and the exact registered redirect URI", () => {
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.example.com/");
    expect(url.searchParams.get("state")).toBe("ms_abc");
  });

  it("uses a state prefix distinct from WhatsApp's, so the root redirect rules never collide", () => {
    expect(MESSENGER_OAUTH_STATE_PREFIX).toBe("ms_");
    expect(MESSENGER_OAUTH_STATE_PREFIX).not.toBe("wa_");
  });
});
