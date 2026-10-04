/**
 * The keyboard and submit rules of the Inbox composer, kept pure so they are covered by ordinary tests.
 *
 * Two bugs lived in the component: Enter called `requestSubmit()`, which ignores a disabled Send button (so a blocked reply
 * box still fired a send), and it fired while a text-input method was composing (Tamil, Sinhala, Arabic and Urdu keyboards use
 * Enter to accept a suggestion).
 */

export type ComposerMode = "reply" | "note";

/** Whether the box may be submitted now: it needs text, and a reply also needs replying to be allowed (a note always may). */
export function canSubmitComposer(input: {
  mode: ComposerMode;
  enabled: boolean;
  text: string;
  /** A file is uploaded and ready. A reply may then go without text (the text becomes its caption); a note never carries a file. */
  hasAttachment?: boolean;
  /** A file is still uploading: nothing is sent until it is there. */
  attachmentUploading?: boolean;
}): boolean {
  if (input.mode === "reply" && input.attachmentUploading) return false;
  if (!input.text.trim() && !(input.mode === "reply" && input.hasAttachment)) return false;
  return input.mode === "note" || input.enabled;
}

/** What Enter should do: send, or leave the key to the browser (a new line for Shift+Enter, accepting a suggestion, and so on). */
export function enterKeyAction(input: {
  key: string;
  shiftKey: boolean;
  /** `event.nativeEvent.isComposing`: true while an input method holds unconfirmed text. */
  isComposing: boolean;
  canSubmit: boolean;
}): "SUBMIT" | "LET_BROWSER_HANDLE" {
  if (input.key !== "Enter" || input.shiftKey || input.isComposing || !input.canSubmit) return "LET_BROWSER_HANDLE";
  return "SUBMIT";
}
