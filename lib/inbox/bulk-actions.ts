import { planConversationAssignment, type AssignmentTarget, type ConversationAssignmentPatch } from "@/lib/inbox/assignment";
import type { CONVERSATION_LIFECYCLE_STATUSES } from "@/lib/inbox/contracts";
import type { ConversationState } from "@/lib/types/whatsapp";

type ConversationLifecycleStatus = (typeof CONVERSATION_LIFECYCLE_STATUSES)[number];

/**
 * What a bulk change does to each chosen conversation, decided before anything is written: which ones change, and which are
 * left alone and why. Assigning reuses the single-chat rules exactly (a closed chat is never assigned, a chat the person
 * already owns is left as it is), and closing is the same one-field change the single Close button makes. The server writes
 * only the conversations this returns as changed.
 *
 * The spam contract (PRD-03). A conversation is spam when its `lifecycle_status` is SPAM, or its lead's stage is SPAM. Marking
 * writes only `lifecycle_status = 'SPAM'` and leaves the chat's own `state` untouched, so nothing is lost. Restoring writes
 * 'CLOSED' when the chat's state is closed and 'OPEN' otherwise, which is exactly what it was before, so the change is fully
 * reversible with no extra column. A chat with a booking or an open review is never marked, and a chat whose lead is spam
 * cannot be restored here because it would stay in Spam. Any fact that could not be read makes the chat skip, never change.
 */

/** The audit events a spam change writes, one per conversation. */
export const SPAM_MARKED_EVENT_KIND = "SPAM_MARKED";
export const SPAM_RESTORED_EVENT_KIND = "SPAM_RESTORED";
/** Written when staff close a chat, single or bulk, so the history shows who closed it. */
export const CONVERSATION_CLOSED_EVENT_KIND = "CONVERSATION_CLOSED";

/** Why a chat with an unresolved review cannot be closed, shared by the single Close button and bulk Close. */
export const CLOSE_BLOCKED_BY_REVIEW_REASON = "Has an open review. Resolve it first.";

/** The most conversations one bulk change touches, so a mistake stays small and a request stays quick. */
export const BULK_ACTION_LIMIT = 50;

export type BulkAction =
  | { kind: "ASSIGN"; target: AssignmentTarget | null }
  | { kind: "CLOSE" }
  | { kind: "MARK_SPAM" }
  | { kind: "UNMARK_SPAM" };

export interface BulkConversationInput {
  id: string;
  state: ConversationState;
  assignedToId: string | null;
  /** Spam facts. Left out (unknown), a spam change skips the chat instead of guessing. */
  lifecycleStatus?: ConversationLifecycleStatus | null;
  leadIsSpam?: boolean;
  hasBooking?: boolean;
  hasOpenReview?: boolean;
}

export interface BulkPlan {
  /** The conversations to change, with the exact fields to write. */
  changed: Array<{ id: string; patch: Partial<ConversationAssignmentPatch> & { state?: ConversationState; lifecycle_status?: ConversationLifecycleStatus } }>;
  /** The conversations left alone, each with a reason in words. */
  skipped: Array<{ id: string; reason: string }>;
}

export function planBulkAction(action: BulkAction, conversations: readonly BulkConversationInput[]): BulkPlan {
  const plan: BulkPlan = { changed: [], skipped: [] };
  for (const conversation of conversations) {
    if (action.kind === "MARK_SPAM" || action.kind === "UNMARK_SPAM") {
      const outcome = planSpamChange(action.kind, conversation);
      if ("reason" in outcome) plan.skipped.push({ id: conversation.id, reason: outcome.reason });
      else plan.changed.push({ id: conversation.id, patch: { lifecycle_status: outcome.lifecycleStatus } });
      continue;
    }
    if (action.kind === "CLOSE") {
      // Closing hides the chat from the working lists, so a live complaint or payment review must be settled first. A booking
      // does not stop a close: closing the chat of a customer who has booked is normal work.
      if (conversation.state === "CLOSED") plan.skipped.push({ id: conversation.id, reason: "Already closed." });
      else if (conversation.hasOpenReview === undefined) plan.skipped.push({ id: conversation.id, reason: "Could not be checked, so it was left alone." });
      else if (conversation.hasOpenReview) plan.skipped.push({ id: conversation.id, reason: CLOSE_BLOCKED_BY_REVIEW_REASON });
      else plan.changed.push({ id: conversation.id, patch: { state: "CLOSED" } });
      continue;
    }
    const outcome = planConversationAssignment({ state: conversation.state, currentAssigneeId: conversation.assignedToId, target: action.target });
    if (!outcome.ok) plan.skipped.push({ id: conversation.id, reason: outcome.error });
    else if (!outcome.changed) plan.skipped.push({ id: conversation.id, reason: "Already has this owner." });
    else plan.changed.push({ id: conversation.id, patch: outcome.patch });
  }
  return plan;
}

function planSpamChange(kind: "MARK_SPAM" | "UNMARK_SPAM", conversation: BulkConversationInput): { lifecycleStatus: ConversationLifecycleStatus } | { reason: string } {
  const { lifecycleStatus, leadIsSpam, hasBooking, hasOpenReview } = conversation;
  if (lifecycleStatus === undefined || leadIsSpam === undefined || hasBooking === undefined || hasOpenReview === undefined) {
    return { reason: "Could not be checked, so it was left alone." };
  }
  if (kind === "UNMARK_SPAM") {
    if (lifecycleStatus !== "SPAM") return { reason: "Not marked as spam." };
    if (leadIsSpam) return { reason: "Its lead is marked as spam, so it would stay in Spam. Change the lead's stage in Leads first." };
    return { lifecycleStatus: conversation.state === "CLOSED" ? "CLOSED" : "OPEN" };
  }
  if (lifecycleStatus === "SPAM") return { reason: "Already marked as spam." };
  if (hasBooking) return { reason: "Linked to a booking, so it is not treated as spam." };
  if (hasOpenReview) return { reason: CLOSE_BLOCKED_BY_REVIEW_REASON };
  if (leadIsSpam) return { reason: "Already treated as spam through its lead." };
  return { lifecycleStatus: "SPAM" };
}

/** "Closed 3 conversations. 1 was left alone." for the toast after a bulk change. */
export function bulkResultSummary(input: { action: BulkAction["kind"]; changed: number; skipped: number }): string {
  const noun = (count: number) => `${count} conversation${count === 1 ? "" : "s"}`;
  const sentence: Record<BulkAction["kind"], string> = {
    CLOSE: `Closed ${noun(input.changed)}.`,
    ASSIGN: `Changed the owner of ${noun(input.changed)}.`,
    MARK_SPAM: `Marked ${noun(input.changed)} as spam.`,
    UNMARK_SPAM: `Restored ${noun(input.changed)} from spam.`,
  };
  const main = input.changed > 0 ? sentence[input.action] : "Nothing was changed.";
  const rest = input.skipped > 0 ? ` ${input.skipped} ${input.skipped === 1 ? "was" : "were"} left alone.` : "";
  return main + rest;
}
