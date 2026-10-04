import { describe, expect, it } from "vitest";

import {
  buildEmbeddedSignupUrl,
  signupRedirectUri,
  WHATSAPP_OAUTH_STATE_PREFIX,
} from "@/lib/whatsapp/embedded-signup-redirect";

describe("buildEmbeddedSignupUrl", () => {
  it("asks Meta's login dialog for an authorization code using the Embedded Signup configuration", () => {
    const url = new URL(
      buildEmbeddedSignupUrl({
        appId: "123",
        configId: "456",
        redirectUri: "https://workspace.example.com/",
        state: `${WHATSAPP_OAUTH_STATE_PREFIX}abc`,
        graphVersion: "v25.0",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("config_id")).toBe("456");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe("https://workspace.example.com/");
    expect(url.searchParams.get("state")).toBe("wa_abc");
    expect(JSON.parse(url.searchParams.get("extras") ?? "{}")).toEqual({ setup: {}, sessionInfoVersion: "3", version: "v4" });
  });
});

describe("buildEmbeddedSignupUrl coexistence", () => {
  const base = {
    appId: "123",
    configId: "456",
    redirectUri: "https://workspace.example.com/",
    state: `${WHATSAPP_OAUTH_STATE_PREFIX}abc`,
    graphVersion: "v25.0",
  };

  it("asks Meta to offer WhatsApp Business app onboarding when coexistence is on", () => {
    const url = new URL(buildEmbeddedSignupUrl({ ...base, coexistence: true }));
    expect(JSON.parse(url.searchParams.get("extras") ?? "{}").featureType).toBe("whatsapp_business_app_onboarding");
  });

  it("leaves the feature type out when coexistence is off", () => {
    const url = new URL(buildEmbeddedSignupUrl(base));
    expect(JSON.parse(url.searchParams.get("extras") ?? "{}")).not.toHaveProperty("featureType");
  });
});

describe("signupRedirectUri", () => {
  it("is the site root with exactly one trailing slash", () => {
    expect(signupRedirectUri("https://localhost:3000")).toBe("https://localhost:3000/");
    expect(signupRedirectUri("https://workspace.example.com///")).toBe("https://workspace.example.com/");
  });
});
