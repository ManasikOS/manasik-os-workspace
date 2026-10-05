import type { Db } from "@/lib/ai/db";

import { decideStartOnExistingConversation, type ExistingConversationForStart } from "./start-conversation-guard";

/**
 * The write that opens a conversation when staff start a chat or an email (BUG-8 in docs/progress/2026-10-05-inbox-security-and-bug-audit.md).
 *
 * It used to be one upsert after a separate read, so a customer message (or a colleague taking the chat) between the two was overwritten:
 * the sender became the owner of a chat somebody else had just picked up. Now:
 *   - no conversation yet: a plain insert. If another request created it first (the unique key says so), nothing is overwritten; the
 *     chat that now exists is read again and treated like any other existing chat.
 *   - a conversation exists: it is taken over only when the same rules as the check before sending still allow it, and only if its
 *     state and owner are still what was read (compare-and-swap). If they changed, it is read again and decided again.
 *   - a chat a colleague owns, found at this point, is left exactly as it is. The caller decides what that means: an email stops, and a
 *     template that has already gone out is recorded in that chat without changing its owner.
 */

export type ExistingConversationRow = ExistingConversationForStart & { contact_name: string | null };

export type StartedConversationOutcome =
  | {
      ok: true;
      conversationId: string;
      /** True when the chat now belongs to the sender (created, or taken over). False when a colleague's chat was left alone. */
      tookOver: boolean;
      /** What the conversation looked like before this write; null when this write created it. */
      previous: ExistingConversationRow | null;
    }
  | { ok: false };

const MAX_ATTEMPTS = 3;
const UNIQUE_VIOLATION = "23505";

export async function openStartedConversation(
  db: Db,
  input: {
    agencyId: string;
    channel: "WHATSAPP" | "GMAIL";
    externalId: string;
    staffId: string | null;
    staffName: string | null;
    /** The columns that depend on the channel and contact (name, phone, connection) plus `last_outbound_at`. */
    fields: Record<string, unknown>;
    /** The conversation as the check before sending saw it; null when there was none. */
    existing: ExistingConversationRow | null;
    /** Reads the conversation for this contact again. */
    readExisting: () => Promise<ExistingConversationRow | null | "UNREADABLE">;
  },
): Promise<StartedConversationOutcome> {
  const owned = { state: "HUMAN_ACTIVE", assigned_to_id: input.staffId, assigned_to_name: input.staffName };
  let current = input.existing;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (current === null) {
      const { data, error } = await db
        .from("conversations")
        .insert({ agency_id: input.agencyId, channel: input.channel, external_conversation_id: input.externalId, ...input.fields, ...owned })
        .select("id")
        .single();
      if (!error && data) return { ok: true, conversationId: data.id as string, tookOver: true, previous: null };
      if (error?.code !== UNIQUE_VIOLATION) return { ok: false };
      const reread = await input.readExisting();
      if (reread === "UNREADABLE" || reread === null) return { ok: false };
      current = reread;
      continue;
    }

    const decision = decideStartOnExistingConversation({ existing: current, currentStaffId: input.staffId, contactNoun: "contact" });
    if (!decision.ok) return { ok: true, conversationId: current.id, tookOver: false, previous: current };

    let swap = db
      .from("conversations")
      .update({ ...input.fields, ...owned })
      .eq("agency_id", input.agencyId)
      .eq("id", current.id)
      .eq("state", current.state);
    swap = current.assigned_to_id === null ? swap.is("assigned_to_id", null) : swap.eq("assigned_to_id", current.assigned_to_id);
    const { data: updated, error } = await swap.select("id");
    if (error) return { ok: false };
    if (updated && updated.length > 0) return { ok: true, conversationId: current.id, tookOver: true, previous: current };

    const reread = await input.readExisting();
    if (reread === "UNREADABLE" || reread === null) return { ok: false };
    current = reread;
  }

  // It kept changing under us. Leave it as it is rather than overwrite it.
  return current ? { ok: true, conversationId: current.id, tookOver: false, previous: current } : { ok: false };
}
