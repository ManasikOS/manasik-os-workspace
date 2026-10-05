/**
 * Starting a chat or an email with a contact that already has a conversation reuses that conversation (one per agency, channel and
 * contact). Reusing it must never take it away from a colleague who is working it, so this decides, before anything is sent, whether the
 * person may go ahead. A closed chat, an unowned chat, one the assistant is handling and one the person already owns are all fine.
 * Taking over a closed chat that was a colleague's is written to its history by the caller, and the write itself
 * (`start-conversation-write.ts`) re-checks these rules against the chat as it is at that moment.
 */

export interface ExistingConversationForStart {
  id: string;
  state: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
}

export type StartConversationDecision = { ok: true } | { ok: false; error: string };

export function decideStartOnExistingConversation(input: {
  existing: ExistingConversationForStart | null;
  currentStaffId: string | null;
  /** "number" for a WhatsApp chat, "email address" for an email. */
  contactNoun: string;
}): StartConversationDecision {
  const { existing } = input;
  if (!existing) return { ok: true };
  const ownedByAnother = existing.assigned_to_id !== null && existing.assigned_to_id !== input.currentStaffId;
  if (!ownedByAnother || existing.state === "CLOSED") return { ok: true };
  const owner = existing.assigned_to_name?.trim() || "a colleague";
  return {
    ok: false,
    error: `This ${input.contactNoun} already has a conversation owned by ${owner}. Open it from the Inbox, or ask them to hand it over, instead of starting a new one.`,
  };
}
