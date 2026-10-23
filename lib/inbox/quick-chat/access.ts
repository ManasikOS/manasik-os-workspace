import type { StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";

/**
 * Who may use the Quick Chat popup, and how their message is sent.
 *
 *  - INBOX: roles that may send from the Inbox (ADMIN, MARKETING, OPERATIONS). The popup sends through the Inbox's own actions.
 *  - RECORD: Finance and Visa. They may not send from the Inbox and still cannot; they may send one kind of message from a record page
 *    (a receipt, a document request) through `enqueue_record_text_message`, which is WhatsApp text only, inside an open reply window,
 *    never into a colleague's chat. Templates, files and email are not available to them from here.
 *
 * The same split is enforced in the database (migration 20270215090000_quick_chat_record_send.sql) and in
 * `sendQuickChatRecordMessageAction`; this file is what the screens read.
 */
export type QuickChatSendMode = "INBOX" | "RECORD";

const RECORD_SEND_ROLES: readonly StaffRole[] = ["FINANCE", "VISA"];

export function quickChatSendMode(role: StaffRole): QuickChatSendMode | null {
  if (capabilitiesForInbox(role).sendMessage) return "INBOX";
  if (RECORD_SEND_ROLES.includes(role) && capabilitiesForInbox(role).viewModule) return "RECORD";
  return null;
}

export function canUseQuickChat(role: StaffRole): boolean {
  return quickChatSendMode(role) !== null;
}

/**
 * Whether Finance and Visa reach the popup from the "Send by WhatsApp" buttons. Off until their two gaps are closed: templates (T4b) and
 * files (T7b), and until the record-send migration is applied. While it is off their buttons open `wa.me` exactly as before; the
 * record-send path itself is built and tested, and this one switch turns it on.
 */
export const RECORD_ROLES_USE_POPUP = false;

/** Whether the "Send by WhatsApp" buttons hand over to the popup for this send mode. */
export function popupTakesSendButtons(mode: QuickChatSendMode): boolean {
  return mode === "INBOX" || RECORD_ROLES_USE_POPUP;
}
