/**
 * The Inbox Realtime event contract — SC2 of docs/inbox/scaling.md §6.
 *
 * Realtime is an invalidation signal, not a data source: an event says WHICH thing changed and how new it is, never what
 * it contains. Every variant is `.strict()` so a payload carrying an unexpected field (a name, a phone number, message
 * text) does not parse, and the browser answers an event it cannot parse with one bounded reconciliation instead of
 * trusting it. The SQL builder that produces these is `public.build_inbox_realtime_event`
 * (supabase/migrations/20261202094100_sc2_typed_inbox_realtime_events.sql).
 *
 * `id` is added to every payload by `realtime.send()` itself; it is the broadcast's own id, not a domain value.
 */

import { z } from "zod";

export const INBOX_REALTIME_SCHEMA_VERSION = 1;
export const INBOX_REALTIME_EVENT_NAME = "inbox.invalidate";

const conversationId = z.string().uuid();
const broadcastId = z.string().optional();

export const inboxListEventSchema = z
  .object({
    id: broadcastId,
    schemaVersion: z.literal(INBOX_REALTIME_SCHEMA_VERSION),
    scope: z.literal("LIST"),
    conversationId,
    /** Monotonic per conversation: a list patch older than the version the browser holds is ignored. */
    conversationVersion: z.number().int().positive(),
    reason: z.enum(["CONVERSATION", "QUEUE", "INTERVENTION"]),
  })
  .strict();

export const inboxThreadEventSchema = z
  .object({
    id: broadcastId,
    schemaVersion: z.literal(INBOX_REALTIME_SCHEMA_VERSION),
    scope: z.literal("THREAD"),
    conversationId,
    entity: z.enum(["MESSAGE", "NOTE", "ATTACHMENT", "MEDIA_ANALYSIS"]),
    entityId: z.string().uuid(),
    operation: z.enum(["INSERT", "UPDATE", "DELETE"]),
    /** Present for messages: the conversation's own sequence, so a client can ask for "everything after N". */
    sequenceNumber: z.number().int().nonnegative().optional(),
    /** Present for attachments and media analyses: the message they belong to, so the browser can re-read just that message. */
    messageId: z.string().uuid().optional(),
  })
  .strict();

export const inboxRevisionEventSchema = z
  .object({
    id: broadcastId,
    schemaVersion: z.literal(INBOX_REALTIME_SCHEMA_VERSION),
    scope: z.enum(["CONTEXT", "INTELLIGENCE", "PRESENCE"]),
    conversationId,
    revision: z.union([z.number().int().nonnegative(), z.string().max(64)]),
  })
  .strict();

export const inboxRealtimeEventSchema = z.union([inboxListEventSchema, inboxThreadEventSchema, inboxRevisionEventSchema]);

export type InboxListEvent = z.infer<typeof inboxListEventSchema>;
export type InboxThreadEvent = z.infer<typeof inboxThreadEventSchema>;
export type InboxRevisionEvent = z.infer<typeof inboxRevisionEventSchema>;
export type InboxRealtimeEvent = z.infer<typeof inboxRealtimeEventSchema>;

export type ParsedInboxRealtimeEvent = { status: "ok"; event: InboxRealtimeEvent } | { status: "unknown" };

/**
 * A payload that does not match the contract (an unknown version, an unknown scope, an extra field) is `unknown`. The
 * caller must reconcile ONCE and must never apply its content speculatively.
 */
export function parseInboxRealtimeEvent(payload: unknown): ParsedInboxRealtimeEvent {
  const parsed = inboxRealtimeEventSchema.safeParse(payload);
  return parsed.success ? { status: "ok", event: parsed.data } : { status: "unknown" };
}

/** The agency-wide topic: the list, queue counts and anything that changes what the list shows. */
export function inboxListTopic(agencyId: string): string {
  return `inbox:${agencyId}`;
}

/** The one-conversation topic: thread, delivery, notes, media, intelligence and presence for the OPEN conversation. */
export function inboxConversationTopic(agencyId: string, conversationId: string): string {
  return `inbox:${agencyId}:conversation:${conversationId}`;
}

/** The agency segment of a topic, exactly as the `realtime.messages` policy reads it (`split_part(topic, ':', 2)`). */
export function agencyOfInboxTopic(topic: string): string | null {
  const [prefix, agency] = topic.split(":");
  return prefix === "inbox" && agency ? agency : null;
}
