/**
 * Groups neighbouring messages from the same sender so the thread can print who sent them and when once, under the last
 * bubble, instead of under every one. A group is broken by an internal note, a different sender, a new day, or a pause
 * longer than the window. A message that failed to send always keeps its own line: it must never look sent.
 */

/** Messages closer together than this, from one sender, read as one burst. */
export const THREAD_GROUP_WINDOW_MS = 5 * 60_000;

export interface ThreadGroupRow {
  /** Internal notes are never grouped with messages. */
  kind: "message" | "note";
  /** Who wrote it, e.g. "user:CUSTOMER"; rows with the same key can group. Ignored for notes. */
  senderKey: string;
  createdAt: Date;
  /** The channel refused it. */
  failed: boolean;
  /** The first row of a calendar day. */
  startsNewDay: boolean;
}

export interface ThreadGroupPlacement {
  startsGroup: boolean;
  endsGroup: boolean;
  /** Print the sender, time and delivery line under this bubble. */
  showMeta: boolean;
}

function continuesGroup(previous: ThreadGroupRow, next: ThreadGroupRow, windowMs: number): boolean {
  if (previous.kind !== "message" || next.kind !== "message") return false;
  if (next.startsNewDay) return false;
  if (previous.senderKey !== next.senderKey) return false;
  return next.createdAt.getTime() - previous.createdAt.getTime() <= windowMs;
}

export function groupThreadMessages(
  rows: readonly ThreadGroupRow[],
  windowMs: number = THREAD_GROUP_WINDOW_MS,
): ThreadGroupPlacement[] {
  return rows.map((row, index) => {
    const previous = index > 0 ? rows[index - 1] : null;
    const next = index < rows.length - 1 ? rows[index + 1] : null;
    const startsGroup = !previous || !continuesGroup(previous, row, windowMs);
    const endsGroup = !next || !continuesGroup(row, next, windowMs);
    return { startsGroup, endsGroup, showMeta: endsGroup || row.failed };
  });
}
