/**
 * The short "what happened to this conversation" list in the side panel. Only events staff can act on or ask about appear:
 * when the chat started and every change of owner. Anything else recorded on the conversation (an event kind this build
 * does not know) is left out rather than shown as raw text.
 */

export interface HistoryEventRow {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  occurred_at: string;
}

export interface HistoryEntry {
  id: string;
  label: string;
  at: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export function historyEntryFor(event: HistoryEventRow): HistoryEntry | null {
  if (event.kind === "OWNER_ASSIGNED_BY_ROUTING") {
    const owner = text(event.data.to_name);
    const reason = text(event.data.reason);
    if (!owner) return null;
    return { id: event.id, at: event.occurred_at, label: reason ? `Assigned to ${owner} by routing: ${reason}` : `Assigned to ${owner} by routing` };
  }
  if (event.kind === "CUSTOMER_REOPENED") return { id: event.id, at: event.occurred_at, label: "Reopened by the customer" };
  if (event.kind === "CONVERSATION_CLOSED") {
    const closedBy = text(event.data.actorName);
    return { id: event.id, at: event.occurred_at, label: closedBy ? `Closed by ${closedBy}` : "Closed" };
  }
  if (event.kind !== "OWNER_CHANGED") return null;
  const from = text(event.data.from_name);
  const to = text(event.data.to_name);
  const by = text(event.data.changed_by_name);
  const suffix = by ? ` by ${by}` : "";
  if (from && to) return { id: event.id, at: event.occurred_at, label: `Owner changed from ${from} to ${to}${suffix}` };
  if (to) return { id: event.id, at: event.occurred_at, label: `Assigned to ${to}${suffix}` };
  if (from) return { id: event.id, at: event.occurred_at, label: `Owner ${from} removed${suffix}` };
  return null;
}

/** Newest first, capped, always ending with when the conversation started. */
export function buildHistory(input: { startedAt: string; events: readonly HistoryEventRow[]; limit?: number }): HistoryEntry[] {
  const limit = input.limit ?? 8;
  const changes = input.events
    .flatMap((event) => historyEntryFor(event) ?? [])
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(0, limit - 1));
  return [...changes, { id: "conversation-started", label: "Conversation started", at: input.startedAt }];
}
