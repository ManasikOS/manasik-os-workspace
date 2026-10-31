/**
 * Inbox SLA block (docs/modules/dashboard-role-blocks-spec.md section 3.2) —
 * pure, client-safe.
 *
 * Nothing is derived here: the figures are the Inbox rail's own queue counts
 * (`loadQueueCounts()` -> the `inbox_queue_counts` RPC), so the dashboard and
 * the Inbox cannot disagree. The only thing this adds is the plan gate: the
 * two SLA figures are left out when the agency's plan does not include SLA,
 * rather than shown from a queue the plan never populates.
 *
 * A queue the RPC did not return has no conversations in it - the read
 * itself succeeded - so it is a real zero, unlike a read that never ran.
 */

import type { InboxSlaData } from "@/lib/types/dashboard";

import type { QueueCounts } from "./inbox-queue-repository";

export function buildInboxSla(counts: QueueCounts, slaEntitled: boolean): InboxSlaData {
  return {
    mine: counts.MINE ?? 0,
    needsReply: counts.NEEDS_REPLY ?? 0,
    unassigned: counts.UNASSIGNED ?? 0,
    slaBreached: slaEntitled ? (counts.SLA_BREACHED ?? 0) : null,
    nearingDeadline: slaEntitled ? (counts.NEARING_DEADLINE ?? 0) : null,
    slaAvailable: slaEntitled,
  };
}
