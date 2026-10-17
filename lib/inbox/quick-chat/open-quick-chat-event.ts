/**
 * How a page asks for the Quick Chat popup without importing it: the page announces "open a chat with this person and put this draft
 * in the box", and the popup (mounted once in the app layout) listens. The text is only ever a draft; staff read, edit and send it.
 *
 * `openQuickChat` answers whether the popup took the request. It does not when the popup is off for this deployment or the signed-in
 * role cannot send, and the caller then does what it did before (open `wa.me`).
 */
import type { QuickChatAttachmentInput } from "@/lib/inbox/quick-chat/attachment";

export const OPEN_QUICK_CHAT_EVENT = "inbox:quick-chat";

export interface QuickChatSentResult {
  conversationId: string;
  messageId: string | null;
}

export interface OpenQuickChatDetail {
  channel: "WHATSAPP";
  /** The contact's WhatsApp number. Any formatting is accepted; digits (with country code) are what is used. */
  to: string;
  contactName: string;
  /** Prefilled text. Never sent without the person pressing send. */
  draft?: string;
  /** One PDF the page has built (a quote, an invoice, a receipt). It is sent with the message once free text is available. */
  attachment?: QuickChatAttachmentInput;
  /** Called only after the channel has accepted the message. This is where a page records "sent". */
  onSent?: (result: QuickChatSentResult) => void | Promise<void>;
}

let available = false;

/** Called by the popup's provider on mount/unmount. Not for pages. */
export function setQuickChatAvailable(next: boolean): void {
  available = next;
}

export function isQuickChatAvailable(): boolean {
  return available;
}

export function openQuickChat(detail: OpenQuickChatDetail): boolean {
  if (typeof window === "undefined" || !available) return false;
  window.dispatchEvent(new CustomEvent<OpenQuickChatDetail>(OPEN_QUICK_CHAT_EVENT, { detail }));
  return true;
}
