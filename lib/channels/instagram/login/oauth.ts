/**
 * Instagram connect through **Instagram Login** (Meta's "Instagram API with Instagram Login"): the agency signs in
 * with Instagram itself, with no Facebook Page in between. This is the pure half: the authorize URL and the
 * constants the client, the connect module, the routes and the adapter share. See
 * docs/tasks/TASK-006-instagram-login-connection.md.
 *
 * It runs beside the older Facebook-Page connection (lib/channels/instagram/connect.ts), which stays as a
 * fallback. Both write a `channel_connections` row with `provider = 'INSTAGRAM'`; this one marks its rows with
 * `provider_metadata.connect_method = "INSTAGRAM_LOGIN"`, and a row without that marker is a Page connection.
 *
 * Meta returns to an explicit callback route (not the site root), so the `ig_` root-redirect rule for the Page flow
 * in next.config.ts is never involved; the state prefix differs (`igl_`) for the same reason.
 */

export const INSTAGRAM_LOGIN_CONNECT_METHOD = "INSTAGRAM_LOGIN" as const;

export const INSTAGRAM_LOGIN_STATE_PREFIX = "igl_";
export const INSTAGRAM_LOGIN_STATE_COOKIE = "instagram_login_state";

/** Least privilege: read the account, and send and receive messages. Publishing, insights and comments are not asked for. */
export const INSTAGRAM_LOGIN_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"] as const;

/** The webhook fields the connected account is subscribed to (what lib/channels/messenger/webhook.ts acts on). */
export const INSTAGRAM_LOGIN_WEBHOOK_FIELDS = ["messages", "messaging_seen", "messaging_postbacks"] as const;

/** Where Meta sends the agency after they approve. Must match the redirect URL registered on the Instagram product exactly. */
export function instagramLoginRedirectUri(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/oauth/instagram-login/callback`;
}

export function buildInstagramBusinessLoginUrl(input: {
  /** The **Instagram** app id shown on the Instagram product page, not META_APP_ID. */
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_LOGIN_SCOPES.join(","));
  url.searchParams.set("state", input.state);
  // Always show the login screen: on a shared computer the agency must pick their own account, not a remembered one.
  url.searchParams.set("force_reauth", "true");
  return url.toString();
}

/** True for a `channel_connections.provider_metadata` written by this flow. Anything else is the Facebook-Page connection. */
export function isInstagramLoginMetadata(metadata: unknown): boolean {
  return typeof metadata === "object" && metadata !== null && (metadata as { connect_method?: unknown }).connect_method === INSTAGRAM_LOGIN_CONNECT_METHOD;
}
