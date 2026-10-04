import "server-only";

import type { Db } from "@/lib/ai/db";
import {
  activeComposerPresence,
  type ComposerPresence,
} from "@/lib/inbox/composer-presence";
import { recordSignals, supersedeSignals } from "@/lib/data/conversation-intelligence-repository";

type ComposerPresenceRow = {
  composing_by: string | null;
  composing_at: string | null;
};

const rowToPresence = (row: ComposerPresenceRow | null): ComposerPresence | null =>
  row?.composing_by && row.composing_at
    ? { staffId: row.composing_by, at: row.composing_at }
    : null;

export type ComposerClaimResult =
  | { status: "CLAIMED"; presence: ComposerPresence }
  | { status: "HELD_BY_OTHER"; presence: ComposerPresence | null };

/**
 * Attempts to take a two-minute soft lease. The conditional UPDATE means a
 * concurrent fresh claim wins without being overwritten; callers still may
 * reply when another colleague holds it.
 */
export async function claimComposerPresence(
  db: Db,
  input: { agencyId: string; conversationId: string; staffId: string; now: Date },
): Promise<ComposerClaimResult> {
  const presence = { staffId: input.staffId, at: input.now.toISOString() };
  const staleBefore = new Date(input.now.getTime() - 2 * 60_000).toISOString();
  const { data, error } = await db
    .from("conversations")
    .update({ composing_by: input.staffId, composing_at: presence.at })
    .eq("agency_id", input.agencyId)
    .eq("id", input.conversationId)
    .or(`composing_by.is.null,composing_by.eq.${input.staffId},composing_at.is.null,composing_at.lt.${staleBefore}`)
    .select("composing_by, composing_at")
    .maybeSingle();
  if (error) throw new Error(`Could not mark this conversation as being written: ${error.message}`);
  if (data) return { status: "CLAIMED", presence };

  // Another fresh claim won. Re-read it so the caller can show the colleague,
  // rather than guessing or treating a failed conditional write as an error.
  const current = await db
    .from("conversations")
    .select("composing_by, composing_at")
    .eq("agency_id", input.agencyId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (current.error) throw new Error(`Could not read the active composer: ${current.error.message}`);
  return {
    status: "HELD_BY_OTHER",
    presence: activeComposerPresence(
      rowToPresence(current.data as ComposerPresenceRow | null),
      input.now,
    ),
  };
}

/** Releases only the caller's lease. It never clears a colleague's newer claim. */
export async function releaseComposerPresence(
  db: Db,
  input: { agencyId: string; conversationId: string; staffId: string },
): Promise<void> {
  const { error } = await db
    .from("conversations")
    .update({ composing_by: null, composing_at: null })
    .eq("agency_id", input.agencyId)
    .eq("id", input.conversationId)
    .eq("composing_by", input.staffId);
  if (error) throw new Error(`Could not clear the composer presence: ${error.message}`);
}

/**
 * Keeps the transient S4 observation in step with the persisted soft lease.
 * This runs on the server's trusted worker path because signals intentionally
 * have no authenticated write policy.
 */
export async function syncConcurrentComposerSignal(
  db: Db,
  input: { agencyId: string; conversationId: string; now: Date },
): Promise<void> {
  const { data, error } = await db
    .from("conversations")
    .select("composing_by, composing_at")
    .eq("agency_id", input.agencyId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read composer presence for the risk signal: ${error.message}`);

  const presence = activeComposerPresence(
    rowToPresence(data as ComposerPresenceRow | null),
    input.now,
  );
  if (presence) {
    await recordSignals(db, input.agencyId, input.conversationId, [{
      signalCode: "CONCURRENT_COMPOSER",
      messageId: null,
      detector: "RULE",
      confidence: 1,
      evidence: [{ messageId: null, snippet: "A colleague is writing a reply to this customer" }],
    }]);
    return;
  }
  await supersedeSignals(db, input.agencyId, input.conversationId, {
    codes: ["CONCURRENT_COMPOSER"],
  });
}
