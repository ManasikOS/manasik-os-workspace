/**
 * Messages a staff member has just sent that the server has not shown back yet. The Inbox displays them at once
 * (as "Sending…") so a send feels instant, then drops each one the moment the canonical message with the SAME
 * idempotency key appears in the thread — SC6 of docs/inbox/scaling.md §8.5.
 *
 * Reconciliation is exact. It used to compare text and timestamps, which mis-settled identical messages sent
 * back to back and was fooled by a browser clock running behind the server's. Now the pending message's id IS the
 * `client_idempotency_key` the browser generated for that send attempt, and the database stores it on the message:
 *
 *   - a network retry reuses the key, so the database returns the message it already has (never a second one);
 *   - a new deliberate send, even with identical text, gets a new key, so both bubbles show until both arrive;
 *   - a response lost after the commit is harmless: the canonical message arrives by realtime/delta and settles the
 *     pending one by key, or the person retries and the same key returns the same message.
 */

import type { StagedAttachmentRef } from "@/lib/inbox/attachments/staff-attachment";

export interface PendingStaffMessage {
  /** The send attempt's idempotency key (a UUID). Also the React key, and what the canonical message carries back. */
  id: string;
  conversationId: string;
  /** What the bubble shows. For a file with no caption this is a "Sending …" placeholder, so it is never what gets sent. */
  content: string;
  /** What the server receives: the message text, or the caption when a file goes with it (possibly empty). A retry sends this. */
  body: string;
  /** The staged file that goes with this message, if any. A retry sends the same file. */
  attachment: StagedAttachmentRef | null;
  createdAt: string;
  /**
   * SENDING  — the request is in flight.
   * ACCEPTED — the server confirmed the message exists; it stays visible until the canonical row reaches the thread.
   * FAILED   — the send was rejected or could not be confirmed; the person can retry with the same key or dismiss.
   */
  status: "SENDING" | "ACCEPTED" | "FAILED";
  error?: string;
  /** The Copilot proposal this reply came from, kept so a retry reports the same review. */
  proposalId?: string | null;
}

/** Only the key matters here; a real thread message carries many other fields. */
interface ThreadMessage {
  client_idempotency_key?: string | null;
}

/**
 * Removes every pending message whose canonical message is now in the thread, matched by exact idempotency key.
 * A failed message is kept until the person acts, unless its canonical message turned up anyway (the send did
 * commit and only the response was lost) — then there is nothing left to retry.
 */
export function settlePendingMessages(pending: PendingStaffMessage[], thread: ThreadMessage[]): PendingStaffMessage[] {
  if (pending.length === 0) return pending;
  const arrived = new Set<string>();
  for (const message of thread) {
    if (message.client_idempotency_key) arrived.add(message.client_idempotency_key);
  }
  if (arrived.size === 0) return pending;
  const remaining = pending.filter((entry) => !arrived.has(entry.id));
  return remaining.length === pending.length ? pending : remaining;
}

/** Marks a pending message as confirmed by the server. Unknown ids are ignored. */
export function markPendingAccepted(pending: PendingStaffMessage[], id: string): PendingStaffMessage[] {
  return pending.map((entry) => (entry.id === id && entry.status !== "ACCEPTED" ? { ...entry, status: "ACCEPTED", error: undefined } : entry));
}

/** Marks a pending message as failed, with the reason to show. Unknown ids are ignored. */
export function markPendingFailed(pending: PendingStaffMessage[], id: string, error: string): PendingStaffMessage[] {
  return pending.map((entry) => (entry.id === id ? { ...entry, status: "FAILED", error } : entry));
}

/** Puts a failed message back to SENDING for a retry. It keeps its id, so the retry carries the SAME key. */
export function markPendingRetrying(pending: PendingStaffMessage[], id: string): PendingStaffMessage[] {
  return pending.map((entry) => (entry.id === id && entry.status === "FAILED" ? { ...entry, status: "SENDING", error: undefined } : entry));
}

/** Removes one pending message (the person dismissed it). */
export function dismissPendingMessage(pending: PendingStaffMessage[], id: string): PendingStaffMessage[] {
  return pending.filter((entry) => entry.id !== id);
}

/** What the composer hands over when a send starts: everything a bubble, and later a retry, needs. */
export interface PendingSendStart {
  key: string;
  content: string;
  body: string;
  attachment: StagedAttachmentRef | null;
  proposalId: string | null;
}

/** The bubble for a send that has just started. Its id is the send attempt's idempotency key. */
export function buildPendingStaffMessage(input: PendingSendStart & { conversationId: string; now: Date }): PendingStaffMessage {
  return {
    id: input.key,
    conversationId: input.conversationId,
    content: input.content,
    body: input.body,
    attachment: input.attachment,
    proposalId: input.proposalId,
    createdAt: input.now.toISOString(),
    status: "SENDING",
  };
}

/**
 * Exactly what a retry hands to the send action: the SAME key (so a send that did commit is returned, not repeated), the text the
 * person wrote, and the file they attached. It never reads `content`, which is display text and can be a placeholder.
 */
export function retryRequestFor(entry: PendingStaffMessage) {
  return {
    conversationId: entry.conversationId,
    body: entry.body,
    proposalId: entry.proposalId ?? null,
    key: entry.id,
    attachment: entry.attachment,
  };
}
