import type { QueueCode } from "@/lib/inbox/intelligence/contracts";

/**
 * The Inbox rail's selectable views. Since MI2.2 every view IS a queue: which conversations belong to it is decided
 * once, in SQL (`compute_conversation_queues`, migration 20261202090500), and read back from
 * `conversation_queue_membership`. This file only names the views and maps each onto its queue code — there is no
 * second, in-memory predicate to keep in step (the old scan-and-filter over 5 000 rows is gone).
 *
 * The first nine ids are the original views and keep their exact meaning; the rest are the new queues.
 */
export const INBOX_VIEWS = [
  "all",
  "unassigned",
  "assigned-to-me",
  "whatsapp",
  "instagram",
  "messenger",
  "email",
  "closed",
  "spam",
  "needs-reply",
  "waiting-customer",
  "waiting-team",
  "payments",
  "documents",
  "visa",
  "complaints",
  "escalations",
  "nearing-deadline",
  "overdue",
  "new-enquiries",
  "qualified",
  "ready-to-book",
  "quote-sent",
] as const;

export type InboxView = (typeof INBOX_VIEWS)[number];

/** Exhaustive by type: adding a view without its queue is a compile error. */
export const VIEW_QUEUE: Record<InboxView, QueueCode> = {
  all: "ALL",
  unassigned: "UNASSIGNED",
  "assigned-to-me": "MINE",
  whatsapp: "WHATSAPP",
  instagram: "INSTAGRAM",
  messenger: "MESSENGER",
  email: "EMAIL",
  closed: "RESOLVED",
  spam: "SPAM",
  "needs-reply": "NEEDS_REPLY",
  "waiting-customer": "WAITING_CUSTOMER",
  "waiting-team": "WAITING_TEAM",
  payments: "PAYMENT_DISCUSSIONS",
  documents: "DOCUMENTS",
  visa: "VISA_ISSUES",
  complaints: "COMPLAINTS",
  escalations: "ESCALATIONS",
  "nearing-deadline": "NEARING_DEADLINE",
  overdue: "SLA_BREACHED",
  "new-enquiries": "NEW_ENQUIRIES",
  qualified: "QUALIFIED",
  "ready-to-book": "BOOKING_READY",
  "quote-sent": "QUOTE_SENT",
};

export function queueForView(view: InboxView): QueueCode {
  return VIEW_QUEUE[view];
}

/** The view that shows a queue, or null when no view exists for it yet (its predicate has not been built). */
export function viewForQueue(queue: QueueCode): InboxView | null {
  return INBOX_VIEWS.find((view) => VIEW_QUEUE[view] === queue) ?? null;
}

/**
 * What the rail shows on the OPEN view: how many chats are actually loaded into the list on screen, never a stored
 * counter. A stored counter kept counting chats that no longer existed after "Clear all chats", so the rail now
 * agrees with the list by construction. `hasMore` means another page exists, so the number is a floor and reads
 * "100+". Null (no badge) when nothing is loaded.
 */
export function loadedListBadge(loaded: number, hasMore: boolean): string | null {
  if (!Number.isFinite(loaded) || loaded <= 0) return null;
  return hasMore ? `${loaded}+` : String(loaded);
}

/** Per-queue counts (as returned by `inbox_queue_counts`) → the per-view counts the rail renders. A missing queue is 0. */
export function countsByView(queueCounts: Partial<Record<QueueCode, number>>): Record<InboxView, number> {
  const counts = {} as Record<InboxView, number>;
  for (const view of INBOX_VIEWS) counts[view] = queueCounts[VIEW_QUEUE[view]] ?? 0;
  return counts;
}
