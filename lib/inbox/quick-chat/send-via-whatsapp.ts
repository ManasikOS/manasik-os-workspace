import { openQuickChat, type OpenQuickChatDetail } from "@/lib/inbox/quick-chat/open-quick-chat-event";

/**
 * What every "Send by WhatsApp" button does: hand the person and the draft to the Quick Chat popup, or, when the popup is not available
 * (off for this deployment, or this role does not send from it), open the `wa.me` link exactly as the button did before.
 *
 * Answers which way it went, because the two have different rules for records. With the popup, "sent" is recorded in `onSent`, once the
 * channel has accepted the message. With the link, nothing is known about what the person did in WhatsApp, so a page keeps recording as it
 * always did, straight away.
 */
export type SendViaWhatsAppRoute = "POPUP" | "LINK";

export function sendViaWhatsApp(
  input: OpenQuickChatDetail & {
    /** The `wa.me` address to open when the popup is unavailable. */
    fallbackUrl: string;
    /** Called when the popup took the request. A page that shows a dialog or sheet closes it here, so the popup is not left underneath. */
    onOpened?: () => void;
  },
): SendViaWhatsAppRoute {
  const { fallbackUrl, onOpened, ...detail } = input;
  if (openQuickChat(detail)) {
    onOpened?.();
    return "POPUP";
  }
  window.open(fallbackUrl, "_blank", "noopener,noreferrer");
  return "LINK";
}
