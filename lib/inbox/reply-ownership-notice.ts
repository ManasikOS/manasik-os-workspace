import type { ConversationState } from "@/lib/types/whatsapp";

/**
 * A heads-up shown before staff reply in a chat a colleague owns. It exists because sending from the CRM changes
 * ownership in one case: when the chat is not already staff-handled (`sendStaffMessage` takes control first), the sender
 * becomes the owner. In every other case the reply goes out and the owner stays, so the only risk is two people answering.
 * It informs; it never blocks sending.
 */

export interface ReplyOwnershipNotice {
  kind: "TAKES_OVER" | "COORDINATE";
  message: string;
}

export function replyOwnershipNoticeFor(input: {
  state: ConversationState;
  assignedToId: string | null;
  assignedToName: string | null;
  currentStaffId: string | null;
}): ReplyOwnershipNotice | null {
  const ownedByAnother = input.assignedToId !== null && input.assignedToId !== input.currentStaffId;
  if (!ownedByAnother || input.state === "CLOSED") return null;

  const owner = input.assignedToName?.trim() || "A colleague";
  if (input.state === "HUMAN_ACTIVE") {
    return { kind: "COORDINATE", message: `${owner} owns this chat. Check with them before you reply so the customer gets one answer.` };
  }
  return { kind: "TAKES_OVER", message: `${owner} is the owner. Sending a reply makes you the owner and pauses the assistant.` };
}
