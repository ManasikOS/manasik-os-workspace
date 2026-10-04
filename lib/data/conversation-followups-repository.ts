/**
 * The follow-up ledger (`conversation_followups`) — idempotency, audit and dry-run record for the lead
 * follow-up sweep. Admin client only: the table has no insert/update policy for signed-in users.
 *
 * "Claim by insert": a row is inserted BEFORE anything is sent. The table's unique key
 * (conversation, kind, sequence, anchor message) means two overlapping cron runs cannot both claim the
 * same step — the loser gets `claimed: false` and does nothing.
 */

import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";

export type FollowupKind = "QUIET_NUDGE" | "HANDOFF_ALERT" | "HANDOFF_ESCALATION" | "WINDOW_REMINDER";
export type FollowupStatus = "CLAIMED" | "SENT" | "SKIPPED" | "FAILED" | "DRY_RUN";

export interface FollowupClaimInput {
  agencyId: string;
  conversationId: string;
  leadId: string | null;
  kind: FollowupKind;
  sequence: number;
  anchorMessageId: string;
  channel: string;
  /** CLAIMED for a send about to happen; DRY_RUN / SKIPPED when the outcome is already known. */
  status: Extract<FollowupStatus, "CLAIMED" | "DRY_RUN" | "SKIPPED">;
  skipReason?: string | null;
}

export type FollowupClaimResult = { claimed: true; id: string } | { claimed: false };

export interface FollowupLedgerRow {
  id: string;
  conversation_id: string;
  kind: FollowupKind;
  sequence: number;
  anchor_message_id: string;
  status: FollowupStatus;
  created_at: string;
}

export class FollowupLedgerError extends Error {
  constructor(operation: string, cause: { message: string; code?: string }) {
    super(`conversation_followups ${operation} failed${cause.code ? ` (${cause.code})` : ""}: ${cause.message}`);
    this.name = "FollowupLedgerError";
  }
}

export async function claimFollowup(db: Db, input: FollowupClaimInput): Promise<FollowupClaimResult> {
  const { data, error } = await db
    .from("conversation_followups")
    .insert({
      agency_id: input.agencyId,
      conversation_id: input.conversationId,
      lead_id: input.leadId,
      kind: input.kind,
      sequence: input.sequence,
      anchor_message_id: input.anchorMessageId,
      channel: input.channel,
      status: input.status,
      skip_reason: input.skipReason ?? null,
    })
    .select("id")
    .single();

  if (!error && data) return { claimed: true, id: (data as { id: string }).id };
  if ((error as { code?: string } | null)?.code === "23505") return { claimed: false }; // already claimed by an earlier or concurrent run
  throw new FollowupLedgerError("insert", (error ?? { message: "no row returned" }) as { message: string; code?: string });
}

export async function completeFollowup(
  db: Db,
  followupId: string,
  outcome: { status: Extract<FollowupStatus, "SENT" | "FAILED" | "SKIPPED">; externalMessageId?: string | null; skipReason?: string | null },
): Promise<void> {
  const { error } = await db
    .from("conversation_followups")
    .update({
      status: outcome.status,
      external_message_id: outcome.externalMessageId ?? null,
      skip_reason: outcome.skipReason ?? null,
    })
    .eq("id", followupId);
  if (error) throw new FollowupLedgerError("update", error);
}

/** Ledger rows for a set of conversations, newest first — what the sweep needs to work out each conversation's next step. */
export async function listLedgerForConversations(db: Db, agencyId: string, conversationIds: string[]): Promise<FollowupLedgerRow[]> {
  if (conversationIds.length === 0) return [];
  const { data, error } = await db
    .from("conversation_followups")
    .select("id, conversation_id, kind, sequence, anchor_message_id, status, created_at")
    .eq("agency_id", agencyId)
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new FollowupLedgerError("select", error);
  return (data ?? []) as FollowupLedgerRow[];
}

/** What the sweep needs to know about one customer message's nudge history. */
export function summariseNudgeLedger(rows: FollowupLedgerRow[], conversationId: string, anchorMessageId: string) {
  const forConversation = rows.filter((row) => row.conversation_id === conversationId && row.kind === "QUIET_NUDGE");
  const forAnchor = forConversation.filter((row) => row.anchor_message_id === anchorMessageId);
  const lastNudge = forConversation.find((row) => row.status === "SENT" || row.status === "DRY_RUN"); // newest first
  return {
    nudgesRecorded: forAnchor.length,
    lastNudgeAt: lastNudge?.created_at ?? null,
    stopped: forAnchor.some((row) => row.status === "FAILED" || row.status === "SKIPPED"),
  };
}
