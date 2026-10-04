/**
 * The Inbox lives on its own page. Header-mounted callers use this event so a notification can navigate to
 * the requested conversation without knowing about the shared header implementation.
 */
export const OPEN_INBOX_EVENT = "inbox:open";

export interface OpenInboxDetail {
  conversationId?: string;
  view?: InboxView;
}

import type { InboxView } from "@/lib/inbox/views";

export function openInboxConversation(conversationId: string): void {
  window.dispatchEvent(new CustomEvent<OpenInboxDetail>(OPEN_INBOX_EVENT, { detail: { conversationId } }));
}

export function openInboxView(view: InboxView): void {
  window.dispatchEvent(new CustomEvent<OpenInboxDetail>(OPEN_INBOX_EVENT, { detail: { view } }));
}
