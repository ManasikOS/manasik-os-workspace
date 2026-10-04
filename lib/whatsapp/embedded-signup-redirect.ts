/**
 * WhatsApp Embedded Signup as a plain page redirect, with no Facebook JavaScript SDK.
 *
 * The SDK route (`FB.login`) needs `connect.facebook.net` to load in the visitor's browser, and browser
 * extensions, privacy tools and strict CSPs block it: the button then does nothing. Meta's hosted signup page
 * works everywhere because it is an ordinary navigation. This does the same: send the browser to Meta's login
 * dialog with the Embedded Signup configuration, and Meta sends it back with an authorization code that the
 * server exchanges (lib/whatsapp/client.ts `exchangeCodeForToken`), exactly like the SDK flow's code.
 *
 * The redirect goes to the site root, because Meta's app settings only accept redirect URIs registered exactly
 * (strict mode) and the site root is already registered for every domain. A redirect rule in next.config.ts
 * forwards `/?code=…&state=wa_…` to the callback route.
 */

/** Prefix that marks a state value as ours, so the root redirect rule only ever matches this flow. */
export const WHATSAPP_OAUTH_STATE_PREFIX = "wa_";
export const WHATSAPP_OAUTH_STATE_COOKIE = "whatsapp_oauth_state";
/** Holds the Vault reference of a token waiting for the agency to choose one of several WhatsApp accounts. */
export const WHATSAPP_PENDING_TOKEN_COOKIE = "whatsapp_pending_token";

export function buildEmbeddedSignupUrl(input: {
  appId: string;
  configId: string;
  redirectUri: string;
  state: string;
  graphVersion: string;
  /** Lets an agency keep using the WhatsApp Business app on the same number (Meta "coexistence"): the dialog offers a QR scan from the app. */
  coexistence?: boolean;
}): string {
  const url = new URL(`https://www.facebook.com/${input.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("config_id", input.configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("extras", JSON.stringify({
      setup: {},
      ...(input.coexistence ? { featureType: "whatsapp_business_app_onboarding" } : {}),
      sessionInfoVersion: "3",
      version: "v4",
    }));
  return url.toString();
}

/** The site root with a trailing slash: the exact string registered under Valid OAuth Redirect URIs. */
export function signupRedirectUri(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/`;
}
