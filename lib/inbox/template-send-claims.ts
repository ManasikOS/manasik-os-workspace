import "server-only";

import type { Db } from "@/lib/ai/db";

/**
 * A staff-started WhatsApp template is billable and goes straight to Meta, so a repeat of the same send (a double click, a retried request, a second
 * tab) must not send it again. Each attempt carries a key from the browser; the row is inserted BEFORE Meta is called, so the second request
 * loses the insert and is answered from the first. A row marked SENT stays on record even if the conversation or message write that follows fails.
 */

const TABLE = "inbox_template_send_claims";
/** A send that has been "in progress" this long probably died mid-way: its outcome is unknown, so it is neither retried nor assumed sent. */
export const STALE_SENDING_MS = 2 * 60_000;

export type TemplateSendClaim =
  | { kind: "CLAIMED" }
  | { kind: "ALREADY_SENT"; conversationId: string | null }
  | { kind: "IN_PROGRESS" }
  | { kind: "UNCERTAIN" }
  | { kind: "UNAVAILABLE" };

/** The sentence to show when a send must not go ahead, or null when it may (or when it is a repeat to answer as success). */
export function claimRefusalMessage(claim: TemplateSendClaim): string | null {
  switch (claim.kind) {
    case "CLAIMED":
    case "ALREADY_SENT":
      return null;
    case "IN_PROGRESS":
      return "This message is already being sent. Wait a moment and check the chat before sending again.";
    case "UNCERTAIN":
      return "An earlier attempt to send this message did not finish, so its result is unknown. Check the chat in the Inbox. If the message is not there, close this window and try again.";
    case "UNAVAILABLE":
      return "Could not prepare the send, so nothing was sent. Try again in a moment.";
  }
}

export async function claimTemplateSend(admin: Db, input: { agencyId: string; key: string; staffId: string; now?: Date }): Promise<TemplateSendClaim> {
  const now = input.now ?? new Date();
  const { error } = await admin.from(TABLE).insert({ agency_id: input.agencyId, idempotency_key: input.key, staff_id: input.staffId });
  if (!error) return { kind: "CLAIMED" };
  // Anything but "this key already exists" is not a reason to send: unknown is not "clear".
  if (error.code !== "23505") {
    console.error("Could not record the template send:", error.message);
    return { kind: "UNAVAILABLE" };
  }

  const { data: existing, error: readError } = await admin
    .from(TABLE)
    .select("status, conversation_id, updated_at")
    .eq("agency_id", input.agencyId)
    .eq("idempotency_key", input.key)
    .maybeSingle();
  if (readError || !existing) return { kind: "UNAVAILABLE" };

  const row = existing as { status: string; conversation_id: string | null; updated_at: string };
  if (row.status === "SENT") return { kind: "ALREADY_SENT", conversationId: row.conversation_id };
  if (row.status === "FAILED") {
    // Nothing was sent last time, so this key may be used again, but only by one request.
    const { data: reclaimed, error: reclaimError } = await admin
      .from(TABLE)
      .update({ status: "SENDING", error: null, updated_at: now.toISOString() })
      .eq("agency_id", input.agencyId)
      .eq("idempotency_key", input.key)
      .eq("status", "FAILED")
      .select("id");
    if (reclaimError) return { kind: "UNAVAILABLE" };
    return reclaimed && reclaimed.length > 0 ? { kind: "CLAIMED" } : { kind: "IN_PROGRESS" };
  }
  const startedAt = Date.parse(row.updated_at);
  return Number.isFinite(startedAt) && now.getTime() - startedAt > STALE_SENDING_MS ? { kind: "UNCERTAIN" } : { kind: "IN_PROGRESS" };
}

async function settle(admin: Db, input: { agencyId: string; key: string }, patch: Record<string, unknown>, context: string): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("agency_id", input.agencyId)
    .eq("idempotency_key", input.key);
  // Best effort by design: the send has already happened (or definitely did not), and this must never turn that into a failure.
  if (error) console.error(`Could not ${context}:`, error.message);
}

/** Meta accepted the message. Recorded before anything else is written, so the send is on record whatever happens next. */
export function recordTemplateSent(admin: Db, input: { agencyId: string; key: string; externalMessageId: string }): Promise<void> {
  return settle(admin, input, { status: "SENT", external_message_id: input.externalMessageId }, "mark the template send as sent");
}

export function attachTemplateConversation(admin: Db, input: { agencyId: string; key: string; conversationId: string }): Promise<void> {
  return settle(admin, input, { conversation_id: input.conversationId }, "link the template send to its conversation");
}

/** Nothing reached the customer, so the same key may be tried again. */
export function recordTemplateFailed(admin: Db, input: { agencyId: string; key: string; error: string }): Promise<void> {
  return settle(admin, input, { status: "FAILED", error: input.error.slice(0, 500) }, "mark the template send as failed");
}
