/**
 * When a conversation next needs an answer — MI2.6 of docs/inbox/implementation-plan.md (Architecture §16 R2).
 * Pure: the caller passes `now`, the calendar and the facts.
 *
 * R2's three rules, as code:
 *
 *   1. THE CHANNEL WINDOW OUTRANKS EVERY TARGET. `due = least(queue_target, service_window_expires_at − 2 h)`. Missing a
 *      Meta messaging window is unrecoverable; missing an internal target is not. (The test that pins this must never
 *      be deleted.)
 *   2. THE CLOCK PAUSES while the conversation is parked on the customer (`WAITING_CUSTOMER`) or resolved. It resumes on
 *      the customer's next message and starts from THAT message — never back-dated to an earlier one — so a
 *      conversation legitimately waiting on the customer cannot manufacture a breach.
 *   3. A breach is a signal, not a storm: what to do on a breach is decided in `breach.ts`.
 *
 * One deliberate departure from R2's wording: R2 pauses the clock in `WAITING_TEAM` too. `WAITING_TEAM` is entered by
 * ANY open intervention — including the `SLA_BREACH` one a breach itself opens — so pausing there would let opening a
 * breach erase the breach. So in `WAITING_TEAM` the RESOLUTION clock is paused (someone owns the problem) but the
 * FIRST-REPLY clock keeps running while the customer's latest message is unanswered: an unanswered customer is exactly
 * what a first-reply target measures.
 *
 * Clocks: `BUSINESS_HOURS` counts only open time in the agency's calendar (so an out-of-hours `NEW_ENQUIRIES` arrival is
 * due 30 open minutes after opening, with no special case); `ALWAYS` counts wall time (a distressed customer does not
 * wait for opening hours). Resolution targets count on the same clock ("3 business days" is 1 440 open minutes, i.e.
 * three 8-hour days — a policy is minutes, not calendar days).
 */

import type { QueueCode } from "@/lib/inbox/intelligence/contracts";
import { addBusinessMinutes, type BusinessCalendar } from "@/lib/inbox/sla/business-hours";

export const SLA_CLOCKS = ["BUSINESS_HOURS", "ALWAYS"] as const;
export type SlaClock = (typeof SLA_CLOCKS)[number];

export interface SlaPolicy {
  queueCode: QueueCode;
  /** Minutes to a first reply once the customer writes; null = no first-reply target for this queue. */
  firstReplyMinutes: number | null;
  /** Minutes to resolve, counted from when the conversation entered the queue; null = none. */
  resolutionMinutes: number | null;
  clock: SlaClock;
  /** Whether crossing the deadline opens an intervention (the four queues R2 names) — not just a signal. */
  opensInterventionOnBreach: boolean;
}

/** The channel window closes for good; leave time to actually reply before it does. */
export const CHANNEL_WINDOW_BUFFER_MINUTES = 120;
/** A conversation this close to its deadline is "nearing" it. Mirrored in SQL (`compute_conversation_queues`) — a test pins both. */
export const NEARING_DEADLINE_MINUTES = 30;

/** Queues in which the resolution clock does not run. Only `WAITING_CUSTOMER` and `RESOLVED` stop the first-reply clock too — see the file header. */
const RESOLUTION_PAUSED_QUEUES: readonly QueueCode[] = ["WAITING_CUSTOMER", "WAITING_TEAM", "RESOLVED"];

export type SlaBasis = "FIRST_REPLY" | "RESOLUTION" | "CHANNEL_WINDOW" | "PAUSED" | "NONE";

export interface SlaInput {
  /** The conversation's queue memberships (from `conversation_queue_membership`) and when it entered each. */
  memberships: ReadonlyArray<{ queueCode: QueueCode; enteredAt: Date }>;
  policies: ReadonlyMap<QueueCode, SlaPolicy>;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  /** Null on channels with no messaging window. */
  serviceWindowExpiresAt: Date | null;
  calendar: BusinessCalendar | null;
  timezone: string;
}

export interface SlaDue {
  dueAt: Date | null;
  basis: SlaBasis;
  /** The queue whose policy produced the deadline (null when the channel window did, or nothing applies). */
  queueCode: QueueCode | null;
}

const NONE: SlaDue = { dueAt: null, basis: "NONE", queueCode: null };

/** The customer's latest message has not been answered by anyone. */
export function isAwaitingReply(lastInboundAt: Date | null, lastOutboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return !lastOutboundAt || lastInboundAt.getTime() > lastOutboundAt.getTime();
}

export function computeSlaDueAt(input: SlaInput): SlaDue {
  const queues = new Set(input.memberships.map((membership) => membership.queueCode));
  const awaiting = isAwaitingReply(input.lastInboundAt, input.lastOutboundAt);

  // Closed, or parked on the customer with nothing of theirs unanswered: nothing is due.
  if (queues.has("RESOLVED") || (queues.has("WAITING_CUSTOMER") && !awaiting)) return { dueAt: null, basis: "PAUSED", queueCode: null };
  const resolutionPaused = RESOLUTION_PAUSED_QUEUES.some((queue) => queues.has(queue));

  let best: SlaDue = NONE;
  const consider = (candidate: SlaDue) => {
    if (candidate.dueAt && (!best.dueAt || candidate.dueAt.getTime() < best.dueAt.getTime())) best = candidate;
  };

  for (const membership of input.memberships) {
    const policy = input.policies.get(membership.queueCode);
    if (!policy) continue;

    if (awaiting && input.lastInboundAt && policy.firstReplyMinutes !== null) {
      // Starts at the customer's LATEST message: resuming after a pause never back-dates to an earlier one.
      const dueAt = policy.clock === "ALWAYS"
        ? new Date(input.lastInboundAt.getTime() + policy.firstReplyMinutes * 60_000)
        : addBusinessMinutes(input.lastInboundAt, policy.firstReplyMinutes, input.calendar, input.timezone);
      consider({ dueAt, basis: "FIRST_REPLY", queueCode: membership.queueCode });
    }

    if (policy.resolutionMinutes !== null && !resolutionPaused) {
      const dueAt = policy.clock === "ALWAYS"
        ? new Date(membership.enteredAt.getTime() + policy.resolutionMinutes * 60_000)
        : addBusinessMinutes(membership.enteredAt, policy.resolutionMinutes, input.calendar, input.timezone);
      consider({ dueAt, basis: "RESOLUTION", queueCode: membership.queueCode });
    }
  }

  // Rule 1: the channel window outranks every target — but only while there is still something to reply to.
  if (awaiting && input.serviceWindowExpiresAt) {
    const windowDeadline = new Date(input.serviceWindowExpiresAt.getTime() - CHANNEL_WINDOW_BUFFER_MINUTES * 60_000);
    if (!best.dueAt || windowDeadline.getTime() < best.dueAt.getTime()) best = { dueAt: windowDeadline, basis: "CHANNEL_WINDOW", queueCode: null };
  }

  return best;
}

export type SlaBand = "NONE" | "NEARING" | "BREACHED";

/** Where a deadline stands against the clock. `now` at or after the deadline is a breach. */
export function slaBand(dueAt: Date | null, now: Date): SlaBand {
  if (!dueAt) return "NONE";
  const remainingMs = dueAt.getTime() - now.getTime();
  if (remainingMs <= 0) return "BREACHED";
  return remainingMs < NEARING_DEADLINE_MINUTES * 60_000 ? "NEARING" : "NONE";
}
