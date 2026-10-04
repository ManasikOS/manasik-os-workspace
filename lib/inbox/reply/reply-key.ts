/**
 * The merge key of a conversation's REPLY job. While a REPLY is QUEUED, another for the same conversation collapses into it, so a burst
 * of messages is answered once. The inbound database function builds the same string (`'reply:' || conversation_id`); keep the two in step.
 * A separate file so both the agent drain and the reply job can import it without importing each other.
 */
export function replyCoalesceKey(conversationId: string): string {
  return `reply:${conversationId}`;
}
