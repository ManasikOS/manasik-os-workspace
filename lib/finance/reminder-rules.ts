/**
 * Deterministic reminder cadence — plan §4.14: "generated daily by rule (T-3,
 * T0, T+3, T+10)". Pure date arithmetic, no model call — the AI layer only
 * ever drafts the *wording* of an already-scheduled reminder
 * (`lib/ai/surfaces/finance/payment-plan-workflows.ts`'s `draftReminder`),
 * never decides whether or when to send one.
 */

export const REMINDER_OFFSET_DAYS = [-3, 0, 3, 10] as const;
export type ReminderOffsetDays = (typeof REMINDER_OFFSET_DAYS)[number];

export type ReminderChannel = "WHATSAPP" | "EMAIL" | "SMS";

function startOfDayMs(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function addDays(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

/**
 * Which cadence offsets are "due today" for an instalment with this due
 * date, evaluated against `nowIso`'s calendar date (UTC). Comparing whole
 * days (not instants) keeps this safe to run once per day regardless of
 * what time the job runs at.
 */
export function reminderOffsetsDueOn(dueAt: string, nowIso: string): ReminderOffsetDays[] {
  const today = startOfDayMs(nowIso);
  const due = startOfDayMs(dueAt);
  return REMINDER_OFFSET_DAYS.filter((offset) => addDays(due, offset) === today);
}

/** T-3 reminders default to a lower-friction channel; T+10 (default risk) escalates. */
export function defaultChannelForOffset(offset: ReminderOffsetDays): ReminderChannel {
  return offset >= 10 ? "EMAIL" : "WHATSAPP";
}

export function scheduledForFromOffset(dueAt: string, offset: ReminderOffsetDays): string {
  return new Date(addDays(startOfDayMs(dueAt), offset)).toISOString();
}
