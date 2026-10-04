import "server-only";

import type { Db } from "@/lib/ai/db";
import { deleteInboxConversations } from "@/lib/inbox/retention/sweep";

export type DeleteConversationResult =
  | { ok: true; channel: string | null; messagesDeleted: number; objectsDeleted: number }
  | { ok: false; reason: "NOT_FOUND" };

/**
 * Permanently removes one conversation of one agency: its messages, notes, drafts, attachments (the stored files too), assistant runs and
 * send queue. Leads, bookings, finance evidence and other records that only point back at the chat are kept and simply lose that link
 * (the database sets the link to null), so deleting a chat never deletes business records.
 *
 * `db` must be the admin client (it removes stored files and send-queue rows no staff session may touch); the caller has already checked
 * the person's permission and that the conversation is theirs. This function confirms the conversation belongs to `agencyId` before it
 * deletes anything, so a wrong id can never reach another agency's data.
 */
export async function deleteConversationPermanently(db: Db, input: { agencyId: string; conversationId: string }): Promise<DeleteConversationResult> {
  const { data, error } = await db.from("conversations").select("id, channel").eq("agency_id", input.agencyId).eq("id", input.conversationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "NOT_FOUND" };

  const deleted = await deleteInboxConversations(db, { agencyId: input.agencyId, conversationIds: [input.conversationId] });
  return {
    ok: true,
    channel: ((data as { channel?: string | null }).channel ?? null),
    messagesDeleted: deleted.messagesDeleted,
    objectsDeleted: deleted.objectsDeleted,
  };
}
