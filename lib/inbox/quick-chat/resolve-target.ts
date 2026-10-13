import { resolveChannelPolicyState } from "@/lib/channels/policy-state";

/**
 * What the popup may do for a number a page asked it to message. Pure: the server action reads the facts, this decides.
 *
 * It only decides what to SHOW. The send itself is checked again by `sendStaffMessage` (window, ownership, protection gate, rate
 * limit), so a wrong answer here can show a wrong screen but can never send what the server would refuse.
 */

export interface QuickChatExistingConversation {
  id: string;
  state: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  service_window_expires_at: string | null;
}

export type QuickChatTarget =
  | { kind: "READY"; conversationId: string; windowExpiresAt: string }
  /** A free-text message cannot go; an approved template can. The template step is T6; until then the popup says so. */
  | { kind: "NEEDS_TEMPLATE"; reason: "NEW_NUMBER" | "WINDOW_CLOSED" | "CONVERSATION_CLOSED"; conversationId: string | null }
  | { kind: "BLOCKED"; reason: "OPTED_OUT" | "OWNED_BY_COLLEAGUE" | "UNREADABLE"; message: string; conversationId: string | null };

export function decideQuickChatTarget(input: {
  existing: QuickChatExistingConversation | null | "UNREADABLE";
  consent: { allowed: true } | { allowed: false; reason: "OPTED_OUT" | "UNREADABLE"; error: string };
  currentStaffId: string | null;
  now: Date;
}): QuickChatTarget {
  const { existing } = input;
  if (existing === "UNREADABLE") {
    return { kind: "BLOCKED", reason: "UNREADABLE", conversationId: null, message: "Could not check whether this number already has a conversation. Try again in a moment." };
  }
  if (!input.consent.allowed) {
    return {
      kind: "BLOCKED",
      reason: input.consent.reason === "OPTED_OUT" ? "OPTED_OUT" : "UNREADABLE",
      conversationId: existing?.id ?? null,
      message: input.consent.error,
    };
  }
  if (!existing) return { kind: "NEEDS_TEMPLATE", reason: "NEW_NUMBER", conversationId: null };

  const closed = existing.state === "CLOSED";
  const ownedByAnother = existing.assigned_to_id !== null && existing.assigned_to_id !== input.currentStaffId;
  if (ownedByAnother && !closed) {
    const owner = existing.assigned_to_name?.trim() || "a colleague";
    return {
      kind: "BLOCKED",
      reason: "OWNED_BY_COLLEAGUE",
      conversationId: existing.id,
      message: `This chat is owned by ${owner}. Open it from the Inbox, or ask them to hand it over.`,
    };
  }
  if (closed) return { kind: "NEEDS_TEMPLATE", reason: "CONVERSATION_CLOSED", conversationId: existing.id };

  const policy = resolveChannelPolicyState({
    channel: "WHATSAPP",
    now: input.now,
    serviceWindowExpiresAt: existing.service_window_expires_at,
    humanAgentWindowExpiresAt: null,
    handlingMode: existing.state,
    hasOpenSupportCase: false,
    author: "HUMAN",
    projectedTemplateCharge: null,
    chargeCurrency: null,
  });
  if (policy.action === "FREE_FORM" && existing.service_window_expires_at) {
    return { kind: "READY", conversationId: existing.id, windowExpiresAt: existing.service_window_expires_at };
  }
  return { kind: "NEEDS_TEMPLATE", reason: "WINDOW_CLOSED", conversationId: existing.id };
}
