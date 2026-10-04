/**
 * The one registry of Inbox keyboard shortcuts (PRD-01). Every key, label, permission need and focus rule lives here,
 * so the help overlay, the handlers and the tests can never disagree. Shortcuts never act while someone is typing,
 * while an input method is composing text, or with Ctrl, Alt or Meta held. Permissions are shown honestly here but are
 * still enforced by the server when the command runs.
 */

import { isTypingTarget } from "./keyboard-navigation";

export type InboxShortcutId =
  | "NEXT_CONVERSATION"
  | "PREVIOUS_CONVERSATION"
  | "FOCUS_SEARCH"
  | "FOCUS_REPLY"
  | "FOCUS_NOTE"
  | "OPEN_ASSIGNMENT"
  | "OPEN_LEAD"
  | "OPEN_BOOKING"
  | "START_QUOTE"
  | "OPEN_DEPARTURE_GROUP"
  | "CLOSE_TOPMOST"
  | "OPEN_HELP";

/** What the screen currently allows. The handler fills these from the same permissions as the visible controls. */
export interface InboxShortcutContext {
  conversationOpen: boolean;
  canReply: boolean;
  canWriteNote: boolean;
  canAssign: boolean;
  hasLead: boolean;
  hasBooking: boolean;
  hasDepartureGroup: boolean;
  canStartQuote: boolean;
  /** A sheet, panel or overlay that Escape may close. */
  hasTransientSurface: boolean;
}

export interface InboxShortcutDefinition {
  id: InboxShortcutId;
  /** One key, or a sequence such as `g` then `d`. Compared exactly against `KeyboardEvent.key`. */
  keys: readonly string[];
  label: string;
  description: string;
  group: "Move" | "Act" | "Open" | "Help";
  /** Every entry must be true for the command to run. */
  requires: ReadonlyArray<keyof InboxShortcutContext>;
  /** Only Escape may act inside a text field. */
  allowWhileTyping: boolean;
  /** Value for the `aria-keyshortcuts` attribute of the control this shortcut triggers. */
  ariaKeyShortcuts: string;
  /** True while a handler is wired to it; the help overlay lists only wired shortcuts, so it never advertises a dead key. */
  wired: boolean;
}

function define(
  definition: Omit<InboxShortcutDefinition, "ariaKeyShortcuts" | "allowWhileTyping" | "wired"> &
    Partial<Pick<InboxShortcutDefinition, "allowWhileTyping" | "wired">>,
): InboxShortcutDefinition {
  return {
    allowWhileTyping: false,
    wired: true,
    ...definition,
    ariaKeyShortcuts: definition.keys.join(" "),
  };
}

export const INBOX_SHORTCUTS: readonly InboxShortcutDefinition[] = [
  define({ id: "NEXT_CONVERSATION", keys: ["j"], label: "Next conversation", description: "Open the next conversation in the list.", group: "Move", requires: [] }),
  define({ id: "PREVIOUS_CONVERSATION", keys: ["k"], label: "Previous conversation", description: "Open the previous conversation in the list.", group: "Move", requires: [] }),
  define({ id: "FOCUS_SEARCH", keys: ["/"], label: "Search conversations", description: "Move the cursor to the conversation search box.", group: "Move", requires: [] }),
  define({ id: "FOCUS_REPLY", keys: ["r"], label: "Reply to customer", description: "Move the cursor to the customer reply box.", group: "Act", requires: ["conversationOpen", "canReply"] }),
  define({ id: "FOCUS_NOTE", keys: ["n"], label: "Add internal note", description: "Move the cursor to the internal note box.", group: "Act", requires: ["conversationOpen", "canWriteNote"] }),
  define({ id: "OPEN_ASSIGNMENT", keys: ["a"], label: "Assign owner", description: "Open the owner assignment for this conversation.", group: "Act", requires: ["conversationOpen", "canAssign"] }),
  define({ id: "START_QUOTE", keys: ["q"], label: "Start a draft quote", description: "Start a draft quote for this conversation. Nothing is sent to the customer.", group: "Act", requires: ["conversationOpen", "canStartQuote"] }),
  define({ id: "OPEN_LEAD", keys: ["e"], label: "Open linked lead", description: "Open the lead linked to this conversation.", group: "Open", requires: ["conversationOpen", "hasLead"] }),
  define({ id: "OPEN_BOOKING", keys: ["b"], label: "Open linked booking", description: "Open the booking linked to this conversation.", group: "Open", requires: ["conversationOpen", "hasBooking"] }),
  define({ id: "OPEN_DEPARTURE_GROUP", keys: ["g", "d"], label: "Open linked departure group", description: "Press g, then d, to open the departure group linked to this conversation.", group: "Open", requires: ["conversationOpen", "hasDepartureGroup"] }),
  define({ id: "CLOSE_TOPMOST", keys: ["Escape"], label: "Close", description: "Close the topmost open sheet, panel or overlay.", group: "Help", requires: ["hasTransientSurface"], allowWhileTyping: true }),
  define({ id: "OPEN_HELP", keys: ["?"], label: "Keyboard shortcuts", description: "Show every keyboard shortcut and what it does.", group: "Help", requires: [] }),
];

/** How long the second key of a sequence may follow the first. */
export const INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS = 1000;

const REQUIREMENT_REASON: Record<keyof InboxShortcutContext, string> = {
  conversationOpen: "Open a conversation first.",
  canReply: "Your role cannot reply to customers.",
  canWriteNote: "Your role cannot add internal notes.",
  canAssign: "Your role cannot assign owners.",
  hasLead: "This conversation has no linked lead.",
  hasBooking: "This conversation has no linked booking.",
  hasDepartureGroup: "This conversation has no linked departure group.",
  canStartQuote: "Your role cannot start a quote here.",
  hasTransientSurface: "There is nothing open to close.",
};

export function inboxShortcutAvailability(
  shortcut: InboxShortcutDefinition,
  context: InboxShortcutContext,
): { available: true } | { available: false; reason: string } {
  const unmet = shortcut.requires.find((requirement) => !context[requirement]);
  return unmet ? { available: false, reason: REQUIREMENT_REASON[unmet] } : { available: true };
}

export interface InboxShortcutCollision {
  first: InboxShortcutId;
  second: InboxShortcutId;
  reason: "SAME_KEYS" | "PREFIX";
}

/** Two bindings collide when they are identical, or when a shorter one would swallow the start of a longer sequence. */
export function findInboxShortcutCollisions(shortcuts: readonly InboxShortcutDefinition[]): InboxShortcutCollision[] {
  const collisions: InboxShortcutCollision[] = [];
  for (let i = 0; i < shortcuts.length; i++) {
    for (let j = i + 1; j < shortcuts.length; j++) {
      const left = shortcuts[i];
      const right = shortcuts[j];
      const [shorter, longer] = left.keys.length <= right.keys.length ? [left, right] : [right, left];
      const startsWith = shorter.keys.every((key, index) => key === longer.keys[index]);
      if (!startsWith) continue;
      collisions.push(
        shorter.keys.length === longer.keys.length
          ? { first: left.id, second: right.id, reason: "SAME_KEYS" }
          : { first: shorter.id, second: longer.id, reason: "PREFIX" },
      );
    }
  }
  return collisions;
}

export interface InboxShortcutInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** True while an input method (IME) is composing text. */
  isComposing: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  /** The first key of a sequence already started, if any. */
  pending: { first: string; at: number } | null;
  now: number;
}

export type InboxShortcutResolution =
  | { kind: "NONE" }
  | { kind: "PENDING"; first: string; at: number }
  | { kind: "RUN"; id: InboxShortcutId }
  | { kind: "UNAVAILABLE"; id: InboxShortcutId; reason: string };

/**
 * Decides what one key press means. `scope` limits which commands a handler may claim, so the list handler can own
 * J, K and / without swallowing the `g` that starts a sequence elsewhere.
 */
export function resolveInboxShortcut(
  input: InboxShortcutInput,
  context: InboxShortcutContext,
  scope?: readonly InboxShortcutId[],
): InboxShortcutResolution {
  if (input.isComposing || input.metaKey || input.ctrlKey || input.altKey) return { kind: "NONE" };

  const typing = isTypingTarget(input.target);
  const candidates = INBOX_SHORTCUTS.filter(
    (shortcut) => (!scope || scope.includes(shortcut.id)) && (!typing || shortcut.allowWhileTyping),
  );

  const outcome = (shortcut: InboxShortcutDefinition): InboxShortcutResolution => {
    const availability = inboxShortcutAvailability(shortcut, context);
    return availability.available
      ? { kind: "RUN", id: shortcut.id }
      : { kind: "UNAVAILABLE", id: shortcut.id, reason: availability.reason };
  };

  if (input.pending && input.now - input.pending.at <= INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS) {
    const completed = candidates.find(
      (shortcut) => shortcut.keys.length === 2 && shortcut.keys[0] === input.pending?.first && shortcut.keys[1] === input.key,
    );
    if (completed) return outcome(completed);
    // A different key cancels the sequence and is then read on its own.
  }

  const single = candidates.find((shortcut) => shortcut.keys.length === 1 && shortcut.keys[0] === input.key);
  if (single) return outcome(single);

  const startsSequence = candidates.some((shortcut) => shortcut.keys.length === 2 && shortcut.keys[0] === input.key);
  return startsSequence ? { kind: "PENDING", first: input.key, at: input.now } : { kind: "NONE" };
}

export interface InboxShortcutHelpItem {
  id: InboxShortcutId;
  keysLabel: string;
  label: string;
  description: string;
  ariaKeyShortcuts: string;
}

export interface InboxShortcutHelpGroup {
  group: InboxShortcutDefinition["group"];
  items: InboxShortcutHelpItem[];
}

const HELP_GROUP_ORDER: ReadonlyArray<InboxShortcutDefinition["group"]> = ["Move", "Act", "Open", "Help"];

function keysLabelFor(keys: readonly string[]): string {
  return keys.map((key) => (key === "Escape" ? "Esc" : key)).join(" then ");
}

/** What the `?` overlay shows: every wired shortcut, grouped in a fixed order, with keys written the way people say them. */
export function groupInboxShortcutsForHelp(shortcuts: readonly InboxShortcutDefinition[] = INBOX_SHORTCUTS): InboxShortcutHelpGroup[] {
  return HELP_GROUP_ORDER.map((group) => ({
    group,
    items: shortcuts
      .filter((shortcut) => shortcut.wired && shortcut.group === group)
      .map((shortcut) => ({
        id: shortcut.id,
        keysLabel: keysLabelFor(shortcut.keys),
        label: shortcut.label,
        description: shortcut.description,
        ariaKeyShortcuts: shortcut.ariaKeyShortcuts,
      })),
  })).filter((entry) => entry.items.length > 0);
}
