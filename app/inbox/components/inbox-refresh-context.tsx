"use client";

import { createContext, useContext } from "react";

/**
 * Lets any control inside the Inbox dialog reload it after its own action succeeds. Realtime already covers
 * messages, notes and conversation changes, but not the lead, booking or follow-up records the customer panel
 * edits — and realtime is only a latency optimisation, so the person's own action must never depend on it.
 */
const InboxRefreshContext = createContext<() => void>(() => undefined);

export const InboxRefreshProvider = InboxRefreshContext.Provider;

export function useInboxRefresh(): () => void {
  return useContext(InboxRefreshContext);
}

/**
 * Tells the Inbox that a conversation no longer exists (staff deleted it), so the screen moves off it. A plain refresh is not enough:
 * it would ask the server for the deleted chat again. Falls back to the plain refresh where nothing provides it.
 */
const InboxConversationRemovedContext = createContext<(() => void) | null>(null);

export const InboxConversationRemovedProvider = InboxConversationRemovedContext.Provider;

export function useInboxConversationRemoved(): () => void {
  const removed = useContext(InboxConversationRemovedContext);
  const refresh = useInboxRefresh();
  return removed ?? refresh;
}

/**
 * The narrow reads a person's OWN action needs after it succeeds (SC6). A send, a note or a composer claim used to call the
 * full-workspace refresh; these read only what the action changed. Like the refresh, they exist so an action never depends on
 * realtime being connected: realtime is a latency optimisation, and each of these is safe to call whether or not the event
 * for the same change also arrives (every merge is idempotent).
 */
export interface InboxScopedSync {
  /** Read the open conversation's messages newer than the ones held. */
  syncThread: () => void;
  /** Read notes newer than the ones held. */
  syncNotes: () => void;
  /** Read who holds the composer lease. */
  syncPresence: () => void;
}

const NOOP_SCOPED_SYNC: InboxScopedSync = { syncThread: () => undefined, syncNotes: () => undefined, syncPresence: () => undefined };

const InboxScopedSyncContext = createContext<InboxScopedSync>(NOOP_SCOPED_SYNC);

export const InboxScopedSyncProvider = InboxScopedSyncContext.Provider;

export function useInboxScopedSync(): InboxScopedSync {
  return useContext(InboxScopedSyncContext);
}
