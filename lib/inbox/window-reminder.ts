/**
 * The reply-window reminder: tell the person who owns a conversation that its reply window is about to close on a customer nobody has
 * answered. Nothing is sent to the customer; this only writes an in-app notification.
 *
 * `decideWindowReminder` holds every rule and is pure. `checkAndRemind` loads what it needs (always re-reading from Postgres, scoped by
 * agency), decides, and acts, exactly once per unanswered customer message through the follow-up ledger. The pg_cron sweep
 * (`lib/inbox/window-sweep.ts`, run by `/api/cron/reply-window-sweep`) finds the chats and calls this; it used to be called by an Inngest
 * function that slept until two hours before the window closed (decision R9 replaced that).
 */

import "server-only";

import { claimFollowup, completeFollowup } from "@/lib/data/conversation-followups-repository";
import { listActiveStaffIdsByRole, notifyConversationWaiting } from "@/lib/data/staff-notifications";
import type { Db } from "@/lib/data/whatsapp-repository";
import { channelDisplayName } from "@/lib/inbox/composer-state";

/** How long before the window closes the owner is told. */
export const WINDOW_REMINDER_LEAD_MS = 2 * 60 * 60_000;
/** Roles told when a chat has no owner and the agency has no default lead owner. */
const FALLBACK_ROLES = ["ADMIN", "CEO"] as const;
/** A window slides forward each time the customer writes; a reminder follows it at most this many times. */
export const WINDOW_REMINDER_MAX_ROUNDS = 4;

export interface WindowReminderConversation {
  state: string;
  assignedToId: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  serviceWindowExpiresAt: Date | null;
}

export type WindowReminderDecision =
  | { action: "REMIND" }
  /** The customer wrote again and the window moved: sleep until the new closing time and look again. */
  | { action: "EXTENDED"; closesAt: Date }
  | { action: "SKIP"; reason: "not_found" | "closed" | "assistant_owns" | "answered" | "expired" };

/** The conversation states in which a person owns the chat; the reminder only ever applies to these. */
export const WINDOW_REMINDER_PERSON_STATES = ["HUMAN_REQUESTED", "HUMAN_ACTIVE"] as const;
const PERSON_STATES = new Set<string>(WINDOW_REMINDER_PERSON_STATES);

export function decideWindowReminder(input: { conversation: WindowReminderConversation | null; expectedClosesAt: Date; now: Date }): WindowReminderDecision {
  const { conversation, expectedClosesAt, now } = input;
  if (!conversation) return { action: "SKIP", reason: "not_found" };
  if (conversation.state === "CLOSED") return { action: "SKIP", reason: "closed" };
  // The window is what it is NOW, not what the event said: a customer who wrote since has moved it.
  const closes = conversation.serviceWindowExpiresAt;
  if (closes && closes.getTime() > expectedClosesAt.getTime() + 60_000) return { action: "EXTENDED", closesAt: closes };
  if (!closes || closes.getTime() <= now.getTime()) return { action: "SKIP", reason: "expired" };
  if (!PERSON_STATES.has(conversation.state)) return { action: "SKIP", reason: "assistant_owns" };
  // Answered: our last outbound message is not older than the customer's last one.
  if (conversation.lastInboundAt && conversation.lastOutboundAt && conversation.lastOutboundAt.getTime() >= conversation.lastInboundAt.getTime()) {
    return { action: "SKIP", reason: "answered" };
  }
  return { action: "REMIND" };
}

export function windowReminderTitle(input: { contactName: string; channel: string; minutesLeft: number }): string {
  const who = input.contactName.trim() || "A customer";
  const hours = Math.floor(input.minutesLeft / 60);
  const minutes = input.minutesLeft % 60;
  const left = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${who} on ${channelDisplayName(input.channel)} has not had a reply and the reply window closes in ${left}`;
}

interface ConversationRow {
  channel: string;
  state: string;
  contact_name: string | null;
  assigned_to_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  service_window_expires_at: string | null;
}

const asDate = (value: string | null): Date | null => (value ? new Date(value) : null);

export type WindowReminderOutcome =
  | { action: "REMIND"; notified: number; alreadySent: boolean }
  | { action: "EXTENDED"; closesAt: string }
  | { action: "SKIP"; reason: string };

/**
 * Re-reads the conversation, decides, and (only when a reminder is due) notifies the owner. Safe to run again: the ledger's unique key
 * (conversation, kind, sequence, anchor message) means a retry after a crash finishes an unfinished claim and never sends twice.
 */
export async function checkAndRemind(
  db: Db,
  input: { agencyId: string; conversationId: string; expectedClosesAt: Date; now?: Date },
): Promise<WindowReminderOutcome> {
  const now = input.now ?? new Date();
  const { data, error } = await db
    .from("conversations")
    .select("channel, state, contact_name, assigned_to_id, last_inbound_at, last_outbound_at, service_window_expires_at")
    .eq("agency_id", input.agencyId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the conversation for a window reminder: ${error.message}`);
  const row = data as ConversationRow | null;

  const decision = decideWindowReminder({
    conversation: row
      ? {
          state: row.state,
          assignedToId: row.assigned_to_id,
          lastInboundAt: asDate(row.last_inbound_at),
          lastOutboundAt: asDate(row.last_outbound_at),
          serviceWindowExpiresAt: asDate(row.service_window_expires_at),
        }
      : null,
    expectedClosesAt: input.expectedClosesAt,
    now,
  });
  if (decision.action === "EXTENDED") return { action: "EXTENDED", closesAt: decision.closesAt.toISOString() };
  if (decision.action === "SKIP" || !row) return { action: "SKIP", reason: decision.action === "SKIP" ? decision.reason : "not_found" };

  // The unanswered customer message the reminder is about: the ledger's anchor, so a later unanswered message re-arms it.
  const { data: anchor, error: anchorError } = await db
    .from("conversation_messages")
    .select("id")
    .eq("agency_id", input.agencyId)
    .eq("conversation_id", input.conversationId)
    .eq("actor_kind", "CUSTOMER")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anchorError) throw new Error(`Could not find the customer message for a window reminder: ${anchorError.message}`);
  const anchorMessageId = (anchor as { id: string } | null)?.id;
  if (!anchorMessageId) return { action: "SKIP", reason: "no_customer_message" };

  const claim = await claimFollowup(db, {
    agencyId: input.agencyId,
    conversationId: input.conversationId,
    leadId: null,
    kind: "WINDOW_REMINDER",
    sequence: 1,
    anchorMessageId,
    channel: row.channel,
    status: "CLAIMED",
  });
  let ledgerId: string;
  if (claim.claimed) {
    ledgerId = claim.id;
  } else {
    // Already claimed. If that run finished, there is nothing to do; if it crashed before finishing, finish it.
    const { data: existing, error: existingError } = await db
      .from("conversation_followups")
      .select("id, status")
      .eq("agency_id", input.agencyId)
      .eq("conversation_id", input.conversationId)
      .eq("kind", "WINDOW_REMINDER")
      .eq("sequence", 1)
      .eq("anchor_message_id", anchorMessageId)
      .maybeSingle();
    if (existingError) throw new Error(`Could not read the window reminder ledger: ${existingError.message}`);
    const previous = existing as { id: string; status: string } | null;
    if (!previous || previous.status !== "CLAIMED") return { action: "REMIND", notified: 0, alreadySent: true };
    ledgerId = previous.id;
  }

  const { data: settings } = await db.from("ai_settings").select("default_lead_owner_id").eq("agency_id", input.agencyId).maybeSingle();
  const defaultOwner = (settings as { default_lead_owner_id: string | null } | null)?.default_lead_owner_id ?? null;
  const owner = row.assigned_to_id ?? defaultOwner;
  const recipients = owner ? [owner] : await listActiveStaffIdsByRole(db, input.agencyId, FALLBACK_ROLES);

  const closes = asDate(row.service_window_expires_at)!;
  const minutesLeft = Math.max(0, Math.round((closes.getTime() - now.getTime()) / 60_000));
  const outcome = await notifyConversationWaiting(
    {
      agencyId: input.agencyId,
      conversationId: input.conversationId,
      kind: "REPLY_WINDOW_CLOSING",
      recipientIds: [...new Set(recipients)],
      title: windowReminderTitle({ contactName: row.contact_name ?? "", channel: row.channel, minutesLeft }),
    },
    db,
  );
  await completeFollowup(db, ledgerId, { status: outcome.ok ? "SENT" : "FAILED", skipReason: outcome.ok && outcome.notified === 0 ? "NO_RECIPIENTS" : null });
  if (!outcome.ok) throw new Error("The window reminder notification could not be written.");
  return { action: "REMIND", notified: outcome.notified, alreadySent: false };
}
