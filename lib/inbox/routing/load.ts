/**
 * How busy each person is — MI3.5 (Architecture §16 R3 step 3). Pure.
 *
 * Load = the person's open conversations that are waiting for a reply (`NEEDS_REPLY`), each weighted by how urgent it is: a
 * plain one counts 1, and every 100 points of queue priority (an open review, a critical customer, a missed target) adds one,
 * up to a weight of 4. Ten calm conversations are lighter than three that are overdue and urgent.
 */

export const MAX_CONVERSATION_WEIGHT = 4;

export function conversationWeight(priorityRank: number): number {
  const raised = 1 + Math.floor(Math.max(0, priorityRank) / 100);
  return Math.min(MAX_CONVERSATION_WEIGHT, raised);
}

/** `assigned_to_id` → weighted load, from one row per open NEEDS_REPLY conversation. Unassigned rows count for no one. */
export function loadByStaff(rows: ReadonlyArray<{ assignedToId: string | null; priorityRank: number }>): Map<string, number> {
  const load = new Map<string, number>();
  for (const row of rows) {
    if (!row.assignedToId) continue;
    load.set(row.assignedToId, (load.get(row.assignedToId) ?? 0) + conversationWeight(row.priorityRank));
  }
  return load;
}
