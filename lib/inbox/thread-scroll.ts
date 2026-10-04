/**
 * When the thread should follow a new message to the bottom. A person reading older messages is never pulled away from
 * them; they are told something new arrived instead (the "New messages" button).
 */

/** How close to the bottom (in pixels) still counts as "at the bottom": a line or two of slack for rounding and padding. */
export const THREAD_BOTTOM_SLACK_PX = 96;

export function isThreadNearBottom(metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= THREAD_BOTTOM_SLACK_PX;
}

export type ThreadScrollDecision = "JUMP" | "FOLLOW" | "NOTIFY" | "NONE";

/**
 * - JUMP: a different chat opened — show its newest message at once.
 * - FOLLOW: the person's own send, or they were already at the bottom — scroll smoothly to it.
 * - NOTIFY: a customer message arrived while they read older ones — leave the scroll alone and offer a way down.
 */
export function decideThreadScroll(input: {
  switchedConversation: boolean;
  newItemArrived: boolean;
  ownSend: boolean;
  wasNearBottom: boolean;
}): ThreadScrollDecision {
  if (input.switchedConversation) return "JUMP";
  if (!input.newItemArrived) return "NONE";
  if (input.ownSend || input.wasNearBottom) return "FOLLOW";
  return "NOTIFY";
}
