/**
 * Messenger Platform Graph calls — send, Page subscription and Page discovery. Pure HTTP: the caller supplies
 * the Page access token (read from Vault) and this module never touches the database. Built on the shared
 * Graph client (lib/meta/graph.ts), so retry/backoff and Meta's own error text behave exactly as on WhatsApp.
 *
 * Endpoint shapes are from Meta's Messenger Platform Send API docs: `POST /{PAGE_ID}/messages` with a
 * Page access token; `messaging_type: RESPONSE` for a reply inside the 24-hour window.
 */

import "server-only";

import type { ChannelErrorClass } from "@/lib/channels/adapter";
import { MetaGraphError, metaGraphFetch, metaGraphVersion } from "@/lib/meta/graph";

const target = () => ({ host: "facebook", version: metaGraphVersion() }) as const;

export class MessengerApiError extends MetaGraphError {
  constructor(message: string, status: number, body: unknown) {
    super(message, status, body);
    this.name = "MessengerApiError";
  }
}

function graph(path: string, token: string, init: RequestInit & { retries?: number } = {}): Promise<unknown> {
  return metaGraphFetch(target(), path, token, { ...init, errorClass: MessengerApiError, label: "Messenger Graph API" });
}

/* ── Sending ──────────────────────────────────────────────────────────────── */

export interface MessengerQuickReply {
  /** Echoed back as `quick_reply.payload` when tapped — a stable machine id, not display text. */
  id: string;
  title: string;
}

export interface MessengerSendResult {
  messageId: string;
}

async function postMessage(pageToken: string, pageId: string, body: Record<string, unknown>, metaTag?: "HUMAN_AGENT"): Promise<MessengerSendResult> {
  const result = (await graph(`/${encodeURIComponent(pageId)}/messages`, pageToken, {
    method: "POST",
    body: JSON.stringify({ messaging_type: metaTag ? "MESSAGE_TAG" : "RESPONSE", ...(metaTag ? { tag: metaTag } : {}), ...body }),
  })) as { message_id?: string };
  if (!result.message_id) throw new MessengerApiError("Messenger send returned no message id", 200, result);
  return { messageId: result.message_id };
}

/** A plain text reply inside the 24-hour window. The 7-day HUMAN_AGENT tag is deliberately not used here (it needs its own App Review feature). */
export function sendMessengerText(pageToken: string, pageId: string, psid: string, text: string, metaTag?: "HUMAN_AGENT"): Promise<MessengerSendResult> {
  return postMessage(pageToken, pageId, { recipient: { id: psid }, message: { text } }, metaTag);
}

/**
 * Text plus tappable quick replies. Meta limits: 13 quick replies, 20-character titles (believed — see plan
 * §1.1 "verify"); the assistant never offers more than three, and titles are truncated defensively.
 * A tap arrives as an ordinary message whose text is the title, so the same agent loop handles it.
 */
export function sendMessengerQuickReplies(
  pageToken: string,
  pageId: string,
  psid: string,
  text: string,
  replies: MessengerQuickReply[],
  metaTag?: "HUMAN_AGENT",
): Promise<MessengerSendResult> {
  return postMessage(pageToken, pageId, {
    recipient: { id: psid },
    message: {
      text,
      quick_replies: replies.slice(0, 13).map((reply) => ({ content_type: "text", title: reply.title.slice(0, 20).trim(), payload: reply.id })),
    },
  }, metaTag);
}

/**
 * An image or file attachment, by URL. Meta fetches the URL once; `is_reusable: false` keeps the upload from being cached as an
 * attachment id we would then have to protect. A caption is not part of an attachment message: the caller sends it as a text after.
 */
export function sendMessengerAttachment(
  pageToken: string,
  pageId: string,
  psid: string,
  attachment: { kind: "image" | "file"; url: string },
  metaTag?: "HUMAN_AGENT",
): Promise<MessengerSendResult> {
  return postMessage(pageToken, pageId, {
    recipient: { id: psid },
    message: { attachment: { type: attachment.kind, payload: { url: attachment.url, is_reusable: false } } },
  }, metaTag);
}

/** `mark_seen` and `typing_on` — the bubble clears when the next message is sent. Best effort at every call site. */
export async function sendMessengerAction(
  pageToken: string,
  pageId: string,
  psid: string,
  action: "mark_seen" | "typing_on" | "typing_off",
): Promise<void> {
  await graph(`/${encodeURIComponent(pageId)}/messages`, pageToken, {
    method: "POST",
    retries: 0,
    body: JSON.stringify({ recipient: { id: psid }, sender_action: action }),
  });
}

/* ── Subscription ─────────────────────────────────────────────────────────── */

/** The webhook fields our handler acts on (lib/channels/messenger/webhook.ts). */
export const MESSENGER_SUBSCRIBED_FIELDS = ["messages", "messaging_postbacks", "message_deliveries", "message_reads", "message_echoes"] as const;

export async function subscribePageToApp(pageId: string, pageToken: string): Promise<void> {
  await graph(`/${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, {
    method: "POST",
    body: JSON.stringify({ subscribed_fields: [...MESSENGER_SUBSCRIBED_FIELDS] }),
  });
}

export async function unsubscribePageFromApp(pageId: string, pageToken: string): Promise<void> {
  await graph(`/${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: "DELETE" });
}

export interface PageSubscription {
  appId: string | null;
  fields: string[];
}

export async function listPageSubscriptions(pageId: string, pageToken: string): Promise<PageSubscription[]> {
  const result = (await graph(`/${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: "GET", retries: 0 })) as {
    data?: Array<{ id?: string; subscribed_fields?: string[] }>;
  };
  return (result.data ?? []).map((row) => ({ appId: row.id ?? null, fields: row.subscribed_fields ?? [] }));
}

/**
 * True when OUR app is subscribed to the Page and receives at least `messages`. Read back after subscribing:
 * Instagram (and sometimes Messenger) accept the POST yet deliver nothing, and "connected but silent" is the
 * failure worst to diagnose later (plan F10).
 */
export function isSubscribedToMessages(subscriptions: PageSubscription[], ourAppId: string): boolean {
  return subscriptions.some((subscription) => subscription.appId === ourAppId && subscription.fields.includes("messages"));
}

/* ── Page discovery ───────────────────────────────────────────────────────── */

export interface GrantedPage {
  id: string;
  name: string | null;
  /** Page access token. A secret: goes to Vault, never to a column or a log. */
  accessToken: string;
}

const PAGE_PERMISSIONS = new Set(["pages_messaging", "pages_manage_metadata", "pages_show_list", "pages_read_engagement"]);

/** Page ids named by a token's granular scopes (what Meta actually granted), or [] when it names none. */
export function pageIdsFromGranularScopes(granularScopes: Array<{ scope: string; targetIds: string[] }>): string[] {
  return [...new Set(granularScopes.filter((g) => PAGE_PERMISSIONS.has(g.scope)).flatMap((g) => g.targetIds))];
}

/**
 * The Pages a login granted, each with its own Page token. Two sources because the token type varies with the
 * Facebook Login for Business configuration (plan F15 — verify in Dev mode which one your configuration yields):
 *  - a user token lists its Pages at /me/accounts, tokens included;
 *  - a system-user token may not, so any Page id named in the debug_token granular scopes is fetched directly.
 * Never throws for one bad Page: an unreadable Page is simply not offered.
 */
export async function listGrantedPages(userToken: string, grantedPageIds: string[]): Promise<GrantedPage[]> {
  const byId = new Map<string, GrantedPage>();

  try {
    const accounts = (await graph(`/me/accounts?fields=id,name,access_token&limit=100`, userToken, { method: "GET", retries: 0 })) as {
      data?: Array<{ id?: string; name?: string; access_token?: string }>;
    };
    for (const page of accounts.data ?? []) {
      if (page.id && page.access_token) byId.set(page.id, { id: page.id, name: page.name ?? null, accessToken: page.access_token });
    }
  } catch {
    // Not fatal: fall through to the per-Page lookups below.
  }

  for (const pageId of grantedPageIds) {
    if (byId.has(pageId)) continue;
    try {
      const page = (await graph(`/${encodeURIComponent(pageId)}?fields=id,name,access_token`, userToken, { method: "GET", retries: 0 })) as {
        id?: string;
        name?: string;
        access_token?: string;
      };
      if (page.id && page.access_token) byId.set(page.id, { id: page.id, name: page.name ?? null, accessToken: page.access_token });
    } catch {
      // A Page we cannot read is not offered.
    }
  }

  // When the granular scopes name specific Pages, offer only those; otherwise everything /me/accounts returned.
  const pages = [...byId.values()];
  return grantedPageIds.length > 0 ? pages.filter((page) => grantedPageIds.includes(page.id)) : pages;
}

/** Reads the Page's public name — used by "Test connection" to prove the stored token still works. */
export async function getPageName(pageId: string, pageToken: string): Promise<string | null> {
  const page = (await graph(`/${encodeURIComponent(pageId)}?fields=name`, pageToken, { method: "GET", retries: 0 })) as { name?: string };
  return page.name ?? null;
}

/* ── Error classification ─────────────────────────────────────────────────── */

/**
 * Maps a Messenger Graph error onto the shared classes the drains act on. Codes are from Meta's Graph error
 * reference as recalled and are marked "verify" in plan §1.1 until seen in Dev mode:
 *  - 190 / 102: the token is invalid or expired → reconnect;
 *  - 10 with subcode 2018278 (Messenger) or 2534022 (Instagram): the message is outside the allowed (24h) window;
 *  - 4, 17, 32, 613 or HTTP 429: rate limited → worth a bounded retry.
 * Anything else is UNKNOWN and is logged, never retried blind.
 */
export function classifyMessengerError(error: unknown): ChannelErrorClass {
  if (!(error instanceof MetaGraphError)) return "UNKNOWN";
  const detail = (error.body as { error?: { code?: number; error_subcode?: number } } | null)?.error;
  const code = detail?.code;
  if (code === 190 || code === 102) return "TOKEN_DEAD";
  if (code === 10 && (detail?.error_subcode === 2018278 || detail?.error_subcode === 2534022)) return "OUTSIDE_SERVICE_WINDOW";
  if (code === 4 || code === 17 || code === 32 || code === 613 || error.status === 429) return "RATE_LIMITED";
  return "UNKNOWN";
}
