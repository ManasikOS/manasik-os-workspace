import { describe, expect, it } from "vitest";

import { findWaitingConversations, handoffNotificationTitle, recipientsFor, type WaitingConversationRow } from "@/lib/followups/handoff-waiting";

const NOW = new Date("2026-10-01T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const THRESHOLDS = { alertMinutes: 15, escalationMinutes: 60 };

function row(overrides: Partial<WaitingConversationRow> = {}): WaitingConversationRow {
  return {
    conversationId: "c1",
    channel: "MESSENGER",
    state: "HUMAN_REQUESTED",
    contactName: "Aisha",
    assignedToId: "s1",
    firstUnansweredMessageId: "m1",
    firstUnansweredAt: minutesAgo(20),
    ...overrides,
  };
}

describe("findWaitingConversations", () => {
  it("alerts after the alert time and anchors on the first unanswered message", () => {
    const due = findWaitingConversations([row()], NOW, THRESHOLDS);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ level: "ALERT", anchorMessageId: "m1", minutesWaiting: 20 });
  });

  it("does nothing before the alert time", () => {
    expect(findWaitingConversations([row({ firstUnansweredAt: minutesAgo(14) })], NOW, THRESHOLDS)).toEqual([]);
  });

  it("adds an escalation past the escalation time", () => {
    const due = findWaitingConversations([row({ firstUnansweredAt: minutesAgo(65) })], NOW, THRESHOLDS);
    expect(due.map((d) => d.level)).toEqual(["ALERT", "ESCALATION"]);
  });

  it("ignores conversations the assistant owns, or with nothing unanswered", () => {
    expect(findWaitingConversations([row({ state: "AI_ACTIVE" })], NOW, THRESHOLDS)).toEqual([]);
    expect(findWaitingConversations([row({ state: "CLOSED" })], NOW, THRESHOLDS)).toEqual([]);
    expect(findWaitingConversations([row({ firstUnansweredMessageId: null, firstUnansweredAt: null })], NOW, THRESHOLDS)).toEqual([]);
  });

  it("re-arms with a new anchor once a later message is the first unanswered one", () => {
    const first = findWaitingConversations([row({ firstUnansweredMessageId: "m1" })], NOW, THRESHOLDS);
    const later = findWaitingConversations([row({ firstUnansweredMessageId: "m9", firstUnansweredAt: minutesAgo(30) })], NOW, THRESHOLDS);
    expect(first[0].anchorMessageId).not.toBe(later[0].anchorMessageId);
  });

  it("ignores a message dated in the future", () => {
    expect(findWaitingConversations([row({ firstUnansweredAt: minutesAgo(-5) })], NOW, THRESHOLDS)).toEqual([]);
  });
});

describe("recipientsFor", () => {
  const admins = ["a1", "a2"];
  it("alerts the assignee first", () => {
    expect(recipientsFor({ level: "ALERT", assignedToId: "s1" }, "d1", admins)).toEqual(["s1"]);
  });
  it("falls back to the default lead owner, then Admin/CEO", () => {
    expect(recipientsFor({ level: "ALERT", assignedToId: null }, "d1", admins)).toEqual(["d1"]);
    expect(recipientsFor({ level: "ALERT", assignedToId: null }, null, admins)).toEqual(admins);
  });
  it("escalates to Admin/CEO only", () => {
    expect(recipientsFor({ level: "ESCALATION", assignedToId: "s1" }, "d1", admins)).toEqual(admins);
  });
});

describe("handoffNotificationTitle", () => {
  it("uses plain words", () => {
    expect(handoffNotificationTitle({ level: "ALERT", contactName: "Aisha", channel: "MESSENGER", minutesWaiting: 20 })).toBe(
      "Aisha is waiting for a reply on Messenger — 20 min",
    );
    expect(handoffNotificationTitle({ level: "ESCALATION", contactName: "", channel: "WHATSAPP", minutesWaiting: 65 })).toBe(
      "Still waiting: A customer on WhatsApp for 65 min",
    );
  });
});
