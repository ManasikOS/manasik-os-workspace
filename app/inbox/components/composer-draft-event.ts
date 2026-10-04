/**
 * How the offer card hands text to the message box without the two knowing about each other: the card announces
 * "put this in the box for this conversation", and the box listens. The text is only ever a draft — staff read, edit and
 * send it themselves.
 */
export const INSERT_COMPOSER_DRAFT_EVENT = "inbox:insert-composer-draft";

export type InsertComposerDraftDetail = { conversationId: string; text: string };

export function announceComposerDraft(detail: InsertComposerDraftDetail): void {
  window.dispatchEvent(new CustomEvent<InsertComposerDraftDetail>(INSERT_COMPOSER_DRAFT_EVENT, { detail }));
}

/** "Ask Copilot to write a reply for this conversation." The banner announces it; the message box listens and drafts. */
export const REQUEST_COMPOSER_SUGGEST_EVENT = "inbox:request-composer-suggest";

export type RequestComposerSuggestDetail = { conversationId: string };

export function announceComposerSuggestRequest(detail: RequestComposerSuggestDetail): void {
  window.dispatchEvent(new CustomEvent<RequestComposerSuggestDetail>(REQUEST_COMPOSER_SUGGEST_EVENT, { detail }));
}
