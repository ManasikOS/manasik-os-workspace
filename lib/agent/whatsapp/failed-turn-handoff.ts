/**
 * What happens when the assistant could not answer a customer message (model error, tool error, refusal, or a
 * blocked reply). Without this the chat stays "AI active", the customer is never answered, and no alert fires
 * because the waiting-conversation sweep only watches chats a person owns. Handing the chat to staff makes it
 * visible and lets the existing unanswered-handoff alerts do their job.
 */

import { parseMaxTurnsReason } from "@/lib/agent/whatsapp/guardrails";
import type { AgentTurnOutcome } from "@/lib/agent/whatsapp/runtime";

type FailedOutcome = Exclude<AgentTurnOutcome, { status: "OK" }>;

/** Guardrail reasons that mean "the assistant must not speak here", not "the assistant failed". */
const NOT_A_FAILURE_REASONS = new Set(["AI disabled for this agency", "conversation is HUMAN_ACTIVE", "conversation is CLOSED"]);

/** True when staff need to pick this chat up because the assistant could not answer it. */
export function shouldHandOffAfterTurn(outcome: AgentTurnOutcome): outcome is FailedOutcome {
  if (outcome.status === "OK") return false;
  if (outcome.status === "GUARDRAIL_BLOCKED" && NOT_A_FAILURE_REASONS.has(outcome.reason)) return false;
  return true;
}

/** The sentence a staff member reads in the conversation, in plain words. */
export function failedTurnNote(outcome: FailedOutcome): string {
  const prefix = "The assistant could not reply, so this chat was passed to staff.";
  switch (outcome.status) {
    case "GUARDRAIL_BLOCKED": {
      const limit = parseMaxTurnsReason(outcome.reason);
      if (limit !== null) return `The assistant handed this chat to staff after ${limit} replies, which is its limit for one conversation.`;
      return `${prefix} Its draft reply was held back: ${outcome.reason}.`;
    }
    case "REFUSAL":
      return `${prefix} The AI model declined to answer this message.`;
    case "TOOL_ERROR":
      return `${prefix} A lookup or update failed: ${outcome.error.slice(0, 200)}`;
    case "MODEL_ERROR":
      return `${prefix} The AI model was unavailable: ${outcome.error.slice(0, 200)}`;
  }
}
