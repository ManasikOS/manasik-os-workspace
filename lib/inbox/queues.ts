/**
 * The queue catalogue — MI2.2 of docs/inbox/implementation-plan.md. What each queue is called, what it means in plain
 * words, and where it sits in the rail. Pure and client-safe.
 *
 * `available: false` means the queue's SQL predicate has not been built yet (it arrives with a later slice), so it
 * stays empty and is hidden from the rail rather than shown as a permanently-zero row that looks broken.
 * The predicates themselves live in SQL (`compute_conversation_queues`); this file never decides membership.
 */

import { QUEUE_CODES, QUEUE_GROUPS, type QueueCode, type QueueGroup } from "@/lib/inbox/intelligence/contracts";

/** Icon keys, resolved to real icons by the rail component so this file stays free of UI imports. */
export type QueueIconKey =
  | "inbox"
  | "user"
  | "unassigned"
  | "reply"
  | "clock"
  | "team"
  | "done"
  | "payment"
  | "document"
  | "visa"
  | "complaint"
  | "escalation"
  | "whatsapp"
  | "instagram"
  | "messenger"
  | "email"
  | "spam"
  | "sparkles"
  | "alarm";

export interface QueueDefinition {
  code: QueueCode;
  /** Shown in the rail. */
  label: string;
  /** One plain sentence: what puts a conversation here. */
  description: string;
  group: QueueGroup;
  icon: QueueIconKey;
  available: boolean;
}

export const QUEUE_CATALOGUE: Record<QueueCode, QueueDefinition> = {
  ALL: { code: "ALL", label: "All conversations", description: "Every open conversation.", group: "INBOX", icon: "inbox", available: true },
  MINE: { code: "MINE", label: "Assigned to me", description: "Open conversations that are yours.", group: "INBOX", icon: "user", available: true },
  UNASSIGNED: { code: "UNASSIGNED", label: "Unassigned", description: "Open conversations nobody owns yet.", group: "INBOX", icon: "unassigned", available: true },
  NEEDS_REPLY: { code: "NEEDS_REPLY", label: "Needs a reply", description: "The customer wrote last and is waiting for us.", group: "INBOX", icon: "reply", available: true },
  WAITING_CUSTOMER: { code: "WAITING_CUSTOMER", label: "Waiting for customer", description: "We replied last and are waiting for the customer.", group: "INBOX", icon: "clock", available: true },
  WAITING_TEAM: { code: "WAITING_TEAM", label: "Waiting for our team", description: "A colleague was asked to step in, or a review is still open.", group: "INBOX", icon: "team", available: true },
  RESOLVED: { code: "RESOLVED", label: "Closed", description: "Conversations that have been closed.", group: "INBOX", icon: "done", available: true },
  SPAM: { code: "SPAM", label: "Spam", description: "Conversations whose lead is marked as spam.", group: "INBOX", icon: "spam", available: true },

  NEW_ENQUIRIES: { code: "NEW_ENQUIRIES", label: "New enquiries", description: "First-time customers asking about a trip.", group: "COMMERCIAL", icon: "sparkles", available: true },
  QUALIFIED: { code: "QUALIFIED", label: "Qualified", description: "We know the travellers, dates and room type.", group: "COMMERCIAL", icon: "sparkles", available: true },
  BOOKING_READY: { code: "BOOKING_READY", label: "Ready to book", description: "The customer has agreed and only needs a booking.", group: "COMMERCIAL", icon: "sparkles", available: true },
  QUOTE_SENT: { code: "QUOTE_SENT", label: "Quote sent", description: "A quote is with the customer.", group: "COMMERCIAL", icon: "sparkles", available: true },

  PAYMENT_DISCUSSIONS: { code: "PAYMENT_DISCUSSIONS", label: "Payments", description: "The customer talks about paying, or a payment claim needs checking.", group: "OPERATIONS", icon: "payment", available: true },
  DOCUMENTS: { code: "DOCUMENTS", label: "Documents", description: "Passports, photos or other documents are involved.", group: "OPERATIONS", icon: "document", available: true },
  VISA_ISSUES: { code: "VISA_ISSUES", label: "Visa questions", description: "The customer is asking about a visa.", group: "OPERATIONS", icon: "visa", available: true },
  DEPARTURE_CHANGES: { code: "DEPARTURE_CHANGES", label: "Departure changes", description: "A change to a departure date or flight.", group: "OPERATIONS", icon: "alarm", available: false },
  GROUP_CHANGES: { code: "GROUP_CHANGES", label: "Group changes", description: "A change to the size or members of a group.", group: "OPERATIONS", icon: "team", available: false },
  COMPLAINTS: { code: "COMPLAINTS", label: "Complaints", description: "The customer is unhappy or asking for a refund.", group: "OPERATIONS", icon: "complaint", available: true },
  ESCALATIONS: { code: "ESCALATIONS", label: "Urgent", description: "Needs a person now: a blocking review is open or the customer is in urgent need.", group: "OPERATIONS", icon: "escalation", available: true },
  NEARING_DEADLINE: { code: "NEARING_DEADLINE", label: "Nearing deadline", description: "About to miss a reply target or a messaging window.", group: "OPERATIONS", icon: "alarm", available: true },
  SLA_BREACHED: { code: "SLA_BREACHED", label: "Overdue", description: "A reply target has already been missed.", group: "OPERATIONS", icon: "alarm", available: true },

  WHATSAPP: { code: "WHATSAPP", label: "WhatsApp", description: "Open WhatsApp conversations.", group: "CHANNELS", icon: "whatsapp", available: true },
  INSTAGRAM: { code: "INSTAGRAM", label: "Instagram", description: "Open Instagram conversations.", group: "CHANNELS", icon: "instagram", available: true },
  MESSENGER: { code: "MESSENGER", label: "Messenger", description: "Open Facebook Messenger conversations.", group: "CHANNELS", icon: "messenger", available: true },
  EMAIL: { code: "EMAIL", label: "Email", description: "Open email conversations.", group: "CHANNELS", icon: "email", available: true },
};

export const QUEUE_GROUP_LABEL: Record<QueueGroup, string> = {
  INBOX: "Inbox",
  COMMERCIAL: "Sales",
  OPERATIONS: "Needs attention",
  CHANNELS: "Channels",
};

/** Rail order inside each group (the catalogue's insertion order is not a contract). */
const RAIL_ORDER: QueueCode[] = [
  "ALL", "MINE", "UNASSIGNED", "NEEDS_REPLY", "WAITING_CUSTOMER", "WAITING_TEAM", "RESOLVED", "SPAM",
  "NEW_ENQUIRIES", "QUALIFIED", "BOOKING_READY", "QUOTE_SENT",
  "ESCALATIONS", "COMPLAINTS", "PAYMENT_DISCUSSIONS", "DOCUMENTS", "VISA_ISSUES", "DEPARTURE_CHANGES", "GROUP_CHANGES", "NEARING_DEADLINE", "SLA_BREACHED",
  "WHATSAPP", "INSTAGRAM", "MESSENGER", "EMAIL",
];

export interface RailQueueGroup {
  group: QueueGroup;
  label: string;
  queues: QueueDefinition[];
}

/** The groups the rail renders: only queues with a built predicate, and no group that would be empty. */
export function railQueueGroups(): RailQueueGroup[] {
  return QUEUE_GROUPS.map((group) => ({
    group,
    label: QUEUE_GROUP_LABEL[group],
    queues: RAIL_ORDER.map((code) => QUEUE_CATALOGUE[code]).filter((queue) => queue.group === group && queue.available),
  })).filter((entry) => entry.queues.length > 0);
}

/** Every queue code has exactly one definition and one rail position — asserted by the test suite. */
export const ALL_QUEUE_CODES: readonly QueueCode[] = QUEUE_CODES;
export const RAIL_QUEUE_ORDER: readonly QueueCode[] = RAIL_ORDER;

/** Always in the rail, whatever their count: the daily working set. Everything else appears when there is something in it. */
const ALWAYS_SHOWN_QUEUES: ReadonlySet<QueueCode> = new Set<QueueCode>(["ALL", "MINE", "UNASSIGNED", "NEEDS_REPLY", "WAITING_CUSTOMER", "WAITING_TEAM"]);

export interface RailQueueGroupVisibility {
  group: QueueGroup;
  label: string;
  /** Shown straight away. */
  shown: QueueDefinition[];
  /** Kept behind "More queues": no conversations right now, and not the open queue. */
  tucked: QueueDefinition[];
}

/**
 * Splits each rail group into what to show and what to tuck away. A queue is shown when it is part of the daily
 * working set, has conversations in it, or is the one open — so the open queue can never disappear from under the
 * person looking at it. A queue that is empty is reachable, not deleted.
 */
export function railQueueVisibility(input: {
  groups: RailQueueGroup[];
  countOf: (queue: QueueCode) => number;
  activeQueue: QueueCode | null;
}): RailQueueGroupVisibility[] {
  return input.groups.map((entry) => {
    const shown: QueueDefinition[] = [];
    const tucked: QueueDefinition[] = [];
    for (const queue of entry.queues) {
      const keep = ALWAYS_SHOWN_QUEUES.has(queue.code) || queue.code === input.activeQueue || input.countOf(queue.code) > 0;
      (keep ? shown : tucked).push(queue);
    }
    return { group: entry.group, label: entry.label, shown, tucked };
  });
}

/** "7", or "99+" so a long count never widens the rail. Null when there is nothing to show. */
export function railCountLabel(count: number | null | undefined): string | null {
  if (!count || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
