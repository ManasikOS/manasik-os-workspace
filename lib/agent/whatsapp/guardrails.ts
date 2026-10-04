/**
 * The outbound gate — every check a reply must clear before it reaches
 * `sendText()`. See §7.4 of docs/modules/whatsapp-ai-agent-implementation-plan.md.
 * A blocked reply never reaches the customer; the caller hands off instead.
 */

import type { ChannelProfile } from "@/lib/channels/profile";
import { evaluateProtection, refusalMessage, type OpenReview } from "@/lib/inbox/risk/protection-gate";
import type { ConversationRow } from "@/lib/types/whatsapp";

export interface GuardrailResult {
  ok: boolean;
  reason?: string;
}

/**
 * The only tools whose results carry prices, dates or seat counts. An allowlist, not a denylist: a lead update,
 * a note or a handoff supplies no figure, so running one must not unlock quoting a number (and neither may a
 * knowledge-base lookup, whose policy prose can state "LKR 15,000").
 */
const NUMBER_BACKING_TOOLS = new Set([
  "get_upcoming_departures",
  "search_departures",
  "get_departure_details",
  "check_departure_availability",
  "start_booking",
  "review_booking",
  "confirm_and_hold_booking",
  "get_booking_status",
]);

/** Tools report ordinary failures as a JSON body that starts with an `error` key, without failing the call itself. */
function callSupplied(call: { isError?: boolean; resultSummary?: string }): boolean {
  return !call.isError && !(call.resultSummary ?? "").startsWith('{"error"');
}

/** True when a tool that can legitimately supply a number ran AND returned something this turn. */
export function usedNumberBackingTool(
  calls: ReadonlyArray<{ toolName: string; isError?: boolean; resultSummary?: string }>,
): boolean {
  return calls.some((call) => NUMBER_BACKING_TOOLS.has(call.toolName) && callSupplied(call));
}

/** "only 3 seats left", "2 spots available" — an availability claim, however short the number. */
const SEAT_CLAIM = /\b(?:only|just)\s+\d{1,2}\s+(?:seats?|spots?|places?)\b|\b\d{1,2}\s+(?:seats?|spots?|places?)\s+(?:left|available|remaining|open)\b/i;

/**
 * Rough check that a reply contains no unattributed number that looks like
 * a price or seat count. `usedNumberBackingToolThisTurn` gates it: a turn
 * that called a tool able to supply numbers is allowed through, since the
 * tool result is where a legitimate number comes from. A turn with no such
 * tool has no source for a number at all — if one appears anyway, it is a
 * hallucination by construction, not a false positive. A knowledge-base
 * lookup does not count: a policy that states "LKR 15,000" would otherwise
 * unlock quoting it.
 */
export function containsUnattributedNumber(text: string, usedNumberBackingToolThisTurn: boolean): boolean {
  if (usedNumberBackingToolThisTurn) return false;
  // A run of 3+ digits, optionally with thousands separators — catches prices ("45000") and dates written as
  // numbers. Seat counts are usually one or two digits, so they get their own pattern. The agent has no
  // business stating any of these without a tool call backing it in this design.
  return /\d[\d,]{2,}/.test(text) || SEAT_CLAIM.test(text);
}

/** The reason recorded when the assistant has used up its replies for one conversation. The limit is part of it so staff can read it. */
export function maxTurnsReason(maxTurns: number): string {
  return `max_turns_per_conversation reached (${maxTurns})`;
}

/** The limit inside a max-turns reason, or null for any other reason. */
export function parseMaxTurnsReason(reason: string): number | null {
  const match = /^max_turns_per_conversation reached \((\d+)\)$/.exec(reason);
  return match ? Number(match[1]) : null;
}

export function checkOutboundReply(
  reply: string,
  input: {
    aiEnabled: boolean;
    conversation: ConversationRow;
    /** How many replies the assistant has already sent in this conversation — the whole conversation, not the model's history window. */
    turnCount: number;
    maxTurns: number;
    usedNumberBackingToolThisTurn: boolean;
    /** The channel's own limits — window length and reply size differ per platform, the rules do not. */
    profile: Pick<ChannelProfile, "displayName" | "replyWindowHours" | "preferredReplyChars">;
    /**
     * The protection gate (MI4.2): the reviews still open on this conversation and the approved bank accounts. The runtime always
     * passes it; an absent value means "no gate", which only older callers and tests rely on.
     */
    protection?: { openReviews: readonly OpenReview[]; approvedAccountDigits: readonly string[] };
  },
): GuardrailResult {
  if (!input.aiEnabled) return { ok: false, reason: "AI disabled for this agency" };

  // §10.1 — the agent must never speak over a colleague.
  if (input.conversation.state === "HUMAN_ACTIVE") {
    return { ok: false, reason: "conversation is HUMAN_ACTIVE" };
  }
  if (input.conversation.state === "CLOSED") {
    return { ok: false, reason: "conversation is CLOSED" };
  }

  // F7 — outside the service window, only an approved template may be sent.
  if (
    input.conversation.service_window_expires_at &&
    new Date(input.conversation.service_window_expires_at).getTime() < Date.now()
  ) {
    return { ok: false, reason: `outside the ${input.profile.replyWindowHours}h ${input.profile.displayName} service window` };
  }

  if (input.turnCount >= input.maxTurns) {
    return { ok: false, reason: maxTurnsReason(input.maxTurns) };
  }

  if (reply.trim().length === 0) {
    return { ok: false, reason: "empty reply" };
  }

  // A long reply reads badly on a phone, so the cap is well under any platform's hard limit.
  if (reply.length > input.profile.preferredReplyChars) {
    return { ok: false, reason: `reply exceeds ${input.profile.preferredReplyChars} characters` };
  }

  if (containsUnattributedNumber(reply, input.usedNumberBackingToolThisTurn)) {
    return { ok: false, reason: "reply contains a number with no tool call to back it this turn" };
  }

  // The strongest of the three never-promise layers: an automated reply that says anything on the never-autonomous list, or that
  // is sent while a blocking review is open, never reaches the customer. No autonomy level is consulted.
  if (input.protection) {
    const decision = evaluateProtection({ text: reply, audience: "AUTOMATED_SEND", openReviews: input.protection.openReviews, approvedAccountDigits: input.protection.approvedAccountDigits });
    if (!decision.allowed) return { ok: false, reason: `protection gate: ${refusalMessage(decision)}` };
  }

  return { ok: true };
}

/** Whether the agent should be invoked for this conversation at all — checked before any model call. */
export function shouldInvokeAgent(conversation: ConversationRow): boolean {
  return (
    conversation.ai_enabled &&
    (conversation.state === "AI_ACTIVE" || conversation.state === "AI_RESUMED")
  );
}
