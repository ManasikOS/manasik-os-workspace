/**
 * What every conversation-conversion kind shares (MI4.6): the payload, the checks made again at execution time, and the
 * proposal's explanation. Nothing here writes; each kind's own file does the one write.
 */

import { z } from "zod";

import type { Db } from "@/lib/agent/kernel/proposals/context-pack";
import { loadConversationConversionFacts, type ConversationPackFacts } from "@/lib/agent/kernel/proposals/conversation-pack";
import { conversionBlocker, type ConversionKind } from "@/lib/inbox/conversions/catalogue";

/**
 * The browser names only the conversation's message, an optional note and — for a conversion that needs a decision — the
 * choices. The group, booking, traveller and customer are read again on the server. `labels` are display text the SERVER
 * derived from the choices (so the "Check before creating" step can say "Umrah Gold", not an id); no decision ever reads them.
 */
export const ConversationConversionPayloadSchema = z.object({
  conversationId: z.string().uuid(),
  sourceMessageId: z.string().uuid(),
  note: z.string().trim().max(300, "Keep the note under 300 characters.").default(""),
  labels: z.record(z.string().max(64), z.string().max(200)).default({}),
});
export type ConversationConversionPayload = z.infer<typeof ConversationConversionPayloadSchema>;

/** One open proposal per conversation and kind — or per conversation, kind and choice where one conversation can hold several. */
export const conversionFingerprint = (kind: ConversionKind, payload: { conversationId: string }, ...parts: string[]) =>
  [kind, payload.conversationId, ...parts].join(":");

/**
 * The world as it is at execution time. Fails with a sentence a person can act on when the conversation is gone, no longer
 * has what the conversion needs, or the named message does not belong to it — a message id from another conversation (or
 * agency) must never become the "source" of an object.
 */
export async function verifyConversionTarget(
  kind: ConversionKind,
  payload: { conversationId: string; sourceMessageId: string },
  ctx: { agencyId: string; db: Db },
): Promise<{ ok: true; facts: ConversationPackFacts } | { ok: false; error: string }> {
  const facts = await loadConversationConversionFacts(ctx.db, ctx.agencyId, payload.conversationId);
  if (!facts) return { ok: false, error: "That conversation no longer exists." };
  const blocker = conversionBlocker(kind, facts);
  if (blocker) return { ok: false, error: blocker };

  const { data, error } = await ctx.db
    .from("conversation_messages")
    .select("id")
    .eq("agency_id", ctx.agencyId)
    .eq("conversation_id", payload.conversationId)
    .eq("id", payload.sourceMessageId)
    .maybeSingle();
  if (error) return { ok: false, error: "Could not check the message this points back at." };
  if (!data) return { ok: false, error: "The message this points back at is no longer in this conversation." };
  return { ok: true, facts };
}

/** The line every created task or case carries so anyone reading it can get back to the conversation. */
export function conversionBackLink(conversationId: string): string {
  return `Raised from an Inbox conversation: /inbox?conversation=${conversationId}`;
}

/** The source columns every conversion row carries. */
export function sourceColumns(payload: { conversationId: string; sourceMessageId: string }) {
  return { source_conversation_id: payload.conversationId, source_message_id: payload.sourceMessageId };
}
