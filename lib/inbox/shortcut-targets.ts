/**
 * The bridge between a keyboard shortcut and the control it stands for (PRD-02). Each command is carried out by the
 * visible control that already does the job, found by a marker attribute. A shortcut can therefore never do more than
 * its control: if the control is not on screen, or is disabled, the shortcut is unavailable too. Permissions are
 * still enforced by the server when the control's own action runs.
 */

import type { InboxShortcutContext, InboxShortcutId } from "./keyboard-shortcuts";

export const INBOX_SHORTCUT_TRIGGER_ATTRIBUTE = "data-inbox-shortcut-trigger";
export const INBOX_CONVERSATION_OPEN_ATTRIBUTE = "data-inbox-conversation-open";
export const INBOX_COMPOSER_FIELD_ATTRIBUTE = "data-inbox-composer-field";

/** The few things of a DOM element this module needs, so it can be tested without a browser. */
export interface ShortcutElement {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  click(): void;
  focus(): void;
  scrollIntoView?(options?: { block?: "center" | "nearest" }): void;
}

export interface ShortcutRoot {
  querySelector(selector: string): ShortcutElement | null;
  querySelectorAll(selector: string): ArrayLike<ShortcutElement>;
}

type ControlShortcutId = Extract<
  InboxShortcutId,
  "FOCUS_REPLY" | "FOCUS_NOTE" | "OPEN_ASSIGNMENT" | "OPEN_LEAD" | "OPEN_BOOKING" | "OPEN_DEPARTURE_GROUP" | "START_QUOTE"
>;

const CONTROL_SHORTCUTS: ReadonlySet<InboxShortcutId> = new Set<ControlShortcutId>([
  "FOCUS_REPLY",
  "FOCUS_NOTE",
  "OPEN_ASSIGNMENT",
  "OPEN_LEAD",
  "OPEN_BOOKING",
  "OPEN_DEPARTURE_GROUP",
  "START_QUOTE",
]);

function isEnabled(element: ShortcutElement): boolean {
  // The tab trigger renders data-disabled="false" when it is enabled, so the attribute's value decides, not its presence.
  const dataDisabled = element.getAttribute("data-disabled");
  const markedDisabled = element.hasAttribute("data-disabled") && dataDisabled !== "false";
  return !element.hasAttribute("disabled") && !markedDisabled && element.getAttribute("aria-disabled") !== "true";
}

function enabledControls(root: ShortcutRoot, id: InboxShortcutId): ShortcutElement[] {
  return Array.from(root.querySelectorAll(`[${INBOX_SHORTCUT_TRIGGER_ATTRIBUTE}="${id}"]`)).filter(isEnabled);
}

/** What the screen offers right now, read from the visible controls so it always matches them. */
export function readInboxShortcutContext(root: ShortcutRoot, transientSurfaceCount: number): InboxShortcutContext {
  const has = (id: ControlShortcutId) => enabledControls(root, id).length > 0;
  return {
    conversationOpen: root.querySelector(`[${INBOX_CONVERSATION_OPEN_ATTRIBUTE}]`) !== null,
    canReply: has("FOCUS_REPLY"),
    canWriteNote: has("FOCUS_NOTE"),
    canAssign: has("OPEN_ASSIGNMENT"),
    hasLead: has("OPEN_LEAD"),
    hasBooking: has("OPEN_BOOKING"),
    hasDepartureGroup: has("OPEN_DEPARTURE_GROUP"),
    canStartQuote: has("START_QUOTE"),
    hasTransientSurface: transientSurfaceCount > 0,
  };
}

export type InboxShortcutRunResult = { ran: true } | { ran: false };

/**
 * Carries out a control-backed command. `schedule` runs a callback after the screen has updated (a frame later in the
 * browser), so the composer has switched tabs before its field is focused. The quote control is only focused, never
 * pressed, so a stray keypress cannot create a quote.
 */
export function runInboxShortcutCommand(
  id: InboxShortcutId,
  root: ShortcutRoot,
  schedule: (callback: () => void) => void,
): InboxShortcutRunResult {
  if (!CONTROL_SHORTCUTS.has(id)) return { ran: false };
  const [control] = enabledControls(root, id);
  if (!control) return { ran: false };

  if (id === "START_QUOTE") {
    control.scrollIntoView?.({ block: "center" });
    control.focus();
    return { ran: true };
  }

  control.click();
  if (id === "FOCUS_REPLY" || id === "FOCUS_NOTE") {
    schedule(() => root.querySelector(`[${INBOX_COMPOSER_FIELD_ATTRIBUTE}]`)?.focus());
  }
  return { ran: true };
}
