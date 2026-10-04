import type { ConversationState } from "@/lib/types/whatsapp";

/** State transition caused by a fresh customer message. */
export function stateAfterInbound(state: ConversationState): ConversationState {
  return state === "AI_RESUMED" || state === "CLOSED" ? "AI_ACTIVE" : state;
}
