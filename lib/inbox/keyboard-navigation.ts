/**
 * Keyboard shortcuts for the Inbox list: J moves to the next conversation, K to the previous, "/" jumps to the search box.
 * They only ever act when the person is not typing, so they never swallow a letter from a message or a note.
 */

/** The conversation one step from the open one, or null at either end. With none open, J starts at the first and K at the last. */
export function adjacentConversationId(ids: readonly string[], activeId: string | null, step: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index === -1) return step === 1 ? ids[0] : ids[ids.length - 1];
  return ids[index + step] ?? null;
}

/** True when a key press is going into a text field, so a shortcut must leave it alone. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export const INBOX_SEARCH_INPUT_ID = "inbox-conversation-search";
