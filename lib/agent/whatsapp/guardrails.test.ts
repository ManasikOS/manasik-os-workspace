import { describe, expect, it } from "vitest";

import { getChannelProfile } from "@/lib/channels/profile";
import type { ConversationRow } from "@/lib/types/whatsapp";

import { checkOutboundReply, containsUnattributedNumber, shouldInvokeAgent, usedNumberBackingTool } from "./guardrails";

function conversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "c1",
    agency_id: "a1",
    channel: "WHATSAPP",
    external_conversation_id: "94771234567",
    lead_id: null,
    contact_name: "Test",
    contact_phone: "94771234567",
    state: "AI_ACTIVE",
    ai_enabled: true,
    assigned_to_id: null,
    assigned_to_name: null,
    service_window_expires_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    unread_count: 0,
    attributed_campaign_id: null,
    attribution_channel: null,
    attribution_tracking_code: null,
    attribution_source_detail: null,
    attribution_confidence: null,
    attribution_captured_at: null,
    created_at: "2026-09-19T00:00:00Z",
    updated_at: "2026-09-19T00:00:00Z",
    ...overrides,
  };
}

function gate(reply: string, overrides: { conversation?: Partial<ConversationRow>; provider?: "WHATSAPP" | "MESSENGER" | "INSTAGRAM"; turnCount?: number; backed?: boolean; aiEnabled?: boolean } = {}) {
  return checkOutboundReply(reply, {
    aiEnabled: overrides.aiEnabled ?? true,
    conversation: conversation(overrides.conversation),
    turnCount: overrides.turnCount ?? 1,
    maxTurns: 40,
    usedNumberBackingToolThisTurn: overrides.backed ?? false,
    profile: getChannelProfile(overrides.provider ?? "WHATSAPP"),
  });
}

/** Pins the WhatsApp outbound gate — same verdicts and same reason strings as before it became channel-aware. */
describe("checkOutboundReply (WhatsApp)", () => {
  it("lets a normal reply through", () => {
    expect(gate("Sure — which month would you like to travel?")).toEqual({ ok: true });
  });

  it("blocks when the agency switched the assistant off", () => {
    expect(gate("Hello", { aiEnabled: false })).toEqual({ ok: false, reason: "AI disabled for this agency" });
  });

  it("never speaks over a colleague, and never into a closed chat", () => {
    expect(gate("Hello", { conversation: { state: "HUMAN_ACTIVE" } })).toEqual({ ok: false, reason: "conversation is HUMAN_ACTIVE" });
    expect(gate("Hello", { conversation: { state: "CLOSED" } })).toEqual({ ok: false, reason: "conversation is CLOSED" });
  });

  it("blocks free text once the 24h window has closed, with the original wording", () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    expect(gate("Hello", { conversation: { service_window_expires_at: expired } })).toEqual({
      ok: false,
      reason: "outside the 24h WhatsApp service window",
    });
  });

  it("allows a reply while the window is still open", () => {
    const open = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(gate("Hello", { conversation: { service_window_expires_at: open } }).ok).toBe(true);
  });

  it("stops at max turns, empty replies, and over-long replies (1200 characters)", () => {
    expect(gate("Hello", { turnCount: 40 })).toEqual({ ok: false, reason: expect.stringMatching(/^max_turns_per_conversation reached \(\d+\)$/) });
    expect(gate("   ")).toEqual({ ok: false, reason: "empty reply" });
    expect(gate("a".repeat(1200)).ok).toBe(true);
    expect(gate("a".repeat(1201))).toEqual({ ok: false, reason: "reply exceeds 1200 characters" });
  });

  it("blocks an unbacked price and lets it through once a tool backed the turn", () => {
    expect(gate("It costs LKR 245,000 per person.")).toEqual({
      ok: false,
      reason: "reply contains a number with no tool call to back it this turn",
    });
    expect(gate("It costs LKR 245,000 per person.", { backed: true }).ok).toBe(true);
  });
});

describe("checkOutboundReply on other channels", () => {
  it("applies the same rules and names the channel in the window reason", () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    expect(gate("Hello", { provider: "INSTAGRAM", conversation: { channel: "INSTAGRAM", service_window_expires_at: expired } })).toEqual({
      ok: false,
      reason: "outside the 24h Instagram service window",
    });
    expect(gate("Hello", { provider: "MESSENGER", conversation: { channel: "MESSENGER", state: "HUMAN_ACTIVE" } }).ok).toBe(false);
  });

  it("still refuses a number no tool backed on every channel", () => {
    for (const provider of ["MESSENGER", "INSTAGRAM"] as const) {
      expect(gate("Only 12 seats left at 245000", { provider }).ok).toBe(false);
    }
  });
});

describe("shouldInvokeAgent", () => {
  it("runs only for an AI-owned, AI-enabled conversation", () => {
    expect(shouldInvokeAgent(conversation())).toBe(true);
    expect(shouldInvokeAgent(conversation({ state: "AI_RESUMED" }))).toBe(true);
    expect(shouldInvokeAgent(conversation({ state: "HUMAN_ACTIVE" }))).toBe(false);
    expect(shouldInvokeAgent(conversation({ state: "HUMAN_REQUESTED" }))).toBe(false);
    expect(shouldInvokeAgent(conversation({ ai_enabled: false }))).toBe(false);
  });
});

describe("usedNumberBackingTool", () => {
  it("is false for a turn with no tool calls", () => {
    expect(usedNumberBackingTool([])).toBe(false);
  });

  it("is false when the only tool was the knowledge lookup", () => {
    expect(usedNumberBackingTool([{ toolName: "search_knowledge_base" }])).toBe(false);
  });

  it("is true when a departure tool ran, even alongside a knowledge lookup", () => {
    expect(usedNumberBackingTool([{ toolName: "search_knowledge_base" }, { toolName: "get_departure_details" }])).toBe(true);
  });
});

describe("usedNumberBackingTool (allowlist)", () => {
  it.each(["update_lead", "add_lead_note", "transfer_to_staff", "find_or_create_lead", "record_traveller", "capture_contact_number"])(
    "is false when the only tool was %s, which supplies no figure",
    (toolName) => {
      expect(usedNumberBackingTool([{ toolName }])).toBe(false);
    },
  );

  it("is false when the departure tool failed or found nothing", () => {
    expect(usedNumberBackingTool([{ toolName: "get_departure_details", isError: true }])).toBe(false);
    expect(usedNumberBackingTool([{ toolName: "get_departure_details", resultSummary: '{"error":"That departure is no longer available"}' }])).toBe(false);
  });

  it("is true when a booking tool returned a summary", () => {
    expect(usedNumberBackingTool([{ toolName: "review_booking", resultSummary: '{"totalPrice":490000}' }])).toBe(true);
  });
});

describe("seat-count claims", () => {
  it.each(["Only 3 seats left.", "There are 12 seats available.", "just 2 spots remaining", "5 places open"])(
    "blocks '%s' without a backing tool",
    (text) => {
      expect(containsUnattributedNumber(text, false)).toBe(true);
    },
  );

  it("lets a customer's own party size be repeated back", () => {
    expect(containsUnattributedNumber("Great, 2 adults and 1 child. Which month suits you?", false)).toBe(false);
    expect(containsUnattributedNumber("Would you like 2 seats held?", false)).toBe(false);
  });

  it("allows a seat claim once a departure tool backed the turn", () => {
    expect(containsUnattributedNumber("Only 3 seats left.", true)).toBe(false);
  });
});

describe("containsUnattributedNumber", () => {
  it("blocks a price on a knowledge-only turn", () => {
    const backed = usedNumberBackingTool([{ toolName: "search_knowledge_base" }]);
    expect(containsUnattributedNumber("The cancellation fee is LKR 245,000.", backed)).toBe(true);
  });

  it("allows the same price once a departure tool backed the turn", () => {
    const backed = usedNumberBackingTool([{ toolName: "search_knowledge_base" }, { toolName: "get_departure_details" }]);
    expect(containsUnattributedNumber("The cancellation fee is LKR 245,000.", backed)).toBe(false);
  });

  it("lets percentages and short day counts through on a knowledge-only turn", () => {
    const backed = usedNumberBackingTool([{ toolName: "search_knowledge_base" }]);
    expect(containsUnattributedNumber("You get 25% back if you cancel 30 days before travel.", backed)).toBe(false);
  });
});


describe("checkOutboundReply — the protection gate (MI4.2)", () => {
  const base = { aiEnabled: true, turnCount: 0, maxTurns: 10, usedNumberBackingToolThisTurn: true, profile: { displayName: "WhatsApp", replyWindowHours: 24, preferredReplyChars: 1000 } };
  const check = checkOutboundReply;
  const conversation = { state: "AI_ACTIVE", service_window_expires_at: null, channel: "WHATSAPP" } as never;
  const noReview = { openReviews: [], approvedAccountDigits: [] };
  const open = { openReviews: [{ kind: "PAYMENT_CLAIM" as const, severity: "BLOCK" as const, headline: "Says they paid" }], approvedAccountDigits: [] };

  it("refuses an automated reply that says anything on the never-autonomous list, with no review open", () => {
    const result = check("We will refund you in full.", { ...base, conversation, protection: noReview });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("protection gate");
  });

  it("refuses any automated reply while a blocking review is open", () => {
    expect(check("Assalamu alaikum, how can I help?", { ...base, conversation, protection: open }).ok).toBe(false);
  });

  it("lets a harmless reply through when nothing is open", () => {
    expect(check("Assalamu alaikum, how can I help?", { ...base, conversation, protection: noReview }).ok).toBe(true);
  });

  it("older callers that pass no protection are unchanged", () => {
    expect(check("Assalamu alaikum, how can I help?", { ...base, conversation }).ok).toBe(true);
  });
});
