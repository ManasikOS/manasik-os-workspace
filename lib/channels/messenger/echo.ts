/**
 * Messenger "echoes" — plan finding F6.
 *
 * An echo fires for a message the Page sent. That includes messages OUR OWN app sent through the API, not
 * only a person typing in the Page inbox. Our AI reply's row is saved after the send returns, so its echo
 * can arrive first and look like an unknown human message — which would flip the conversation to
 * HUMAN_ACTIVE and silence the assistant on its own reply.
 *
 * So the webhook never acts on an echo it does not recognise straight away:
 *   1. an echo from our own app id is ignored outright;
 *   2. an echo whose message id is already stored is ignored;
 *   3. anything else is deferred a few seconds (a RECONCILE_ECHO job), and only if the message is STILL
 *      unknown then is it recorded as a person and the conversation handed to staff.
 */

import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";
import { insertMessage, markConversationHandledFromBusinessApp, messageExistsByExternalId } from "@/lib/data/whatsapp-repository";
import type { PageMessagingChannel } from "@/lib/channels/messenger/webhook";
import type { MessageType } from "@/lib/types/whatsapp";

/** Long enough for an in-flight send to save its message id; short enough that a real colleague reply silences the assistant promptly. */
export const ECHO_RECONCILE_DELAY_MS = 10_000;

export const MESSENGER_PAGE_INBOX_LABEL = "Messenger Page inbox";
export const INSTAGRAM_INBOX_LABEL = "Instagram inbox";

export function classifyEcho(appId: string | null, ownAppId: string | undefined): "OWN_APP" | "OTHER" {
  return appId !== null && ownAppId !== undefined && ownAppId.length > 0 && appId === ownAppId ? "OWN_APP" : "OTHER";
}

export interface EchoJobPayload {
  /** Absent on jobs queued before Instagram existed — those are Messenger. */
  channel?: PageMessagingChannel;
  connectionId: string;
  pageId: string;
  psid: string;
  mid: string;
  text: string;
  messageType: Extract<MessageType, "TEXT" | "IMAGE" | "AUDIO" | "DOCUMENT">;
  contactName: string;
}

export type EchoReconcileResult = "ALREADY_KNOWN" | "RECORDED_AS_PERSON";

export interface EchoDeps {
  messageExists: typeof messageExistsByExternalId;
  markHandled: typeof markConversationHandledFromBusinessApp;
  insertMessage: typeof insertMessage;
}

const defaultDeps: EchoDeps = {
  messageExists: messageExistsByExternalId,
  markHandled: markConversationHandledFromBusinessApp,
  insertMessage,
};

export async function reconcileEcho(db: Db, agencyId: string, payload: EchoJobPayload, deps: EchoDeps = defaultDeps): Promise<EchoReconcileResult> {
  // Recognised by now: either our own send finished saving it, or a redelivery already recorded it.
  if (await deps.messageExists(db, agencyId, payload.mid, { includePartIds: true })) return "ALREADY_KNOWN";

  const channel = payload.channel ?? "MESSENGER";
  const conversation = await deps.markHandled(db, {
    agencyId,
    waId: payload.psid,
    contactName: payload.contactName,
    channel,
    connectionId: payload.connectionId,
  });

  await deps.insertMessage(db, {
    agencyId,
    conversationId: conversation.id,
    externalMessageId: payload.mid,
    role: "staff",
    actorKind: "STAFF",
    actorName: channel === "INSTAGRAM" ? INSTAGRAM_INBOX_LABEL : MESSENGER_PAGE_INBOX_LABEL,
    content: payload.text,
    messageType: payload.messageType,
    deliveryStatus: "SENT",
    metadata: { source: channel === "INSTAGRAM" ? "instagram_inbox" : "messenger_page_inbox" },
  });
  return "RECORDED_AS_PERSON";
}
