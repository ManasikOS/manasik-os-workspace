/**
 * Context Pack loader for `subjectType: "BOOKING"` — Phase 1 (P1.2). First
 * native v2 pack outside departure-groups (see `group-executor.ts`'s
 * `loadGroupPack` for the precedent this follows). Backs the three payments
 * proposal kinds in `kinds/payments.ts`: `PAYMENT_PLAN_FLAG_FOR_REVIEW`,
 * `PAYMENT_REMINDER_SEND`, `PAYMENT_PLAN_RESCHEDULE_DRAFT`.
 */

import "server-only";

import { hashObject } from "@/lib/agent/kernel/hash";
import { buildContextPack, type ContextPack, type Db } from "@/lib/agent/kernel/proposals/context-pack";
import { computeCollectionRisk, type CollectionRiskResult } from "@/lib/finance/collection-risk";

export interface BookingPackMilestone {
  id: string;
  label: string;
  amount: number;
  paidAmount: number;
  dueAt: string | null;
  waived: boolean;
  rescheduled: boolean;
}

export interface BookingFacts {
  bookingId: string;
  bookingReference: string;
  contactName: string;
  bookingStatus: string;
  departureGroupId: string;
  departureGroupName: string;
  currency: string;
  milestones: BookingPackMilestone[];
  overdueMilestoneCount: number;
  outstandingBalance: number;
  collectionRisk: CollectionRiskResult;
}

export type BookingContextPack = ContextPack<BookingFacts>;

interface BookingRow {
  id: string;
  booking_reference: string;
  primary_contact_name: string;
  booking_status: string;
  departure_group_id: string;
  departure_groups: { group_name: string } | null;
}

interface MilestoneRow {
  id: string;
  label: string;
  amount: number;
  paid_amount: number;
  due_at: string | null;
  waived: boolean;
  due_at_previous: string | null;
}

export async function loadBookingPack(subjectId: string, _agencyId: string, db: Db): Promise<BookingContextPack | null> {
  const { data: booking, error: bookingError } = await db
    .from("departure_group_bookings")
    .select(
      `id, booking_reference, primary_contact_name, booking_status, departure_group_id,
       departure_groups:departure_group_id ( group_name )`,
    )
    .eq("id", subjectId)
    .maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking) return null;
  const bookingRow = booking as unknown as BookingRow;

  const { data: milestoneRows, error: milestonesError } = await db
    .from("booking_payment_milestones")
    .select("id, label, amount, paid_amount, due_at, waived, due_at_previous, currency")
    .eq("booking_id", subjectId)
    .order("sequence", { ascending: true });
  if (milestonesError) throw milestonesError;

  const rawMilestones = (milestoneRows ?? []) as unknown as (MilestoneRow & { currency: string | null })[];
  const currency = rawMilestones[0]?.currency ?? "LKR";

  const milestones: BookingPackMilestone[] = rawMilestones.map((m) => ({
    id: m.id,
    label: m.label,
    amount: m.amount,
    paidAmount: m.paid_amount,
    dueAt: m.due_at,
    waived: m.waived,
    rescheduled: m.due_at_previous !== null,
  }));

  const nowIso = new Date().toISOString();
  const overdueMilestoneCount = milestones.filter(
    (m) => !m.waived && m.dueAt !== null && Date.parse(m.dueAt) <= Date.parse(nowIso) && m.paidAmount < m.amount,
  ).length;
  const outstandingBalance = milestones.reduce((sum, m) => sum + Math.max(0, m.amount - m.paidAmount), 0);
  const collectionRisk = computeCollectionRisk(milestones, nowIso);

  const facts: BookingFacts = {
    bookingId: bookingRow.id,
    bookingReference: bookingRow.booking_reference,
    contactName: bookingRow.primary_contact_name,
    bookingStatus: bookingRow.booking_status,
    departureGroupId: bookingRow.departure_group_id,
    departureGroupName: bookingRow.departure_groups?.group_name ?? "—",
    currency,
    milestones,
    overdueMilestoneCount,
    outstandingBalance,
    collectionRisk,
  };

  return buildContextPack<BookingFacts>({
    subject: {
      type: "BOOKING",
      id: subjectId,
      label: `${bookingRow.booking_reference} (${bookingRow.primary_contact_name})`,
      href: `/departure-groups/${bookingRow.departure_group_id}/bookings/${subjectId}`,
    },
    facts,
    fingerprint: hashObject(facts),
  });
}
