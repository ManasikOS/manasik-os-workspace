import "server-only";

import type { Db } from "@/lib/ai/db";
import { getChannelAdapter } from "@/lib/channels/registry";
import type { ChannelProvider } from "@/lib/inbox/contracts";
import { inboxAttachmentFamily } from "@/lib/inbox/media/classify";
import type { WhatsAppIntegrationRow } from "@/lib/types/whatsapp";
import { sendText } from "@/lib/whatsapp/client";
import { readWhatsAppToken } from "@/lib/whatsapp/vault";
import { testAgencySendRefusal } from "@/lib/inbox/outbound/test-agency-send-guard";
import { outboundRecipientRefusal } from "@/lib/inbox/outbound/outbound-allowlist";

/** What the customer is told when they send a message type the Inbox does not accept. */
export const UNSUPPORTED_ATTACHMENT_TEXT =
  "Sorry, this message type isn't supported. Please send a text message, a document (such as PDF or Word), an image, or an audio message instead.";

/** Accept only the four supported WhatsApp message types; unknown/new types fail closed. */
export function isUnsupportedWhatsAppMessage(message: { type?: string; document?: { mime_type?: string } }): boolean {
  if (message.type === "document") {
    return inboxAttachmentFamily({ mimeType: message.document?.mime_type ?? "application/octet-stream", providerType: "file" }) === null;
  }
  return message.type !== "text" && message.type !== "image" && message.type !== "audio";
}

/** Best effort: a failed notice never fails the webhook, which must still acknowledge Meta. */
export async function sendWhatsAppUnsupportedNotice(db: Db, integration: WhatsAppIntegrationRow, to: string): Promise<void> {
  try {
    if (!integration.credential_ref || !integration.phone_number_id) return;
    if (await testAgencySendRefusal(db, integration.agency_id)) return;
    if (outboundRecipientRefusal(to)) return;
    const token = await readWhatsAppToken(db, integration.credential_ref);
    if (!token) return;
    await sendText(integration.phone_number_id, token, to, UNSUPPORTED_ATTACHMENT_TEXT);
  } catch (cause) {
    console.error("Could not send the unsupported-file notice:", cause instanceof Error ? cause.message : cause);
  }
}

/** The same notice for Messenger and Instagram, through the channel adapter. Best effort. */
export async function sendPageChannelUnsupportedNotice(db: Db, input: { agencyId: string; provider: ChannelProvider; connectionId: string; to: string }): Promise<void> {
  try {
    if (await testAgencySendRefusal(db, input.agencyId)) return;
    if (outboundRecipientRefusal(input.to)) return;
    const adapter = getChannelAdapter(input.provider);
    const connection = await adapter.resolveConnectionForChannelConnection(db, input.agencyId, input.connectionId);
    if (!connection) return;
    const token = await adapter.readToken(db, connection);
    if (!token) return;
    await adapter.sendReply(connection, token, { to: input.to, text: UNSUPPORTED_ATTACHMENT_TEXT });
  } catch (cause) {
    console.error("Could not send the unsupported-file notice:", cause instanceof Error ? cause.message : cause);
  }
}
