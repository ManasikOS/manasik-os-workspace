/**
 * What crossing a deadline does — MI2.6 of docs/inbox/implementation-plan.md (Architecture §16 R2 rule 3):
 * "A breach is a signal, not an email storm." Crossing `sla_due_at` records the `SLA_BREACHED` signal (and the queue
 * priority rises, in SQL); it opens an INTERVENTION only for `ESCALATIONS`, `COMPLAINTS`, `PAYMENT_DISCUSSIONS` and
 * `BOOKING_READY`. Pure.
 *
 * Both the signal and the intervention are idempotent downstream (a live signal for the same code is not recorded twice;
 * one open intervention per kind), so the sweep may run every two minutes without a storm. When the conversation is
 * answered (the deadline clears) the signal is superseded, never deleted; an intervention someone must still close
 * themselves, with a note — the sweep does not close a decision a person owns.
 */

import { SLA_INTERVENTION_QUEUE_CODES, type QueueCode } from "@/lib/inbox/intelligence/contracts";
import type { SlaBand, SlaBasis, SlaPolicy } from "@/lib/inbox/sla/due-at";

export interface BreachInput {
  band: SlaBand;
  basis: SlaBasis;
  /** The queue whose target set the deadline (null for the channel window). */
  deadlineQueue: QueueCode | null;
  /** Every queue the conversation is in. */
  queues: readonly QueueCode[];
  policies: ReadonlyMap<QueueCode, SlaPolicy>;
}

export interface BreachPlan {
  recordSignal: boolean;
  /** Supersede a live SLA_BREACHED signal: the conversation is no longer past its deadline. */
  supersedeSignal: boolean;
  intervention: { headline: string; guidance: string } | null;
}

const INTERVENTION_QUEUES: readonly QueueCode[] = SLA_INTERVENTION_QUEUE_CODES;

/** The queue that justifies an intervention: the one that set the deadline, else any in-scope queue the conversation is in. */
function interventionQueueFor(input: BreachInput): QueueCode | null {
  const eligible = (queue: QueueCode) => INTERVENTION_QUEUES.includes(queue) && input.policies.get(queue)?.opensInterventionOnBreach === true;
  if (input.deadlineQueue && eligible(input.deadlineQueue)) return input.deadlineQueue;
  // A channel-window breach has no queue of its own: it is as serious as the most serious in-scope queue the customer is in.
  if (input.basis === "CHANNEL_WINDOW") return input.queues.find(eligible) ?? null;
  return null;
}

export function decideBreachActions(input: BreachInput): BreachPlan {
  if (input.band !== "BREACHED") return { recordSignal: false, supersedeSignal: true, intervention: null };

  const queue = interventionQueueFor(input);
  if (!queue) return { recordSignal: true, supersedeSignal: false, intervention: null };

  const window = input.basis === "CHANNEL_WINDOW";
  return {
    recordSignal: true,
    supersedeSignal: false,
    intervention: {
      headline: window ? "This customer's messaging window is about to close" : "A reply is overdue",
      guidance: window
        ? "Reply now: once the channel's messaging window closes, only an approved template can reach this customer."
        : "The reply target for this conversation has passed. Reply, or hand it to someone who can, and note what you did when you close this review.",
    },
  };
}
