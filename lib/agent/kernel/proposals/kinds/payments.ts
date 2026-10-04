/**
 * Payments proposal kinds — plan §4.14. Native v2 executors, `module:
 * "finance"`, `subjectType: "BOOKING"`, backed by `loadBookingPack()`
 * (`../booking-pack.ts`) — the first module outside departure-groups to use
 * the v2 contract directly instead of going through `groupExecutor()`'s
 * legacy adapter (Phase 0 (P0.2) exit criterion: "a test proposal on
 * subject BOOKING approves end-to-end").
 *
 * All three still call exactly one existing mutator each — `mutate()` (via
 * `createGroupTaskInStore`) for the two that stage a task, a direct
 * `payment_reminders` status flip for the one that doesn't. None of them
 * calls `changeMilestoneDueDate`, sends a message, or waives/discounts
 * anything — those stay Class 3 (no tool exists), per plan §4.14 "Never".
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import { createGroupTaskInStore } from "@/lib/data/departure-groups-tasks";
import { loadBookingPack, type BookingContextPack } from "@/lib/agent/kernel/proposals/booking-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── PAYMENT_PLAN_FLAG_FOR_REVIEW ─────────────────────────────────────────── */

const FlagForReviewSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  bookingReference: z.string().min(1),
  contactName: z.string().min(1),
  overdueMilestoneCount: z.number().int().min(2),
  outstandingBalance: z.number().min(0),
  taskTitle: z.string().min(1).max(120),
  ownerName: z.string().min(1),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.string(),
});
type FlagForReviewPayload = z.infer<typeof FlagForReviewSchema>;

export const paymentPlanFlagForReviewExecutor: ProposalExecutor<FlagForReviewPayload, BookingContextPack> = {
  kind: "PAYMENT_PLAN_FLAG_FOR_REVIEW",
  module: "finance",
  subjectType: "BOOKING",
  schema: FlagForReviewSchema,
  requiredCapability: "recordPayments",
  risk: "MEDIUM",
  ttlHours: 72,
  loadPack: loadBookingPack,
  // One open proposal per booking — a second review pass over the same
  // still-unresolved account shouldn't queue a duplicate ask.
  fingerprint: (p) => `PAYMENT_PLAN_FLAG_FOR_REVIEW:${p.bookingId}`,
  dependencySnapshot: (_p, pack) => ({
    overdueMilestoneCount: pack.facts.overdueMilestoneCount,
    outstandingBalance: pack.facts.outstandingBalance,
  }),
  describe: (p) => ({
    humanDiff: [
      { field: "task", from: null, to: p.taskTitle },
      { field: "assigned to", from: null, to: p.ownerName },
    ],
  }),
  execute: (p, ctx) =>
    mutate(
      [p.departureGroupId],
      (store, actor) =>
        createGroupTaskInStore(
          store,
          {
            departureGroupId: p.departureGroupId,
            title: p.taskTitle,
            description: `Booking ${p.bookingReference} (${p.contactName}) has ${p.overdueMilestoneCount} overdue instalments, ${p.outstandingBalance.toLocaleString()} outstanding. Worth a restructure conversation.`,
            ownerName: p.ownerName,
            ownerId: p.ownerId ?? null,
            dueAt: p.dueAt,
            category: "FINANCE",
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── PAYMENT_REMINDER_SEND ────────────────────────────────────────────────── */

const ReminderSendSchema = z.object({
  reminderId: z.string().uuid(),
  bookingId: z.string().uuid(),
  bookingReference: z.string().min(1),
  milestoneLabel: z.string().min(1),
  channel: z.enum(["WHATSAPP", "EMAIL", "SMS"]),
  scheduledFor: z.string(),
  message: z.string().min(1),
});
type ReminderSendPayload = z.infer<typeof ReminderSendSchema>;

/**
 * "Approves a queued reminder" (plan §4.14) — this only flips a DRAFT
 * `payment_reminders` row to APPROVED, it never dispatches a message itself.
 * No WhatsApp/email send integration exists for finance reminders yet
 * (deferred, same posture as the metrics registry's honestly-unavailable
 * figures); wiring an approved row to an actual send channel is follow-up
 * work for whichever slice builds that integration.
 */
export const paymentReminderSendExecutor: ProposalExecutor<ReminderSendPayload, BookingContextPack> = {
  kind: "PAYMENT_REMINDER_SEND",
  module: "finance",
  subjectType: "BOOKING",
  schema: ReminderSendSchema,
  requiredCapability: "sendReminders",
  risk: "HIGH",
  ttlHours: 48,
  loadPack: loadBookingPack,
  fingerprint: (p) => `PAYMENT_REMINDER_SEND:${p.reminderId}`,
  // Re-reading the pack can't see the reminder row itself (it isn't part of
  // BookingFacts) — the milestone's own overdue/paid state is the closest
  // available signal that the reminder is still warranted; the live
  // `payment_reminders.status` check at execute time is the real guard
  // against a reminder that was already sent or skipped.
  dependencySnapshot: (_p, pack) => ({ outstandingBalance: pack.facts.outstandingBalance }),
  describe: (p) => ({
    humanDiff: [
      { field: "reminder", from: "DRAFT", to: "APPROVED" },
      { field: "channel", from: null, to: p.channel },
    ],
  }),
  execute: async (p, ctx) => {
    const { data: existing, error: fetchError } = await ctx.db
      .from("payment_reminders")
      .select("id, status")
      .eq("id", p.reminderId)
      .maybeSingle();
    if (fetchError) return { ok: false, error: fetchError.message };
    if (!existing) return { ok: false, error: "That reminder no longer exists." };
    if (existing.status !== "DRAFT") return { ok: false, error: `Reminder is already ${existing.status}, not DRAFT.` };

    const { error: updateError } = await ctx.db
      .from("payment_reminders")
      .update({ status: "APPROVED", message: p.message, approved_by: ctx.actor.id, approved_at: new Date().toISOString() })
      .eq("id", p.reminderId);
    if (updateError) return { ok: false, error: updateError.message };
    return { ok: true };
  },
};

/* ── PAYMENT_PLAN_RESCHEDULE_DRAFT ────────────────────────────────────────── */

const ProposedScheduleLineSchema = z.object({
  milestoneId: z.string().uuid(),
  milestoneLabel: z.string().min(1),
  currentDueAt: z.string().nullable(),
  proposedDueAt: z.string(),
});

const RescheduleDraftSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  bookingReference: z.string().min(1),
  contactName: z.string().min(1),
  proposedSchedule: z.array(ProposedScheduleLineSchema).min(1),
  reason: z.string().min(1),
  taskTitle: z.string().min(1).max(120),
  ownerName: z.string().min(1),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.string(),
});
type RescheduleDraftPayload = z.infer<typeof RescheduleDraftSchema>;

/**
 * Stages a proposed new schedule as a task for a human, who then performs
 * `changeMilestoneDueDate()` themselves through the existing reschedule
 * dialog — this executor never calls it directly, per plan §4.14's explicit
 * "the spec forbids AI changing due dates".
 */
export const paymentPlanRescheduleDraftExecutor: ProposalExecutor<RescheduleDraftPayload, BookingContextPack> = {
  kind: "PAYMENT_PLAN_RESCHEDULE_DRAFT",
  module: "finance",
  subjectType: "BOOKING",
  schema: RescheduleDraftSchema,
  requiredCapability: "changeMilestoneDueDates",
  risk: "HIGH",
  ttlHours: 72,
  loadPack: loadBookingPack,
  fingerprint: (p) => `PAYMENT_PLAN_RESCHEDULE_DRAFT:${p.bookingId}`,
  dependencySnapshot: (_p, pack) => ({
    milestoneDueDates: pack.facts.milestones.map((m) => ({ id: m.id, dueAt: m.dueAt })),
  }),
  describe: (p) => ({
    humanDiff: p.proposedSchedule.map((line) => ({
      field: line.milestoneLabel,
      from: line.currentDueAt,
      to: line.proposedDueAt,
    })),
  }),
  execute: (p, ctx) =>
    mutate(
      [p.departureGroupId],
      (store, actor) =>
        createGroupTaskInStore(
          store,
          {
            departureGroupId: p.departureGroupId,
            title: p.taskTitle,
            description: [
              `Proposed reschedule for ${p.bookingReference} (${p.contactName}): ${p.reason}`,
              ...p.proposedSchedule.map(
                (line) => `${line.milestoneLabel}: ${line.currentDueAt ?? "no due date"} → ${line.proposedDueAt}`,
              ),
              "Apply via the Payment Plans reschedule dialog — this task does not change any due date itself.",
            ].join("\n"),
            ownerName: p.ownerName,
            ownerId: p.ownerId ?? null,
            dueAt: p.dueAt,
            category: "FINANCE",
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};
