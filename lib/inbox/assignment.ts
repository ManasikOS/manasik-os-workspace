import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";
import type { ConversationState } from "@/lib/types/whatsapp";

/**
 * What changes on a conversation when staff give it to someone, or take the owner off it. Pure, so the rules are tested
 * and the action only does the reading and writing.
 *
 * A person owning the chat pauses the assistant (same as taking control). Removing the owner from a chat the assistant was
 * not handling must not leave it silently ownerless and paused, so it goes back to "waiting for staff".
 */

export interface AssignmentTarget {
  id: string;
  name: string;
}

export interface ConversationAssignmentPatch {
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  state: ConversationState;
}

export type AssignmentPlan =
  | { ok: true; changed: true; patch: ConversationAssignmentPatch }
  | { ok: true; changed: false }
  | { ok: false; error: string };

export function planConversationAssignment(input: {
  state: ConversationState;
  currentAssigneeId: string | null;
  /** The person to give it to, or null to remove the owner. */
  target: AssignmentTarget | null;
}): AssignmentPlan {
  if (input.state === "CLOSED") {
    return { ok: false, error: "This conversation is closed. It reopens when the customer writes again." };
  }
  if ((input.target?.id ?? null) === input.currentAssigneeId) return { ok: true, changed: false };

  if (input.target) {
    return {
      ok: true,
      changed: true,
      patch: { assigned_to_id: input.target.id, assigned_to_name: input.target.name, state: "HUMAN_ACTIVE" },
    };
  }
  return {
    ok: true,
    changed: true,
    patch: {
      assigned_to_id: null,
      assigned_to_name: null,
      state: input.state === "HUMAN_ACTIVE" ? "HUMAN_REQUESTED" : input.state,
    },
  };
}

/**
 * May this staff member be given an Inbox conversation? They must be active and hold a role that can reply in the Inbox,
 * so a chat is never handed to someone who cannot open it. An unknown role is refused, never guessed.
 */
export function canTakeInboxConversations(profile: { role: string | null | undefined; status: string | null | undefined }): boolean {
  if (profile.status !== "ACTIVE") return false;
  const role = String(profile.role ?? "").toUpperCase();
  if (!(STAFF_ROLES as readonly string[]).includes(role)) return false;
  return capabilitiesForInbox(role as StaffRole).sendMessage;
}

export const OWNER_CHANGED_EVENT_KIND = "OWNER_CHANGED";

/** The audit row for an owner change: who did it, and who owned the chat before and after. Names are kept as they were then. */
export function ownerChangedEventData(input: {
  from: { id: string | null; name: string | null };
  to: { id: string | null; name: string | null };
  actorName: string | null;
}) {
  return {
    from_id: input.from.id,
    from_name: input.from.name,
    to_id: input.to.id,
    to_name: input.to.name,
    changed_by_name: input.actorName,
  };
}

/**
 * The bell notice for the person who was just given a chat. Nobody is told about a change they made themselves, and
 * removing an owner notifies no one.
 */
export function assignmentNotification(input: {
  actorId: string | null;
  actorName: string | null;
  target: AssignmentTarget | null;
  customerName: string | null;
}): { recipientId: string; title: string } | null {
  if (!input.target || input.target.id === input.actorId) return null;
  const who = input.actorName?.trim() || "A colleague";
  const customer = input.customerName?.trim() || "a customer";
  return { recipientId: input.target.id, title: `${who} gave you the conversation with ${customer}` };
}
