/**
 * Instagram Login Graph calls — sign-in code exchange, the 60-day token, the account's profile, the webhook
 * subscription, and sending. Pure HTTP: callers supply the token (read from Vault) and this module never touches
 * the database. Sends and reads go through the shared Graph client (lib/meta/graph.ts) on `graph.instagram.com`
 * with the token in the Authorization header, so it never appears in a URL, an error message or a log.
 *
 * The two token endpoints are the exception: `api.instagram.com/oauth/access_token` takes a form body and
 * `graph.instagram.com/access_token` takes the app secret as a query parameter, neither with a bearer token, so
 * they use plain `fetch`. Their error messages are built from Meta's own error text and never from the request URL.
 *
 * Endpoint shapes are from Meta's Instagram API with Instagram Login documentation; the ones still unconfirmed
 * against a real delivery are listed in docs/tasks/TASK-006-instagram-login-connection.md (Q2 to Q7).
 */

import "server-only";

import { INSTAGRAM_LOGIN_WEBHOOK_FIELDS } from "@/lib/channels/instagram/login/oauth";
import { profileDisplayName } from "@/lib/channels/messenger/profile";
import { MetaGraphError, metaGraphFetch, metaGraphVersion } from "@/lib/meta/graph";

const target = () => ({ host: "instagram", version: metaGraphVersion() }) as const;

export class InstagramLoginApiError extends MetaGraphError {
  constructor(message: string, status: number, body: unknown) {
    super(message, status, body);
    this.name = "InstagramLoginApiError";
  }
}

function graph(path: string, token: string, init: RequestInit & { retries?: number } = {}): Promise<unknown> {
  return metaGraphFetch(target(), path, token, { ...init, errorClass: InstagramLoginApiError, label: "Instagram Login API" });
}

/* ── Sign-in and tokens ───────────────────────────────────────────────────── */

/** Meta's OAuth errors are `{ error_type, code, error_message }`; the Graph ones are `{ error: { message } }`. */
function oauthErrorText(body: unknown): string | undefined {
  const flat = body as { error_message?: string; error?: { message?: string; error_user_msg?: string } } | null;
  return flat?.error_message || flat?.error?.error_user_msg || flat?.error?.message;
}

/** The single-use code (valid about an hour) becomes a short-lived token. The `data[0]` wrapper and the flat shape are both accepted. */
export async function exchangeInstagramLoginCode(input: { code: string; appId: string; appSecret: string; redirectUri: string }): Promise<{ accessToken: string }> {
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code: input.code,
    }),
  });
  const body = (await response.json().catch(() => null)) as { data?: Array<{ access_token?: string }>; access_token?: string } | null;
  if (!response.ok) {
    const detail = oauthErrorText(body);
    throw new InstagramLoginApiError(detail ? `Instagram rejected the sign-in: ${detail}` : `Instagram rejected the sign-in (HTTP ${response.status}).`, response.status, body);
  }
  const accessToken = Array.isArray(body?.data) ? body.data[0]?.access_token : body?.access_token;
  if (!accessToken) throw new InstagramLoginApiError("Instagram did not return an access token.", 200, null);
  return { accessToken };
}

/** The short-lived token (one hour) becomes a long-lived one (60 days). */
export async function exchangeForLongLivedToken(input: { shortToken: string; appSecret: string }): Promise<{ accessToken: string; expiresInSeconds: number | null }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("access_token", input.shortToken);

  const response = await fetch(url, { method: "GET" });
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!response.ok) {
    const detail = oauthErrorText(body);
    throw new InstagramLoginApiError(detail ? `Instagram could not issue a long-lived token: ${detail}` : `Instagram could not issue a long-lived token (HTTP ${response.status}).`, response.status, body);
  }
  if (!body?.access_token) throw new InstagramLoginApiError("Instagram did not return a long-lived token.", 200, null);
  return { accessToken: body.access_token, expiresInSeconds: typeof body.expires_in === "number" ? body.expires_in : null };
}

/* ── The account ──────────────────────────────────────────────────────────── */

export interface InstagramLoginProfile {
  /** The Instagram professional account id: what webhooks carry as `entry.id` and what we store as the connection's account id. */
  userId: string;
  username: string | null;
  name: string | null;
}

/**
 * `/me` returns two ids. `user_id` is the professional account id (confirmed to equal the id the Page flow
 * stores and the webhooks carry, TASK-006 Q1); `id` is an app-scoped id and must never be used, so it is not read.
 */
export async function getInstagramLoginProfile(token: string): Promise<InstagramLoginProfile> {
  const profile = (await graph("/me?fields=user_id,username,name", token, { method: "GET", retries: 0 })) as { user_id?: string | number; username?: string; name?: string };
  if (profile.user_id === undefined || profile.user_id === null || String(profile.user_id).length === 0) {
    throw new InstagramLoginApiError("Instagram did not say which account this login is for.", 200, profile);
  }
  return { userId: String(profile.user_id), username: profile.username ?? null, name: profile.name ?? null };
}

/** Reads the account's label: what "Test connection" uses to prove the stored token still works. */
export async function getInstagramLoginLabel(token: string): Promise<string> {
  const profile = await getInstagramLoginProfile(token);
  return profile.username ? `@${profile.username}` : (profile.name ?? `Instagram account ${profile.userId}`);
}

/**
 * The customer's name, from Instagram's User Profile API on the connected account's own token
 * (`GET /<IGSID>?fields=name,username`, permission `instagram_business_manage_messages`). A Login connection's token
 * belongs to `graph.instagram.com`; the Page-based lookups in lib/channels/messenger/profile.ts call
 * `graph.facebook.com` and are refused for it, which is what left "Instagram customer" on every conversation.
 * Best effort like they are: it never throws, and no name simply leaves the placeholder. A customer with no display
 * name is shown by their @handle.
 */
export async function fetchInstagramLoginCustomerName(token: string, igsid: string): Promise<string | null> {
  try {
    const profile = (await graph(`/${encodeURIComponent(igsid)}?fields=name,username`, token, {
      method: "GET",
      retries: 0,
      signal: AbortSignal.timeout(4000),
    })) as { name?: string; username?: string };
    return profileDisplayName(profile);
  } catch (error) {
    console.warn("Instagram profile lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/* ── Webhook subscription ─────────────────────────────────────────────────── */

export async function subscribeInstagramLoginAccount(token: string): Promise<void> {
  await graph(`/me/subscribed_apps?subscribed_fields=${INSTAGRAM_LOGIN_WEBHOOK_FIELDS.join(",")}`, token, { method: "POST" });
}

export async function unsubscribeInstagramLoginAccount(token: string): Promise<void> {
  await graph("/me/subscribed_apps", token, { method: "DELETE", retries: 0 });
}

export interface InstagramLoginSubscription {
  fields: string[];
}

/** What the account is subscribed to, read back after subscribing. Reads `subscribed_fields` (the shape is unconfirmed: TASK-006 Q4). */
export async function listInstagramLoginSubscriptions(token: string): Promise<InstagramLoginSubscription[]> {
  const result = (await graph("/me/subscribed_apps", token, { method: "GET", retries: 0 })) as { data?: Array<{ subscribed_fields?: string[] }> };
  return (result.data ?? []).map((row) => ({ fields: row.subscribed_fields ?? [] }));
}

/** True when the account receives at least `messages`: "connected but silent" is the failure worst to diagnose later. */
export function isSubscribedToLoginMessages(subscriptions: InstagramLoginSubscription[]): boolean {
  return subscriptions.some((subscription) => subscription.fields.includes("messages"));
}

/* ── Sending ──────────────────────────────────────────────────────────────── */

export interface InstagramLoginSendResult {
  messageId: string;
}

async function postLoginMessage(token: string, instagramAccountId: string, body: Record<string, unknown>, metaTag?: "HUMAN_AGENT"): Promise<InstagramLoginSendResult> {
  const result = (await graph(`/${encodeURIComponent(instagramAccountId)}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ ...(metaTag ? { messaging_type: "MESSAGE_TAG", tag: metaTag } : {}), ...body }),
  })) as { message_id?: string };
  if (!result.message_id) throw new InstagramLoginApiError("Instagram send returned no message id", 200, result);
  return { messageId: result.message_id };
}

export function sendInstagramLoginText(token: string, instagramAccountId: string, igsid: string, text: string, metaTag?: "HUMAN_AGENT"): Promise<InstagramLoginSendResult> {
  return postLoginMessage(token, instagramAccountId, { recipient: { id: igsid }, message: { text } }, metaTag);
}

/** An image, by URL, sent through an Instagram Login connection. The caller sends any caption as a text after. */
export function sendInstagramLoginImage(token: string, instagramAccountId: string, igsid: string, url: string, metaTag?: "HUMAN_AGENT"): Promise<InstagramLoginSendResult> {
  return postLoginMessage(token, instagramAccountId, { recipient: { id: igsid }, message: { attachment: { type: "image", payload: { url, is_reusable: false } } } }, metaTag);
}

/** Text plus tappable quick replies (13 at most, 20-character titles, truncated defensively). A tap arrives as an ordinary message. */
export function sendInstagramLoginQuickReplies(
  token: string,
  instagramAccountId: string,
  igsid: string,
  text: string,
  replies: Array<{ id: string; title: string }>,
  metaTag?: "HUMAN_AGENT",
): Promise<InstagramLoginSendResult> {
  return postLoginMessage(
    token,
    instagramAccountId,
    {
      recipient: { id: igsid },
      message: { text, quick_replies: replies.slice(0, 13).map((reply) => ({ content_type: "text", title: reply.title.slice(0, 20).trim(), payload: reply.id })) },
    },
    metaTag,
  );
}

/** `mark_seen` / `typing_on`: best effort at every call site. */
export async function sendInstagramLoginAction(token: string, instagramAccountId: string, igsid: string, action: "mark_seen" | "typing_on" | "typing_off"): Promise<void> {
  await graph(`/${encodeURIComponent(instagramAccountId)}/messages`, token, { method: "POST", retries: 0, body: JSON.stringify({ recipient: { id: igsid }, sender_action: action }) });
}
