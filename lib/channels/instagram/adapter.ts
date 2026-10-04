/**
 * Instagram behind the channel-adapter seam. Shares everything with Messenger through
 * lib/channels/page-channel-adapter.ts. What is Instagram's own:
 *  - a Facebook-Page connection sends to `/me/messages` with the Page token, so the connection's account id is
 *    not needed to send;
 *  - an Instagram Login connection (`connectMethod === "INSTAGRAM_LOGIN"`) sends to
 *    `graph.instagram.com/<instagram account id>/messages` with the account's own token, so its account id IS needed;
 *  - replies are split by UTF-8 bytes (the profile's 1000-byte limit), which matters for Sinhala and Tamil.
 */

import "server-only";

import type { ChannelRuntimeAdapter, ResolvedChannelConnection } from "@/lib/channels/adapter";
import { sendInstagramAction, sendInstagramImage, sendInstagramQuickReplies, sendInstagramText } from "@/lib/channels/instagram/client";
import { sendInstagramLoginAction, sendInstagramLoginImage, sendInstagramLoginQuickReplies, sendInstagramLoginText } from "@/lib/channels/instagram/login/client";
import { classifyMessengerError } from "@/lib/channels/messenger/client";
import { createPageChannelAdapter } from "@/lib/channels/page-channel-adapter";

const isLogin = (connection: ResolvedChannelConnection) => connection.connectMethod === "INSTAGRAM_LOGIN";

function loginAccountId(connection: ResolvedChannelConnection): string {
  if (!connection.accountId) throw new Error("Instagram connection has no Instagram account id.");
  return connection.accountId;
}

export const instagramChannelAdapter: ChannelRuntimeAdapter = createPageChannelAdapter({
  provider: "INSTAGRAM",
  accountNoun: "Instagram account",
  reconnectNotice: "Instagram rejected the stored access token — reconnect the Instagram account.",
  // The Page connection sends through `/me`; the Login connection's own sender checks its account id.
  sendNeedsAccountId: false,
  // Instagram messaging goes through the same Graph error vocabulary as Messenger.
  classifyError: classifyMessengerError,
  senders: {
    sendText: (token, connection, to, text, metaTag) =>
      isLogin(connection) ? sendInstagramLoginText(token, loginAccountId(connection), to, text, metaTag) : sendInstagramText(token, to, text, metaTag),
    sendQuickReplies: (token, connection, to, text, buttons, metaTag) =>
      isLogin(connection) ? sendInstagramLoginQuickReplies(token, loginAccountId(connection), to, text, buttons, metaTag) : sendInstagramQuickReplies(token, to, text, buttons, metaTag),
    sendAction: (token, connection, to, action) => (isLogin(connection) ? sendInstagramLoginAction(token, loginAccountId(connection), to, action) : sendInstagramAction(token, to, action)),
    // Instagram messaging carries images, not documents.
    sendAttachment: async (token, connection, to, attachment, metaTag) => {
      if (attachment.kind !== "image") throw new Error("Instagram can't send documents. Send a photo instead.");
      return isLogin(connection) ? sendInstagramLoginImage(token, loginAccountId(connection), to, attachment.url, metaTag) : sendInstagramImage(token, to, attachment.url, metaTag);
    },
  },
});
