/**
 * Which model answers a WhatsApp turn. Pure, so the rule is unit-tested.
 *
 * The free model is OPT-IN. Free endpoints may log prompts, and a customer's first messages carry names, phone
 * numbers and passport questions, so nothing runs on one unless `AI_FREE_CHAT_MODEL` names it. Unset, or "off",
 * every turn uses the paid model.
 *
 * When it is set, a conversation that is still purely between the customer and the assistant runs on it
 * first, with no thinking step, to answer quickly and at no cost. Anything that a
 * person from the agency has touched runs on the paid model: staff wrote to the customer, the customer
 * asked for a person, or staff handed the chat back to the assistant afterwards (`AI_RESUMED`).
 *
 * Free models are rate-limited and sometimes return nothing, so the runtime retries a failed free attempt
 * on the paid model (see `canRetryOnPaidModel`).
 */

import { MODEL_FOR_TIER } from "@/lib/ai/provider";
import type { ConversationMessageRow, ConversationRow } from "@/lib/types/whatsapp";

/** How long the free attempt may take before the paid model is used instead. */
export const FREE_ATTEMPT_TIMEOUT_MS = 7_000;

/** The opted-in free model slug, or null when none is configured (unset, empty or "off"). */
export function freeChatModel(): string | null {
  const configured = process.env.AI_FREE_CHAT_MODEL?.trim();
  if (!configured || configured.toLowerCase() === "off") return null;
  return configured;
}

export function paidChatModel(): string {
  return MODEL_FOR_TIER.agent;
}

/** Any turn a person at the agency took in this conversation. */
function hasHumanInvolvement(conversation: Pick<ConversationRow, "state">, history: Array<Pick<ConversationMessageRow, "role" | "actor_kind">>): boolean {
  if (conversation.state !== "AI_ACTIVE") return true;
  return history.some((row) => row.role === "staff" || row.actor_kind === "STAFF");
}

export function shouldUseFreeChatModel(
  conversation: Pick<ConversationRow, "state">,
  history: Array<Pick<ConversationMessageRow, "role" | "actor_kind">>,
): boolean {
  if (freeChatModel() === null) return false;
  return !hasHumanInvolvement(conversation, history);
}

/** Tools that only read. A turn that has run only these can safely be run again on another model. */
const READ_ONLY_TOOLS = new Set([
  "get_upcoming_departures",
  "search_departures",
  "get_departure_details",
  "check_departure_availability",
  "get_booking_status",
  "search_knowledge_base",
]);

/** False as soon as a failed attempt already wrote something (a lead, a note, a booking): running it again could duplicate it. */
export function canRetryOnPaidModel(calls: Array<{ toolName: string }>): boolean {
  return calls.every((call) => READ_ONLY_TOOLS.has(call.toolName));
}
