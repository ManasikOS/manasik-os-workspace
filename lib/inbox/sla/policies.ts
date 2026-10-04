/**
 * The SLA policy table — MI2.6 of docs/inbox/implementation-plan.md (Architecture §16 R2). Pure and client-safe.
 *
 * `DEFAULT_SLA_POLICIES` is R2's table verbatim; the migration seeds `inbox_sla_policies` from the same numbers (a test
 * compares them), and an agency with a missing row — one created after the seed — falls back to these, so a new agency
 * is never without targets. Per-queue edits are stored per agency and override the default.
 *
 * Units: every target is MINUTES on the queue's own clock. R2's "24 h" on an always-on queue is 1 440 wall minutes;
 * "3 business days" on a business-hours queue is 1 440 OPEN minutes (three 8-hour days). A business-hours "24 h" is read
 * the same literal way, as 24 open hours. An owner whose day is longer or shorter edits the minutes.
 */

import { z } from "zod";

import { SLA_INTERVENTION_QUEUE_CODES, queueCodeSchema, type QueueCode } from "@/lib/inbox/intelligence/contracts";
import { SLA_CLOCKS, type SlaPolicy } from "@/lib/inbox/sla/due-at";

const policy = (queueCode: QueueCode, firstReplyMinutes: number | null, resolutionMinutes: number | null, clock: SlaPolicy["clock"]): SlaPolicy => ({
  queueCode,
  firstReplyMinutes,
  resolutionMinutes,
  clock,
  // Architecture §16 R2 rule 3: only these four queues open an intervention on a breach; the rest only raise a signal.
  opensInterventionOnBreach: (SLA_INTERVENTION_QUEUE_CODES as readonly QueueCode[]).includes(queueCode),
});

/** Architecture §16 R2, row for row. Paused queues (`WAITING_CUSTOMER`, `WAITING_TEAM`, `RESOLVED`) have no policy by design. */
export const DEFAULT_SLA_POLICIES: readonly SlaPolicy[] = [
  policy("ESCALATIONS", 15, 24 * 60, "ALWAYS"),
  policy("COMPLAINTS", 15, 24 * 60, "ALWAYS"),
  policy("BOOKING_READY", 15, 4 * 60, "BUSINESS_HOURS"),
  policy("PAYMENT_DISCUSSIONS", 30, 4 * 60, "BUSINESS_HOURS"),
  policy("NEW_ENQUIRIES", 30, 8 * 60, "BUSINESS_HOURS"),
  policy("NEEDS_REPLY", 60, null, "BUSINESS_HOURS"),
  policy("DEPARTURE_CHANGES", 2 * 60, 24 * 60, "BUSINESS_HOURS"),
  policy("GROUP_CHANGES", 2 * 60, 24 * 60, "BUSINESS_HOURS"),
  policy("QUALIFIED", 2 * 60, 48 * 60, "BUSINESS_HOURS"),
  policy("QUOTE_SENT", 2 * 60, 48 * 60, "BUSINESS_HOURS"),
  policy("DOCUMENTS", 4 * 60, 3 * 8 * 60, "BUSINESS_HOURS"),
  policy("VISA_ISSUES", 4 * 60, 3 * 8 * 60, "BUSINESS_HOURS"),
];

export const SLA_POLICY_QUEUE_CODES = DEFAULT_SLA_POLICIES.map((entry) => entry.queueCode);

/** Upper bound on any target: 60 days of minutes. A typo of an extra zero should be rejected, not stored. */
export const MAX_SLA_MINUTES = 60 * 24 * 60;

const minutesField = z.number().int().min(1, "Enter at least 1 minute").max(MAX_SLA_MINUTES, "That is longer than 60 days").nullable();

/** What the settings form submits for one queue. */
export const slaPolicyInputSchema = z.object({
  queueCode: queueCodeSchema.refine((code) => SLA_POLICY_QUEUE_CODES.includes(code), "This queue has no reply target"),
  firstReplyMinutes: minutesField,
  resolutionMinutes: minutesField,
  clock: z.enum(SLA_CLOCKS),
  opensInterventionOnBreach: z.boolean(),
});
export type SlaPolicyInput = z.infer<typeof slaPolicyInputSchema>;

interface PolicyRow {
  queue_code: string;
  first_reply_minutes: number | null;
  resolution_minutes: number | null;
  clock: string;
  opens_intervention_on_breach: boolean;
}

/** Defaults overlaid with an agency's stored rows. A row that does not parse is ignored, not trusted. */
export function mergeSlaPolicies(rows: readonly PolicyRow[]): Map<QueueCode, SlaPolicy> {
  const merged = new Map<QueueCode, SlaPolicy>(DEFAULT_SLA_POLICIES.map((entry) => [entry.queueCode, entry]));
  for (const row of rows) {
    const parsed = slaPolicyInputSchema.safeParse({
      queueCode: row.queue_code,
      firstReplyMinutes: row.first_reply_minutes,
      resolutionMinutes: row.resolution_minutes,
      clock: row.clock,
      opensInterventionOnBreach: row.opens_intervention_on_breach,
    });
    if (parsed.success) merged.set(parsed.data.queueCode, parsed.data);
  }
  return merged;
}
