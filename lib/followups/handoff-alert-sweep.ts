/**
 * Phase 1 of docs/modules/lead-retention-followups-implementation-plan.md: tell staff when a customer who
 * needs a person has gone unanswered. Runs for ONE agency per call — the cron loops over agencies so a
 * query never spans tenants. Sends nothing to customers; it only writes in-app notifications.
 */

import "server-only";

import { claimFollowup, completeFollowup } from "@/lib/data/conversation-followups-repository";
import { listActiveStaffIdsByRole, notifyConversationWaiting } from "@/lib/data/staff-notifications";
import type { Db } from "@/lib/data/whatsapp-repository";
import {
  findWaitingConversations,
  handoffNotificationTitle,
  recipientsFor,
  type WaitingConversationRow,
} from "@/lib/followups/handoff-waiting";

/** Roles told when a customer is still waiting past the escalation time. */
export const ESCALATION_ROLES = ["ADMIN", "CEO"] as const;

const DEFAULT_ALERT_MINUTES = 15;
const DEFAULT_ESCALATION_MINUTES = 60;
/** Nothing older than this is alerted on — it is also the longest escalation time the settings allow. */
const LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const CONVERSATION_LIMIT = 200;

export interface HandoffAlertSweepResult {
  waiting: number;
  alertsSent: number;
  escalationsSent: number;
  failed: number;
}

interface ConversationRecord {
  id: string;
  channel: string;
  state: string;
  contact_name: string | null;
  assigned_to_id: string | null;
  last_inbound_at: string;
  last_outbound_at: string | null;
}

export async function runHandoffAlertSweep(db: Db, agencyId: string, now: Date = new Date()): Promise<HandoffAlertSweepResult> {
  const result: HandoffAlertSweepResult = { waiting: 0, alertsSent: 0, escalationsSent: 0, failed: 0 };

  const { data: settings } = await db
    .from("ai_settings")
    .select("handoff_alert_minutes, handoff_escalation_minutes, default_lead_owner_id")
    .eq("agency_id", agencyId)
    .maybeSingle();
  const thresholds = {
    alertMinutes: (settings?.handoff_alert_minutes as number | undefined) ?? DEFAULT_ALERT_MINUTES,
    escalationMinutes: (settings?.handoff_escalation_minutes as number | undefined) ?? DEFAULT_ESCALATION_MINUTES,
  };
  const defaultLeadOwnerId = (settings?.default_lead_owner_id as string | null | undefined) ?? null;

  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const { data: conversations, error } = await db
    .from("conversations")
    .select("id, channel, state, contact_name, assigned_to_id, last_inbound_at, last_outbound_at")
    .eq("agency_id", agencyId)
    .in("state", ["HUMAN_REQUESTED", "HUMAN_ACTIVE"])
    .not("last_inbound_at", "is", null)
    .gte("last_inbound_at", since)
    .order("last_inbound_at", { ascending: true })
    .limit(CONVERSATION_LIMIT);
  if (error) throw new Error(`Could not load conversations waiting on staff: ${error.message}`);

  // A customer message after our last outbound one means the customer is waiting.
  const unanswered = ((conversations ?? []) as ConversationRecord[]).filter(
    (row) => !row.last_outbound_at || new Date(row.last_inbound_at).getTime() > new Date(row.last_outbound_at).getTime(),
  );
  if (unanswered.length === 0) return result;

  const { data: messages, error: messagesError } = await db
    .from("conversation_messages")
    .select("id, conversation_id, created_at")
    .eq("agency_id", agencyId)
    .eq("actor_kind", "CUSTOMER")
    .in("conversation_id", unanswered.map((row) => row.id))
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (messagesError) throw new Error(`Could not load customer messages: ${messagesError.message}`);

  const customerMessages = (messages ?? []) as { id: string; conversation_id: string; created_at: string }[];
  const rows: WaitingConversationRow[] = unanswered.map((conversation) => {
    const lastOutbound = conversation.last_outbound_at ? new Date(conversation.last_outbound_at).getTime() : Number.NEGATIVE_INFINITY;
    const first = customerMessages.find(
      (message) => message.conversation_id === conversation.id && new Date(message.created_at).getTime() > lastOutbound,
    );
    return {
      conversationId: conversation.id,
      channel: conversation.channel,
      state: conversation.state,
      contactName: conversation.contact_name ?? "",
      assignedToId: conversation.assigned_to_id,
      firstUnansweredMessageId: first?.id ?? null,
      firstUnansweredAt: first?.created_at ?? null,
    };
  });

  const due = findWaitingConversations(rows, now, thresholds);
  result.waiting = new Set(due.map((alert) => alert.conversationId)).size;
  if (due.length === 0) return result;

  let escalationRecipientIds: string[] | null = null;
  for (const alert of due) {
    const claim = await claimFollowup(db, {
      agencyId,
      conversationId: alert.conversationId,
      leadId: null,
      kind: alert.level === "ESCALATION" ? "HANDOFF_ESCALATION" : "HANDOFF_ALERT",
      sequence: 1,
      anchorMessageId: alert.anchorMessageId,
      channel: alert.channel,
      status: "CLAIMED",
    });
    if (!claim.claimed) continue; // an earlier run already told them about this customer message

    try {
      escalationRecipientIds ??= await listActiveStaffIdsByRole(db, agencyId, ESCALATION_ROLES);
      const outcome = await notifyConversationWaiting(
        {
          agencyId,
          conversationId: alert.conversationId,
          kind: alert.level === "ESCALATION" ? "HANDOFF_ESCALATED" : "HANDOFF_WAITING",
          recipientIds: recipientsFor(alert, defaultLeadOwnerId, escalationRecipientIds),
          title: handoffNotificationTitle(alert),
        },
        db,
      );
      await completeFollowup(db, claim.id, { status: outcome.ok ? "SENT" : "FAILED", skipReason: outcome.ok && outcome.notified === 0 ? "NO_RECIPIENTS" : null });
      if (!outcome.ok) {
        result.failed += 1;
      } else if (alert.level === "ESCALATION") {
        result.escalationsSent += 1;
      } else {
        result.alertsSent += 1;
      }
    } catch (cause) {
      result.failed += 1;
      console.error(`Handoff alert failed for conversation ${alert.conversationId}:`, cause instanceof Error ? cause.message : "unknown error");
      await completeFollowup(db, claim.id, { status: "FAILED" }).catch(() => undefined);
    }
  }
  return result;
}
