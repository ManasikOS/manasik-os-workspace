/**
 * The reply-window reminder as a sweep (decision R9, tasks/plan.md T8). Instead of an event that sleeps until two hours before a window
 * closes, a pg_cron job runs this every few minutes: find the person-owned chats whose reply window closes within the next two hours and
 * have not been answered, and remind their owner. Nothing is sent to the customer; the reminder is an in-app staff notification.
 *
 * Every rule is the existing one. `decideWindowReminder` decides (so an answered, closed, expired or assistant-owned chat is skipped), and
 * `checkAndRemind` acts, exactly once per unanswered customer message through the follow-up ledger's unique key. Because the window is read
 * from the conversation on every run, a customer who writes again simply moves it, with no "follow the window" loop. A sweep that sees the
 * same chat a dozen times therefore still sends one notification.
 *
 * Every query names the agency. The only things read are ids, states, owner and timestamps; no message text is loaded here.
 */

import "server-only";

import { listLedgerForConversations, type FollowupLedgerRow } from "@/lib/data/conversation-followups-repository";
import type { Db } from "@/lib/data/whatsapp-repository";
import {
  WINDOW_REMINDER_LEAD_MS,
  WINDOW_REMINDER_PERSON_STATES,
  checkAndRemind,
  decideWindowReminder,
} from "@/lib/inbox/window-reminder";

/** The most chats one agency's sweep looks at in one run; the soonest-closing come first, so the rest wait for the next run. */
export const WINDOW_SWEEP_CANDIDATE_LIMIT = 200;

export interface WindowSweepSummary {
  /** Person-owned chats whose window closes within the lead time. */
  examined: number;
  /** Chats the reminder logic said to remind that were handed to `checkAndRemind`. */
  reminded: number;
  /** Chats already reminded for their latest customer message; skipped without any further work. */
  alreadyHandled: number;
  /** Chats that needed nothing: answered, assistant-owned, expired or closed. */
  skipped: number;
  notified: number;
  failed: number;
}

interface CandidateRow {
  id: string;
  state: string;
  assigned_to_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  service_window_expires_at: string | null;
}

const asDate = (value: string | null): Date | null => (value ? new Date(value) : null);

/** True when this chat already has a finished reminder that was made after the customer's latest message. */
function alreadyReminded(ledger: FollowupLedgerRow[], conversationId: string, lastInboundAt: Date | null): boolean {
  return ledger.some(
    (row) =>
      row.conversation_id === conversationId &&
      row.kind === "WINDOW_REMINDER" &&
      row.status !== "CLAIMED" && // an unfinished claim is retried by checkAndRemind, so it is not "handled"
      (!lastInboundAt || new Date(row.created_at).getTime() >= lastInboundAt.getTime()),
  );
}

export async function runWindowReminderSweepForAgency(
  db: Db,
  agencyId: string,
  options: { now?: Date; deadlineMs?: number } = {},
): Promise<WindowSweepSummary> {
  const now = options.now ?? new Date();
  const summary: WindowSweepSummary = { examined: 0, reminded: 0, alreadyHandled: 0, skipped: 0, notified: 0, failed: 0 };

  const { data, error } = await db
    .from("conversations")
    .select("id, state, assigned_to_id, last_inbound_at, last_outbound_at, service_window_expires_at")
    .eq("agency_id", agencyId)
    .in("state", [...WINDOW_REMINDER_PERSON_STATES])
    .gt("service_window_expires_at", now.toISOString())
    .lte("service_window_expires_at", new Date(now.getTime() + WINDOW_REMINDER_LEAD_MS).toISOString())
    .order("service_window_expires_at", { ascending: true })
    .limit(WINDOW_SWEEP_CANDIDATE_LIMIT);
  if (error) throw new Error(`Could not list chats whose reply window is closing: ${error.message}`);

  const rows = (data ?? []) as CandidateRow[];
  summary.examined = rows.length;
  if (rows.length === WINDOW_SWEEP_CANDIDATE_LIMIT) {
    console.warn(`Reply-window sweep for agency ${agencyId} hit its ${WINDOW_SWEEP_CANDIDATE_LIMIT}-chat limit; the rest wait for the next run.`);
  }

  const due: Array<{ row: CandidateRow; closesAt: Date; lastInboundAt: Date | null }> = [];
  for (const row of rows) {
    const closesAt = asDate(row.service_window_expires_at);
    if (!closesAt) continue;
    const lastInboundAt = asDate(row.last_inbound_at);
    const decision = decideWindowReminder({
      conversation: {
        state: row.state,
        assignedToId: row.assigned_to_id,
        lastInboundAt,
        lastOutboundAt: asDate(row.last_outbound_at),
        serviceWindowExpiresAt: closesAt,
      },
      expectedClosesAt: closesAt,
      now,
    });
    if (decision.action === "REMIND") due.push({ row, closesAt, lastInboundAt });
    else summary.skipped += 1;
  }
  if (due.length === 0) return summary;

  const ledger = await listLedgerForConversations(
    db,
    agencyId,
    due.map((item) => item.row.id),
  );

  for (const item of due) {
    if (alreadyReminded(ledger, item.row.id, item.lastInboundAt)) {
      summary.alreadyHandled += 1;
      continue;
    }
    if (options.deadlineMs !== undefined && Date.now() >= options.deadlineMs) break; // the rest wait for the next run
    try {
      const outcome = await checkAndRemind(db, { agencyId, conversationId: item.row.id, expectedClosesAt: item.closesAt, now });
      if (outcome.action === "REMIND") {
        if (outcome.alreadySent) summary.alreadyHandled += 1;
        else {
          summary.reminded += 1;
          summary.notified += outcome.notified;
        }
      } else {
        summary.skipped += 1;
      }
    } catch (cause) {
      summary.failed += 1;
      // Only the kind of error is logged: a database message can quote a value from the row it failed on.
      console.error(`Reply-window reminder failed for a chat in agency ${agencyId}:`, cause instanceof Error ? cause.name : "unknown error");
    }
  }
  return summary;
}
