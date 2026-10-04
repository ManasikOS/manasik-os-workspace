/**
 * Messenger behind the channel-adapter seam — the send half of Phase 3 of
 * docs/modules/messenger-instagram-ai-agent-implementation-plan.md. The behaviour it shares with Instagram
 * (resolving the connection, splitting an over-long reply, reporting every part's id) lives in
 * lib/channels/page-channel-adapter.ts; this file supplies what is Messenger's own: sends go to
 * `/{PAGE_ID}/messages` as `RESPONSE` messages.
 *
 * A Messenger connection is a `channel_connections` row (provider MESSENGER, `provider_account_id` = the Page
 * id, token in Vault). Unlike WhatsApp there is no legacy per-provider table to bridge to.
 */

import "server-only";

import type { ChannelRuntimeAdapter } from "@/lib/channels/adapter";
import {
  classifyMessengerError,
  sendMessengerAction,
  sendMessengerAttachment,
  sendMessengerQuickReplies,
  sendMessengerText,
} from "@/lib/channels/messenger/client";
import { createPageChannelAdapter } from "@/lib/channels/page-channel-adapter";

const pageIdOf = (accountId: string | null): string => {
  if (!accountId) throw new Error("Messenger connection has no Page id.");
  return accountId;
};

export const messengerChannelAdapter: ChannelRuntimeAdapter = createPageChannelAdapter({
  provider: "MESSENGER",
  accountNoun: "Page",
  reconnectNotice: "Messenger rejected the stored access token — reconnect the Page.",
  sendNeedsAccountId: true,
  classifyError: classifyMessengerError,
  senders: {
    sendText: (token, connection, to, text, metaTag) => sendMessengerText(token, pageIdOf(connection.accountId), to, text, metaTag),
    sendQuickReplies: (token, connection, to, text, buttons, metaTag) => sendMessengerQuickReplies(token, pageIdOf(connection.accountId), to, text, buttons, metaTag),
    sendAction: (token, connection, to, action) => sendMessengerAction(token, pageIdOf(connection.accountId), to, action),
    sendAttachment: (token, connection, to, attachment, metaTag) =>
      sendMessengerAttachment(token, pageIdOf(connection.accountId), to, { kind: attachment.kind === "document" ? "file" : "image", url: attachment.url }, metaTag),
  },
});
