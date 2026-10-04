/**
 * Per-connection processing of Messenger / Instagram events, with its collaborators injected so it is unit tested. Shared by the
 * webhook (a live delivery) and the raw-event reconciler (I2, replaying a delivery whose messages never landed). No Next.js imports,
 * so the always-on worker can load it.
 */

import { VOICE_DISABLED_TEXT } from "@/lib/inbox/media/voice-note";
import { classifyEcho, ECHO_RECONCILE_DELAY_MS, type EchoJobPayload } from "@/lib/channels/messenger/echo";
import { namePlaceholderFor, needsProfileName } from "@/lib/channels/messenger/profile";
import {
  messageTypeFor,
  type PageMessagingChannel,
  type ParsedMessengerEvent,
} from "@/lib/channels/messenger/webhook";
import type { ChannelConnectionRecord } from "@/lib/data/channel-connection-repository";
import {
  enqueueJob,
  getConversationContactName,
  markOutboundMessagesReadUpTo,
  messageExistsByExternalId,
  type Db,
} from "@/lib/data/whatsapp-repository";
import { recordMessageDelivery } from "@/lib/inbox/delivery/delivery-updates";
import { ingestInboundMessage } from "@/lib/inbox/ingest";
import { sendPageChannelUnsupportedNotice } from "@/lib/inbox/media/unsupported-notice";

/* ── Per-connection processing (unit tested) ──────────────────────────────── */

export interface MessengerProcessDeps {
  ingest: typeof ingestInboundMessage;
  messageExists: typeof messageExistsByExternalId;
  getContactName: typeof getConversationContactName;
  enqueueJob: typeof enqueueJob;
  patchDelivery: typeof recordMessageDelivery;
  markRead: typeof markOutboundMessagesReadUpTo;
  sendUnsupportedNotice?: typeof sendPageChannelUnsupportedNotice;
}

const defaultProcessDeps: MessengerProcessDeps = {
  ingest: ingestInboundMessage,
  messageExists: messageExistsByExternalId,
  getContactName: getConversationContactName,
  enqueueJob,
  patchDelivery: recordMessageDelivery,
  markRead: markOutboundMessagesReadUpTo,
  sendUnsupportedNotice: sendPageChannelUnsupportedNotice,
};

export interface MessengerProcessResult {
  /** Agent jobs queued now — the shell kicks the drain for them. */
  jobIds: string[];
  /** True when at least one inbound message queued an ENRICH job (Inbox intelligence) — the shell kicks the REALTIME drain for it. */
  enrichQueued: boolean;
  /** True when an unrecognised echo was deferred; the shell schedules a follow-up drain for it. */
  echoDeferred: boolean;
  /** Customers whose name is still a placeholder; the shell looks them up after acknowledging Meta. */
  profilePsids: string[];
}

export async function processMessengerEvents(
  db: Db,
  connection: ChannelConnectionRecord,
  events: ParsedMessengerEvent[],
  options: { agentAllowed: boolean; ownAppId?: string; now?: () => Date; channel?: PageMessagingChannel },
  deps: MessengerProcessDeps = defaultProcessDeps,
): Promise<MessengerProcessResult> {
  const agencyId = connection.agency_id;
  const channel = options.channel ?? "MESSENGER";
  const placeholderName = namePlaceholderFor(channel);
  const now = options.now ?? (() => new Date());
  const result: MessengerProcessResult = { jobIds: [], enrichQueued: false, echoDeferred: false, profilePsids: [] };

  for (const event of events) {
    // The tenant gate resolved THIS connection from the Page id; an event for any other Page is not ours to touch.
    if (event.pageId !== connection.provider_account_id) continue;

    switch (event.kind) {
      case "message": {
        // Already stored (a redelivery): skip before touching the conversation, or a replay hours later would
        // wrongly extend the 24h reply window.
        if (await deps.messageExists(db, agencyId, event.mid)) break;

        // Video is not accepted: nothing is stored or shown; the customer is asked to send something we can open.
        if (event.contentKind === "video" || event.attachments.some((attachment) => attachment.type === "video")) {
          await deps.sendUnsupportedNotice?.(db, { agencyId, provider: channel, connectionId: connection.id, to: event.psid });
          break;
        }

        const storedName = await deps.getContactName(db, agencyId, channel, event.psid);
        if (needsProfileName(storedName) && !result.profilePsids.includes(event.psid)) result.profilePsids.push(event.psid);

        const ingested = await deps.ingest(db, {
          agencyId,
          provider: channel,
          connectionId: connection.id,
          agentAllowed: options.agentAllowed,
          externalConversationId: event.psid,
          contactName: storedName && storedName.trim() ? storedName : placeholderName,
          normalizedPhone: null, // neither Messenger nor Instagram carries a phone number (plan F2)
          externalMessageId: event.mid,
          // Voice notes stay available for staff playback, but are never sent to a transcription model.
          content: event.contentKind === "audio" ? VOICE_DISABLED_TEXT : event.text,
          messageType: messageTypeFor(event.contentKind),
          metadata: {
            raw_type: event.contentKind,
            via_postback: event.viaPostback,
            ...(event.attachments.length > 0 ? { attachments: event.attachments } : {}),
          },
          agentJobKind: "PROCESS_INBOUND",
        });
        if (ingested.status === "stored" && ingested.jobId) result.jobIds.push(ingested.jobId);
        if (ingested.status === "stored" && ingested.enrichQueued) result.enrichQueued = true;
        break;
      }

      case "echo": {
        // F6 — see lib/channels/messenger/echo.ts. Never act on an echo we cannot yet tell from our own send.
        if (classifyEcho(event.appId, options.ownAppId) === "OWN_APP") break;
        if (await deps.messageExists(db, agencyId, event.mid, { includePartIds: true })) break;

        const storedName = await deps.getContactName(db, agencyId, channel, event.psid);
        const payload: EchoJobPayload = {
          channel,
          connectionId: connection.id,
          pageId: event.pageId,
          psid: event.psid,
          mid: event.mid,
          text: event.text,
          messageType: messageTypeFor(event.contentKind),
          contactName: storedName && storedName.trim() ? storedName : placeholderName,
        };
        await deps.enqueueJob(db, {
          agencyId,
          kind: "RECONCILE_ECHO",
          payload: { ...payload },
          runAfter: new Date(now().getTime() + ECHO_RECONCILE_DELAY_MS),
        });
        result.echoDeferred = true;
        break;
      }

      case "delivery": {
        for (const mid of event.mids) {
          await deps.patchDelivery(db, mid, agencyId, { deliveryStatus: "DELIVERED" }).catch(() => undefined); // a receipt for a message we don't hold is not fatal
        }
        break;
      }

      case "read": {
        if (event.watermarkMs !== null) {
          await deps
            .markRead(db, { agencyId, channel, externalConversationId: event.psid, upToMs: event.watermarkMs })
            .catch(() => undefined);
        }
        break;
      }
    }
  }
  return result;
}
