/**
 * The back-link for objects made by the Inbox's existing buttons (MI4.6): a lead captured from a chat, a quote drafted from an
 * offer, a booking created from a conversation. The new conversion menu writes its source columns in the same insert as the
 * object; these three flows create theirs through older store mutators that cannot carry the columns, so the link is stamped
 * straight after, on the trusted client, naming the agency.
 *
 * It only ever fills an EMPTY link (`source_conversation_id is null`): an object that already knows where it came from is not
 * re-pointed. A failure is logged and never undoes the object — the lead, quote or booking is real and the person needs it; the
 * link is what makes it traceable, and a missing one is repaired by running this again.
 */

import "server-only";

import type { Db } from "@/lib/agent/kernel/proposals/context-pack";
import { findSourceMessageId } from "@/lib/agent/kernel/proposals/conversation-pack";

export const SOURCE_LINKED_TABLES = ["leads", "lead_quotes", "departure_group_bookings"] as const;
export type SourceLinkedTable = (typeof SOURCE_LINKED_TABLES)[number];

export interface SourceLinkTarget {
  agencyId: string;
  table: SourceLinkedTable;
  /** How the row is found: by its id, or (quotes) by its unique reference. */
  by: { column: "id" | "reference"; value: string };
  conversationId: string;
  /** The exact message to point at. Omitted, the customer's latest message is used. */
  messageId?: string | null;
}

/** Returns true when the row now points at the conversation; false when it was left alone or the write failed. */
export async function stampConversationSource(db: Db, target: SourceLinkTarget): Promise<boolean> {
  try {
    const messageId = target.messageId ?? (await findSourceMessageId(db, target.agencyId, target.conversationId));
    const { data, error } = await db
      .from(target.table)
      .update({ source_conversation_id: target.conversationId, source_message_id: messageId })
      .eq("agency_id", target.agencyId)
      .eq(target.by.column, target.by.value)
      .is("source_conversation_id", null)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`Could not link ${target.table} to its conversation:`, error.message);
      return false;
    }
    return Boolean(data);
  } catch (cause) {
    console.error(`Could not link ${target.table} to its conversation:`, cause instanceof Error ? cause.message : cause);
    return false;
  }
}
