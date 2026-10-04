/**
 * Per-pilgrim pricing — the money half of traveller customisation.
 *
 * Pure, store-passing and testable, same posture as `departure-groups-bookings.ts`.
 * The product rule this file enforces:
 *
 *   A booking's total is the sum of its pilgrims' live (non-voided) charge
 *   lines. `package_price_per_person * traveller_count` is no longer computed
 *   directly — `createGroupBookingInStore` seeds one BASE_FARE line per
 *   traveller and this module's `recomputeBookingTotalsInStore` derives the
 *   booking's money columns from those lines on every change, so the two can
 *   never drift apart (see invariant 1 in the implementation plan).
 *
 * A charge is never deleted — `voided_at` — mirroring the same rule
 * `finance_adjustments` and `payments` already carry: a money record is
 * corrected, not erased.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import {
  derivePaymentStatus,
  money,
  resolveNextMilestoneDueDate,
  sumBillableChargeLines,
} from "@/lib/data/departure-groups-money";
import type {
  ChargeType,
  DepartureGroupPilgrimChargeRow,
  DepartureGroupStore,
  GroupActor,
  RoomType,
} from "@/lib/types/departure-groups";

export type ChargeMutationOutcome =
  | { ok: true; charge: DepartureGroupPilgrimChargeRow }
  | { ok: false; error: string };

const NEGATIVE_TYPES: ChargeType[] = ["DISCOUNT"];
const NON_NEGATIVE_TYPES: ChargeType[] = [
  "BASE_FARE",
  "ROOM_UPGRADE",
  "EXTRA_NIGHTS",
  "FLIGHT_VARIATION",
  "TRANSPORT_VARIATION",
  "ADDON",
  "SURCHARGE",
  "CANCELLATION_FEE",
];

/**
 * Recomputes `total_price` for one traveller (returned, not written — callers
 * decide whether they need it) and the owning booking's
 * `total_booking_value` / `outstanding_balance` / payment status from the
 * live charge lines of every traveller on it. Called after every insert,
 * void or approval so the booking never disagrees with its own charge lines.
 */
export function recomputeBookingTotalsInStore(
  data: DepartureGroupStore,
  bookingId: string,
  now: string,
): void {
  const booking = data.bookings.find((b) => b.id === bookingId);
  if (!booking) return;

  const pilgrims = data.pilgrims.filter((p) => p.booking_id === bookingId);
  // Billable only — a charge still awaiting approval (see
  // `requestPilgrimCustomisation`) is a quote, not a debt, and must not move
  // the booking's total until `decideDeviationInStore` approves it.
  const total = money(
    pilgrims.reduce((sum, p) => {
      const lines = data.pilgrimCharges.filter((c) => c.group_pilgrim_id === p.id);
      return sum + sumBillableChargeLines(lines);
    }, 0),
  );

  booking.total_booking_value = total;
  // A void/discount can bring the total below what was already collected —
  // never let the outstanding balance go negative; that overpayment is a
  // refund conversation, not a debt that reads as settled.
  booking.outstanding_balance = money(Math.max(total - booking.amount_paid, 0));
  // package_price_per_person keeps reporting a single blended rate for
  // screens that still read it (the "add booking" recap, CSV exports); it is
  // no longer authoritative once charges diverge per traveller.
  if (pilgrims.length > 0) {
    booking.package_price_per_person = money(total / pilgrims.length);
  }

  /**
   * A charge added to a booking that was already paid in full reopens a
   * balance with no due date — `recordBookingPaymentInStore` nulls
   * `next_due_at` on paid-in-full, and nothing here used to put it back. That
   * left the new balance permanently invisible to `buildPaymentSummary`'s
   * overdue filter (which requires `next_due_at !== null`) and to reminders,
   * however far past departure it sat. Mirrors the same fix already applied
   * to a booking reprice in `changeBookingRoomPreferenceInStore`.
   */
  if (booking.outstanding_balance <= 0) {
    booking.next_due_at = null;
  } else if (!booking.next_due_at) {
    const group = data.groups.find((g) => g.id === booking.departure_group_id);
    if (group) {
      const milestones =
        data.pricing.find((p) => p.departure_group_id === group.id)
          ?.payment_milestones ?? [];
      booking.next_due_at = resolveNextMilestoneDueDate(
        milestones,
        booking.total_booking_value,
        booking.amount_paid,
        group.departure_date,
        now,
      );
    }
  }

  // Payment allocation across travellers on the same booking is not tracked
  // separately (see Phase 7 of the implementation plan): a partial payment on
  // a shared booking cannot be attributed to one traveller over another, so
  // every traveller on the booking reads the *booking's* status, exactly as
  // before charges existed — never each traveller's own total against the
  // whole amount paid, which would independently mark every traveller
  // "paid in full" the moment the booking crosses their own price alone.
  const nowMs = Date.parse(now);
  const bookingStatus = derivePaymentStatus(
    booking.total_booking_value,
    booking.amount_paid,
    booking.next_due_at,
    nowMs,
  );
  for (const p of pilgrims) {
    if (p.payment_status === "REFUND_PENDING") continue;
    p.payment_status = bookingStatus;
  }
}

/** Whether a traveller has anything beyond a bare base fare. */
export function recomputeHasCustomisationsInStore(
  data: DepartureGroupStore,
  pilgrimId: string,
): void {
  const pilgrim = data.pilgrims.find((p) => p.id === pilgrimId);
  if (!pilgrim) return;
  const hasExtraCharge = data.pilgrimCharges.some(
    (c) =>
      c.group_pilgrim_id === pilgrimId &&
      c.voided_at === null &&
      c.charge_type !== "BASE_FARE",
  );
  const hasOpenDeviation = data.pilgrimDeviations.some(
    (d) =>
      d.group_pilgrim_id === pilgrimId &&
      d.status !== "DECLINED" &&
      d.status !== "CANCELLED",
  );
  pilgrim.has_customisations = hasExtraCharge || hasOpenDeviation;
}

export interface BuildBaseFareInput {
  departureGroupId: string;
  bookingId: string;
  groupPilgrimId: string;
  amount: number;
  roomType: RoomType | null;
  source?: "SNAPSHOT" | "MANUAL";
  currency?: string;
}

/**
 * Seeds a traveller's one live BASE_FARE line. Used by
 * `createGroupBookingInStore` at booking time and by `setBaseFareInStore`
 * on a reprice — never called with an id that already has a live base fare,
 * which the caller must void first (the partial unique index in the
 * migration would refuse a second one at the database layer regardless).
 */
export function buildBaseFareCharge(
  input: BuildBaseFareInput,
  actor: GroupActor,
  now: string,
): DepartureGroupPilgrimChargeRow {
  return {
    id: newId(),
    departure_group_id: input.departureGroupId,
    booking_id: input.bookingId,
    group_pilgrim_id: input.groupPilgrimId,
    charge_type: "BASE_FARE",
    addon_id: null,
    label: "Package base fare",
    amount: money(Math.max(input.amount, 0)),
    quantity: 1,
    currency: input.currency ?? "LKR",
    source: input.source ?? "SNAPSHOT",
    priced_room_type: input.roomType,
    reason: null,
    requires_approval: false,
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now,
  };
}

export interface SetBaseFareInput {
  departureGroupId: string;
  groupPilgrimId: string;
  amount: number;
  roomType?: RoomType | null;
  reason?: string;
}

/**
 * Replaces a traveller's base fare: voids the live one (if any) with a
 * `Repriced` reason and inserts a fresh `MANUAL` line, then reconciles the
 * booking. This is the per-pilgrim analogue of the old
 * `booking.package_price_per_person = requestedPrice` assignment — the
 * difference is it can now be done for one traveller on a shared booking
 * without moving the others.
 */
export function setBaseFareInStore(
  data: DepartureGroupStore,
  input: SetBaseFareInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ChargeMutationOutcome {
  const pilgrim = data.pilgrims.find((p) => p.id === input.groupPilgrimId);
  if (!pilgrim || pilgrim.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That traveller no longer exists." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return { ok: false, error: "This traveller's seat has been cancelled." };
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "Enter a base fare of zero or more." };
  }

  const existing = data.pilgrimCharges.find(
    (c) =>
      c.group_pilgrim_id === pilgrim.id &&
      c.charge_type === "BASE_FARE" &&
      c.voided_at === null,
  );
  if (existing) {
    existing.voided_at = now;
    existing.voided_by_name = actor.name;
    existing.void_reason = input.reason?.trim() || "Repriced";
    existing.updated_at = now;
  }

  const roomType = input.roomType ?? pilgrim.room_occupancy_type ?? existing?.priced_room_type ?? null;
  const charge = buildBaseFareCharge(
    {
      departureGroupId: pilgrim.departure_group_id,
      bookingId: pilgrim.booking_id,
      groupPilgrimId: pilgrim.id,
      amount: input.amount,
      roomType,
      source: "MANUAL",
      currency: existing?.currency ?? data.pricing.find((p) => p.departure_group_id === pilgrim.departure_group_id)?.currency ?? "LKR",
    },
    actor,
    now,
  );
  data.pilgrimCharges.push(charge);

  recomputeBookingTotalsInStore(data, pilgrim.booking_id, now);
  recomputeHasCustomisationsInStore(data, pilgrim.id);

  data.activity.push({
    id: newId(),
    departure_group_id: pilgrim.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_REPRICED",
    entity_type: "CHARGE",
    entity_id: charge.id,
    before_value: existing ? { amount: existing.amount } : null,
    after_value: { amount: charge.amount },
    message: `${pilgrim.full_name_snapshot}'s base fare set to LKR ${charge.amount.toLocaleString("en-US")}.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, charge };
}

/**
 * Regenerates the BASE_FARE line for every traveller on a booking whose
 * current base fare is still `SNAPSHOT`-sourced — i.e. untouched since it was
 * seeded at booking time. A traveller whose base fare was hand-repriced via
 * `setBaseFareInStore` (source `MANUAL`) is left alone: a booking-wide tier
 * change must never silently overwrite an individually negotiated fare.
 *
 * Used by `changeBookingRoomPreferenceInStore` and `moveBookingToGroupInStore`,
 * which log one combined activity entry themselves rather than one per
 * traveller — this function does not write to the activity trail.
 *
 * Returns the number of travellers actually repriced.
 */
export function regenerateSnapshotBaseFaresInStore(
  data: DepartureGroupStore,
  bookingId: string,
  newAmount: number,
  /** Omit to keep each traveller's current occupancy unchanged. */
  newRoomType: RoomType | null | undefined,
  actor: GroupActor,
  now: string,
): number {
  const pilgrims = data.pilgrims.filter((p) => p.booking_id === bookingId);
  let repriced = 0;

  for (const pilgrim of pilgrims) {
    const existing = data.pilgrimCharges.find(
      (c) =>
        c.group_pilgrim_id === pilgrim.id &&
        c.charge_type === "BASE_FARE" &&
        c.voided_at === null,
    );
    if (existing && existing.source !== "SNAPSHOT") continue;

    const roomType =
      newRoomType !== undefined
        ? newRoomType
        : (pilgrim.room_occupancy_type ?? existing?.priced_room_type ?? null);

    if (existing && existing.amount === money(newAmount) && existing.priced_room_type === roomType) {
      continue;
    }

    if (existing) {
      existing.voided_at = now;
      existing.voided_by_name = actor.name;
      existing.void_reason = "Booking repriced";
      existing.updated_at = now;
    }

    data.pilgrimCharges.push(
      buildBaseFareCharge(
        {
          departureGroupId: pilgrim.departure_group_id,
          bookingId,
          groupPilgrimId: pilgrim.id,
          amount: newAmount,
          roomType,
          source: "SNAPSHOT",
        },
        actor,
        now,
      ),
    );
    pilgrim.room_occupancy_type = roomType;
    repriced++;
  }

  if (repriced > 0) recomputeBookingTotalsInStore(data, bookingId, now);
  return repriced;
}

export interface AddChargeInput {
  departureGroupId: string;
  groupPilgrimId: string;
  chargeType: Exclude<ChargeType, "BASE_FARE">;
  addonId?: string | null;
  label: string;
  amount: number;
  quantity?: number;
  reason?: string;
  requiresApproval: boolean;
}

const APPROVAL_THRESHOLD_TYPES: ChargeType[] = ["DISCOUNT", "PRICE_CORRECTION"];

/** Adds one priced line to a traveller and reconciles their booking. */
export function addChargeInStore(
  data: DepartureGroupStore,
  input: AddChargeInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ChargeMutationOutcome {
  const pilgrim = data.pilgrims.find((p) => p.id === input.groupPilgrimId);
  if (!pilgrim || pilgrim.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That traveller no longer exists." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return { ok: false, error: "This traveller's seat has been cancelled." };
  }
  if (!input.label.trim()) {
    return { ok: false, error: "Give this charge a label." };
  }
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    return { ok: false, error: "Enter a non-zero amount." };
  }
  if (NEGATIVE_TYPES.includes(input.chargeType) && input.amount > 0) {
    return { ok: false, error: "A discount must be a negative amount." };
  }
  if (NON_NEGATIVE_TYPES.includes(input.chargeType) && input.amount < 0) {
    return { ok: false, error: "That charge type cannot be negative." };
  }

  const requiresApproval =
    input.requiresApproval || APPROVAL_THRESHOLD_TYPES.includes(input.chargeType);
  if (requiresApproval && !input.reason?.trim()) {
    return { ok: false, error: "A charge that needs approval must have a reason." };
  }

  const charge: DepartureGroupPilgrimChargeRow = {
    id: newId(),
    departure_group_id: pilgrim.departure_group_id,
    booking_id: pilgrim.booking_id,
    group_pilgrim_id: pilgrim.id,
    charge_type: input.chargeType,
    addon_id: input.addonId ?? null,
    label: input.label.trim(),
    amount: money(input.amount),
    quantity: input.quantity && input.quantity > 0 ? input.quantity : 1,
    currency: "LKR",
    source: input.addonId ? "ADDON_CATALOGUE" : "MANUAL",
    priced_room_type: null,
    reason: input.reason?.trim() || null,
    requires_approval: requiresApproval,
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    voided_at: null,
    voided_by_name: null,
    void_reason: null,
    created_by: actor.id,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now,
  };
  data.pilgrimCharges.push(charge);

  recomputeBookingTotalsInStore(data, pilgrim.booking_id, now);
  recomputeHasCustomisationsInStore(data, pilgrim.id);

  data.activity.push({
    id: newId(),
    departure_group_id: pilgrim.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_CHARGE_ADDED",
    entity_type: "CHARGE",
    entity_id: charge.id,
    before_value: null,
    after_value: { charge_type: charge.charge_type, amount: charge.amount },
    message: `${charge.charge_type === "DISCOUNT" ? "Discount" : "Charge"} "${charge.label}" (${
      charge.amount >= 0 ? "" : "-"
    }LKR ${Math.abs(charge.amount).toLocaleString("en-US")}) added for ${pilgrim.full_name_snapshot}${
      requiresApproval ? " — awaiting approval" : ""
    }.`,
    is_system: false,
    is_high_impact: requiresApproval,
    created_at: now,
  });

  return { ok: true, charge };
}

export interface VoidChargeInput {
  departureGroupId: string;
  chargeId: string;
  reason: string;
}

/** Voids a charge line. Never deletes it — see the module doc. */
export function voidChargeInStore(
  data: DepartureGroupStore,
  input: VoidChargeInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ChargeMutationOutcome {
  const charge = data.pilgrimCharges.find((c) => c.id === input.chargeId);
  if (!charge || charge.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That charge no longer exists." };
  }
  if (charge.voided_at !== null) {
    return { ok: false, error: "This charge has already been voided." };
  }
  if (charge.charge_type === "BASE_FARE") {
    return {
      ok: false,
      error: "A base fare cannot be voided directly — reprice the traveller instead.",
    };
  }
  if (!input.reason.trim()) {
    return { ok: false, error: "A reason is required to void a charge." };
  }

  charge.voided_at = now;
  charge.voided_by_name = actor.name;
  charge.void_reason = input.reason.trim();
  charge.updated_at = now;

  recomputeBookingTotalsInStore(data, charge.booking_id, now);
  recomputeHasCustomisationsInStore(data, charge.group_pilgrim_id);

  const pilgrim = data.pilgrims.find((p) => p.id === charge.group_pilgrim_id);
  data.activity.push({
    id: newId(),
    departure_group_id: charge.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_CHARGE_VOIDED",
    entity_type: "CHARGE",
    entity_id: charge.id,
    before_value: { amount: charge.amount },
    after_value: null,
    message: `Charge "${charge.label}" voided for ${pilgrim?.full_name_snapshot ?? "traveller"}. Reason: ${input.reason.trim()}.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, charge };
}

export interface ApproveChargeInput {
  departureGroupId: string;
  chargeId: string;
}

/** Signs off a charge that was flagged as needing approval. */
export function approveChargeInStore(
  data: DepartureGroupStore,
  input: ApproveChargeInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ChargeMutationOutcome {
  const charge = data.pilgrimCharges.find((c) => c.id === input.chargeId);
  if (!charge || charge.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That charge no longer exists." };
  }
  if (charge.voided_at !== null) {
    return { ok: false, error: "This charge has been voided." };
  }
  if (!charge.requires_approval) {
    return { ok: false, error: "This charge does not require approval." };
  }
  if (charge.approved_at !== null) {
    return { ok: false, error: "This charge has already been approved." };
  }

  charge.approved_at = now;
  charge.approved_by = actor.id;
  charge.approved_by_name = actor.name;
  charge.updated_at = now;

  // Now that `total_booking_value` excludes an unapproved charge (see
  // `sumBillableChargeLines`), approving one has to move real money —
  // this used to be a no-op because the total never depended on the state
  // being changed here.
  recomputeBookingTotalsInStore(data, charge.booking_id, now);

  const pilgrim = data.pilgrims.find((p) => p.id === charge.group_pilgrim_id);
  data.activity.push({
    id: newId(),
    departure_group_id: charge.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_CHARGE_APPROVED",
    entity_type: "CHARGE",
    entity_id: charge.id,
    before_value: null,
    after_value: { approved_by_name: actor.name },
    message: `Charge "${charge.label}" for ${pilgrim?.full_name_snapshot ?? "traveller"} approved by ${actor.name}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, charge };
}
