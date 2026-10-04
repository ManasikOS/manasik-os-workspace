/**
 * Bookings proposal kinds — plan §4.5. `bookingSendReminderExecutor` is
 * re-scoped here from its old implicit-group-scoping (via the
 * `groupExecutor()` legacy adapter, despite already carrying `bookingId` in
 * its own payload — the same situation P1.2 fixed for
 * `PAYMENT_PLAN_FLAG_FOR_REVIEW`) to native v2 `subjectType: "BOOKING"`,
 * backed by `loadBookingPack()` from `../booking-pack.ts`. The two new
 * kinds are additive.
 *
 * None of these three finalises anything a human hasn't reviewed —
 * `sendBookingReminderInStore` only ever records a reviewed draft to the
 * activity trail (there is no messaging gateway in this codebase, see that
 * function's own comment), and the inconsistency review only ever stages a
 * task. Per plan §4.5 "Never: Cancel, transfer, change allocation, price or
 * terms → no tool."
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import { createGroupTaskInStore } from "@/lib/data/departure-groups-tasks";
import { sendBookingReminderInStore } from "@/lib/data/departure-groups-bookings";
import { loadBookingPack, type BookingContextPack } from "@/lib/agent/kernel/proposals/booking-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── BOOKING_SEND_REMINDER (re-scoped from group to booking) ─────────────── */

const SendReminderSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  kind: z.enum(["PAYMENT", "DOCUMENT"]),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  message: z.string().min(1).max(2000),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(1),
});
type SendReminderPayload = z.infer<typeof SendReminderSchema>;

export const bookingSendReminderExecutor: ProposalExecutor<SendReminderPayload, BookingContextPack> = {
  kind: "BOOKING_SEND_REMINDER",
  module: "departure_groups",
  subjectType: "BOOKING",
  schema: SendReminderSchema,
  requiredCapability: "sendGroupCommunications",
  risk: "HIGH",
  ttlHours: 48,
  loadPack: loadBookingPack,
  fingerprint: (p) => `BOOKING_SEND_REMINDER:${p.bookingId}:${p.kind}`,
  dependencySnapshot: (_p, pack) => ({ outstandingBalance: pack.facts.outstandingBalance, overdueMilestoneCount: pack.facts.overdueMilestoneCount }),
  describe: (p) => ({
    humanDiff: [
      { field: "channel", from: null, to: p.channel },
      { field: "recipient", from: null, to: p.recipientName },
    ],
  }),
  execute: (p, ctx) =>
    mutate(
      [p.departureGroupId],
      (store, actor) =>
        sendBookingReminderInStore(
          store,
          {
            bookingId: p.bookingId,
            departureGroupId: p.departureGroupId,
            kind: p.kind,
            channel: p.channel,
            message: p.message,
            recipientName: p.recipientName,
            recipientPhone: p.recipientPhone,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── BOOKING_DOCUMENT_CHASE ───────────────────────────────────────────────── */

const DocumentChaseSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  message: z.string().min(1).max(2000),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(1),
});
type DocumentChasePayload = z.infer<typeof DocumentChaseSchema>;

/**
 * Same underlying mutator as `BOOKING_SEND_REMINDER` (kind fixed to
 * DOCUMENT) but gated by `pilgrims.sendCommunications` instead of
 * `departure_groups.sendGroupCommunications` — a document-completeness
 * nudge is triggered from the Pilgrims workflow, not the group's own
 * communications tooling, and the two roles that can approve each aren't
 * necessarily the same person.
 */
export const bookingDocumentChaseExecutor: ProposalExecutor<DocumentChasePayload, BookingContextPack> = {
  kind: "BOOKING_DOCUMENT_CHASE",
  module: "pilgrims",
  subjectType: "BOOKING",
  schema: DocumentChaseSchema,
  requiredCapability: "sendCommunications",
  risk: "HIGH",
  ttlHours: 48,
  loadPack: loadBookingPack,
  fingerprint: (p) => `BOOKING_DOCUMENT_CHASE:${p.bookingId}`,
  dependencySnapshot: (_p, pack) => ({ milestoneCount: pack.facts.milestones.length }),
  describe: (p) => ({
    humanDiff: [
      { field: "channel", from: null, to: p.channel },
      { field: "recipient", from: null, to: p.recipientName },
    ],
  }),
  execute: (p, ctx) =>
    mutate(
      [p.departureGroupId],
      (store, actor) =>
        sendBookingReminderInStore(
          store,
          {
            bookingId: p.bookingId,
            departureGroupId: p.departureGroupId,
            kind: "DOCUMENT",
            channel: p.channel,
            message: p.message,
            recipientName: p.recipientName,
            recipientPhone: p.recipientPhone,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── BOOKING_INCONSISTENCY_REVIEW ─────────────────────────────────────────── */

const InconsistencyReviewSchema = z.object({
  bookingId: z.string().uuid(),
  departureGroupId: z.string().uuid(),
  bookingReference: z.string().min(1),
  diffLines: z.array(z.string().min(1)).min(1),
  taskTitle: z.string().min(1).max(120),
  ownerName: z.string().min(1),
  ownerId: z.string().uuid().nullable().optional(),
  dueAt: z.string(),
});
type InconsistencyReviewPayload = z.infer<typeof InconsistencyReviewSchema>;

/** Stages the diff table (`lib/bookings/inconsistencies.ts`'s output) as a task — same "never fabricates, only reports" posture as every other Class-1-shaped task in this codebase. */
export const bookingInconsistencyReviewExecutor: ProposalExecutor<InconsistencyReviewPayload, BookingContextPack> = {
  kind: "BOOKING_INCONSISTENCY_REVIEW",
  module: "bookings",
  subjectType: "BOOKING",
  schema: InconsistencyReviewSchema,
  requiredCapability: "editCommercials",
  risk: "MEDIUM",
  ttlHours: 72,
  loadPack: loadBookingPack,
  fingerprint: (p) => `BOOKING_INCONSISTENCY_REVIEW:${p.bookingId}`,
  dependencySnapshot: (_p, pack) => ({ outstandingBalance: pack.facts.outstandingBalance }),
  describe: (p) => ({ humanDiff: [{ field: "task", from: null, to: p.taskTitle }] }),
  execute: (p, ctx) =>
    mutate(
      [p.departureGroupId],
      (store, actor) =>
        createGroupTaskInStore(
          store,
          {
            departureGroupId: p.departureGroupId,
            title: p.taskTitle,
            description: [`Inconsistencies found on booking ${p.bookingReference}:`, ...p.diffLines].join("\n"),
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
