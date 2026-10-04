import { describe, expect, it, vi } from "vitest";

import {
  INBOX_COMPOSER_FIELD_ATTRIBUTE,
  INBOX_CONVERSATION_OPEN_ATTRIBUTE,
  INBOX_SHORTCUT_TRIGGER_ATTRIBUTE,
  readInboxShortcutContext,
  runInboxShortcutCommand,
  type ShortcutElement,
  type ShortcutRoot,
} from "./shortcut-targets";

function element(attributes: Record<string, string> = {}, extras: Partial<ShortcutElement> = {}): ShortcutElement & { clicked: number; focused: number } {
  const state = { clicked: 0, focused: 0 };
  return Object.assign(state, {
    hasAttribute: (name: string) => name in attributes,
    getAttribute: (name: string) => attributes[name] ?? null,
    click: () => {
      state.clicked += 1;
    },
    focus: () => {
      state.focused += 1;
    },
    scrollIntoView: vi.fn(),
    ...extras,
  });
}

function root(parts: { triggers?: Array<[string, ShortcutElement]>; conversationOpen?: boolean; composerField?: ShortcutElement | null }): ShortcutRoot {
  const triggers = parts.triggers ?? [];
  return {
    querySelector(selector: string) {
      if (selector === `[${INBOX_CONVERSATION_OPEN_ATTRIBUTE}]`) return parts.conversationOpen ? element() : null;
      if (selector === `[${INBOX_COMPOSER_FIELD_ATTRIBUTE}]`) return parts.composerField ?? null;
      return null;
    },
    querySelectorAll(selector: string) {
      const match = /\[data-inbox-shortcut-trigger="([A-Z_]+)"\]/.exec(selector);
      return match ? triggers.filter(([id]) => id === match[1]).map(([, el]) => el) : [];
    },
  };
}

const now = (fn: () => void) => fn();

describe("readInboxShortcutContext", () => {
  it("treats a control marked data-disabled=\"false\" (an enabled tab trigger) as enabled, and data-disabled=\"\" or \"true\" as disabled", () => {
    const context = (attributes: Record<string, string>) =>
      readInboxShortcutContext(root({ conversationOpen: true, triggers: [["FOCUS_REPLY", element(attributes)]] }), 0);
    expect(context({ "data-disabled": "false" }).canReply).toBe(true);
    expect(context({ "data-disabled": "" }).canReply).toBe(false);
    expect(context({ "data-disabled": "true" }).canReply).toBe(false);
    expect(context({ disabled: "" }).canReply).toBe(false);
  });

  it("reports what the screen currently offers, from the visible controls themselves", () => {
    const context = readInboxShortcutContext(
      root({
        conversationOpen: true,
        triggers: [
          ["FOCUS_REPLY", element()],
          ["OPEN_ASSIGNMENT", element()],
          ["OPEN_LEAD", element()],
        ],
      }),
      0,
    );
    expect(context).toEqual({
      conversationOpen: true,
      canReply: true,
      canWriteNote: false,
      canAssign: true,
      hasLead: true,
      hasBooking: false,
      hasDepartureGroup: false,
      canStartQuote: false,
      hasTransientSurface: false,
    });
  });

  it("treats a disabled control as absent, so a shortcut never exceeds its visible control", () => {
    const context = readInboxShortcutContext(
      root({
        conversationOpen: true,
        triggers: [
          ["FOCUS_REPLY", element({ disabled: "" })],
          ["OPEN_ASSIGNMENT", element({ "aria-disabled": "true" })],
          ["START_QUOTE", element({ "data-disabled": "" })],
        ],
      }),
      0,
    );
    expect(context.canReply).toBe(false);
    expect(context.canAssign).toBe(false);
    expect(context.canStartQuote).toBe(false);
  });

  it("is empty when no conversation is open, and reflects registered transient surfaces", () => {
    expect(readInboxShortcutContext(root({}), 0)).toMatchObject({ conversationOpen: false, hasTransientSurface: false });
    expect(readInboxShortcutContext(root({}), 2).hasTransientSurface).toBe(true);
  });
});

describe("runInboxShortcutCommand", () => {
  it("switches the composer to the right tab, then focuses its field", () => {
    const tab = element();
    const field = element();
    const scheduled: Array<() => void> = [];
    const result = runInboxShortcutCommand("FOCUS_NOTE", root({ triggers: [["FOCUS_NOTE", tab]], composerField: field }), (fn) => scheduled.push(fn));
    expect(result).toEqual({ ran: true });
    expect(tab.clicked).toBe(1);
    expect(field.focused).toBe(0);
    scheduled.forEach((fn) => fn());
    expect(field.focused).toBe(1);
  });

  it("opens the owner assignment and the linked records by activating their visible controls", () => {
    for (const id of ["OPEN_ASSIGNMENT", "OPEN_LEAD", "OPEN_BOOKING", "OPEN_DEPARTURE_GROUP"] as const) {
      const control = element();
      expect(runInboxShortcutCommand(id, root({ triggers: [[id, control]] }), now)).toEqual({ ran: true });
      expect(control.clicked).toBe(1);
    }
  });

  it("only focuses the quote control, so a keypress can never create a quote by itself", () => {
    const control = element();
    expect(runInboxShortcutCommand("START_QUOTE", root({ triggers: [["START_QUOTE", control]] }), now)).toEqual({ ran: true });
    expect(control.clicked).toBe(0);
    expect(control.focused).toBe(1);
    expect(control.scrollIntoView).toHaveBeenCalled();
  });

  it("uses the first enabled control when the same command appears in more than one place", () => {
    const disabled = element({ disabled: "" });
    const first = element();
    const second = element();
    runInboxShortcutCommand("START_QUOTE", root({ triggers: [["START_QUOTE", disabled], ["START_QUOTE", first], ["START_QUOTE", second]] }), now);
    expect(first.focused).toBe(1);
    expect(second.focused).toBe(0);
    expect(disabled.focused).toBe(0);
  });

  it("does nothing, and says so, when the control is missing or disabled", () => {
    expect(runInboxShortcutCommand("OPEN_LEAD", root({}), now)).toEqual({ ran: false });
    const disabled = element({ disabled: "" });
    expect(runInboxShortcutCommand("OPEN_LEAD", root({ triggers: [["OPEN_LEAD", disabled]] }), now)).toEqual({ ran: false });
    expect(disabled.clicked).toBe(0);
  });

  it("does not claim commands the provider or the list own", () => {
    for (const id of ["NEXT_CONVERSATION", "PREVIOUS_CONVERSATION", "FOCUS_SEARCH", "OPEN_HELP", "CLOSE_TOPMOST"] as const) {
      expect(runInboxShortcutCommand(id, root({}), now)).toEqual({ ran: false });
    }
  });
});

describe("markers", () => {
  it("uses stable attribute names the components share", () => {
    expect(INBOX_SHORTCUT_TRIGGER_ATTRIBUTE).toBe("data-inbox-shortcut-trigger");
    expect(INBOX_CONVERSATION_OPEN_ATTRIBUTE).toBe("data-inbox-conversation-open");
    expect(INBOX_COMPOSER_FIELD_ATTRIBUTE).toBe("data-inbox-composer-field");
  });
});
