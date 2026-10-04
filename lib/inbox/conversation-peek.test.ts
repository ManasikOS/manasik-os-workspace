import { describe, expect, it } from "vitest";

import { conversationPeek, type ConversationPeekSource } from "./conversation-peek";

const now = new Date("2026-10-04T12:00:00Z");

function source(overrides: Partial<ConversationPeekSource> = {}): ConversationPeekSource {
  return {
    channel: "WHATSAPP",
    contact_name: "Nadeesha Perera",
    contact_phone: "+94771234567",
    external_conversation_id: "94771234567",
    state: "AI_ACTIVE",
    assigned_to_id: null,
    assigned_to_name: null,
    service_window_expires_at: null,
    last_inbound_at: "2026-10-04T10:00:00Z",
    last_outbound_at: "2026-10-04T10:05:00Z",
    unread_count: 0,
    created_at: "2026-09-01T08:00:00Z",
    lead_reference: null,
    lead_stage: null,
    desired_package_name: null,
    last_message_content: "Is the March departure still open?",
    last_message_role: "user",
    last_message_type: "TEXT",
    has_open_support_case: false,
    ...overrides,
  };
}
const options = { now, currentStaffId: "me" };
const fact = (peek: ReturnType<typeof conversationPeek>, label: string) =>
  peek.facts.find((entry) => entry.label === label);

describe("conversationPeek", () => {
  it("names the contact, the channel and who wrote last", () => {
    const peek = conversationPeek(source(), options);
    expect(peek.name).toBe("Nadeesha Perera");
    expect(peek.channelLabel).toBe("WhatsApp");
    expect(peek.contactLine).toBe("+94771234567");
    expect(peek.lastMessage).toEqual({ sender: "Customer", text: "Is the March departure still open?" });
  });

  it("falls back to the voice-message label for media and shortens a very long message", () => {
    const voice = conversationPeek(source({ last_message_content: "", last_message_type: "AUDIO" }), options);
    expect(voice.lastMessage?.text).toBe("Voice message");
    const long = conversationPeek(source({ last_message_content: "x".repeat(500) }), options).lastMessage!.text;
    expect(long.length).toBeLessThanOrEqual(241);
    expect(long.endsWith("…")).toBe(true);
  });

  it("shows no last message for a chat that has none", () => {
    const none = conversationPeek(source({ last_message_content: null, last_message_type: null }), options);
    expect(none.lastMessage).toBeNull();
  });

  it("uses the email address for an email thread and does not repeat the phone when it is the name", () => {
    expect(conversationPeek(source({ channel: "GMAIL", external_conversation_id: "a@b.com" }), options).contactLine).toBe("a@b.com");
    expect(conversationPeek(source({ contact_name: "+94771234567" }), options).contactLine).toBeNull();
  });

  it("says who owns the chat, from the viewer's point of view", () => {
    expect(fact(conversationPeek(source(), options), "Owner")?.value).toBe("Unassigned");
    expect(fact(conversationPeek(source({ assigned_to_id: "me", assigned_to_name: "Me" }), options), "Owner")?.value).toBe(
      "Assigned to you",
    );
    expect(fact(conversationPeek(source({ assigned_to_id: "x", assigned_to_name: "Amina" }), options), "Owner")?.value).toBe(
      "Assigned to Amina",
    );
  });

  it("flags a chat that needs staff", () => {
    expect(fact(conversationPeek(source({ state: "HUMAN_REQUESTED" }), options), "Status")).toMatchObject({
      value: "Staff action needed",
      attention: true,
    });
  });

  it("reports an open reply window with its closing time, and a closed one as needing attention", () => {
    const open = fact(conversationPeek(source({ service_window_expires_at: "2026-10-04T17:00:00Z" }), options), "Reply window");
    expect(open?.value).toBe("Open, closes in 5 hours");
    expect(open?.attention).toBeUndefined();
    const closed = fact(conversationPeek(source({ service_window_expires_at: "2026-10-04T08:00:00Z" }), options), "Reply window");
    expect(closed?.attention).toBe(true);
    expect(closed?.value).toMatch(/^Closed/);
  });

  it("skips the reply window when there is none or the chat is closed", () => {
    expect(fact(conversationPeek(source(), options), "Reply window")).toBeUndefined();
    const closedChat = source({ state: "CLOSED", service_window_expires_at: "2026-10-04T17:00:00Z" });
    expect(fact(conversationPeek(closedChat, options), "Reply window")).toBeUndefined();
  });

  it("includes lead, interest, unread and support-case lines only when there is something to say", () => {
    const bare = conversationPeek(source(), options);
    for (const label of ["Lead", "Interested in", "Unread", "Support case"]) expect(fact(bare, label)).toBeUndefined();
    const rich = conversationPeek(
      source({
        lead_reference: "L-1042",
        lead_stage: "QUOTE_SENT",
        desired_package_name: "Umrah March",
        unread_count: 2,
        has_open_support_case: true,
      }),
      options,
    );
    expect(fact(rich, "Lead")?.value).toBe("L-1042 · Quote sent");
    expect(fact(rich, "Interested in")?.value).toBe("Umrah March");
    expect(fact(rich, "Unread")?.value).toBe("2 messages");
    expect(fact(rich, "Support case")?.attention).toBe(true);
  });

  it("describes when the customer last wrote and when we last replied", () => {
    const peek = conversationPeek(source(), options);
    expect(fact(peek, "Customer wrote")?.value).toBe("2 hours ago");
    expect(fact(peek, "We replied")?.value).toBe("2 hours ago");
  });
});
