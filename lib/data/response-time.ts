/**
 * Read side of the "Response time by channel" card. Session client, so RLS decides who gets rows, and every
 * query is also filtered by agency like the other lib/data read models. Bounded to the last 30 days and a
 * row cap; hitting the cap is reported rather than hidden.
 */

import "server-only";

import { ANALYTICS_WINDOW_DAYS } from "@/lib/agent/whatsapp/analytics";
import type { Db } from "@/lib/data/whatsapp-billing-view";
import { buildResponseTimeStats, type ResponseActor, type ResponseTimeStats } from "@/lib/inbox/response-time";

const MESSAGE_ROW_CAP = 20000;
const DEFAULT_TARGET_MINUTES = 15;

export interface ResponseTimeSummary extends ResponseTimeStats {
  windowDays: number;
  /** True when the row cap was hit, so the older part of the window is missing. */
  truncated: boolean;
}

export async function getResponseTimeSummary(db: Db, agencyId: string, now: Date = new Date()): Promise<ResponseTimeSummary> {
  const since = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();

  const [{ data: settings }, messagesResult] = await Promise.all([
    db.from("ai_settings").select("handoff_alert_minutes").eq("agency_id", agencyId).maybeSingle(),
    db
      .from("conversation_messages")
      .select("conversation_id, actor_kind, created_at, conversations!inner(channel, state)")
      .eq("agency_id", agencyId)
      .gte("created_at", since)
      .neq("conversations.state", "CLOSED")
      .order("created_at", { ascending: false })
      .limit(MESSAGE_ROW_CAP),
  ]);
  if (messagesResult.error) throw new Error(`Could not load messages for response times: ${messagesResult.error.message}`);

  const rows = (messagesResult.data ?? []) as unknown as {
    conversation_id: string;
    actor_kind: ResponseActor;
    created_at: string;
    conversations: { channel: string } | { channel: string }[] | null;
  }[];

  const messages = rows.flatMap((row) => {
    const conversation = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations;
    return conversation ? [{ conversationId: row.conversation_id, channel: conversation.channel, actorKind: row.actor_kind, createdAt: row.created_at }] : [];
  });

  const targetMinutes = (settings?.handoff_alert_minutes as number | undefined) ?? DEFAULT_TARGET_MINUTES;
  return {
    ...buildResponseTimeStats(messages, targetMinutes, now),
    windowDays: ANALYTICS_WINDOW_DAYS,
    truncated: rows.length >= MESSAGE_ROW_CAP,
  };
}
