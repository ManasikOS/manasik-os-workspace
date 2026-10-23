import { parseInboxRealtimeEvent } from "@/lib/inbox/realtime/contracts";
import type { QuickChatMessage } from "@/lib/inbox/quick-chat/thread";

/**
 * Realtime only says WHICH conversation changed, never what changed (docs/inbox/scaling.md §6). The popup watches one conversation, so
 * the only question per event is "does this mean I should read the thread again?".
 *
 * Yes for any message, attachment or list-level change of this conversation. No for other conversations, and for the context,
 * intelligence and presence signals, which the popup does not show. A payload that does not match the contract is read again once and
 * never trusted: the same rule the Inbox applies.
 */
export function shouldRefreshThread(payload: unknown, conversationId: string): boolean {
  const parsed = parseInboxRealtimeEvent(payload);
  if (parsed.status === "unknown") return true;
  const { event } = parsed;
  if (event.conversationId !== conversationId) return false;
  return event.scope === "THREAD" || event.scope === "LIST";
}

/** Customer messages that arrived after the person last looked at the popup. */
export function countUnreadInbound(messages: readonly QuickChatMessage[], seenAt: string | null): number {
  return messages.filter((message) => message.direction === "IN" && (seenAt === null || message.createdAt > seenAt)).length;
}

/** The newest message time, or null for an empty thread. Used as "seen up to here" while the popup is open. */
export function latestMessageTime(messages: readonly QuickChatMessage[]): string | null {
  return messages.reduce<string | null>((latest, message) => (latest === null || message.createdAt > latest ? message.createdAt : latest), null);
}
