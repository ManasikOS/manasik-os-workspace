import { describe, expect, it } from "vitest";

import {
  buildInstagramBusinessLoginUrl,
  INSTAGRAM_LOGIN_SCOPES,
  INSTAGRAM_LOGIN_STATE_PREFIX,
  instagramLoginRedirectUri,
  isInstagramLoginMetadata,
} from "./oauth";

describe("buildInstagramBusinessLoginUrl", () => {
  const url = new URL(buildInstagramBusinessLoginUrl({ appId: "1057637823763593", redirectUri: "https://workspace.example.com/api/oauth/instagram-login/callback", state: "igl_abc" }));

  it("goes to Instagram's own authorize endpoint with the Instagram app id", () => {
    expect(`${url.origin}${url.pathname}`).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("1057637823763593");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("asks only for reading the account and messaging, not publishing, insights or comments", () => {
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
    expect(INSTAGRAM_LOGIN_SCOPES).toEqual(["instagram_business_basic", "instagram_business_manage_messages"]);
  });

  it("carries the state and the exact redirect URI, and always forces the login screen", () => {
    expect(url.searchParams.get("state")).toBe("igl_abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://workspace.example.com/api/oauth/instagram-login/callback");
    expect(url.searchParams.get("force_reauth")).toBe("true");
  });

  it("uses a state prefix that the Page flow's root-redirect rule (state=ig_…) can never match", () => {
    expect(INSTAGRAM_LOGIN_STATE_PREFIX).toBe("igl_");
    expect(/^ig_.*$/.test(`${INSTAGRAM_LOGIN_STATE_PREFIX}abc`)).toBe(false);
  });
});

describe("instagramLoginRedirectUri", () => {
  it("is the callback route on the site origin, however the origin is written", () => {
    expect(instagramLoginRedirectUri("https://workspace.example.com")).toBe("https://workspace.example.com/api/oauth/instagram-login/callback");
    expect(instagramLoginRedirectUri("https://workspace.example.com///")).toBe("https://workspace.example.com/api/oauth/instagram-login/callback");
  });
});

describe("isInstagramLoginMetadata", () => {
  it("recognises a connection made with Instagram Login", () => {
    expect(isInstagramLoginMetadata({ connect_method: "INSTAGRAM_LOGIN", instagram_account_id: "1" })).toBe(true);
  });

  it("treats a Facebook-Page connection, and anything malformed, as not Instagram Login", () => {
    expect(isInstagramLoginMetadata({ page_id: "p", instagram_account_id: "1" })).toBe(false);
    expect(isInstagramLoginMetadata({ connect_method: "SOMETHING_ELSE" })).toBe(false);
    expect(isInstagramLoginMetadata(null)).toBe(false);
    expect(isInstagramLoginMetadata("INSTAGRAM_LOGIN")).toBe(false);
  });
});
