import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-10 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): every OAuth callback skips the state check when the provider reports an error,
 * so anyone can send a signed-in admin a link like `/api/oauth/whatsapp/callback?error=x&error_description=Your account is locked...`. The text shown
 * on the Integrations page must come from us, never from that link.
 */

vi.mock("server-only", () => ({}));

const HOSTILE = "Your account is locked. Call +94 77 000 0000 or visit https://evil.example/login now";
const redirects: Array<{ provider: string; status: string; message: string; legacyUrl: string }> = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, delete: () => undefined, set: () => undefined }) }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ agencyId: "agency-1" }) }));
vi.mock("@/lib/channels/pending-token-cookie", () => ({ sealPendingRef: () => "sealed" }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: async () => "https://app.example.test" }));
vi.mock("@/lib/setup/setup-return-server", () => ({
  connectorRedirect: async (input: { provider: string; status: string; message: string; legacyUrl: string }) => {
    redirects.push(input);
    return { redirected: true };
  },
}));
vi.mock("@/app/(main)/management/settings/integrations/whatsapp-actions", () => ({ connectWhatsApp: vi.fn() }));
vi.mock("@/app/(main)/management/settings/integrations/messenger-actions", () => ({ connectMessenger: vi.fn() }));
vi.mock("@/app/(main)/management/settings/integrations/instagram-actions", () => ({ connectInstagram: vi.fn(), connectInstagramWithLogin: vi.fn() }));
vi.mock("@/app/(main)/management/settings/integrations/ads-actions", () => ({ completeMetaAdsConnection: vi.fn(), completeGoogleAdsConnection: vi.fn() }));
vi.mock("@/app/api/oauth/meta-ads/start/route", () => ({ STATE_COOKIE: "meta_ads_state" }));
vi.mock("@/app/api/oauth/google-ads/start/route", () => ({ STATE_COOKIE: "google_ads_state" }));

const ROUTES = [
  { name: "whatsapp", provider: "WhatsApp", load: () => import("./whatsapp/callback/route") },
  { name: "messenger", provider: "Messenger", load: () => import("./messenger/callback/route") },
  { name: "instagram", provider: "Instagram", load: () => import("./instagram/callback/route") },
  { name: "instagram-login", provider: "Instagram", load: () => import("./instagram-login/callback/route") },
  { name: "meta-ads", provider: "Meta Ads", load: () => import("./meta-ads/callback/route") },
  { name: "google-ads", provider: "Google Ads", load: () => import("./google-ads/callback/route") },
] as const;

function callbackRequest(path: string, query: Record<string, string>) {
  const url = new URL(`https://app.example.test${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { nextUrl: url, url: url.toString(), headers: new Headers() } as never;
}

beforeEach(() => {
  redirects.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe.each(ROUTES)("the $name callback, when the link carries an error", (route) => {
  it("shows a fixed 'cancelled' sentence, not the link's words, when the person declined", async () => {
    const { GET } = await route.load();
    await GET(callbackRequest(`/api/oauth/${route.name}/callback`, { error: "access_denied", error_description: HOSTILE }));
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatchObject({ status: "error", message: `The ${route.provider} connection was cancelled. Click Connect to try again.` });
  });

  it("shows a fixed 'did not complete' sentence for any other error", async () => {
    const { GET } = await route.load();
    await GET(callbackRequest(`/api/oauth/${route.name}/callback`, { error: "server_error", error_description: HOSTILE }));
    expect(redirects[0].message).toContain(`The ${route.provider} connection did not complete.`);
  });

  it("puts none of the link's words anywhere in the redirect, including the address, whatever the link says", async () => {
    const { GET } = await route.load();
    await GET(callbackRequest(`/api/oauth/${route.name}/callback`, { error: HOSTILE, error_description: HOSTILE }));
    const everything = JSON.stringify(redirects[0]) + decodeURIComponent(redirects[0].legacyUrl);
    expect(everything).not.toMatch(/locked|evil\.example|\+94 77/i);
  });

  it("keeps the provider's description in the server log", async () => {
    const { GET } = await route.load();
    await GET(callbackRequest(`/api/oauth/${route.name}/callback`, { error: "server_error", error_description: "Application is restricted" }));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(route.provider), expect.stringContaining("Application is restricted"));
  });
});
