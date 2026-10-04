/**
 * Inbound WhatsApp messages: which ones a delivery holds, and storing them. Shared by the webhook (a live delivery) and the raw-event
 * reconciler (I2, replaying a delivery whose messages never landed). No Next.js imports, so the always-on worker can load it.
 */

import { countryForWaId, waIdToMobile } from "@/lib/agent/whatsapp/phone";
import { VOICE_DISABLED_TEXT, voiceMediaFromWebhook } from "@/lib/inbox/media/voice-note";
import { upsertMessageCharge } from "@/lib/data/whatsapp-billing-repository";
import type { Db } from "@/lib/data/whatsapp-repository";
import { ingestInboundMessage } from "@/lib/inbox/ingest";
import { isUnsupportedWhatsAppMessage } from "@/lib/inbox/media/unsupported-notice";
import { resolveCampaignAttributionFromMessageText } from "@/lib/whatsapp/campaign-attribution";
import type { WhatsAppWebhookPayload } from "@/lib/types/whatsapp";

/**
 * True for a tapped emoji reaction — a customer's on an inbound `messages` entry, or the agency's own on a
 * `message_echoes` entry from the WhatsApp Business app (coexistence). Meta gives it a real id/from-or-to like
 * any other message, but no text, so nothing that only checks `id`/`from` can tell it apart from a real message
 * on its own — checked wherever either array is walked, before extractMessageText/extractMessageType (neither
 * knows "reaction" and would resolve it to "" / TEXT, landing as an empty message in the Inbox).
 */
export function isReactionMessage(message: { type?: string }): boolean {
  return message.type === "reaction";
}

/**
 * The ids of the inbound messages in a delivery that the Inbox will store: the ones the handler below actually ingests.
 * Unsupported media is answered with a notice and never stored, so it is left out — otherwise every redelivery would look
 * like a missing message and send the customer the notice again.
 */
export function storableInboundMessageIds(payload: WhatsAppWebhookPayload): string[] {
  const ids: string[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (!message.from || !message.id || isReactionMessage(message) || isUnsupportedWhatsAppMessage(message)) continue;
        ids.push(message.id);
      }
    }
  }
  return ids;
}

export interface InboundMessage {
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
}

/**
 * A tapped reply button (e.g. "Book Now 📅") is folded into plain text here
 * — its title becomes the inbound message content, so the SAME tool-calling
 * agent loop that handles a typed reply handles a tap, with no separate
 * button-routing code. See sendInteractiveButtons() in lib/whatsapp/client.ts.
 */
export function extractMessageText(message: InboundMessage): string {
  if (message.type === "text") return message.text?.body ?? "";
  if (message.type === "image") return message.image?.caption ?? "";
  if (message.type === "interactive") return message.interactive?.button_reply?.title ?? "";
  return "";
}

export function extractMessageType(
  message: { type?: string },
): "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "INTERACTIVE" {
  switch (message.type) {
    case "audio":
      return "AUDIO";
    case "image":
      return "IMAGE";
    case "document":
      return "DOCUMENT";
    case "interactive":
      return "INTERACTIVE";
    default:
      return "TEXT";
  }
}

export interface WhatsAppInboundIngestResult {
  enqueuedJobIds: string[];
  enrichQueued: boolean;
  /** Senders to tell that their message type is not supported. Sent by the caller, after Meta has its 200 (never on a replay). */
  unsupportedNoticeRecipients: string[];
}

/**
 * Stores every inbound customer message in a delivery and queues the work each one needs. Idempotent per message (the ingest RPC
 * keys on the message id), so running it again over a delivery whose messages are already stored changes nothing. The webhook calls
 * it for a live delivery; the raw-event reconciler (I2) calls it to replay a delivery whose messages never landed.
 */
export async function ingestWhatsAppInboundMessages(
  admin: Db,
  agencyId: string,
  payload: WhatsAppWebhookPayload,
): Promise<WhatsAppInboundIngestResult> {
  const noticedSenders = new Set<string>();
  // Answered after Meta has its 200: the notice is a call to Meta's API, which must not sit on the acknowledgement path.
  const unsupportedNoticeRecipients: string[] = [];
  const enqueuedJobIds: string[] = [];
  let enrichQueued = false;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const message of value.messages ?? []) {
        if (!message.from || !message.id) continue;

        // A tapped emoji reaction on one of our messages, not a message of its own. Nothing to notice the
        // customer about, so it's dropped silently, the same way Messenger drops reactions.
        if (isReactionMessage(message)) continue;

        // Only text, images, documents and audio reach the Inbox. Refuse contacts, locations and all other types
        // before they can become empty messages. Once per sender per delivery, so a burst gets one reply.
        if (isUnsupportedWhatsAppMessage(message)) {
          if (!noticedSenders.has(message.from)) {
            noticedSenders.add(message.from);
            unsupportedNoticeRecipients.push(message.from);
          }
          continue;
        }

        const contactName =
          value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? waIdToMobile(message.from);
        const messageText = extractMessageText(message);

        // Resolved from a click-to-chat tracking code/QR in the opening
        // message — see lib/whatsapp/campaign-attribution.ts. Cheap to run
        // on every inbound message (it's a no-op once a conversation already
        // has an attribution or a lead), and it must run before the
        // conversation row is written so first-touch capture actually lands.
        const attribution = await resolveCampaignAttributionFromMessageText(
          admin,
          agencyId,
          messageText,
        ).catch((error) => {
          console.error("WhatsApp webhook: campaign attribution lookup failed:", error);
          return null;
        });

        const voiceMedia = message.type === "audio" ? voiceMediaFromWebhook(message) : null;
        const inboundAttachment = voiceMedia
          ? { type: "audio", media_id: voiceMedia.mediaId, mime_type: voiceMedia.mimeType }
          : message.type === "image" && message.image?.id
            ? { type: "image", media_id: message.image.id, mime_type: message.image.mime_type ?? "image/jpeg" }
            : message.type === "document" && message.document?.id
              ? { type: "file", media_id: message.document.id, mime_type: message.document.mime_type ?? "application/octet-stream", filename: message.document.filename ?? null }
              : null;
        // Voice notes remain available for staff playback, but are not sent to a transcription model.
        const contentToStore = message.type === "audio" ? VOICE_DISABLED_TEXT : messageText;

        // The shared inbound path (lib/inbox/ingest.ts): conversation → lead link → idempotent message →
        // agent job. Everything before it (parsing, attribution) and after it (billing) is WhatsApp-only.
        const ingested = await ingestInboundMessage(admin, {
          agencyId: agencyId,
          provider: "WHATSAPP",
          externalConversationId: message.from,
          contactName,
          normalizedPhone: waIdToMobile(message.from),
          externalMessageId: message.id,
          content: contentToStore,
          messageType: extractMessageType(message),
          metadata: {
            raw_type: message.type,
            ...(voiceMedia ? { media_id: voiceMedia.mediaId, mime_type: voiceMedia.mimeType } : {}),
            ...(inboundAttachment ? { attachments: [inboundAttachment] } : {}),
          },
          attribution,
          agentJobKind: "PROCESS_INBOUND",
          // Inbound messages are always free (F12) — still worth a charge row so volume shows up in
          // attribution even though it never costs.
          afterMessageStored: async ({ conversation, message: stored }) => {
            await upsertMessageCharge(admin, {
              agencyId: agencyId,
              conversationId: conversation.id,
              messageId: stored.id,
              externalMessageId: message.id!,
              direction: "INBOUND",
              billable: false,
              recipientCountry: countryForWaId(message.from!),
              leadId: conversation.lead_id,
            }).catch((error) => console.error("WhatsApp webhook: failed to record inbound charge row:", error));
          },
        });

        if (ingested.status === "stored" && ingested.jobId) enqueuedJobIds.push(ingested.jobId);
        if (ingested.status === "stored" && ingested.enrichQueued) enrichQueued = true;
      }
    }
  }

  return { enqueuedJobIds, enrichQueued, unsupportedNoticeRecipients };
}
