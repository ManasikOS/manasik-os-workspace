/**
 * From a burst of typed Realtime events to the smallest set of scoped reads — SC4 of docs/inbox/scaling.md §8.2.
 *
 * `planInboxSync` is pure: it folds events into one plan, coalescing by scope + conversation + entity so that several
 * events about the same thing become ONE read. `createInboxEventBatcher` is the small timer around it: it holds events for
 * a short window, then hands the plan over once. No window may approach the 2-second inbound-visible SLO, so the default is
 * 150 ms with a hard cap.
 */

import { parseInboxRealtimeEvent, type InboxRealtimeEvent } from "@/lib/inbox/realtime/contracts";

/** More distinct conversations than this in one window is a burst: one first-page reload is cheaper than N row patches. */
export const MAX_LIST_PATCHES_PER_FLUSH = 10;

export interface InboxSyncPlan {
  /** An event could not be trusted (or a reconnect happened): do ONE bounded reconciliation and nothing else. */
  reconcile: boolean;
  /** A burst touched too many rows to patch individually: reload the first page (and counts) once. */
  reloadList: boolean;
  /** Conversations whose list row should be re-read, one patch each. */
  listPatchConversationIds: string[];
  /** The open conversation's transcript. `fullReload` is only for changes a delta cannot express (a deleted message, an attachment). */
  thread: { refetchNewer: boolean; messageIds: string[]; fullReload: boolean } | null;
  notes: { refetchNewer: boolean; noteIds: string[] } | null;
  context: boolean;
  intelligence: boolean;
  presence: boolean;
}

export function emptyInboxSyncPlan(): InboxSyncPlan {
  return { reconcile: false, reloadList: false, listPatchConversationIds: [], thread: null, notes: null, context: false, intelligence: false, presence: false };
}

/** `catchup`: the open chat's channel has just subscribed, so anything sent since it was read is asked for once. */
export type PlannedInboxEvent = { status: "ok"; event: InboxRealtimeEvent } | { status: "unknown" } | { status: "catchup" };

/** True when the plan asks for no read at all. */
export function isEmptyInboxSyncPlan(plan: InboxSyncPlan): boolean {
  return (
    !plan.reconcile &&
    !plan.reloadList &&
    plan.listPatchConversationIds.length === 0 &&
    plan.thread === null &&
    plan.notes === null &&
    !plan.context &&
    !plan.intelligence &&
    !plan.presence
  );
}

/**
 * Folds events into a plan for the person's current screen.
 *
 * Events about a conversation other than the open one only ever matter to the list: a thread, note, intelligence, context
 * or presence change of a chat nobody is viewing needs no read (opening it later loads it fresh). While the database still
 * sends conversation-local events on the agency-wide topic (until SC5), this is what keeps them from causing work.
 */
export function planInboxSync(events: ReadonlyArray<PlannedInboxEvent>, screen: { activeConversationId: string | null }): InboxSyncPlan {
  const plan = emptyInboxSyncPlan();
  const listIds = new Set<string>();
  const threadMessageIds = new Set<string>();
  const noteIds = new Set<string>();
  let thread: NonNullable<InboxSyncPlan["thread"]> | null = null;
  let notes: NonNullable<InboxSyncPlan["notes"]> | null = null;

  for (const planned of events) {
    if (planned.status === "unknown") {
      plan.reconcile = true;
      continue;
    }
    if (planned.status === "catchup") {
      if (screen.activeConversationId === null) continue;
      thread ??= { refetchNewer: false, messageIds: [], fullReload: false };
      thread.refetchNewer = true;
      notes ??= { refetchNewer: false, noteIds: [] };
      notes.refetchNewer = true;
      continue;
    }
    const event = planned.event;

    if (event.scope === "LIST") {
      listIds.add(event.conversationId);
      continue;
    }
    if (event.conversationId !== screen.activeConversationId) continue;

    switch (event.scope) {
      case "THREAD": {
        if (event.entity === "MESSAGE") {
          thread ??= { refetchNewer: false, messageIds: [], fullReload: false };
          if (event.operation === "INSERT") thread.refetchNewer = true;
          else if (event.operation === "UPDATE") threadMessageIds.add(event.entityId);
          else thread.fullReload = true; // a deleted message cannot be expressed as "after sequence N"
        } else if (event.entity === "NOTE") {
          notes ??= { refetchNewer: false, noteIds: [] };
          if (event.operation === "INSERT") notes.refetchNewer = true;
          else noteIds.add(event.entityId);
        } else {
          // ATTACHMENT / MEDIA_ANALYSIS: re-read the message it belongs to (the delta returns that message's artifacts). An
          // event without a message id — or a deleted artifact — cannot be targeted, so it falls back to a full reload.
          thread ??= { refetchNewer: false, messageIds: [], fullReload: false };
          if (event.messageId && event.operation !== "DELETE") threadMessageIds.add(event.messageId);
          else thread.fullReload = true;
        }
        break;
      }
      case "CONTEXT":
        plan.context = true;
        break;
      case "INTELLIGENCE":
        plan.intelligence = true;
        break;
      case "PRESENCE":
        plan.presence = true;
        break;
    }
  }

  if (plan.reconcile) return { ...emptyInboxSyncPlan(), reconcile: true };

  if (listIds.size > MAX_LIST_PATCHES_PER_FLUSH) plan.reloadList = true;
  else plan.listPatchConversationIds = [...listIds];

  if (thread) plan.thread = { ...thread, messageIds: [...threadMessageIds] };
  else if (threadMessageIds.size > 0) plan.thread = { refetchNewer: false, messageIds: [...threadMessageIds], fullReload: false };
  if (notes) plan.notes = { ...notes, noteIds: [...noteIds] };
  else if (noteIds.size > 0) plan.notes = { refetchNewer: false, noteIds: [...noteIds] };
  return plan;
}

/* ── Timer ────────────────────────────────────────────────────────────────── */

export interface InboxEventBatcher {
  /** Feed one raw broadcast payload; it is parsed against the contract and held for the window. */
  push(payload: unknown): void;
  /** A reconnect, resume or online recovery: ask for exactly one reconciliation, however many signals arrive together. */
  requestReconcile(): void;
  /** The open chat's own channel just subscribed: read what arrived between its first read and now, once. */
  requestOpenChatCatchUp(): void;
  setActiveConversation(conversationId: string | null): void;
  /** While hidden nothing is read; the events are kept as one pending reconciliation for when the tab is shown. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface InboxEventBatcherOptions {
  onFlush: (plan: InboxSyncPlan) => void;
  windowMs?: number;
  /** The longest an event may wait, however steadily new ones keep arriving. */
  maxWaitMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  now?: () => number;
}

export function createInboxEventBatcher(options: InboxEventBatcherOptions): InboxEventBatcher {
  const windowMs = options.windowMs ?? 150;
  const maxWaitMs = Math.max(options.maxWaitMs ?? 500, windowMs);
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const now = options.now ?? Date.now;

  let held: PlannedInboxEvent[] = [];
  let firstHeldAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeConversationId: string | null = null;
  let visible = true;
  let missedWhileHidden = false;
  let disposed = false;

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    if (disposed || held.length === 0) return;
    const batch = held;
    held = [];
    const plan = planInboxSync(batch, { activeConversationId });
    if (!isEmptyInboxSyncPlan(plan)) options.onFlush(plan);
  };

  const hold = (planned: PlannedInboxEvent) => {
    if (disposed) return;
    if (!visible) {
      missedWhileHidden = true;
      return;
    }
    if (held.length === 0) firstHeldAt = now();
    held.push(planned);
    // Trailing window, but never past the cap: a steady trickle must not postpone the read indefinitely.
    const wait = Math.max(0, Math.min(windowMs, firstHeldAt + maxWaitMs - now()));
    cancelTimer();
    timer = setTimer(flush, wait);
  };

  return {
    push(payload) {
      hold(parseInboxRealtimeEvent(payload));
    },
    requestReconcile() {
      hold({ status: "unknown" });
    },
    requestOpenChatCatchUp() {
      hold({ status: "catchup" });
    },
    setActiveConversation(conversationId) {
      activeConversationId = conversationId;
      // Events held for the previous conversation must not be planned against the new one.
      held = held.filter((planned) => planned.status === "unknown" || (planned.status === "ok" && planned.event.scope === "LIST"));
    },
    setVisible(next) {
      visible = next;
      if (next && missedWhileHidden) {
        missedWhileHidden = false;
        hold({ status: "unknown" });
      }
    },
    dispose() {
      disposed = true;
      held = [];
      cancelTimer();
    },
  };
}
