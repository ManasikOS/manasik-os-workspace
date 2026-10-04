import type { ConversationState } from "@/lib/types/whatsapp";

/**
 * Turns a conversation's stored state and owner into the plain words staff read in the thread header.
 * The raw state names never reach the screen. It answers three questions at a glance: who owns this chat,
 * may the assistant speak, and who must respond next.
 */

export type OwnershipTone = "calm" | "owned" | "action" | "muted";

export interface OwnershipStatus {
  /** The owner chip text, e.g. "Assigned to Nadeesha" or "Unassigned". */
  ownerLabel: string;
  /** The assistant / responsibility badge text. */
  statusLabel: string;
  /** Who must write the next reply. */
  nextResponder: "ASSISTANT" | "STAFF" | "NOBODY";
  tone: OwnershipTone;
  /** A short sentence for screen readers and the badge tooltip. */
  description: string;
}

export function ownershipStatusFor(input: {
  state: ConversationState;
  assignedToName: string | null;
  assignedToId: string | null;
  currentStaffId: string | null;
}): OwnershipStatus {
  const ownerName = input.assignedToName?.trim() || null;
  const ownedByCurrentStaff = input.assignedToId !== null && input.assignedToId === input.currentStaffId;
  const ownerLabel = ownedByCurrentStaff
    ? "Assigned to you"
    : ownerName
      ? `Assigned to ${ownerName}`
      : "Unassigned";

  switch (input.state) {
    case "AI_ACTIVE":
    case "AI_RESUMED":
      return {
        ownerLabel,
        statusLabel: "Assistant active",
        nextResponder: "ASSISTANT",
        tone: "calm",
        description: "The assistant is handling replies. Staff can take over at any time.",
      };
    case "HUMAN_REQUESTED":
      return {
        ownerLabel,
        statusLabel: "Staff action needed",
        nextResponder: "STAFF",
        tone: "action",
        description: "The assistant has stopped. A person needs to reply.",
      };
    case "HUMAN_ACTIVE":
      return {
        ownerLabel,
        statusLabel: "Assistant paused",
        nextResponder: "STAFF",
        tone: "muted",
        description: "Staff own this chat, so the assistant will not reply.",
      };
    case "CLOSED":
      return {
        ownerLabel,
        statusLabel: "Closed",
        nextResponder: "NOBODY",
        tone: "muted",
        description: "This conversation is closed. A new message from the customer reopens it.",
      };
  }
}
