/**
 * Taking, releasing or replying on a conversation must never move it away from the colleague who owns it. These are the pure decisions the
 * Inbox actions make, from a fresh read of the conversation, before anything is sent or written. Giving a chat to someone else is a separate,
 * recorded action (`assignConversationAction`); none of these is a way around it.
 */

export interface OwnedConversationFacts {
  state: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
}

export type OwnershipDecision = { ok: true } | { ok: false; error: string };

function ownerOf(facts: OwnedConversationFacts, currentStaffId: string | null): { name: string } | null {
  if (facts.assigned_to_id === null || facts.assigned_to_id === currentStaffId) return null;
  return { name: facts.assigned_to_name?.trim() || "a colleague" };
}

/** "Take control": refused on a closed chat (it reopens when the customer writes) and on a chat a colleague owns. */
export function decideTakeControl(input: { conversation: OwnedConversationFacts; currentStaffId: string | null }): OwnershipDecision {
  if (input.conversation.state === "CLOSED") {
    return { ok: false, error: "This conversation is closed. It reopens when the customer writes again." };
  }
  const owner = ownerOf(input.conversation, input.currentStaffId);
  if (owner) return { ok: false, error: `This conversation is owned by ${owner.name}. Ask them to hand it over, or ask an administrator to assign it to you.` };
  return { ok: true };
}

/** Sending into a chat someone else owns would also make the sender its owner, so it is refused up front. */
export function decideReplyOnOwnedConversation(input: { conversation: OwnedConversationFacts; currentStaffId: string | null }): OwnershipDecision {
  const owner = ownerOf(input.conversation, input.currentStaffId);
  if (owner) return { ok: false, error: `This conversation is owned by ${owner.name}. Ask them to reply, or to hand it over first.` };
  return { ok: true };
}

/** "Hand back to the assistant": only the owner (or an administrator) may, and never while a review is open on the chat. */
export function decideReleaseToAi(input: {
  conversation: OwnedConversationFacts;
  currentStaffId: string | null;
  isAdministrator: boolean;
  openReviewCount: number;
}): OwnershipDecision {
  const owner = ownerOf(input.conversation, input.currentStaffId);
  if (owner && !input.isAdministrator) return { ok: false, error: `This conversation is owned by ${owner.name}. Only they or an administrator can hand it back to the assistant.` };
  if (input.openReviewCount > 0) return { ok: false, error: "A review is still open on this conversation. Resolve it before handing the chat back to the assistant." };
  return { ok: true };
}
