/**
 * The runtime adapter shared by the two Meta channels that talk through a Facebook Page token — Messenger and
 * Instagram. The AI reply drain and the staff outbox both send through the adapter, so a fix here is a fix for
 * both channels. What differs per channel (which endpoint a text goes to, the profile's limits, the wording of a
 * dead-token notice) is passed in; everything else — resolving the connection, splitting an over-long reply,
 * reporting every part's message id, reflecting a rejected token — is one implementation.
 *
 * A connection is a `channel_connections` row (`provider_account_id` = the Page id for Messenger, the Instagram
 * professional account id for Instagram; the Page token lives in Vault under `credential_ref`).
 */

import "server-only";

import { MAX_VOICE_NOTE_BYTES } from "@/lib/inbox/media/voice-note";
import type { ChannelRuntimeAdapter, OutboundReply, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { downloadMetaAttachment, downloadMetaFile } from "@/lib/channels/attachment-download";
import { getChannelProfile } from "@/lib/channels/profile";
import { splitForChannel } from "@/lib/channels/text-split";
import { readChannelToken } from "@/lib/channels/vault";
import type { Db } from "@/lib/data/whatsapp-repository";

export type PageChannelProvider = "MESSENGER" | "INSTAGRAM";

export interface PageChannelSenders {
  sendText(token: string, connection: ResolvedChannelConnection, to: string, text: string, metaTag?: "HUMAN_AGENT"): Promise<{ messageId: string }>;
  sendQuickReplies(token: string, connection: ResolvedChannelConnection, to: string, text: string, buttons: NonNullable<OutboundReply["buttons"]>, metaTag?: "HUMAN_AGENT"): Promise<{ messageId: string }>;
  sendAction(token: string, connection: ResolvedChannelConnection, to: string, action: "mark_seen" | "typing_on"): Promise<void>;
  /** Absent when the channel carries no files. A channel that carries images only throws "can't send" for a document. */
  sendAttachment?(token: string, connection: ResolvedChannelConnection, to: string, attachment: { kind: "image" | "document"; url: string }, metaTag?: "HUMAN_AGENT"): Promise<{ messageId: string }>;
}

export interface PageChannelConfig {
  provider: PageChannelProvider;
  senders: PageChannelSenders;
  classifyError: ChannelRuntimeAdapter["classifyError"];
  /** The account label used in operator-facing text: "Page" or "Instagram account". */
  accountNoun: string;
  /** Shown on the Integrations card when the stored token is rejected. */
  reconnectNotice: string;
  /** True when a send needs the connection's account id (Messenger's Page id); Instagram sends through `/me`. */
  sendNeedsAccountId: boolean;
}

interface ConnectionRow {
  id: string;
  status: string;
  credential_ref: string | null;
  provider_account_id: string | null;
  display_name: string;
  provider_metadata: { connect_method?: string } | null;
}

const COLUMNS = "id, status, credential_ref, provider_account_id, display_name, provider_metadata";

export function createPageChannelAdapter(config: PageChannelConfig): ChannelRuntimeAdapter {
  const { provider, senders } = config;
  const profile = getChannelProfile(provider);
  const label = profile.displayName;

  function toConnection(row: ConnectionRow): ResolvedChannelConnection {
    return {
      provider,
      id: row.id,
      status: row.status,
      credentialRef: row.credential_ref,
      displayAddress: null, // neither a Page nor an Instagram account has a public number to append to a reply
      fundingStatus: null, // Meta does not bill Messenger or Instagram messages
      accountId: row.provider_account_id,
      connectMethod: row.provider_metadata?.connect_method === "INSTAGRAM_LOGIN" ? "INSTAGRAM_LOGIN" : null,
    };
  }

  return {
    provider,
    profile,

    async resolveConnection(db: Db, agencyId) {
      const { data } = await db
        .from("channel_connections")
        .select(COLUMNS)
        .eq("agency_id", agencyId)
        .eq("provider", provider)
        .neq("status", "DISCONNECTED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? toConnection(data as ConnectionRow) : null;
    },

    async resolveConnectionForChannelConnection(db: Db, agencyId, channelConnectionId) {
      const { data } = await db
        .from("channel_connections")
        .select(COLUMNS)
        .eq("id", channelConnectionId)
        .eq("agency_id", agencyId)
        .eq("provider", provider)
        .maybeSingle();
      return data ? toConnection(data as ConnectionRow) : null;
    },

    async readToken(db, connection) {
      return connection.credentialRef ? readChannelToken(db, connection.credentialRef) : null;
    },

    decorateReplyText(text) {
      return text;
    },

    /**
     * Sends inside the 24-hour window. A reply over the platform's text limit is split into ordered parts
     * (quick replies ride on the last one). Every part's id is returned: each part echoes back with its own id,
     * and all of them must be recognised as ours (see SendReplyResult.partMessageIds).
     *
     * If a later part fails after an earlier one was delivered, the error is rethrown honestly — the caller
     * cannot know the customer already saw part 1. That is only reachable for a reply over the limit (the AI's
     * own cap is well under it; a long staff message can hit it) and a retry would re-send the earlier parts.
     */
    async sendReply(connection, token, reply) {
      if (config.sendNeedsAccountId && !connection.accountId) throw new Error(`${label} connection has no ${config.accountNoun} id.`);

      const parts = splitForChannel(reply.text, { unit: profile.maxTextUnit, size: profile.maxTextSize });
      if (parts.length === 0) throw new Error(`Cannot send an empty ${label} message.`);

      const ids: string[] = [];
      for (const [index, part] of parts.entries()) {
        const isLast = index === parts.length - 1;
        const buttons = isLast ? (reply.buttons ?? []) : [];
        const sent =
          buttons.length > 0
            ? await senders.sendQuickReplies(token, connection, reply.to, part, buttons, reply.metaTag)
            : await senders.sendText(token, connection, reply.to, part, reply.metaTag);
        ids.push(sent.messageId);
      }
      return { externalMessageId: ids[ids.length - 1], ...(ids.length > 1 ? { partMessageIds: ids } : {}) };
    },

    /**
     * A file, then its caption as a separate text (these channels have no caption on an attachment). If the file goes out and the
     * caption does not, the file is NOT retried: the result says the caption failed and the send is recorded as sent.
     */
    async sendMedia(connection, token, media) {
      if (config.sendNeedsAccountId && !connection.accountId) throw new Error(`${label} connection has no ${config.accountNoun} id.`);
      if (!senders.sendAttachment) throw new Error(`${label} can't send files.`);
      const sent = await senders.sendAttachment(token, connection, media.to, { kind: media.kind, url: media.url }, media.metaTag);
      if (!media.caption) return { externalMessageId: sent.messageId };
      try {
        const caption = await senders.sendText(token, connection, media.to, media.caption, media.metaTag);
        return { externalMessageId: caption.messageId, partMessageIds: [sent.messageId, caption.messageId] };
      } catch {
        return { externalMessageId: sent.messageId, captionFailed: true };
      }
    },

    /** Marks the customer's message seen and shows the typing bubble; it clears when the reply is sent. */
    async sendTyping(connection, token, target) {
      if (config.sendNeedsAccountId && !connection.accountId) return;
      await senders.sendAction(token, connection, target.to, "mark_seen");
      await senders.sendAction(token, connection, target.to, "typing_on");
    },

    /** A voice note arrives as a Meta CDN URL, not a media id; see lib/channels/attachment-download.ts for how it is fetched safely. */
    async fetchAudio(_connection, token, attachmentUrl) {
      return downloadMetaAttachment(attachmentUrl, token, { maxBytes: MAX_VOICE_NOTE_BYTES });
    },

    async fetchAttachment(_connection, token, attachmentUrl) {
      return downloadMetaFile(attachmentUrl, token, { maxBytes: 10 * 1024 * 1024 });
    },

    classifyError: config.classifyError,

    async reflectSendFailure(db, connection, _agencyId, errorClass, error) {
      // A dead token is not something retries fix: show "needs reconnect" on the Integrations card and in the Inbox.
      if (errorClass !== "TOKEN_DEAD") return;
      await db
        .from("channel_connections")
        .update({
          status: "ERROR",
          last_error: config.reconnectNotice,
          health_checked_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
      console.warn(`${label} token rejected:`, error instanceof Error ? error.message : error);
    },

    async reflectSendSuccess() {
      // Nothing to clear: neither channel has a funding state.
    },
  };
}
