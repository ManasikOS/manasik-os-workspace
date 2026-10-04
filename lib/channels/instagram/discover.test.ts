import { describe, expect, it, vi } from "vitest";

import type { GrantedPage } from "@/lib/channels/messenger/client";

import { discoverInstagramAccounts, noInstagramAccountMessage } from "./discover";
import { INSTAGRAM_OAUTH_STATE_PREFIX, buildInstagramLoginUrl } from "./oauth-redirect";

const pageA: GrantedPage = { id: "page-a", name: "Royal Al-Fathima", accessToken: "tok-a" };
const pageB: GrantedPage = { id: "page-b", name: "Royal Umrah", accessToken: "tok-b" };
const igA = { id: "ig-a", username: "royal", name: "Royal" };
const igB = { id: "ig-b", username: "umrah", name: "Umrah" };

describe("discoverInstagramAccounts", () => {
  it("pairs each Page with the Instagram account linked to it", async () => {
    const findLinked = vi.fn(async (page: GrantedPage) => (page.id === "page-a" ? igA : igB));
    const { candidates, pagesWithoutInstagram } = await discoverInstagramAccounts([pageA, pageB], findLinked);
    expect(candidates).toEqual([
      { account: igA, page: pageA },
      { account: igB, page: pageB },
    ]);
    expect(pagesWithoutInstagram).toEqual([]);
  });

  it("reports a Page that has no linked account, and still returns the others", async () => {
    const { candidates, pagesWithoutInstagram } = await discoverInstagramAccounts([pageA, pageB], async (page) => (page.id === "page-a" ? igA : null));
    expect(candidates).toHaveLength(1);
    expect(pagesWithoutInstagram).toEqual([pageB]);
  });

  it("treats a Page Meta will not let us read as having no account, without hiding the rest", async () => {
    const { candidates, pagesWithoutInstagram } = await discoverInstagramAccounts([pageA, pageB], async (page) => {
      if (page.id === "page-a") throw new Error("(#190) token expired");
      return igB;
    });
    expect(candidates).toEqual([{ account: igB, page: pageB }]);
    expect(pagesWithoutInstagram).toEqual([pageA]);
  });

  it("lists one account once even if it is reachable through two grants", async () => {
    const { candidates } = await discoverInstagramAccounts([pageA, pageB], async () => igA);
    expect(candidates).toHaveLength(1);
  });

  it("has nothing to find when no Page was shared", async () => {
    const findLinked = vi.fn();
    expect(await discoverInstagramAccounts([], findLinked)).toEqual({ candidates: [], pagesWithoutInstagram: [] });
    expect(findLinked).not.toHaveBeenCalled();
  });
});

describe("noInstagramAccountMessage", () => {
  it("says the Page is what to share when nothing was shared, since Instagram goes through the Page", () => {
    expect(noInstagramAccountMessage(0, [])).toContain("Instagram messaging goes through the Page");
  });

  it("names the Pages that have no linked account and how to link one", () => {
    const message = noInstagramAccountMessage(2, [pageA, pageB]);
    expect(message).toContain("Royal Al-Fathima, Royal Umrah");
    expect(message).toContain("Meta Business Suite");
  });
});

describe("Instagram's own login", () => {
  it("has its own state prefix, distinct from the WhatsApp and Messenger ones so the root redirect rules never collide", () => {
    expect(INSTAGRAM_OAUTH_STATE_PREFIX).toBe("ig_");
    expect(["wa_", "ms_"]).not.toContain(INSTAGRAM_OAUTH_STATE_PREFIX);
  });

  it("builds the login dialog URL from Instagram's own configuration id", () => {
    const url = new URL(buildInstagramLoginUrl({ appId: "app-1", configId: "cfg-ig", redirectUri: "https://x.test/", state: "ig_abc", graphVersion: "v25.0" }));
    expect(url.pathname).toBe("/v25.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe("cfg-ig");
    expect(url.searchParams.get("state")).toBe("ig_abc");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});
