import { describe, expect, it } from "vitest";

import {
  INBOX_SHORTCUTS,
  INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS,
  findInboxShortcutCollisions,
  groupInboxShortcutsForHelp,
  inboxShortcutAvailability,
  resolveInboxShortcut,
  type InboxShortcutContext,
  type InboxShortcutDefinition,
  type InboxShortcutInput,
} from "./keyboard-shortcuts";

const context: InboxShortcutContext = {
  conversationOpen: true,
  canReply: true,
  canWriteNote: true,
  canAssign: true,
  hasLead: true,
  hasBooking: true,
  hasDepartureGroup: true,
  canStartQuote: true,
  hasTransientSurface: true,
};

const press = (key: string, overrides: Partial<InboxShortcutInput> = {}): InboxShortcutInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  target: { tagName: "BODY" },
  pending: null,
  now: 1_000,
  ...overrides,
});

describe("shortcut registry", () => {
  it("covers every command the spec names", () => {
    const keys = INBOX_SHORTCUTS.map((shortcut) => shortcut.keys.join(" "));
    for (const expected of ["j", "k", "/", "r", "n", "a", "e", "b", "q", "g d", "Escape", "?"]) {
      expect(keys).toContain(expected);
    }
    expect(INBOX_SHORTCUTS).toHaveLength(12);
  });

  it("has no duplicate or colliding bindings", () => {
    expect(findInboxShortcutCollisions(INBOX_SHORTCUTS)).toEqual([]);
    expect(new Set(INBOX_SHORTCUTS.map((shortcut) => shortcut.id)).size).toBe(INBOX_SHORTCUTS.length);
  });

  it("detects an identical binding", () => {
    const duplicate: InboxShortcutDefinition = { ...INBOX_SHORTCUTS[0], id: "OPEN_HELP" };
    expect(findInboxShortcutCollisions([INBOX_SHORTCUTS[0], duplicate])).toEqual([
      { first: INBOX_SHORTCUTS[0].id, second: "OPEN_HELP", reason: "SAME_KEYS" },
    ]);
  });

  it("detects a single key that shadows the start of a sequence", () => {
    const shadow: InboxShortcutDefinition = { ...INBOX_SHORTCUTS[0], id: "OPEN_HELP", keys: ["g"] };
    const sequence = INBOX_SHORTCUTS.find((shortcut) => shortcut.keys.join(" ") === "g d")!;
    expect(findInboxShortcutCollisions([shadow, sequence])).toEqual([
      { first: "OPEN_HELP", second: sequence.id, reason: "PREFIX" },
    ]);
  });

  it("gives every command a plain label, description, group and aria-keyshortcuts value", () => {
    for (const shortcut of INBOX_SHORTCUTS) {
      expect(shortcut.label.length).toBeGreaterThan(3);
      expect(shortcut.description.length).toBeGreaterThan(10);
      expect(["Move", "Act", "Open", "Help"]).toContain(shortcut.group);
      expect(shortcut.ariaKeyShortcuts).toBe(shortcut.keys.join(" "));
    }
  });

  it("allows only Escape to run while typing", () => {
    expect(INBOX_SHORTCUTS.filter((shortcut) => shortcut.allowWhileTyping).map((shortcut) => shortcut.id)).toEqual(["CLOSE_TOPMOST"]);
  });

  it("has a handler behind every shortcut it advertises", () => {
    expect(INBOX_SHORTCUTS.every((shortcut) => shortcut.wired)).toBe(true);
  });
});

describe("resolveInboxShortcut", () => {
  it("runs a single-key shortcut", () => {
    expect(resolveInboxShortcut(press("j"), context)).toEqual({ kind: "RUN", id: "NEXT_CONVERSATION" });
    expect(resolveInboxShortcut(press("k"), context)).toEqual({ kind: "RUN", id: "PREVIOUS_CONVERSATION" });
    expect(resolveInboxShortcut(press("/"), context)).toEqual({ kind: "RUN", id: "FOCUS_SEARCH" });
    expect(resolveInboxShortcut(press("?"), context)).toEqual({ kind: "RUN", id: "OPEN_HELP" });
  });

  it("ignores every shortcut except Escape while typing in a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      for (const key of ["j", "k", "/", "r", "n", "a", "g", "?"]) {
        expect(resolveInboxShortcut(press(key, { target: { tagName } }), context)).toEqual({ kind: "NONE" });
      }
      expect(resolveInboxShortcut(press("Escape", { target: { tagName } }), context)).toEqual({ kind: "RUN", id: "CLOSE_TOPMOST" });
    }
    expect(resolveInboxShortcut(press("j", { target: { tagName: "DIV", isContentEditable: true } }), context)).toEqual({ kind: "NONE" });
  });

  it("ignores a shortcut while an input method is composing text", () => {
    expect(resolveInboxShortcut(press("j", { isComposing: true }), context)).toEqual({ kind: "NONE" });
    expect(resolveInboxShortcut(press("Escape", { isComposing: true }), context)).toEqual({ kind: "NONE" });
  });

  it("ignores a key pressed with Ctrl, Alt or Meta", () => {
    for (const modifier of ["metaKey", "ctrlKey", "altKey"] as const) {
      expect(resolveInboxShortcut(press("j", { [modifier]: true }), context)).toEqual({ kind: "NONE" });
    }
  });

  it("ignores keys that are not shortcuts, including capitals", () => {
    expect(resolveInboxShortcut(press("x"), context)).toEqual({ kind: "NONE" });
    expect(resolveInboxShortcut(press("J"), context)).toEqual({ kind: "NONE" });
    expect(resolveInboxShortcut(press("Enter"), context)).toEqual({ kind: "NONE" });
  });

  it("starts a g-then-d sequence and completes it inside the timeout", () => {
    const first = resolveInboxShortcut(press("g", { now: 5_000 }), context);
    expect(first).toEqual({ kind: "PENDING", first: "g", at: 5_000 });
    const second = resolveInboxShortcut(press("d", { now: 5_000 + INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS, pending: { first: "g", at: 5_000 } }), context);
    expect(second).toEqual({ kind: "RUN", id: "OPEN_DEPARTURE_GROUP" });
  });

  it("does not complete a sequence after its timeout", () => {
    const late = resolveInboxShortcut(press("d", { now: 5_000 + INBOX_SHORTCUT_SEQUENCE_TIMEOUT_MS + 1, pending: { first: "g", at: 5_000 } }), context);
    expect(late).toEqual({ kind: "NONE" });
  });

  it("cancels a pending sequence on a different key and treats that key normally", () => {
    const result = resolveInboxShortcut(press("j", { now: 5_100, pending: { first: "g", at: 5_000 } }), context);
    expect(result).toEqual({ kind: "RUN", id: "NEXT_CONVERSATION" });
    expect(resolveInboxShortcut(press("x", { now: 5_100, pending: { first: "g", at: 5_000 } }), context)).toEqual({ kind: "NONE" });
  });

  it("never starts or completes a sequence while typing", () => {
    expect(resolveInboxShortcut(press("g", { target: { tagName: "TEXTAREA" } }), context)).toEqual({ kind: "NONE" });
    expect(resolveInboxShortcut(press("d", { target: { tagName: "INPUT" }, pending: { first: "g", at: 1_000 } }), context)).toEqual({ kind: "NONE" });
  });

  it("restricts matching to a scope so one handler cannot swallow another's keys", () => {
    const scope = ["NEXT_CONVERSATION", "PREVIOUS_CONVERSATION", "FOCUS_SEARCH"] as const;
    expect(resolveInboxShortcut(press("j"), context, scope)).toEqual({ kind: "RUN", id: "NEXT_CONVERSATION" });
    expect(resolveInboxShortcut(press("g"), context, scope)).toEqual({ kind: "NONE" });
    expect(resolveInboxShortcut(press("r"), context, scope)).toEqual({ kind: "NONE" });
  });

  it("reports an unavailable command with its reason instead of running it", () => {
    const noReply = resolveInboxShortcut(press("r"), { ...context, canReply: false });
    expect(noReply).toMatchObject({ kind: "UNAVAILABLE", id: "FOCUS_REPLY" });
    expect(noReply.kind === "UNAVAILABLE" && noReply.reason.length).toBeGreaterThan(10);
  });
});

describe("inboxShortcutAvailability", () => {
  const byId = (id: string) => INBOX_SHORTCUTS.find((shortcut) => shortcut.id === id)!;

  it("lets navigation and help work with no conversation open", () => {
    const empty: InboxShortcutContext = {
      conversationOpen: false, canReply: false, canWriteNote: false, canAssign: false,
      hasLead: false, hasBooking: false, hasDepartureGroup: false, canStartQuote: false, hasTransientSurface: false,
    };
    for (const id of ["NEXT_CONVERSATION", "PREVIOUS_CONVERSATION", "FOCUS_SEARCH", "OPEN_HELP"]) {
      expect(inboxShortcutAvailability(byId(id), empty).available).toBe(true);
    }
  });

  it("needs an open conversation plus the matching permission or linked record", () => {
    const cases: Array<[string, Partial<InboxShortcutContext>]> = [
      ["FOCUS_REPLY", { canReply: false }],
      ["FOCUS_NOTE", { canWriteNote: false }],
      ["OPEN_ASSIGNMENT", { canAssign: false }],
      ["OPEN_LEAD", { hasLead: false }],
      ["OPEN_BOOKING", { hasBooking: false }],
      ["OPEN_DEPARTURE_GROUP", { hasDepartureGroup: false }],
      ["START_QUOTE", { canStartQuote: false }],
    ];
    for (const [id, missing] of cases) {
      expect(inboxShortcutAvailability(byId(id), context).available).toBe(true);
      const blocked = inboxShortcutAvailability(byId(id), { ...context, ...missing });
      expect(blocked.available).toBe(false);
      expect(blocked.available === false && blocked.reason.length).toBeGreaterThan(10);
      const closed = inboxShortcutAvailability(byId(id), { ...context, conversationOpen: false });
      expect(closed.available).toBe(false);
    }
  });

  it("lets Escape act only when something transient is open", () => {
    expect(inboxShortcutAvailability(byId("CLOSE_TOPMOST"), context).available).toBe(true);
    expect(inboxShortcutAvailability(byId("CLOSE_TOPMOST"), { ...context, hasTransientSurface: false }).available).toBe(false);
  });
});

describe("groupInboxShortcutsForHelp", () => {
  it("groups the wired shortcuts in a fixed order with human-readable keys", () => {
    const groups = groupInboxShortcutsForHelp();
    expect(groups.map((group) => group.group)).toEqual(["Move", "Act", "Open", "Help"]);
    const flat = groups.flatMap((group) => group.items);
    expect(flat).toHaveLength(INBOX_SHORTCUTS.length);
    expect(flat.find((item) => item.id === "OPEN_DEPARTURE_GROUP")?.keysLabel).toBe("g then d");
    expect(flat.find((item) => item.id === "CLOSE_TOPMOST")?.keysLabel).toBe("Esc");
    expect(flat.find((item) => item.id === "OPEN_HELP")?.keysLabel).toBe("?");
    expect(flat.find((item) => item.id === "NEXT_CONVERSATION")?.keysLabel).toBe("j");
  });

  it("leaves out a shortcut that has no handler, so the overlay never advertises a dead key", () => {
    const unwired = INBOX_SHORTCUTS.map((shortcut) => (shortcut.id === "OPEN_LEAD" ? { ...shortcut, wired: false } : shortcut));
    const ids = groupInboxShortcutsForHelp(unwired).flatMap((group) => group.items.map((item) => item.id));
    expect(ids).not.toContain("OPEN_LEAD");
    expect(ids).toContain("OPEN_BOOKING");
  });

  it("carries each item's label, description and aria-keyshortcuts value", () => {
    for (const item of groupInboxShortcutsForHelp().flatMap((group) => group.items)) {
      expect(item.label.length).toBeGreaterThan(3);
      expect(item.description.length).toBeGreaterThan(10);
      expect(item.ariaKeyShortcuts.length).toBeGreaterThan(0);
    }
  });
});
