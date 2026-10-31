import { describe, expect, it } from "vitest";

import { decideQuickChatTarget, type QuickChatExistingConversation } from "./resolve-target";

const NOW = new Date("2030-01-10T12:00:00Z");
const OPEN_UNTIL = "2030-01-11T10:00:00Z";
const CLOSED_AT = "2030-01-09T10:00:00Z";
const ALLOWED = { allowed: true } as const;

function conversation(overrides: Partial<QuickChatExistingConversation> = {}): QuickChatExistingConversation {
  return { id: "c-1", state: "HUMAN_ACTIVE", assigned_to_id: "staff-1", assigned_to_name: "Amina", service_window_expires_at: OPEN_UNTIL, ...overrides };
}

const decide = (overrides: Partial<Parameters<typeof decideQuickChatTarget>[0]> = {}) =>
  decideQuickChatTarget({ existing: conversation(), consent: ALLOWED, currentStaffId: "staff-1", now: NOW, ...overrides });

describe("decideQuickChatTarget", () => {
  it("is ready for free text when the reply window is open and the chat is the sender's", () => {
    expect(decide()).toEqual({ kind: "READY", conversationId: "c-1", windowExpiresAt: OPEN_UNTIL });
  });

  it("is ready for an unowned chat the assistant is handling", () => {
    expect(decide({ existing: conversation({ assigned_to_id: null, assigned_to_name: null, state: "AI_ACTIVE" }) }).kind).toBe("READY");
  });

  it("needs a template for a number with no conversation", () => {
    expect(decide({ existing: null })).toEqual({ kind: "NEEDS_TEMPLATE", reason: "NEW_NUMBER", conversationId: null });
  });

  it("needs a template once the window has closed, and when no window was ever recorded", () => {
    expect(decide({ existing: conversation({ service_window_expires_at: CLOSED_AT }) })).toMatchObject({ kind: "NEEDS_TEMPLATE", reason: "WINDOW_CLOSED", conversationId: "c-1" });
    expect(decide({ existing: conversation({ service_window_expires_at: null }) })).toMatchObject({ kind: "NEEDS_TEMPLATE", reason: "WINDOW_CLOSED" });
  });

  it("needs a template to reopen a closed chat even if its window is still open", () => {
    expect(decide({ existing: conversation({ state: "CLOSED" }) })).toMatchObject({ kind: "NEEDS_TEMPLATE", reason: "CONVERSATION_CLOSED" });
  });

  it("is blocked for a chat a colleague owns, and names them", () => {
    const target = decide({ existing: conversation({ assigned_to_id: "staff-2", assigned_to_name: "Rizwan" }) });
    expect(target).toMatchObject({ kind: "BLOCKED", reason: "OWNED_BY_COLLEAGUE", conversationId: "c-1" });
    expect(target.kind === "BLOCKED" && target.message).toContain("Rizwan");
  });

  it("lets a closed chat that was a colleague's be started again", () => {
    expect(decide({ existing: conversation({ state: "CLOSED", assigned_to_id: "staff-2" }) }).kind).toBe("NEEDS_TEMPLATE");
  });

  it("is blocked for an opted-out lead before anything else, even with an open window", () => {
    const target = decide({ consent: { allowed: false, reason: "OPTED_OUT", error: "Opted out." } });
    expect(target).toMatchObject({ kind: "BLOCKED", reason: "OPTED_OUT", message: "Opted out." });
  });

  it("treats an unreadable consent or conversation lookup as blocked, never as clear", () => {
    expect(decide({ consent: { allowed: false, reason: "UNREADABLE", error: "Try again." } })).toMatchObject({ kind: "BLOCKED", reason: "UNREADABLE" });
    expect(decide({ existing: "UNREADABLE" })).toMatchObject({ kind: "BLOCKED", reason: "UNREADABLE" });
  });
});
