/**
 * The idempotency record for one AI reply to one inbound message (Q1, docs/inbox/scale-inngest-implementation-plan.md §5.1).
 *
 * A retry of a reply job must never call the model a second time for an answer that already exists, and must never send a
 * second message. The queue cannot promise that: a handler can outlive its job (a timeout re-queues a job whose handler is
 * still running), and a worker can die after the provider accepted a message but before we noted it. So the intent is written
 * BEFORE anything happens and every move is a compare-and-set on the row:
 *
 *   GENERATING ──► SENDING ──► SENT | SKIPPED
 *        ▲            │ (send failed, retryable)
 *        └─ GENERATED ◄┘                     SENDING with an expired lease ──► UNKNOWN
 *
 *   - GENERATING / SENDING are leases. An attempt that finds a live lease held by someone else stands down (BUSY); one that
 *     finds an expired GENERATING lease takes it over and re-runs the model (nothing was sent, so that is safe).
 *   - GENERATED holds a produced-but-unsent reply, so a retry sends it without the model.
 *   - An expired SENDING lease means the send MAY have reached the customer. Sending again could double-message them, so it
 *     becomes UNKNOWN and is handed to staff; it is never retried automatically.
 *
 * Every write names the attempt's `owner_token` and the status it expects, so an attempt that lost its lease can change nothing.
 * The table is service-role only. Pure decision logic is separate from the writes so it is tested without a database.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";

export const REPLY_GENERATE_LEASE_SECONDS = 120;
export const REPLY_SEND_LEASE_SECONDS = 60;

export type ReplyIntentStatus = "GENERATING" | "GENERATED" | "SENDING" | "SENT" | "SKIPPED" | "UNKNOWN";

export interface ReplyIntentRow {
  id: string;
  status: ReplyIntentStatus;
  owner_token: string | null;
  lease_until: string | null;
  reply_text: string | null;
  reply_buttons: unknown;
  attempts: number;
  /** The row's version: every compare-and-set below also matches it, so two attempts cannot both take the same lease. */
  updated_at: string;
}

export type ExistingIntentDecision = "DONE" | "TAKE_GENERATION" | "TAKE_STORED" | "MARK_UNKNOWN" | "BUSY";

/** What an attempt should do about an intent that already exists. Pure. */
export function decideExistingIntent(row: Pick<ReplyIntentRow, "status" | "lease_until">, now: Date): ExistingIntentDecision {
  const leaseLive = row.lease_until !== null && new Date(row.lease_until).getTime() > now.getTime();
  switch (row.status) {
    case "SENT":
    case "SKIPPED":
    case "UNKNOWN":
      return "DONE";
    case "GENERATED":
      return "TAKE_STORED";
    case "GENERATING":
      return leaseLive ? "BUSY" : "TAKE_GENERATION";
    case "SENDING":
      return leaseLive ? "BUSY" : "MARK_UNKNOWN";
  }
}

export type IntentClaim =
  | { action: "GENERATE"; intentId: string }
  | { action: "SEND_STORED"; intentId: string; reply: string; buttons: Array<{ id: string; title: string }> }
  /** Sent, skipped, or already handed to staff: there is nothing left to do. */
  | { action: "DONE" }
  /** An earlier attempt may have sent this reply. Do not send it again; tell staff. */
  | { action: "UNKNOWN"; intentId: string }
  /** Another attempt holds the lease. Stand down and retry later. */
  | { action: "BUSY" };

export interface ReplyIntentKey {
  agencyId: string;
  conversationId: string;
  inboundMessageId: string;
}

const COLUMNS = "id, status, owner_token, lease_until, reply_text, reply_buttons, attempts, updated_at";

function leaseFrom(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function asButtons(value: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { id: string; title: string } =>
      typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { title?: unknown }).title === "string",
  );
}

/**
 * Takes or creates the intent for this inbound message. The insert is the claim: the unique key on (agency, inbound
 * message) lets exactly one attempt create it, and every other attempt reads what is there and decides.
 */
export async function claimReplyIntent(db: Db, key: ReplyIntentKey, ownerToken: string, now: Date = new Date()): Promise<IntentClaim> {
  const inserted = await db
    .from("reply_intents")
    .insert({
      agency_id: key.agencyId,
      conversation_id: key.conversationId,
      inbound_message_id: key.inboundMessageId,
      status: "GENERATING",
      owner_token: ownerToken,
      lease_until: leaseFrom(now, REPLY_GENERATE_LEASE_SECONDS),
    })
    .select("id")
    .maybeSingle();
  if (!inserted.error && inserted.data) return { action: "GENERATE", intentId: (inserted.data as { id: string }).id };
  if (inserted.error && (inserted.error as { code?: string }).code !== "23505") {
    throw new Error(`Could not record the reply intent: ${inserted.error.message}`);
  }

  const existing = await db
    .from("reply_intents")
    .select(COLUMNS)
    .eq("agency_id", key.agencyId)
    .eq("inbound_message_id", key.inboundMessageId)
    .maybeSingle();
  if (existing.error) throw new Error(`Could not read the reply intent: ${existing.error.message}`);
  const row = existing.data as ReplyIntentRow | null;
  if (!row) return { action: "BUSY" }; // deleted between our insert and our read (the conversation was removed): let the job retry

  const decision = decideExistingIntent(row, now);
  if (decision === "DONE") return { action: "DONE" };
  if (decision === "BUSY") return { action: "BUSY" };

  // Each takeover matches the row's version, so if two attempts race for the same expired lease only one update lands.
  const versioned = (patch: Record<string, unknown>, status: ReplyIntentStatus) =>
    db
      .from("reply_intents")
      .update(patch)
      .eq("id", row.id)
      .eq("agency_id", key.agencyId)
      .eq("status", status)
      .eq("updated_at", row.updated_at)
      .select("id");

  if (decision === "TAKE_GENERATION") {
    const taken = await versioned(
      { owner_token: ownerToken, lease_until: leaseFrom(now, REPLY_GENERATE_LEASE_SECONDS), attempts: row.attempts + 1 },
      "GENERATING",
    );
    if (taken.error) throw new Error(`Could not take over the reply intent: ${taken.error.message}`);
    return (taken.data ?? []).length === 1 ? { action: "GENERATE", intentId: row.id } : { action: "BUSY" };
  }

  if (decision === "TAKE_STORED") {
    const taken = await versioned({ owner_token: ownerToken, lease_until: null, attempts: row.attempts + 1 }, "GENERATED");
    if (taken.error) throw new Error(`Could not take over the reply intent: ${taken.error.message}`);
    if ((taken.data ?? []).length !== 1) return { action: "BUSY" };
    return { action: "SEND_STORED", intentId: row.id, reply: row.reply_text ?? "", buttons: asButtons(row.reply_buttons) };
  }

  // MARK_UNKNOWN: a send began and never finished. It may or may not have reached the customer.
  const marked = await versioned({ status: "UNKNOWN", lease_until: null }, "SENDING");
  if (marked.error) throw new Error(`Could not mark the reply intent unknown: ${marked.error.message}`);
  return (marked.data ?? []).length === 1 ? { action: "UNKNOWN", intentId: row.id } : { action: "BUSY" };
}

/**
 * Moves the intent to SENDING and records the reply text. True only for the attempt that still owns the intent, so an
 * attempt whose lease expired (and was taken over) cannot send.
 */
export async function beginReplySend(
  db: Db,
  ids: { agencyId: string; intentId: string; ownerToken: string },
  reply: { text: string; buttons: Array<{ id: string; title: string }> },
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await db
    .from("reply_intents")
    .update({
      status: "SENDING",
      reply_text: reply.text,
      reply_buttons: reply.buttons,
      lease_until: leaseFrom(now, REPLY_SEND_LEASE_SECONDS),
    })
    .eq("id", ids.intentId)
    .eq("agency_id", ids.agencyId)
    .eq("owner_token", ids.ownerToken)
    .in("status", ["GENERATING", "GENERATED"])
    .select("id");
  if (error) throw new Error(`Could not start the reply send: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Records that the provider accepted the reply. */
export async function finishReplySent(
  db: Db,
  ids: { agencyId: string; intentId: string; ownerToken: string },
  providerMessageId: string,
): Promise<void> {
  const { error } = await db
    .from("reply_intents")
    .update({ status: "SENT", provider_message_id: providerMessageId, lease_until: null })
    .eq("id", ids.intentId)
    .eq("agency_id", ids.agencyId)
    .eq("owner_token", ids.ownerToken)
    .eq("status", "SENDING");
  if (error) throw new Error(`Could not record the sent reply: ${error.message}`);
}

/** Records that no reply will be sent for this inbound message, and why, so a retry stands down. */
export async function finishReplySkipped(
  db: Db,
  ids: { agencyId: string; intentId: string; ownerToken: string },
  reason: string,
): Promise<void> {
  const { error } = await db
    .from("reply_intents")
    .update({ status: "SKIPPED", skip_reason: reason.slice(0, 200), lease_until: null })
    .eq("id", ids.intentId)
    .eq("agency_id", ids.agencyId)
    .eq("owner_token", ids.ownerToken)
    .in("status", ["GENERATING", "GENERATED", "SENDING"]);
  if (error) throw new Error(`Could not record the skipped reply: ${error.message}`);
}

/** A send that certainly did NOT reach the customer (a rate limit, a missing token): keep the reply so a retry sends it without the model. */
export async function revertReplyToGenerated(db: Db, ids: { agencyId: string; intentId: string; ownerToken: string }): Promise<void> {
  const { error } = await db
    .from("reply_intents")
    .update({ status: "GENERATED", lease_until: null })
    .eq("id", ids.intentId)
    .eq("agency_id", ids.agencyId)
    .eq("owner_token", ids.ownerToken)
    .eq("status", "SENDING");
  if (error) throw new Error(`Could not keep the reply for a retry: ${error.message}`);
}
