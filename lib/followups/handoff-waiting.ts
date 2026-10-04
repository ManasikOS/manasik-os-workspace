/**
 * Which conversations have a customer waiting on a person, and who should be told. Pure — the sweep hands
 * in already-loaded rows so every rule is unit-testable (Phase 1 of
 * docs/modules/lead-retention-followups-implementation-plan.md).
 *
 * "Waiting" is measured from the FIRST unanswered customer message, never the latest: a customer who keeps
 * writing must not keep postponing the alert. That first message is the ledger's anchor, so once staff reply
 * the next unanswered message becomes a new anchor and alerts re-arm by themselves.
 */

import { channelDisplayName } from "@/lib/inbox/composer-state";

export type HandoffAlertLevel = "ALERT" | "ESCALATION";

export interface WaitingConversationRow {
  conversationId: string;
  channel: string;
  state: string;
  contactName: string;
  assignedToId: string | null;
  /** The earliest customer message newer than our last outbound message; null when there is none. */
  firstUnansweredMessageId: string | null;
  firstUnansweredAt: string | null;
}

export interface HandoffThresholds {
  alertMinutes: number;
  escalationMinutes: number;
}

export interface DueHandoffAlert {
  conversationId: string;
  anchorMessageId: string;
  channel: string;
  contactName: string;
  assignedToId: string | null;
  level: HandoffAlertLevel;
  minutesWaiting: number;
}

/** Conversation states where a person owns, or has been asked to own, the thread. */
const PERSON_STATES = new Set(["HUMAN_REQUESTED", "HUMAN_ACTIVE"]);

/** Every alert that is due right now. A conversation past the escalation time yields both levels (the ledger de-duplicates). */
export function findWaitingConversations(rows: WaitingConversationRow[], now: Date, thresholds: HandoffThresholds): DueHandoffAlert[] {
  const due: DueHandoffAlert[] = [];
  for (const row of rows) {
    if (!PERSON_STATES.has(row.state)) continue;
    if (!row.firstUnansweredMessageId || !row.firstUnansweredAt) continue;

    const waitingMs = now.getTime() - new Date(row.firstUnansweredAt).getTime();
    if (!Number.isFinite(waitingMs) || waitingMs < 0) continue;
    const minutesWaiting = Math.floor(waitingMs / 60_000);

    const base = {
      conversationId: row.conversationId,
      anchorMessageId: row.firstUnansweredMessageId,
      channel: row.channel,
      contactName: row.contactName,
      assignedToId: row.assignedToId,
      minutesWaiting,
    };
    if (minutesWaiting >= thresholds.alertMinutes) due.push({ ...base, level: "ALERT" });
    if (minutesWaiting >= thresholds.escalationMinutes) due.push({ ...base, level: "ESCALATION" });
  }
  return due;
}

/**
 * Who is told. An alert goes to the assignee, else the agency's default lead owner, else the escalation
 * roles (Admin/CEO). An escalation always goes to the escalation roles.
 */
export function recipientsFor(
  alert: Pick<DueHandoffAlert, "level" | "assignedToId">,
  defaultLeadOwnerId: string | null,
  escalationRecipientIds: string[],
): string[] {
  if (alert.level === "ESCALATION") return [...new Set(escalationRecipientIds)];
  const owner = alert.assignedToId ?? defaultLeadOwnerId;
  return owner ? [owner] : [...new Set(escalationRecipientIds)];
}

/** Plain-words notification title (AGENTS.md: text everyone understands). */
export function handoffNotificationTitle(alert: Pick<DueHandoffAlert, "level" | "contactName" | "channel" | "minutesWaiting">): string {
  const name = alert.contactName.trim() || "A customer";
  const channel = channelDisplayName(alert.channel);
  return alert.level === "ESCALATION"
    ? `Still waiting: ${name} on ${channel} for ${alert.minutesWaiting} min`
    : `${name} is waiting for a reply on ${channel} — ${alert.minutesWaiting} min`;
}
