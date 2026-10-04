/**
 * Instagram connect as its own plain page redirect to Facebook Login for Business — a separate onboarding from
 * WhatsApp and Messenger, with its own configuration (`META_INSTAGRAM_CONFIG_ID`): Page assets plus the
 * Instagram account, with `instagram_manage_messages`, `instagram_basic`, `pages_show_list` and
 * `pages_manage_metadata`. No Facebook JavaScript SDK, so no extension or CSP can leave the button dead.
 *
 * Meta returns to the SITE ROOT (already a registered OAuth redirect URI for every domain) with
 * `?code=…&state=ig_…`; a redirect rule in next.config.ts forwards that to /api/oauth/instagram/callback. The
 * `ig_` prefix keeps the rule from ever matching the WhatsApp (`wa_`) or Messenger (`ms_`) flows.
 */

import { buildMessengerLoginUrl } from "@/lib/channels/messenger/oauth-redirect";

export const INSTAGRAM_OAUTH_STATE_PREFIX = "ig_";
export const INSTAGRAM_OAUTH_STATE_COOKIE = "instagram_oauth_state";
/** Holds the Vault reference of a login waiting for the agency to choose one of several Instagram accounts. */
export const INSTAGRAM_PENDING_TOKEN_COOKIE = "instagram_pending_token";

/** The login dialog is the same one Messenger uses; only the configuration id (and so the permissions asked for) differs. */
export function buildInstagramLoginUrl(input: { appId: string; configId: string; redirectUri: string; state: string; graphVersion: string }): string {
  return buildMessengerLoginUrl(input);
}
