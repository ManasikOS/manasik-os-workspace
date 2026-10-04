/**
 * WhatsApp behind the channel-adapter seam. Every branch here is code that used to live inline in
 * lib/agent/whatsapp/drain.ts and lib/inbox/outbox/drain.ts, moved verbatim so the WhatsApp path
 * behaves exactly as before — the point of Phase 1 of
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md.
 */

import "server-only";

import { BOOK_NOW_REPLY } from "@/lib/agent/whatsapp/quick-replies";
import type { ChannelRuntimeAdapter, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { getChannelProfile } from "@/lib/channels/profile";
import { getIntegrationByAgency } from "@/lib/data/whatsapp-repository";
import { recordConnectionEvent } from "@/lib/data/whatsapp-connection-repository";
import type { WhatsAppIntegrationRow } from "@/lib/types/whatsapp";
import {
  classifyWhatsAppError,
  downloadMedia,
  formatCallNowLine,
  sendInteractiveButtons,
  sendMedia,
  sendText,
  sendTypingIndicator,
} from "@/lib/whatsapp/client";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";

function toConnection(row: WhatsAppIntegrationRow): ResolvedChannelConnection {
  return {
    provider: "WHATSAPP",
    id: row.id,
    status: row.status,
    credentialRef: row.credential_ref,
    displayAddress: row.display_phone_number,
    fundingStatus: row.funding_status,
    accountId: row.phone_number_id,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const whatsappChannelAdapter: ChannelRuntimeAdapter = {
  provider: "WHATSAPP",
  profile: getChannelProfile("WHATSAPP"),

  async resolveConnection(db, agencyId) {
    const row = await getIntegrationByAgency(db, agencyId);
    return row ? toConnection(row) : null;
  },

  async resolveConnectionForChannelConnection(db, agencyId, channelConnectionId) {
    const { data: connection } = await db
      .from("channel_connections")
      .select("legacy_whatsapp_integration_id")
      .eq("id", channelConnectionId)
      .eq("agency_id", agencyId)
      .maybeSingle();
    const legacyId = (connection as { legacy_whatsapp_integration_id: string | null } | null)?.legacy_whatsapp_integration_id;
    if (!legacyId) return null;

    const { data: integration } = await db
      .from("whatsapp_integrations")
      .select("*")
      .eq("id", legacyId)
      .eq("agency_id", agencyId)
      .maybeSingle();
    return integration ? toConnection(integration as WhatsAppIntegrationRow) : null;
  },

  async readToken(db, connection) {
    return connection.credentialRef ? readWhatsAppToken(db, connection.credentialRef) : null;
  },

  // The Call Now affordance rides only the Book Now turns rather than every reply — a phone number on
  // every message reads as spam; on the one moment a specific departure was just shown, it reads as a
  // second, equally fast way to act. (Moved unchanged from the reply drain.)
  decorateReplyText(text, buttons, connection) {
    const offersBookNow = buttons.some((button) => button.id === BOOK_NOW_REPLY.id);
    return offersBookNow && connection.displayAddress ? `${text}\n\n${formatCallNowLine(connection.displayAddress)}` : text;
  },

  async sendReply(connection, token, reply) {
    if (!connection.accountId) throw new Error("WhatsApp connection has no phone number id.");
    const hasButtons = (reply.buttons?.length ?? 0) > 0;
    return hasButtons
      ? sendInteractiveButtons(connection.accountId, token, reply.to, reply.text, reply.buttons ?? [])
      : sendText(connection.accountId, token, reply.to, reply.text);
  },

  async sendMedia(connection, token, media) {
    if (!connection.accountId) throw new Error("WhatsApp connection has no phone number id.");
    return sendMedia(connection.accountId, token, media.to, {
      kind: media.kind,
      link: media.url,
      ...(media.caption ? { caption: media.caption } : {}),
      filename: media.filename,
    });
  },

  async sendTyping(connection, token, target) {
    if (!connection.accountId) return;
    await sendTypingIndicator(connection.accountId, token, target.customerMessageId);
  },

  async fetchAudio(_connection, token, mediaId) {
    return downloadMedia(token, mediaId);
  },

  async fetchAttachment(_connection, token, mediaId) {
    const file = await downloadMedia(token, mediaId);
    if (file.bytes.byteLength > 10 * 1024 * 1024) throw new Error("The attachment is too large.");
    return file;
  },

  classifyError: classifyWhatsAppError,

  async reflectSendFailure(db, connection, agencyId, errorClass, error) {
    // F11/E3 — never retry a dead token. Reflect it on the integration immediately (the connect card
    // and Inbox both read `status`) instead of waiting for three failed attempts to say the same thing.
    if (errorClass === "TOKEN_DEAD") {
      await db
        .from("whatsapp_integrations")
        .update({ status: "ERROR", last_error: "WhatsApp rejected the stored access token — reconnect required." })
        .eq("id", connection.id);
      await recordConnectionEvent(db, {
        agencyId,
        integrationId: connection.id,
        kind: "SEND_TOKEN_DEAD",
        detail: { error: errorText(error) },
      }).catch(() => undefined);
      return;
    }
    if (errorClass === "UNFUNDED") {
      // E9 — detected from the send-error taxonomy, the other half of F10's "also from account_update".
      await db
        .from("whatsapp_integrations")
        .update({
          status: "UNFUNDED",
          funding_status: "UNFUNDED",
          last_error: "Meta rejected this send — no valid payment method is attached to this WhatsApp Business Account.",
        })
        .eq("id", connection.id);
      await recordConnectionEvent(db, {
        agencyId,
        integrationId: connection.id,
        kind: "SEND_UNFUNDED",
        detail: { error: errorText(error) },
      }).catch(() => undefined);
    }
  },

  async reflectSendSuccess(db, connection) {
    // E9 — a send that just succeeded is the clearest signal a prior funding problem has cleared. Only
    // funding_status flips back: `status` was already CONNECTED, or the caller would not have sent.
    if (connection.fundingStatus !== "UNFUNDED") return;
    await db
      .from("whatsapp_integrations")
      .update({ funding_status: "FUNDED" })
      .eq("id", connection.id)
      .then(
        () => undefined,
        () => undefined,
      );
  },
};
