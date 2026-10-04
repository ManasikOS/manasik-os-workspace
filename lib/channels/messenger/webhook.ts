/**
 * Messenger webhook payloads → a small list of normalised events. Pure and dependency-free so every
 * shape Meta sends can be pinned by a unit test. Field names follow Meta's Messenger Platform webhook
 * reference (object `page`; `entry[].messaging[]`); anything not listed here is ignored, never guessed.
 *
 * Direction rules, which are easy to get backwards:
 *  - a customer's message:   sender.id = the customer (PSID), recipient.id = the Page
 *  - an echo (our Page sent): sender.id = the Page,           recipient.id = the customer
 *  - delivery / read:         sender.id = the customer who received/read
 * The Page id is always taken from `entry.id`, never inferred from sender/recipient.
 */

/** The two channels that share this payload shape: a Facebook Page (object `page`) and its linked Instagram account (object `instagram`). */
export type PageMessagingChannel = "MESSENGER" | "INSTAGRAM";

const WEBHOOK_OBJECT: Record<PageMessagingChannel, string> = { MESSENGER: "page", INSTAGRAM: "instagram" };

export interface MessengerMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    /** Instagram: the customer unsent a message. There is nothing left to answer. */
    is_deleted?: boolean;
    /** Instagram: the account messaged itself. */
    is_self?: boolean;
    /** Present on echoes of messages sent through an app's API; identifies which app. Absent for a person in the Page inbox (to be confirmed in Dev mode). */
    app_id?: number | string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { mid?: string; title?: string; payload?: string };
  delivery?: { mids?: string[]; watermark?: number };
  /** Messenger sends a watermark; Instagram sends the id of the message that was read. */
  read?: { watermark?: number; mid?: string };
}

export interface MessengerWebhookPayload {
  object?: string;
  entry?: Array<{ id?: string; time?: number; messaging?: MessengerMessagingEvent[] }>;
}

export type MessengerContentKind = "text" | "image" | "audio" | "video" | "file" | "location" | "other";

export interface MessengerAttachmentRef {
  type: string;
  url: string | null;
}

interface MessageBase {
  pageId: string;
  psid: string;
  mid: string;
  text: string;
  contentKind: MessengerContentKind;
  attachments: MessengerAttachmentRef[];
  timestampMs: number | null;
}

export type ParsedMessengerEvent =
  | (MessageBase & { kind: "message"; viaPostback: boolean })
  | (MessageBase & { kind: "echo"; appId: string | null })
  | { kind: "delivery"; pageId: string; psid: string; mids: string[]; watermarkMs: number | null }
  | { kind: "read"; pageId: string; psid: string; watermarkMs: number | null };

const KNOWN_ATTACHMENT_KINDS: Record<string, MessengerContentKind> = {
  image: "image",
  audio: "audio",
  video: "video",
  file: "file",
  location: "location",
};

function contentKindOf(text: string, attachments: MessengerAttachmentRef[]): MessengerContentKind {
  // Typed text wins: an attachment that arrives with a caption is answered as a text message.
  if (text.trim().length > 0) return "text";
  const first = attachments[0];
  if (!first) return "other";
  return KNOWN_ATTACHMENT_KINDS[first.type] ?? "other";
}

function readMessageBase(pageId: string, psid: string, mid: string, event: MessengerMessagingEvent): MessageBase {
  const text = event.message?.text ?? event.postback?.title ?? "";
  const attachments = (event.message?.attachments ?? []).map((a) => ({ type: a.type ?? "unknown", url: a.payload?.url ?? null }));
  return { pageId, psid, mid, text, contentKind: contentKindOf(text, attachments), attachments, timestampMs: event.timestamp ?? null };
}

/**
 * `null` means "this delivery is not for this channel's webhook object" — the caller records it and stops.
 * An empty array means "recognised, but nothing we act on" (e.g. a reaction). `pageId` in the result is the
 * account id from `entry.id`: the Page id for Messenger, the Instagram professional account id for Instagram.
 */
export function parseMessengerWebhook(payload: MessengerWebhookPayload, channel: PageMessagingChannel = "MESSENGER"): ParsedMessengerEvent[] | null {
  if (payload.object !== WEBHOOK_OBJECT[channel]) return null;

  const events: ParsedMessengerEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    if (!pageId) continue;

    for (const event of entry.messaging ?? []) {
      const message = event.message;

      // Nothing to answer: an unsent message has no content, and an account messaging itself is not a customer.
      if (message?.is_deleted || message?.is_self) continue;

      if (message?.is_echo) {
        const psid = event.recipient?.id;
        if (!psid || !message.mid) continue;
        events.push({
          ...readMessageBase(pageId, psid, message.mid, event),
          kind: "echo",
          appId: message.app_id === undefined || message.app_id === null ? null : String(message.app_id),
        });
        continue;
      }

      if (message) {
        const psid = event.sender?.id;
        if (!psid || !message.mid) continue;
        events.push({ ...readMessageBase(pageId, psid, message.mid, event), kind: "message", viaPostback: false });
        continue;
      }

      if (event.postback) {
        // A tapped button/menu item. Folded into an ordinary message so the same agent loop handles a tap
        // exactly like a typed reply, as the WhatsApp button path does. Meta gives postbacks a `mid`; if one
        // is ever missing a stable synthetic id keeps redeliveries idempotent.
        const psid = event.sender?.id;
        if (!psid) continue;
        const mid = event.postback.mid ?? `postback:${pageId}:${psid}:${event.timestamp ?? 0}:${event.postback.payload ?? ""}`;
        events.push({ ...readMessageBase(pageId, psid, mid, event), kind: "message", viaPostback: true });
        continue;
      }

      if (event.delivery) {
        const psid = event.sender?.id;
        if (!psid) continue;
        events.push({ kind: "delivery", pageId, psid, mids: event.delivery.mids ?? [], watermarkMs: event.delivery.watermark ?? null });
        continue;
      }

      if (event.read) {
        const psid = event.sender?.id;
        if (!psid) continue;
        // Instagram's read event names a message, not a watermark; its own timestamp is the moment of reading.
        events.push({ kind: "read", pageId, psid, watermarkMs: event.read.watermark ?? event.timestamp ?? null });
      }
      // reactions, referrals, opt-ins, handovers: intentionally ignored until a phase needs them.
    }
  }
  return events;
}

/** The CRM message type for a piece of Messenger content. Video, files and anything unrecognised are shown as a document. */
export function messageTypeFor(kind: MessengerContentKind): "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT" {
  switch (kind) {
    case "text":
    case "location":
      return "TEXT";
    case "image":
      return "IMAGE";
    case "audio":
      return "AUDIO";
    default:
      return "DOCUMENT";
  }
}
