import type { QuickChatTarget } from "@/lib/inbox/quick-chat/resolve-target";

/**
 * How an approved template reaches a number, from what the popup already knows about it.
 *
 *  - No conversation yet, or a closed one: the Inbox's "start chat" action sends it and opens (or reopens) the conversation.
 *  - An open conversation whose reply window has closed: the Inbox's "send template into this conversation" action sends it.
 *
 * Both actions re-check consent, ownership, rate limits and the protection gate on the server; this only picks which one to call.
 */
export type TemplateSendRoute = { kind: "START_CHAT" } | { kind: "IN_CONVERSATION"; conversationId: string };

export function templateSendRoute(target: Extract<QuickChatTarget, { kind: "NEEDS_TEMPLATE" }>): TemplateSendRoute {
  if (target.reason === "WINDOW_CLOSED" && target.conversationId) {
    return { kind: "IN_CONVERSATION", conversationId: target.conversationId };
  }
  return { kind: "START_CHAT" };
}

/** Every template variable must be filled before it can be sent; a template with none is always complete. */
export function templateValuesComplete(values: readonly string[], variableCount: number): boolean {
  return values.length === variableCount && values.every((value) => value.trim().length > 0);
}

/** What staff are told after a template went out: free text is still closed until the customer replies. */
export const TEMPLATE_SENT_NOTICE =
  "The template was sent. WhatsApp only allows free text after the customer replies. Check again once they have, and your drafted message will be ready to send.";
