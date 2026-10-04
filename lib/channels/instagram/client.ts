/**
 * Instagram messaging Graph calls, made with the connected Facebook Page's access token (Instagram Messaging
 * through Facebook Login for Business). Pure HTTP: the caller supplies the token and this module never touches
 * the database. Built on the shared Graph client, so retry/backoff and Meta's error text behave as on WhatsApp.
 *
 * Endpoint shapes are from Meta's Instagram Messaging docs: `POST /me/messages` with the Page token and the
 * customer's Instagram-scoped id (IGSID) as `recipient.id`. Unlike Messenger there is no `messaging_type`.
 * The Instagram-specific limits (1000 characters of text, replies only within 24 hours of the customer's last
 * message) are enforced by the channel profile and the drain, not here.
 */

import "server-only";

import { MetaGraphError, metaGraphFetch, metaGraphVersion } from "@/lib/meta/graph";

const target = () => ({ host: "facebook", version: metaGraphVersion() }) as const;

export class InstagramApiError extends MetaGraphError {
  constructor(message: string, status: number, body: unknown) {
    super(message, status, body);
    this.name = "InstagramApiError";
  }
}

function graph(path: string, token: string, init: RequestInit & { retries?: number } = {}): Promise<unknown> {
  return metaGraphFetch(target(), path, token, { ...init, errorClass: InstagramApiError, label: "Instagram Graph API" });
}

export interface InstagramQuickReply {
  /** Echoed back as `quick_reply.payload` when tapped — a stable machine id, not display text. */
  id: string;
  title: string;
}

export interface InstagramSendResult {
  messageId: string;
}

async function postMessage(pageToken: string, body: Record<string, unknown>, metaTag?: "HUMAN_AGENT"): Promise<InstagramSendResult> {
  const result = (await graph("/me/messages", pageToken, { method: "POST", body: JSON.stringify({ ...(metaTag ? { messaging_type: "MESSAGE_TAG", tag: metaTag } : {}), ...body }) })) as { message_id?: string };
  if (!result.message_id) throw new InstagramApiError("Instagram send returned no message id", 200, result);
  return { messageId: result.message_id };
}

export function sendInstagramText(pageToken: string, igsid: string, text: string, metaTag?: "HUMAN_AGENT"): Promise<InstagramSendResult> {
  return postMessage(pageToken, { recipient: { id: igsid }, message: { text } }, metaTag);
}

/** Text plus tappable quick replies (Instagram allows up to 13, 20-character titles — truncated defensively). A tap arrives as an ordinary message. */
export function sendInstagramQuickReplies(pageToken: string, igsid: string, text: string, replies: InstagramQuickReply[], metaTag?: "HUMAN_AGENT"): Promise<InstagramSendResult> {
  return postMessage(pageToken, {
    recipient: { id: igsid },
    message: {
      text,
      quick_replies: replies.slice(0, 13).map((reply) => ({ content_type: "text", title: reply.title.slice(0, 20).trim(), payload: reply.id })),
    },
  }, metaTag);
}

/** An image, by URL (Instagram messaging carries images, not documents). The caller sends any caption as a text after. */
export function sendInstagramImage(pageToken: string, igsid: string, url: string, metaTag?: "HUMAN_AGENT"): Promise<InstagramSendResult> {
  return postMessage(pageToken, { recipient: { id: igsid }, message: { attachment: { type: "image", payload: { url, is_reusable: false } } } }, metaTag);
}

/** `mark_seen` / `typing_on` — best effort at every call site; the bubble clears when the next message is sent. */
export async function sendInstagramAction(pageToken: string, igsid: string, action: "mark_seen" | "typing_on" | "typing_off"): Promise<void> {
  await graph("/me/messages", pageToken, { method: "POST", retries: 0, body: JSON.stringify({ recipient: { id: igsid }, sender_action: action }) });
}

export interface LinkedInstagramAccount {
  /** The Instagram professional account id — the `entry.id` of every webhook for it. */
  id: string;
  username: string | null;
  name: string | null;
}

/**
 * The Instagram professional account linked to a Page, or null when there is none. Read with the Page token; the
 * Page grants nothing about Instagram unless the account is linked to it in Meta Business Suite.
 */
export async function getLinkedInstagramAccount(pageId: string, pageToken: string): Promise<LinkedInstagramAccount | null> {
  const page = (await graph(`/${encodeURIComponent(pageId)}?fields=instagram_business_account{id,username,name}`, pageToken, {
    method: "GET",
    retries: 0,
  })) as { instagram_business_account?: { id?: string; username?: string; name?: string } };
  const account = page.instagram_business_account;
  if (!account?.id) return null;
  return { id: account.id, username: account.username ?? null, name: account.name ?? null };
}

/** Reads the account's username — used by "Test connection" to prove the stored token still works. */
export async function getInstagramAccountLabel(instagramAccountId: string, pageToken: string): Promise<string | null> {
  const account = (await graph(`/${encodeURIComponent(instagramAccountId)}?fields=username,name`, pageToken, { method: "GET", retries: 0 })) as {
    username?: string;
    name?: string;
  };
  return account.username ? `@${account.username}` : (account.name ?? null);
}
