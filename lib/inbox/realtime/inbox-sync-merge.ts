/**
 * Pure merge rules for the incremental Inbox client — SC4 of docs/inbox/scaling.md §8.2–§8.4.
 *
 * Everything the browser does with a scoped read lives here as plain functions over plain data, so the rules that keep
 * the screen correct (a stale response cannot win, a duplicate is harmless, an older version cannot overwrite a newer
 * one, a loaded page is never lost) are covered by ordinary Node tests rather than by clicking through a browser.
 *
 * Nothing here fetches, subscribes, or touches React.
 */

import type {
  InboxAttachment,
  InboxConversation,
  InboxConversationListPatch,
  InboxMediaAnalysis,
  InboxMessage,
  InboxNote,
  InboxNotesDelta,
  InboxThreadDelta,
} from "@/app/inbox/types";

/* ── List ─────────────────────────────────────────────────────────────────── */

type ListRow = Pick<InboxConversation, "id"> & { last_activity_at?: string | null };

/**
 * Sort order of the list: newest activity first, ties broken by id descending. The timestamp is compared as the exact
 * string Postgres returned — never through a `Date`, which would round to milliseconds and reorder rows that tie.
 * Positive when `left` belongs AFTER `right`.
 */
export function compareListOrder(left: ListRow, right: ListRow): number {
  const leftAt = left.last_activity_at ?? "";
  const rightAt = right.last_activity_at ?? "";
  if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

export interface ListPatchMergeInput {
  /** What the list shows now: the first page plus any older pages already loaded. */
  conversations: InboxConversation[];
  /** True when the view has more rows beyond the ones loaded (a next-page cursor exists). */
  hasOlder: boolean;
  patch: InboxConversationListPatch;
  /** The version the browser already holds for this conversation, if it holds one. */
  heldVersion: number | undefined;
  /** The conversation id the patch is about. */
  conversationId: string;
}

export interface ListPatchMergeResult {
  conversations: InboxConversation[];
  /** The version to remember for this conversation afterwards (unchanged when the patch was stale). */
  version: number | undefined;
  /** False when nothing on screen changed, so the caller can skip a state update and a re-render. */
  changed: boolean;
  outcome: "REPLACED" | "INSERTED" | "REMOVED" | "IGNORED_STALE" | "NOT_IN_WINDOW" | "UNCHANGED";
}

/**
 * Applies one list patch to the rows already on screen.
 *
 *  - A patch older than the held version is ignored: a slow response can never overwrite newer state.
 *  - A row that left the view (or is no longer visible) is removed.
 *  - A row still in the view is replaced in place, then re-sorted, since its activity time usually moved.
 *  - A row that newly enters the view is inserted only when it belongs inside the loaded window; otherwise the counts
 *    change and pagination will bring it in — inserting it at the wrong end would fabricate a page that was never read.
 *  - The caller's own pages are never dropped: only the one row is touched.
 */
export function mergeListPatch(input: ListPatchMergeInput): ListPatchMergeResult {
  const { conversations, patch, heldVersion, conversationId } = input;
  const incomingVersion = patch.conversationVersion;

  if (heldVersion !== undefined && incomingVersion !== null && incomingVersion < heldVersion) {
    return { conversations, version: heldVersion, changed: false, outcome: "IGNORED_STALE" };
  }

  const existingIndex = conversations.findIndex((row) => row.id === conversationId);
  const version = incomingVersion ?? heldVersion;

  if (!patch.conversation || !patch.inActiveView) {
    if (existingIndex === -1) return { conversations, version, changed: false, outcome: "UNCHANGED" };
    return { conversations: conversations.filter((row) => row.id !== conversationId), version, changed: true, outcome: "REMOVED" };
  }

  const incoming = patch.conversation;
  if (existingIndex !== -1) {
    const next = conversations.filter((row) => row.id !== conversationId);
    next.push(incoming);
    next.sort(compareListOrder);
    return { conversations: next, version, changed: true, outcome: "REPLACED" };
  }

  const last = conversations[conversations.length - 1];
  const insideWindow = !input.hasOlder || last === undefined || compareListOrder(incoming, last) <= 0;
  if (!insideWindow) return { conversations, version, changed: false, outcome: "NOT_IN_WINDOW" };

  const next = [...conversations, incoming];
  next.sort(compareListOrder);
  return { conversations: next, version, changed: true, outcome: "INSERTED" };
}

/**
 * Drops loaded "older page" rows that a fresh first page proves are stale. A row that now sorts inside the first page's window
 * but is not in it has left the view (closed, reassigned, moved queue); one the first page holds is deduplicated. Rows that
 * still sort after the first page are kept: they were read and nothing says they changed.
 */
export function pruneOlderChats<T extends ListRow>(older: T[], firstPage: ReadonlyArray<ListRow>): T[] {
  const last = firstPage[firstPage.length - 1];
  if (last === undefined) return [];
  return older.filter((row) => compareListOrder(row, last) > 0);
}

/* ── Thread ───────────────────────────────────────────────────────────────── */

/**
 * Thread order: by the conversation's own sequence when both messages have one, otherwise by time then id. Every
 * persisted message has a sequence since SC2; the fallback only orders a legacy null against something else.
 */
export function compareMessageOrder(left: InboxMessage, right: InboxMessage): number {
  const leftSequence = left.sequence_number;
  const rightSequence = right.sequence_number;
  if (typeof leftSequence === "number" && typeof rightSequence === "number" && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  if (left.created_at !== right.created_at) return left.created_at < right.created_at ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** The highest sequence among the messages, or 0 when none carries one — the `afterSequence` for the next delta. */
export function highestMessageSequence(messages: ReadonlyArray<InboxMessage>): number {
  let highest = 0;
  for (const message of messages) {
    if (typeof message.sequence_number === "number" && message.sequence_number > highest) highest = message.sequence_number;
  }
  return highest;
}

export interface ThreadMergeResult {
  messages: InboxMessage[];
  attachments: InboxAttachment[];
  mediaAnalyses: InboxMediaAnalysis[];
  changed: boolean;
}

/**
 * Merges a thread delta into the messages on screen.
 *
 * A message already shown is replaced IN PLACE (a delivery-status change patches the same bubble — it is never removed
 * and re-added), a new one is inserted at its sequence position, and a duplicate delivery of the same delta is harmless.
 * Artifacts follow the same rule keyed by their own ids.
 */
export function mergeThreadDelta(
  current: { messages: InboxMessage[]; attachments: InboxAttachment[]; mediaAnalyses: InboxMediaAnalysis[] },
  delta: Pick<InboxThreadDelta, "messages" | "attachments" | "mediaAnalyses">,
): ThreadMergeResult {
  const messages = upsertById(current.messages, delta.messages, compareMessageOrder);
  const attachments = upsertById(current.attachments, delta.attachments, () => 0);
  const mediaAnalyses = upsertById(current.mediaAnalyses, delta.mediaAnalyses, () => 0);
  const changed = messages !== current.messages || attachments !== current.attachments || mediaAnalyses !== current.mediaAnalyses;
  return { messages, attachments, mediaAnalyses, changed };
}

/**
 * Upserts `incoming` into `existing` by id. Returns the SAME array reference when nothing differs, so a duplicate event
 * causes no state change and no re-render. When `compare` is a real ordering the result is sorted by it; otherwise
 * existing order is kept and new rows are appended.
 */
function upsertById<T extends { id: string }>(existing: T[], incoming: T[], compare: (left: T, right: T) => number): T[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((row) => [row.id, row]));
  let changed = false;
  for (const row of incoming) {
    const held = byId.get(row.id);
    if (held === undefined || !sameJson(held, row)) {
      byId.set(row.id, row);
      changed = true;
    }
  }
  if (!changed) return existing;

  const merged = [...byId.values()];
  const positions = new Map(existing.map((row, index) => [row.id, index]));
  // Existing rows keep their place unless an ordering is supplied; brand-new rows go after them.
  merged.sort((left, right) => {
    const ordered = compare(left, right);
    if (ordered !== 0) return ordered;
    return (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });
  return merged;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/* ── Notes ────────────────────────────────────────────────────────────────── */

export function compareNoteOrder(left: InboxNote, right: InboxNote): number {
  if (left.created_at !== right.created_at) return left.created_at < right.created_at ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Applies a notes delta: deleted ids leave, changed and new notes are upserted, order is `(created_at, id)`. */
export function mergeNotesDelta(current: InboxNote[], delta: InboxNotesDelta): { notes: InboxNote[]; changed: boolean } {
  const removed = new Set(delta.removedNoteIds);
  const kept = removed.size === 0 ? current : current.filter((note) => !removed.has(note.id));
  const upserted = upsertById(kept, delta.notes, compareNoteOrder);
  const changed = kept !== current || upserted !== kept;
  return { notes: changed ? upserted : current, changed };
}

/** The keyset position of the newest note held, for the next notes delta; null when there are none. */
export function newestNotePosition(notes: ReadonlyArray<InboxNote>): { createdAt: string; id: string } | null {
  let newest: InboxNote | null = null;
  for (const note of notes) if (newest === null || compareNoteOrder(note, newest) > 0) newest = note;
  return newest ? { createdAt: newest.created_at, id: newest.id } : null;
}
