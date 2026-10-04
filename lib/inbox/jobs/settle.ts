/**
 * The settle delay and coalescing key for enrichment jobs — MI1.2 of docs/inbox/implementation-plan.md
 * (Architecture §7.3).
 *
 * A customer sending five messages in eight seconds must produce ONE enrichment run, not five. Two layers do it:
 * the SQL unique index on (agency_id, coalesce_key) while QUEUED (verified by scripts/sql/verify-mi1-1-channel-jobs.sql),
 * and this short delay so the run starts after the burst rather than after its first message. Each further message
 * pushes `run_after` out again, so the run happens once the customer has paused.
 *
 * Triage of a FIRST-contact message is what the customer is waiting on, so it is not delayed.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { enqueueChannelJob, type EnqueueChannelJobResult } from "@/lib/inbox/jobs/queue";

export const DEFAULT_SETTLE_DELAY_SECONDS = 4;

export function enrichCoalesceKey(conversationId: string): string {
  return `enrich:${conversationId}`;
}

export function settleDelaySeconds(input: { firstContact: boolean; agencySettleSeconds?: number | null }): number {
  if (input.firstContact) return 0;
  const configured = input.agencySettleSeconds;
  return typeof configured === "number" && Number.isFinite(configured) ? Math.min(Math.max(Math.trunc(configured), 0), 60) : DEFAULT_SETTLE_DELAY_SECONDS;
}

/** Enqueues (or extends) the one ENRICH job for a conversation. Never throws — a webhook must still acknowledge. */
export function enqueueEnrichForConversation(
  db: Db,
  input: { agencyId: string; conversationId: string; messageId?: string; firstContact: boolean; agencySettleSeconds?: number | null },
): Promise<EnqueueChannelJobResult> {
  return enqueueChannelJob(db, {
    agencyId: input.agencyId,
    kind: "ENRICH",
    coalesceKey: enrichCoalesceKey(input.conversationId),
    payload: { conversationId: input.conversationId, ...(input.messageId ? { messageId: input.messageId } : {}) },
    delaySeconds: settleDelaySeconds(input),
  });
}
