/**
 * Messenger connect as a plain page redirect to Facebook Login for Business — the same approach as
 * WhatsApp Embedded Signup (lib/whatsapp/embedded-signup-redirect.ts), for the same reason: no Facebook
 * JavaScript SDK, so no extension or CSP can leave the button dead.
 *
 * Meta returns to the SITE ROOT (already a registered OAuth redirect URI for every domain) with
 * `?code=…&state=ms_…`; a redirect rule in next.config.ts forwards that to /api/oauth/messenger/callback.
 * The `ms_` prefix keeps the rule from ever matching the WhatsApp (`wa_`) flow.
 */

export const MESSENGER_OAUTH_STATE_PREFIX = "ms_";
export const MESSENGER_OAUTH_STATE_COOKIE = "messenger_oauth_state";
/** Holds the Vault reference of a login waiting for the agency to choose one of several Pages. */
export const MESSENGER_PENDING_TOKEN_COOKIE = "messenger_pending_token";

export function buildMessengerLoginUrl(input: {
  appId: string;
  /** The Facebook Login for Business configuration that grants pages_messaging, pages_manage_metadata and pages_show_list. */
  configId: string;
  redirectUri: string;
  state: string;
  graphVersion: string;
}): string {
  const url = new URL(`https://www.facebook.com/${input.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("config_id", input.configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}
