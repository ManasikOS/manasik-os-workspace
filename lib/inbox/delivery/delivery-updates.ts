/**
 * Delivery ticks (sent, delivered, read, failed) reported by a channel, applied in batches (Q4).
 *
 * `recordMessageDelivery` is what a webhook calls for each status. Two paths, chosen by whether the always-on worker is running
 * (`INBOX_WORKER_ACTIVE`):
 *   - worker active: append the status to `message_delivery_status_buffer` and return. The worker's status loop applies up to a few hundred
 *     at once, so a message's sent, delivered and read become one write instead of three.
 *   - otherwise: apply it now through the same SQL function, which never moves a message backwards.
 * If the append fails, it falls back to applying now, so a status is not dropped because the buffer was unreachable.
 *
 * Nothing here logs a message id or text; an error carries only the database's message.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { isInboxWorkerActive } from "@/lib/inbox/worker/mode";

export type DeliveryState = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface DeliveryPatch {
  deliveryStatus: DeliveryState;
  deliveryError?: string | null;
}

export class DeliveryUpdateError extends Error {
  constructor(operation: string, cause: { message: string }) {
    super(`delivery status ${operation} failed: ${cause.message}`);
    this.name = "DeliveryUpdateError";
  }
}

/** Furthest-along first; mirrors `public.delivery_status_rank` in the database. */
export function deliveryStateRank(status: string): number {
  switch (status) {
    case "SENT":
    case "FAILED":
      return 1;
    case "DELIVERED":
      return 2;
    case "READ":
      return 3;
    default:
      return 0;
  }
}

async function applyNow(db: Db, agencyId: string, externalMessageId: string, patch: DeliveryPatch): Promise<void> {
  const { error } = await db.rpc("apply_message_delivery_updates", {
    p_agency_ids: [agencyId],
    p_external_message_ids: [externalMessageId],
    p_statuses: [patch.deliveryStatus],
    p_errors: [patch.deliveryError ?? null],
  });
  if (!error) return;
  // PGRST202: the function is not there yet (code deployed before the Q4 migration). Do what the code did before, so ticks keep landing.
  if ((error as { code?: string }).code === "PGRST202") {
    const legacy = await db
      .from("conversation_messages")
      .update({ delivery_status: patch.deliveryStatus, delivery_error: patch.deliveryError ?? null })
      .eq("agency_id", agencyId)
      .eq("external_message_id", externalMessageId);
    if (!legacy.error) return;
    throw new DeliveryUpdateError("apply", legacy.error);
  }
  throw new DeliveryUpdateError("apply", error);
}

export async function recordMessageDelivery(
  db: Db,
  externalMessageId: string,
  agencyId: string,
  patch: DeliveryPatch,
  options: { buffer?: boolean } = {},
): Promise<void> {
  const buffer = options.buffer ?? isInboxWorkerActive();
  if (buffer) {
    const { error } = await db.from("message_delivery_status_buffer").insert({
      agency_id: agencyId,
      external_message_id: externalMessageId,
      delivery_status: patch.deliveryStatus,
      delivery_error: patch.deliveryError ?? null,
    });
    if (!error) return;
    console.error("delivery status buffer insert failed; applying it directly:", error.message);
  }
  await applyNow(db, agencyId, externalMessageId, patch);
}

export interface DeliveryDrainResult {
  processed: number;
  failed: number;
  changed: number;
}

/**
 * Applies buffered statuses until the buffer is empty or the budget is spent. `processed` counts statuses taken from the buffer,
 * `changed` the messages whose row actually changed (the rest were repeats or arrived after a later state).
 */
export async function drainDeliveryEvents(
  db: Db,
  options: { budgetMs: number; batchSize?: number; now?: () => number },
): Promise<DeliveryDrainResult> {
  const now = options.now ?? Date.now;
  const batchSize = options.batchSize ?? 500;
  const deadline = now() + options.budgetMs;
  const result: DeliveryDrainResult = { processed: 0, failed: 0, changed: 0 };

  while (now() < deadline) {
    const { data, error } = await db.rpc("drain_message_delivery_status_buffer", { p_limit: batchSize });
    if (error) throw new DeliveryUpdateError("drain", error);
    const row = (Array.isArray(data) ? data[0] : data) as { taken?: number; changed?: number } | null | undefined;
    const taken = Number(row?.taken ?? 0);
    result.processed += taken;
    result.changed += Number(row?.changed ?? 0);
    if (taken < batchSize) break;
  }
  return result;
}
