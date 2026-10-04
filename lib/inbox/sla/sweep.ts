/**
 * The SLA sweep — MI2.6 of docs/inbox/implementation-plan.md (Architecture §16 R2). Runs on a schedule
 * (app/api/cron/inbox-sla, every two minutes) for one agency at a time.
 *
 * Why a sweep: a deadline passes WITHOUT any row changing, so the trigger-driven queue membership cannot notice it. The
 * sweep recomputes each waiting conversation's `sla_due_at` with the pure `computeSlaDueAt()` (the ONE place the
 * business-hours arithmetic lives — SQL does not repeat it), writes it when it changed, refreshes the conversation's queue
 * membership when its deadline band no longer matches the queue it is in, and applies `decideBreachActions()`.
 *
 * `planSlaSweep` is pure and holds every decision; `runSlaSweepForAgency` only loads and applies. Bounded per run
 * (`SWEEP_CONVERSATION_LIMIT`, oldest-waiting first) so one huge agency cannot stall the cron; the remainder is
 * picked up on the next tick.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { openIntervention, recordSignals, supersedeSignals } from "@/lib/data/conversation-intelligence-repository";
import { loadSlaSettings } from "@/lib/data/inbox-sla-repository";
import { isQueueCode, type QueueCode } from "@/lib/inbox/intelligence/contracts";
import { decideBreachActions, type BreachPlan } from "@/lib/inbox/sla/breach";
import { computeSlaDueAt, slaBand, type SlaBand, type SlaPolicy } from "@/lib/inbox/sla/due-at";
import type { BusinessCalendar } from "@/lib/inbox/sla/business-hours";

export const SWEEP_CONVERSATION_LIMIT = 1000;
const ID_CHUNK = 200;

export interface SweepConversation {
  id: string;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  serviceWindowExpiresAt: Date | null;
  slaDueAt: Date | null;
  memberships: Array<{ queueCode: QueueCode; enteredAt: Date }>;
}

export interface SweepPlanItem {
  conversationId: string;
  newDueAt: Date | null;
  /** The stored `sla_due_at` must be rewritten. */
  writeDueAt: boolean;
  band: SlaBand;
  /** Queue membership no longer matches the band (or the deadline moved): refresh it. */
  refreshQueues: boolean;
  breach: BreachPlan;
}

const sameInstant = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());

/** The band the conversation's CURRENT queue membership shows. */
function bandInMembership(memberships: SweepConversation["memberships"]): SlaBand {
  if (memberships.some((membership) => membership.queueCode === "SLA_BREACHED")) return "BREACHED";
  if (memberships.some((membership) => membership.queueCode === "NEARING_DEADLINE")) return "NEARING";
  return "NONE";
}

export function planSlaSweep(input: {
  conversations: readonly SweepConversation[];
  policies: ReadonlyMap<QueueCode, SlaPolicy>;
  calendar: BusinessCalendar | null;
  timezone: string;
  now: Date;
}): SweepPlanItem[] {
  return input.conversations.map((conversation) => {
    // The deadline queues themselves carry no target; they are outputs of this sweep, not inputs to it.
    const memberships = conversation.memberships.filter((membership) => membership.queueCode !== "SLA_BREACHED" && membership.queueCode !== "NEARING_DEADLINE");
    const due = computeSlaDueAt({
      memberships,
      policies: input.policies,
      lastInboundAt: conversation.lastInboundAt,
      lastOutboundAt: conversation.lastOutboundAt,
      serviceWindowExpiresAt: conversation.serviceWindowExpiresAt,
      calendar: input.calendar,
      timezone: input.timezone,
    });
    const band = slaBand(due.dueAt, input.now);
    // Only a conversation that WAS past its deadline has a live SLA_BREACHED signal worth superseding; the rest need no write.
    const wasBreached = bandInMembership(conversation.memberships) === "BREACHED" || (conversation.slaDueAt !== null && conversation.slaDueAt.getTime() <= input.now.getTime());
    const writeDueAt = !sameInstant(due.dueAt, conversation.slaDueAt);
    return {
      conversationId: conversation.id,
      newDueAt: due.dueAt,
      writeDueAt,
      band,
      refreshQueues: writeDueAt || band !== bandInMembership(conversation.memberships),
      breach: (() => {
        const plan = decideBreachActions({ band, basis: due.basis, deadlineQueue: due.queueCode, queues: memberships.map((membership) => membership.queueCode), policies: input.policies });
        return { ...plan, supersedeSignal: plan.supersedeSignal && wasBreached };
      })(),
    };
  });
}

/* ── Loading and applying ─────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
const toDate = (value: unknown): Date | null => (typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? new Date(value) : null);

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function loadSweepConversations(db: Db, agencyId: string): Promise<SweepConversation[]> {
  // Candidates: every conversation waiting for a reply (oldest first), plus every one that already carries a deadline (so it can be cleared).
  const [waiting, withDeadline] = await Promise.all([
    db.from("conversation_queue_membership").select("conversation_id").eq("agency_id", agencyId).eq("queue_code", "NEEDS_REPLY").order("entered_at", { ascending: true }).limit(SWEEP_CONVERSATION_LIMIT),
    db.from("conversations").select("id").eq("agency_id", agencyId).not("sla_due_at", "is", null).order("sla_due_at", { ascending: true }).limit(SWEEP_CONVERSATION_LIMIT),
  ]);
  if (waiting.error) throw new Error(`Could not list waiting conversations: ${waiting.error.message}`);
  if (withDeadline.error) throw new Error(`Could not list conversations with a deadline: ${withDeadline.error.message}`);

  const ids = [...new Set([...((waiting.data ?? []) as Row[]).map((row) => String(row.conversation_id)), ...((withDeadline.data ?? []) as Row[]).map((row) => String(row.id))])];
  const conversations: SweepConversation[] = [];

  for (const idChunk of chunk(ids, ID_CHUNK)) {
    const [rows, memberships] = await Promise.all([
      db.from("conversations").select("id, last_inbound_at, last_outbound_at, service_window_expires_at, sla_due_at").eq("agency_id", agencyId).in("id", idChunk),
      db.from("conversation_queue_membership").select("conversation_id, queue_code, entered_at").eq("agency_id", agencyId).in("conversation_id", idChunk),
    ]);
    if (rows.error) throw new Error(`Could not load conversations: ${rows.error.message}`);
    if (memberships.error) throw new Error(`Could not load queue membership: ${memberships.error.message}`);

    const byConversation = new Map<string, SweepConversation["memberships"]>();
    for (const row of (memberships.data ?? []) as Row[]) {
      const queueCode = String(row.queue_code);
      if (!isQueueCode(queueCode)) continue;
      const list = byConversation.get(String(row.conversation_id)) ?? [];
      list.push({ queueCode, enteredAt: toDate(row.entered_at) ?? new Date() });
      byConversation.set(String(row.conversation_id), list);
    }
    for (const row of (rows.data ?? []) as Row[]) {
      conversations.push({
        id: String(row.id),
        lastInboundAt: toDate(row.last_inbound_at),
        lastOutboundAt: toDate(row.last_outbound_at),
        serviceWindowExpiresAt: toDate(row.service_window_expires_at),
        slaDueAt: toDate(row.sla_due_at),
        memberships: byConversation.get(String(row.id)) ?? [],
      });
    }
  }
  return conversations;
}

export interface SlaSweepSummary {
  examined: number;
  deadlinesWritten: number;
  queuesRefreshed: number;
  breached: number;
  interventionsOpened: number;
  failed: number;
}

export async function runSlaSweepForAgency(db: Db, agencyId: string, options: { now?: Date } = {}): Promise<SlaSweepSummary> {
  const now = options.now ?? new Date();
  const { policies, calendar, timezone } = await loadSlaSettings(db, agencyId);
  const conversations = await loadSweepConversations(db, agencyId);
  const plan = planSlaSweep({ conversations, policies, calendar, timezone, now });

  const summary: SlaSweepSummary = { examined: plan.length, deadlinesWritten: 0, queuesRefreshed: 0, breached: 0, interventionsOpened: 0, failed: 0 };

  for (const item of plan) {
    try {
      if (item.writeDueAt) {
        const { error } = await db.from("conversations").update({ sla_due_at: item.newDueAt ? item.newDueAt.toISOString() : null }).eq("agency_id", agencyId).eq("id", item.conversationId);
        if (error) throw new Error(`Could not save the deadline: ${error.message}`);
        summary.deadlinesWritten += 1;
      }

      if (item.breach.recordSignal) {
        await recordSignals(db, agencyId, item.conversationId, [{ signalCode: "SLA_BREACHED", messageId: null, detector: "RULE", confidence: 1, evidence: [] }]);
        summary.breached += 1;
      }
      if (item.breach.supersedeSignal) await supersedeSignals(db, agencyId, item.conversationId, { codes: ["SLA_BREACHED"] });
      if (item.breach.intervention) {
        const { created } = await openIntervention(db, agencyId, {
          conversationId: item.conversationId,
          kind: "SLA_BREACH",
          severity: "REVIEW",
          headline: item.breach.intervention.headline,
          guidance: item.breach.intervention.guidance,
          requiredActionCode: "ESCALATE_TO_HUMAN",
        });
        if (created) summary.interventionsOpened += 1;
      }

      if (item.refreshQueues) {
        const { error } = await db.rpc("refresh_conversation_queues", { p_conversation_id: item.conversationId });
        if (error) throw new Error(`Could not refresh queues: ${error.message}`);
        summary.queuesRefreshed += 1;
      }
    } catch (cause) {
      // One bad conversation must not stop the rest; the next tick retries it.
      summary.failed += 1;
      console.error(`SLA sweep failed for conversation ${item.conversationId}:`, cause instanceof Error ? cause.message : cause);
    }
  }
  return summary;
}
