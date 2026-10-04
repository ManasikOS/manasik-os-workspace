/**
 * Reads the Inbox queues — MI2.2 of docs/inbox/implementation-plan.md. Replaces the old "scan up to 5 000 conversations
 * and filter them in memory" path with two indexed reads:
 *
 *   loadQueueCounts          one call to `inbox_queue_counts` (a grouped count over conversation_queue_membership)
 *   listQueueConversationIds a keyset-paginated read of one queue, newest activity first, ties broken by id
 *
 * Both run on the caller's SESSION client, so RLS (and the counts function's own agency/role check) decides what is
 * visible, and both are also filtered by agency. Which conversations belong to a queue is decided in SQL only.
 */

import { z } from "zod";

import type { Db } from "@/lib/ai/db";
import { isQueueCode, type QueueCode } from "@/lib/inbox/intelligence/contracts";

/** Chats shown per page. One extra row is read to learn whether another page exists. */
export const QUEUE_PAGE_SIZE = 100;

/** A staff member with no id yet still gets a valid uuid; the function returns 0 for MINE unless it equals auth.uid(). */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * `lastActivityAt` is kept as the exact string Postgres returned (microsecond precision). Round-tripping it through a
 * JavaScript Date would truncate to milliseconds, and a row sharing that millisecond would then be skipped or repeated.
 */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

export const queueCursorSchema = z.object({
  lastActivityAt: z.string().regex(TIMESTAMP_PATTERN, "Not a timestamp"),
  conversationId: z.string().uuid(),
});
export type QueueCursor = z.infer<typeof queueCursorSchema>;

export type QueueCounts = Partial<Record<QueueCode, number>>;

/** Turns the RPC's rows into a typed map, ignoring any code this build does not know rather than failing the rail. */
export function parseQueueCountRows(rows: unknown): QueueCounts {
  const counts: QueueCounts = {};
  for (const row of (rows ?? []) as Array<{ queue_code?: unknown; conversation_count?: unknown }>) {
    if (!isQueueCode(row.queue_code)) continue;
    const count = Number(row.conversation_count);
    if (Number.isFinite(count)) counts[row.queue_code] = count;
  }
  return counts;
}

export async function loadQueueCounts(db: Db, staffId: string | null): Promise<QueueCounts> {
  const { data, error } = await db.rpc("inbox_queue_counts", { p_staff_id: staffId ?? NIL_UUID });
  if (error) throw new Error(`Could not load queue counts: ${error.message}`);
  return parseQueueCountRows(data);
}

export interface QueuePage {
  ids: string[];
  /** Pass back to read the next page; null when this was the last one. */
  nextCursor: QueueCursor | null;
}

/** PostgREST `or` filter for "strictly after the cursor" in (last_activity_at desc, id desc) order. Inputs are pre-validated. */
export function keysetFilter(cursor: QueueCursor, idColumn: string): string {
  return `last_activity_at.lt.${cursor.lastActivityAt},and(last_activity_at.eq.${cursor.lastActivityAt},${idColumn}.lt.${cursor.conversationId})`;
}

export async function listQueueConversationIds(
  db: Db,
  input: { agencyId: string; staffId: string | null; queue: QueueCode; cursor?: QueueCursor | null; pageSize?: number },
): Promise<QueuePage> {
  const pageSize = input.pageSize ?? QUEUE_PAGE_SIZE;
  const cursor = input.cursor ? queueCursorSchema.parse(input.cursor) : null;

  // MINE is per staff member, so it is not a stored queue: read it straight from conversations (indexed on agency + assignee).
  if (input.queue === "MINE") {
    if (!input.staffId) return { ids: [], nextCursor: null };
    let query = db
      .from("conversations")
      .select("id, last_activity_at")
      .eq("agency_id", input.agencyId)
      .eq("assigned_to_id", input.staffId)
      .neq("state", "CLOSED");
    if (cursor) query = query.or(keysetFilter(cursor, "id"));
    const { data, error } = await query
      .order("last_activity_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1);
    if (error) throw new Error(`Could not list your conversations: ${error.message}`);
    return toPage((data ?? []) as Array<{ id: string; last_activity_at: string }>, pageSize, (row) => ({ id: row.id, at: row.last_activity_at }));
  }

  let query = db
    .from("conversation_queue_membership")
    .select("conversation_id, last_activity_at")
    .eq("agency_id", input.agencyId)
    .eq("queue_code", input.queue);
  if (cursor) query = query.or(keysetFilter(cursor, "conversation_id"));
  const { data, error } = await query
    .order("last_activity_at", { ascending: false })
    .order("conversation_id", { ascending: false })
    .limit(pageSize + 1);
  if (error) throw new Error(`Could not list the queue: ${error.message}`);
  return toPage((data ?? []) as Array<{ conversation_id: string; last_activity_at: string }>, pageSize, (row) => ({ id: row.conversation_id, at: row.last_activity_at }));
}

function toPage<T>(rows: T[], pageSize: number, pick: (row: T) => { id: string; at: string }): QueuePage {
  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;
  const last = visible.length > 0 ? pick(visible[visible.length - 1]) : null;
  return {
    ids: visible.map((row) => pick(row).id),
    nextCursor: hasMore && last ? { lastActivityAt: last.at, conversationId: last.id } : null,
  };
}

/** Whether this agency has switched on the grouped queue rail. Absent settings row = off. */
export async function loadInboxQueuesV2Enabled(db: Db, agencyId: string): Promise<boolean> {
  const { data, error } = await db.from("agency_settings").select("inbox_queues_v2").eq("agency_id", agencyId).maybeSingle();
  if (error) return false;
  return (data as { inbox_queues_v2?: boolean } | null)?.inbox_queues_v2 === true;
}
