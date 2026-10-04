import { INBOX_VIEWS, type InboxView } from "@/lib/inbox/views";

/**
 * The full-page Inbox reads which chat and which queue to show from the address, so a link to one conversation
 * (a task, a notification, a colleague's message) opens it directly. The address is untrusted: anything that is not a
 * real view name or a well-formed conversation id is ignored, and the Inbox opens on its default instead.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InboxPageRequest {
  conversationId: string | null;
  view: InboxView;
}

function firstValue(value: string | string[] | undefined): string | null {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" && single.length > 0 ? single : null;
}

export function inboxPageRequestFromSearchParams(params: { conversation?: string | string[]; view?: string | string[] }): InboxPageRequest {
  const conversation = firstValue(params.conversation);
  const view = firstValue(params.view);
  return {
    conversationId: conversation && UUID_PATTERN.test(conversation) ? conversation.toLowerCase() : null,
    view: view && (INBOX_VIEWS as readonly string[]).includes(view) ? (view as InboxView) : "all",
  };
}

/** The address of the full-page Inbox for a view and, optionally, one conversation. */
export function inboxPageHref(input: { view?: InboxView | null; conversationId?: string | null }): string {
  const query = new URLSearchParams();
  if (input.view && input.view !== "all") query.set("view", input.view);
  if (input.conversationId) query.set("conversation", input.conversationId);
  const text = query.toString();
  return text ? `/inbox?${text}` : "/inbox";
}
