/**
 * Booking creation logic, kept pure and store-passing so it can be unit-tested
 * without the Next server runtime (mirroring how `departure-groups-copy.ts` is
 * separated from the data layer).
 *
 * `createGroupBookingInStore` mutates the store it is handed: it appends the
 * booking and its pilgrim rows, reconciles the group's seat counts and records
 * the activity entry. The thin wrapper in `departure-groups.ts` supplies the
 * live store.
 */

import {
  buildBaseFareCharge,
  recomputeBookingTotalsInStore,
  regenerateSnapshotBaseFaresInStore,
} from "@/lib/data/departure-groups-charges";
import { buildPilgrimDocuments } from "@/lib/data/departure-groups-copy";
import { syncPilgrimDerivedState } from "@/lib/data/departure-groups-documents";
import { newId } from "@/lib/data/departure-groups-ids";
import {
  derivePaymentStatus,
  money,
  resolveNextMilestoneDueDate,
} from "@/lib/data/departure-groups-money";
import type {
  BookingStatus,
  GroupActor,
  DepartureGroupBookingRow,
  DepartureGroupPilgrimRow,
  DepartureGroupRoomRow,
  DepartureGroupRow,
  RoomType,
  SeatStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";
import type { CreateGroupBookingInput } from "@/app/(main)/departure-groups/types";

export interface CreateGroupBookingResult {
  bookingId: string;
  bookingReference: string;
  travellerCount: number;
}

export type CreateBookingOutcome =
  | { ok: true; result: CreateGroupBookingResult }
  | { ok: false; error: string };

/** A hold and a confirmed booking take seats; the waitlist does not. */
export function bookingConsumesSeats(status: BookingStatus): boolean {
  return status !== "WAITLIST" && status !== "CANCELLED";
}

/** The group's live, editable payment schedule — empty for a group whose pricing row is missing. */
function groupMilestones(data: DepartureGroupStore, groupId: string) {
  return (
    data.pricing.find((p) => p.departure_group_id === groupId)
      ?.payment_milestones ?? []
  );
}

/**
 * Whether a pilgrim row represents someone actually travelling — as opposed
 * to cancelled, or seated on a `WAITLIST` booking that has never been given a
 * seat.
 *
 * `createGroupBookingInStore` inserts pilgrim rows for a waitlist booking the
 * same as any other, so those travellers previously counted toward the
 * manifest, readiness score, blocker list and auto-room-assignment while
 * contributing nothing to `booked_seats` — a group could read "4 booked of
 * 40" next to a manifest of 8 people, a readiness score dragged down by
 * travellers with no seat, and rooms auto-filled with people who are not
 * confirmed to travel. `p.seat_status !== "CANCELLED"` alone does not catch
 * this: a fresh waitlist pilgrim's seat status is never `CANCELLED`.
 */
export function isTravellingPilgrim(
  data: DepartureGroupStore,
  p: DepartureGroupPilgrimRow,
): boolean {
  if (p.seat_status === "CANCELLED") return false;
  const booking = data.bookings.find((b) => b.id === p.booking_id);
  if (!booking) return false;
  return bookingConsumesSeats(booking.booking_status);
}

/** The group fields a booking request needs to validate against. */
export type BookableGroup = Pick<
  DepartureGroupRow,
  "group_name" | "group_status" | "sales_status" | "available_seats" | "waitlist_enabled"
>;

/**
 * The gates a booking request has to clear, independent of actually writing
 * anything: group open, sales open, traveller count sane, seats available.
 *
 * Shared by `createGroupBookingInStore()` (the authoritative check, run
 * inside the mutation) and `precheckGroupBooking()` (a read-only check run
 * *before* `createGroupBooking()` resolves or creates Pilgrim person
 * records — see that function for why the order matters). Because the
 * pre-check reads the group outside the mutation's load-modify-write window,
 * it cannot fully close the race a concurrent booking creates; it exists to
 * catch the common case — a closed group, an oversized ask — before a
 * refused booking has already created traveller profiles.
 */
export function validateBookingRequest(
  group: BookableGroup,
  input: Pick<CreateGroupBookingInput, "bookingStatus" | "travellerCount">,
): { ok: true } | { ok: false; error: string } {
  if (group.group_status === "CANCELLED" || group.group_status === "CLOSED") {
    return { ok: false, error: "This group is closed to new bookings." };
  }
  // Closing sales is advertised as "new bookings are blocked", so it has to
  // actually block them — only the group status used to be checked here, which
  // let a group with sales closed keep taking bookings.
  if (
    group.sales_status === "SALES_CLOSED" ||
    group.sales_status === "CANCELLED"
  ) {
    return {
      ok: false,
      error:
        group.sales_status === "CANCELLED"
          ? "Sales have been cancelled for this group."
          : "Sales are closed for this group. Reopen sales before adding a booking.",
    };
  }
  // A waitlist-only group may still take waitlist entries, but not live seats.
  if (group.sales_status === "WAITLIST" && input.bookingStatus !== "WAITLIST") {
    return {
      ok: false,
      error: `${group.group_name} is on waitlist only. Add this booking to the waitlist instead.`,
    };
  }
  if (input.travellerCount < 1) {
    return { ok: false, error: "A booking needs at least one traveller." };
  }

  const consumesSeats = bookingConsumesSeats(input.bookingStatus);

  // Capacity gate — a hold and a confirmed booking both take real seats.
  if (consumesSeats && input.travellerCount > group.available_seats) {
    return {
      ok: false,
      error: group.waitlist_enabled
        ? `Only ${group.available_seats} seat${
            group.available_seats === 1 ? "" : "s"
          } left. Add this booking to the waitlist instead.`
        : `Only ${group.available_seats} seat${
            group.available_seats === 1 ? "" : "s"
          } left and the waitlist is disabled.`,
    };
  }

  return { ok: true };
}

/**
 * Moves a group out of `PLANNING` the moment it has something to prepare.
 *
 * `PREPARING` was one of four group states the schema declared and no code path
 * could reach. It belongs here rather than beside the other lifecycle
 * transitions because taking a booking is what causes it, and because
 * `departure-groups-lifecycle.ts` already imports this module, so putting it
 * there would close an import cycle.
 */
export function advanceGroupToPreparing(
  group: DepartureGroupRow,
  now: string,
): boolean {
  if (group.group_status !== "PLANNING") return false;
  group.group_status = "PREPARING";
  group.updated_at = now;
  return true;
}

/**
 * Reconciles `sales_status` to the seats actually available.
 *
 * Every caller that changes `booked_seats` / `held_seats` used to leave
 * `sales_status` alone: filling the last seat through an ordinary booking
 * left a sold-out group advertised as `SELLING`, and freeing a seat by
 * cancelling a booking left a sold-out group's `SALES_CLOSED`/`WAITLIST`
 * status stuck forever — only the hold-expiry sweeper and waitlist
 * promotion ever nudged it, and only in one direction each. This is the one
 * place that rule lives now, so every seat-count change carries it for free.
 *
 * A deliberate `CANCELLED` group is never touched. `actor` is `null` for
 * system-triggered callers (the expiry sweeper); the activity entry then
 * reads as system-authored, matching the sweeper's existing entries.
 */
export function syncSalesStatusToSeats(
  data: DepartureGroupStore,
  group: DepartureGroupRow,
  actor: GroupActor | null,
  now: string,
): void {
  if (group.sales_status === "CANCELLED") return;

  const before = group.sales_status;
  let after = before;

  if (group.available_seats === 0) {
    if (before !== "SALES_CLOSED") {
      after = group.waitlist_enabled ? "WAITLIST" : "SALES_CLOSED";
    }
  } else if (before === "WAITLIST" || before === "SALES_CLOSED") {
    after =
      group.available_seats <= Math.ceil(group.capacity * 0.1)
        ? "LIMITED_AVAILABILITY"
        : "SELLING";
  }

  if (after === before) return;

  group.sales_status = after;
  group.updated_at = now;

  data.activity.push({
    id: newId(),
    departure_group_id: group.id,
    actor_id: actor?.id ?? null,
    actor_name_snapshot: actor?.name ?? "System",
    action_type: "SALES_STATUS_CHANGED",
    entity_type: "GROUP",
    entity_id: group.id,
    before_value: { sales_status: before },
    after_value: { sales_status: after },
    message:
      after === "SALES_CLOSED" || after === "WAITLIST"
        ? `Sales ${after === "WAITLIST" ? "moved to the waitlist" : "closed"} automatically — no seats left.`
        : `Sales reopened automatically — ${group.available_seats} seat${
            group.available_seats === 1 ? "" : "s"
          } available again.`,
    is_system: actor === null,
    is_high_impact: false,
    created_at: now,
  });
}

/** Next free 1-based waitlist slot, so promotion runs longest-waiting first. */
function nextWaitlistPosition(
  data: DepartureGroupStore,
  groupId: string,
): number {
  const taken = data.bookings
    .filter(
      (b) =>
        b.departure_group_id === groupId &&
        b.booking_status === "WAITLIST" &&
        b.waitlist_position !== null,
    )
    .map((b) => b.waitlist_position!);
  return taken.length === 0 ? 1 : Math.max(...taken) + 1;
}

// Lives in the leaf money module so the seed can share the rule without
// importing this one back (seed → bookings → seed was a real init cycle).
export { derivePaymentStatus };

/** First unused `${CODE}-BK###` reference for the group. */
export function nextBookingReference(
  groupCode: string,
  data: DepartureGroupStore,
): string {
  const existing = new Set(
    data.bookings.map((b) => b.booking_reference.toUpperCase()),
  );
  let n = data.bookings.filter((b) =>
    b.booking_reference.startsWith(groupCode),
  ).length;
  let ref: string;
  do {
    n += 1;
    ref = `${groupCode}-BK${String(n).padStart(3, "0")}`;
  } while (existing.has(ref.toUpperCase()));
  return ref;
}

/**
 * Creates a booking and its pilgrim records against a group, then reconciles
 * the group's seat counts. This is the tail of the booking lifecycle — lead →
 * package → group → capacity check → seat hold → booking → pilgrim records →
 * payment milestones copied → document checklist copied — so it:
 *
 *   * refuses to oversell (unless the booking is placed on the waitlist),
 *   * moves seats into `held_seats` for a hold and `booked_seats` for a
 *     confirmed/deposit booking, leaving `available_seats` consistent,
 *   * seeds each traveller's document checklist from the package snapshot and
 *     their payment state from the deposit taken,
 *   * records the booking on the activity trail.
 */
export function createGroupBookingInStore(
  data: DepartureGroupStore,
  input: CreateGroupBookingInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): CreateBookingOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  const validation = validateBookingRequest(group, input);
  if (!validation.ok) return validation;

  const consumesSeats = bookingConsumesSeats(input.bookingStatus);

  const bookingId = newId();
  const reference =
    input.bookingReference &&
    !data.bookings.some(
      (b) =>
        b.booking_reference.toUpperCase() ===
        input.bookingReference.toUpperCase(),
    )
      ? input.bookingReference.toUpperCase()
      : nextBookingReference(group.group_code, data);

  const pricePerPerson = money(Math.max(input.packagePricePerPerson, 0));
  // A per-traveller override (a child/infant priced below the adult rate,
  // say) makes the real total lower than `pricePerPerson × travellerCount` —
  // summing the overrides here keeps the initial deposit clamp honest before
  // `recomputeBookingTotalsInStore` derives the authoritative total from the
  // BASE_FARE lines just below.
  const totalValue =
    input.travellers && input.travellers.length === input.travellerCount
      ? money(
          input.travellers.reduce(
            (sum, t) => sum + Math.max(t.pricePerPerson ?? pricePerPerson, 0),
            0,
          ),
        )
      : money(pricePerPerson * input.travellerCount);
  const amountPaid = money(
    Math.min(Math.max(input.amountPaid, 0), totalValue),
  );
  const outstanding = money(totalValue - amountPaid);

  const isHold = input.bookingStatus === "HELD";
  const seatHoldExpiresAt = isHold
    ? (input.seatHoldExpiresAt ??
      new Date(
        Date.now() + group.seat_hold_expiry_hours * 3_600_000,
      ).toISOString())
    : null;

  const booking: DepartureGroupBookingRow = {
    id: bookingId,
    departure_group_id: group.id,
    lead_id: input.leadId ?? null,
    booking_reference: reference,
    booking_status: input.bookingStatus,
    primary_contact_name: input.primaryContactName,
    primary_contact_phone: input.primaryContactPhone,
    traveller_count: input.travellerCount,
    room_occupancy_preference: input.roomOccupancyPreference,
    package_price_per_person: pricePerPerson,
    total_booking_value: totalValue,
    currency: data.pricing.find((p) => p.departure_group_id === group.id)?.currency ?? "LKR",
    cancellation_refund_amount: 0,
    amount_paid: amountPaid,
    outstanding_balance: outstanding,
    next_due_at:
      outstanding > 0
        ? resolveNextMilestoneDueDate(
            groupMilestones(data, group.id),
            totalValue,
            amountPaid,
            group.departure_date,
            now,
          )
        : null,
    seat_hold_expires_at: seatHoldExpiresAt,
    hold_released_at: null,
    booked_at: input.bookingStatus === "CONFIRMED" ? now : null,
    confirmed_at: input.bookingStatus === "CONFIRMED" ? now : null,
    // A waitlist is only fair if it has an order, and promotion needs one.
    waitlist_position:
      input.bookingStatus === "WAITLIST"
        ? nextWaitlistPosition(data, group.id)
        : null,
    created_at: now,
    payer_pilgrim_id: null,
    payer_lead_id: null,
    payer_name: null,
    payer_email: null,
    booking_type: "GROUP",
  };
  data.bookings.push(booking);

  const seatStatus: SeatStatus =
    input.bookingStatus === "WAITLIST"
      ? "WAITLIST"
      : input.bookingStatus === "HELD"
        ? "HELD"
        : "CONFIRMED";
  const paymentStatus = derivePaymentStatus(
    totalValue,
    amountPaid,
    booking.next_due_at,
  );

  // The document checklist comes from the frozen snapshot, so a later template
  // edit can't change what these travellers were asked for. Each requirement
  // becomes its own row: the module used to keep only the array length, which
  // is what made "4 / 8 documents" impossible to act on.
  const snapshot = data.snapshots.find(
    (s) => s.departure_group_id === group.id,
  );
  const requirements = snapshot?.traveller_requirements_snapshot ?? [];

  for (let i = 0; i < input.travellerCount; i++) {
    const traveller = input.travellers?.[i];
    const name =
      traveller?.fullName?.trim() ||
      (i === 0 ? input.primaryContactName : `Traveller ${i + 1}`);
    const phone =
      traveller?.phone?.trim() ||
      (i === 0 ? input.primaryContactPhone : null);
    const passport = traveller?.passportNumber?.trim() || null;

    const pilgrimId = newId();
    const pilgrim: DepartureGroupPilgrimRow = {
      id: pilgrimId,
      departure_group_id: group.id,
      booking_id: bookingId,
      pilgrim_id: traveller?.pilgrimPersonId ?? null,
      full_name_snapshot: name,
      phone_snapshot: phone,
      passport_number_snapshot: passport,
      passport_expiry: traveller?.passportExpiry?.trim() || null,
      passport_issue_country: null,
      date_of_birth: null,
      seat_status: seatStatus,
      flight_status: "PENDING",
      room_assignment_status: "UNASSIGNED",
      room_id: null,
      documents_completed: 0,
      documents_required: 0,
      document_completion_percent: 0,
      visa_status: "NOT_STARTED",
      visa_submitted_at: null,
      visa_reviewed_at: null,
      visa_rejected_at: null,
      visa_rejection_reason: null,
      visa_id: null,
      visa_issue_note: null,
      visa_file_path: null,
      visa_expiry_date: null,
      visa_ai_status: null,
      visa_ai_extracted: null,
      visa_ai_issues: null,
      visa_ai_analyzed_at: null,
      visa_ai_error: null,
      ticket_file_path: null,
      ticket_file_name: null,
      ticket_uploaded_at: null,
      ticket_uploaded_by: null,
      ticket_ai_status: null,
      ticket_ai_extracted: null,
      ticket_ai_issues: null,
      ticket_ai_analyzed_at: null,
      ticket_ai_error: null,
      payment_status: paymentStatus,
      emergency_contact_status: "MISSING",
      emergency_contact_name: traveller?.emergencyContactName?.trim() || null,
      emergency_contact_phone: traveller?.emergencyContactPhone?.trim() || null,
      emergency_contact_relationship: null,
      room_occupancy_type: traveller?.roomOccupancyType ?? input.roomOccupancyPreference,
      has_customisations: false,
      excluded_from_group_flight: false,
    };
    data.pilgrims.push(pilgrim);

    // One live BASE_FARE line per traveller — the source of truth for what
    // this booking is worth, replacing the flat
    // `packagePricePerPerson * travellerCount` multiplication. A traveller
    // without a per-seat override is priced at the booking's uniform rate, so
    // an ordinary booking reconciles to exactly the total computed above.
    data.pilgrimCharges.push(
      buildBaseFareCharge(
        {
          departureGroupId: group.id,
          bookingId,
          groupPilgrimId: pilgrimId,
          amount: traveller?.pricePerPerson ?? pricePerPerson,
          roomType: pilgrim.room_occupancy_type,
          currency: data.pricing.find((p) => p.departure_group_id === group.id)?.currency ?? "LKR",
        },
        actor,
        now,
      ),
    );

    data.pilgrimDocuments.push(
      ...buildPilgrimDocuments(
        requirements,
        group.id,
        pilgrimId,
        () => newId(),
        now,
      ),
    );
    // Counters, the emergency-contact badge and the visa stage all derive from
    // the rows just created, so the traveller is consistent from insert.
    syncPilgrimDerivedState(data, pilgrim, now);
  }

  // Reconciles the booking's money columns from the BASE_FARE lines just
  // created. For a uniform-price booking this reproduces `totalValue` exactly;
  // for one with per-traveller overrides it is what makes the total correct.
  recomputeBookingTotalsInStore(data, bookingId, now);

  // A group with travellers on it is no longer merely planned.
  advanceGroupToPreparing(group, now);

  // Reconcile seat counts.
  if (input.bookingStatus === "HELD") {
    group.held_seats += input.travellerCount;
  } else if (consumesSeats) {
    group.booked_seats += input.travellerCount;
  }
  group.available_seats = Math.max(
    group.capacity - group.booked_seats - group.held_seats,
    0,
  );
  group.updated_at = now;
  syncSalesStatusToSeats(data, group, actor, now);

  data.activity.push({
    id: newId(),
    departure_group_id: group.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_CREATED",
    entity_type: "BOOKING",
    entity_id: bookingId,
    before_value: null,
    after_value: {
      booking_reference: reference,
      travellers: input.travellerCount,
      amount_paid: amountPaid,
    },
    message: `Booking ${reference} created for ${input.primaryContactName} (${input.travellerCount} traveller${
      input.travellerCount === 1 ? "" : "s"
    }).`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingId,
      bookingReference: reference,
      travellerCount: input.travellerCount,
    },
  };
}

/* ── Record payment ───────────────────────────────────────────────────────── */

export type PaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "CARD"
  | "CHEQUE"
  | "ONLINE";

export interface RecordPaymentInput {
  bookingId: string;
  departureGroupId: string;
  amount: number;
  method?: PaymentMethod;
  note?: string;
}

export interface RecordPaymentResult {
  bookingReference: string;
  amountPaid: number;
  outstandingBalance: number;
  bookingStatus: BookingStatus;
  paidInFull: boolean;
}

export type RecordPaymentOutcome =
  | { ok: true; result: RecordPaymentResult }
  | { ok: false; error: string };

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "cash",
  BANK_TRANSFER: "bank transfer",
  CARD: "card",
  CHEQUE: "cheque",
  ONLINE: "online",
};

/**
 * Records a payment against a booking: it adds to `amount_paid`, recomputes the
 * outstanding balance, re-derives every traveller's payment status, promotes a
 * deposit-pending booking to confirmed once money is in, clears the due date on
 * full settlement, and writes the payment to the activity trail.
 *
 * Guards against overpaying (a payment cannot exceed the balance) and against
 * paying an already-settled or cancelled booking.
 */
export function recordBookingPaymentInStore(
  data: DepartureGroupStore,
  input: RecordPaymentInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): RecordPaymentOutcome {
  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.booking_status === "CANCELLED") {
    return { ok: false, error: "This booking has been cancelled." };
  }

  const amount = money(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }
  if (booking.outstanding_balance <= 0) {
    return { ok: false, error: "This booking is already paid in full." };
  }
  if (amount > booking.outstanding_balance) {
    return {
      ok: false,
      error: `Payment exceeds the outstanding balance of ${booking.outstanding_balance.toLocaleString(
        "en-US",
      )}.`,
    };
  }

  booking.amount_paid = money(booking.amount_paid + amount);
  booking.outstanding_balance = money(
    Math.max(booking.total_booking_value - booking.amount_paid, 0),
  );
  const paidInFull = booking.outstanding_balance <= 0;

  if (paidInFull) booking.next_due_at = null;
  else {
    booking.next_due_at = resolveNextMilestoneDueDate(
      groupMilestones(data, booking.departure_group_id),
      booking.total_booking_value,
      booking.amount_paid,
      data.groups.find((g) => g.id === booking.departure_group_id)?.departure_date ?? now,
      booking.created_at ?? now,
    );
  }

  /**
   * Money is what turns a provisional booking into a real one.
   *
   * `DEPOSIT_PENDING` was the only status promoted here, which left a *held*
   * booking with no path to `CONFIRMED` at all: a hold that paid in full stayed
   * `HELD` forever, its seats stuck in `held_seats` rather than `booked_seats`,
   * and its expiry timer still running against a traveller who had already
   * paid. A hold that pays is confirmed, and its seats move across.
   */
  const wasHeld = booking.booking_status === "HELD";
  if (wasHeld || booking.booking_status === "DEPOSIT_PENDING") {
    booking.booking_status = "CONFIRMED";
    booking.confirmed_at ??= now;
    booking.booked_at ??= now;

    if (wasHeld) {
      // The hold is spent, so the sweeper must not later reclaim these seats.
      booking.seat_hold_expires_at = null;
      const group = data.groups.find(
        (g) => g.id === booking.departure_group_id,
      );
      if (group) {
        group.held_seats = Math.max(
          group.held_seats - booking.traveller_count,
          0,
        );
        group.booked_seats += booking.traveller_count;
        group.available_seats = Math.max(
          group.capacity - group.booked_seats - group.held_seats,
          0,
        );
        group.updated_at = now;
      }
    }
  }

  const nowMs = Date.parse(now);
  for (const pilgrim of data.pilgrims) {
    if (pilgrim.booking_id !== booking.id) continue;
    if (pilgrim.payment_status !== "REFUND_PENDING") {
      pilgrim.payment_status = derivePaymentStatus(
        booking.total_booking_value,
        booking.amount_paid,
        booking.next_due_at,
        nowMs,
      );
    }
    if (pilgrim.seat_status === "HELD") pilgrim.seat_status = "CONFIRMED";
    // The deposit-threshold requirement is answered by this payment, so the
    // traveller's checklist clears without anyone ticking it.
    if (pilgrim.seat_status !== "CANCELLED") {
      syncPilgrimDerivedState(data, pilgrim, now);
    }
  }

  const methodLabel = input.method
    ? ` by ${PAYMENT_METHOD_LABELS[input.method]}`
    : "";
  data.activity.push({
    id: newId(),
    departure_group_id: booking.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PAYMENT_RECORDED",
    entity_type: "PAYMENT",
    entity_id: booking.id,
    before_value: { amount_paid: booking.amount_paid - amount },
    after_value: { amount_paid: booking.amount_paid },
    message: `Recorded ${booking.package_price_per_person > 0 ? "LKR " : ""}${amount.toLocaleString(
      "en-US",
    )}${methodLabel} for ${booking.primary_contact_name} (${booking.booking_reference})${
      paidInFull ? " — paid in full" : ""
    }.${input.note ? ` Note: ${input.note}` : ""}`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      amountPaid: booking.amount_paid,
      outstandingBalance: booking.outstanding_balance,
      bookingStatus: booking.booking_status,
      paidInFull,
    },
  };
}

/* ── Reverse payment ──────────────────────────────────────────────────────── */

export interface ReverseBookingPaymentInput {
  bookingId: string;
  departureGroupId: string;
  /** Positive — the amount being taken back off the booking. */
  amount: number;
  reason: string;
  /**
   * True when this reversal *is* a refund payout actually reaching the
   * pilgrim (called from `payRefund()` in lib/data/finance-repository.ts),
   * as opposed to a correction of a wrongly-recorded payment. Only then does
   * a traveller sitting at `REFUND_PENDING` get their payment status
   * re-derived — see the loop below.
   */
  resolvesRefund?: boolean;
}

export interface ReverseBookingPaymentResult {
  bookingReference: string;
  amountPaid: number;
  outstandingBalance: number;
}

export type ReverseBookingPaymentOutcome =
  | { ok: true; result: ReverseBookingPaymentResult }
  | { ok: false; error: string };

/**
 * The mirror of `recordBookingPaymentInStore()` — a payment is never deleted
 * (plan F1). Reversing one takes the same amount back off `amount_paid` /
 * `outstanding_balance`, re-derives every traveller's payment status against
 * the new balance, and never sets a booking back to `HELD` or reclaims seats:
 * a reversal is a money correction, not an undo of the booking's commercial
 * lifecycle. The ledger row itself (the caller's `payments` table) is what
 * records the reversal happened; this only makes the booking's totals agree
 * with it again.
 */
export function reverseBookingPaymentInStore(
  data: DepartureGroupStore,
  input: ReverseBookingPaymentInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ReverseBookingPaymentOutcome {
  const booking = data.bookings.find(
    (b) => b.id === input.bookingId && b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };

  const amount = money(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than zero to reverse." };
  }
  if (amount > booking.amount_paid) {
    return {
      ok: false,
      error: `Cannot reverse more than the ${booking.amount_paid.toLocaleString("en-US")} already recorded.`,
    };
  }

  booking.amount_paid = money(booking.amount_paid - amount);
  // A cancelled booking has no original receivable after settlement. Refund
  // payout reduces cash held, but must not recreate that cancelled debt.
  booking.outstanding_balance =
    booking.booking_status === "CANCELLED"
      ? 0
      : money(Math.max(booking.total_booking_value - booking.amount_paid, 0));
  if (booking.booking_status !== "CANCELLED") {
    booking.next_due_at =
      booking.outstanding_balance > 0
        ? resolveNextMilestoneDueDate(
            groupMilestones(data, booking.departure_group_id),
            booking.total_booking_value,
            booking.amount_paid,
            data.groups.find((g) => g.id === booking.departure_group_id)?.departure_date ?? now,
            booking.created_at ?? now,
          )
        : null;
  }

  const nowMs = Date.parse(now);
  for (const pilgrim of data.pilgrims) {
    if (pilgrim.booking_id !== booking.id) continue;
    if (pilgrim.payment_status !== "REFUND_PENDING" || input.resolvesRefund) {
      pilgrim.payment_status = derivePaymentStatus(
        booking.total_booking_value,
        booking.amount_paid,
        booking.next_due_at,
        nowMs,
      );
    }
  }

  data.activity.push({
    id: newId(),
    departure_group_id: booking.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: input.resolvesRefund ? "PAYMENT_REFUND_PAID" : "PAYMENT_REVERSED",
    entity_type: "PAYMENT",
    entity_id: booking.id,
    before_value: { amount_paid: booking.amount_paid + amount },
    after_value: { amount_paid: booking.amount_paid },
    message: input.resolvesRefund
      ? `Refund of ${amount.toLocaleString("en-US")} paid to ${booking.primary_contact_name} (${booking.booking_reference}).`
      : `Reversed ${amount.toLocaleString("en-US")} for ${booking.primary_contact_name} (${booking.booking_reference}). Reason: ${input.reason}`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      amountPaid: booking.amount_paid,
      outstandingBalance: booking.outstanding_balance,
    },
  };
}

/* ── Change room preference ───────────────────────────────────────────────── */

export interface ChangeRoomPreferenceInput {
  bookingId: string;
  departureGroupId: string;
  roomOccupancyPreference: RoomType;
  /**
   * New per-person rate for the new occupancy tier. Omitted — or equal to the
   * current rate — leaves the booking priced exactly as it was.
   */
  pricePerPerson?: number;
  /**
   * Drop the booking's room assignments so rooming can be rebuilt at the new
   * occupancy. Locked assignments are never released.
   */
  releaseRoomAssignments?: boolean;
  note?: string;
}

export interface ChangeRoomPreferenceResult {
  bookingReference: string;
  primaryContactName: string;
  travellerCount: number;
  previousPreference: RoomType;
  roomOccupancyPreference: RoomType;
  repriced: boolean;
  packagePricePerPerson: number;
  totalBookingValue: number;
  outstandingBalance: number;
  /** Assignments actually cleared. */
  releasedRoomAssignments: number;
  /** Assignments kept because the room was locked. */
  lockedRoomAssignments: number;
}

export type ChangeRoomPreferenceOutcome =
  | { ok: true; result: ChangeRoomPreferenceResult }
  | { ok: false; error: string };

const ROOM_TYPE_WORDS: Record<RoomType, string> = {
  QUAD: "Quad",
  TRIPLE: "Triple",
  DOUBLE: "Double",
  SINGLE: "Single",
  OTHER: "Other",
};

/** A blocked room is out of service for its own reason — leave it blocked. */
export function recomputeRoomStatus(room: DepartureGroupRoomRow): void {
  if (room.status === "BLOCKED") return;
  room.status =
    room.assigned_pilgrim_count === 0
      ? "AVAILABLE"
      : room.assigned_pilgrim_count >= room.occupancy_capacity
        ? "COMPLETE"
        : "PARTIAL";
}

/**
 * Clears a booking's rooming. The assignment rows, the pilgrim's `room_id` and
 * the room's occupant count are three views of the same fact, so they always
 * move together — releasing one without the others leaves the Hotels & Rooms
 * tab disagreeing with the manifest.
 *
 * Locked assignments are kept unless `includeLocked` is set: a tier change can
 * respect a lock, but a move to another group cannot — those rooms belong to the
 * old group's hotels.
 */
function releaseBookingRooms(
  data: DepartureGroupStore,
  bookingId: string,
  includeLocked: boolean,
): { released: number; locked: number } {
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]));
  const assignmentsByPilgrim = new Map<string, string[]>();
  for (const row of data.roomAssignments) {
    const rooms = assignmentsByPilgrim.get(row.pilgrim_id);
    if (rooms) rooms.push(row.room_id);
    else assignmentsByPilgrim.set(row.pilgrim_id, [row.room_id]);
  }

  const cleared = new Set<string>();
  let released = 0;
  let locked = 0;

  for (const pilgrim of data.pilgrims) {
    if (pilgrim.booking_id !== bookingId) continue;

    const roomIds = new Set(assignmentsByPilgrim.get(pilgrim.id) ?? []);
    if (pilgrim.room_id) roomIds.add(pilgrim.room_id);
    if (roomIds.size === 0) continue;

    if (!includeLocked && pilgrim.room_assignment_status === "LOCKED") {
      locked++;
      continue;
    }

    for (const roomId of roomIds) {
      const room = roomsById.get(roomId);
      if (!room) continue;
      room.assigned_pilgrim_count = Math.max(
        room.assigned_pilgrim_count - 1,
        0,
      );
      recomputeRoomStatus(room);
    }

    pilgrim.room_id = null;
    pilgrim.room_assignment_status = "UNASSIGNED";
    cleared.add(pilgrim.id);
    released++;
  }

  if (cleared.size > 0) {
    data.roomAssignments = data.roomAssignments.filter(
      (row) => !cleared.has(row.pilgrim_id),
    );
  }

  return { released, locked };
}

/** Locked assignments on a booking, for reporting when nothing is released. */
function countLockedRooms(data: DepartureGroupStore, bookingId: string): number {
  return data.pilgrims.filter(
    (pilgrim) =>
      pilgrim.booking_id === bookingId &&
      pilgrim.room_assignment_status === "LOCKED" &&
      pilgrim.room_id,
  ).length;
}

/**
 * Moves a booking to a different room occupancy tier.
 *
 * The preference lives on the booking, not the pilgrim, so this is a
 * booking-wide change that every traveller on it inherits. Three things follow
 * from it and are handled here rather than left to the caller:
 *
 *   * Repricing — a tier change usually changes the per-person rate, so the
 *     total, the outstanding balance, the next due date and every traveller's
 *     payment status are recomputed together. A reprice may never drop the
 *     total below what has already been collected.
 *   * Rooming — assignments made for the old occupancy are stale once the tier
 *     changes, so they can be released in the same step (locked ones are kept).
 *   * The activity trail, with the before/after values.
 *
 * Seat counts are untouched: the traveller count does not change, so capacity
 * cannot be affected.
 */
export function changeBookingRoomPreferenceInStore(
  data: DepartureGroupStore,
  input: ChangeRoomPreferenceInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): ChangeRoomPreferenceOutcome {
  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.booking_status === "CANCELLED") {
    return { ok: false, error: "This booking has been cancelled." };
  }

  const group = data.groups.find((g) => g.id === booking.departure_group_id);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  const previous = booking.room_occupancy_preference;
  const next = input.roomOccupancyPreference;

  const requestedPrice =
    input.pricePerPerson === undefined
      ? null
      : money(input.pricePerPerson);
  if (requestedPrice !== null && !Number.isFinite(requestedPrice)) {
    return { ok: false, error: "Enter a package price of zero or more." };
  }
  if (requestedPrice !== null && requestedPrice < 0) {
    return { ok: false, error: "Enter a package price of zero or more." };
  }

  const repricing =
    requestedPrice !== null &&
    requestedPrice !== booking.package_price_per_person;

  if (previous === next && !repricing) {
    return {
      ok: false,
      error: `This booking is already on ${ROOM_TYPE_WORDS[next]} occupancy at the same rate.`,
    };
  }

  const priceBefore = booking.package_price_per_person;
  const totalBefore = booking.total_booking_value;

  if (repricing) {
    const newTotal = money(requestedPrice * booking.traveller_count);
    if (newTotal < booking.amount_paid) {
      return {
        ok: false,
        error: `That rate puts the booking total at ${newTotal.toLocaleString(
          "en-US",
        )}, below the ${booking.amount_paid.toLocaleString(
          "en-US",
        )} already collected. Raise a refund first.`,
      };
    }

    // Regenerates every traveller's still-`SNAPSHOT` BASE_FARE line at the new
    // rate and re-derives the booking's `total_booking_value` /
    // `outstanding_balance` from those lines — a hand-repriced (`MANUAL`)
    // traveller is left exactly as they were.
    regenerateSnapshotBaseFaresInStore(data, booking.id, requestedPrice, next, actor, now);
    booking.package_price_per_person = requestedPrice;

    if (booking.outstanding_balance <= 0) {
      booking.next_due_at = null;
    } else if (!booking.next_due_at) {
      // A previously settled booking that now owes money needs a due date back.
      booking.next_due_at = resolveNextMilestoneDueDate(
        groupMilestones(data, group.id),
        booking.total_booking_value,
        booking.amount_paid,
        group.departure_date,
        now,
      );
    }

    const nowMs = Date.parse(now);
    for (const pilgrim of data.pilgrims) {
      if (pilgrim.booking_id !== booking.id) continue;
      if (pilgrim.payment_status === "REFUND_PENDING") continue;
      pilgrim.payment_status = derivePaymentStatus(
        booking.total_booking_value,
        booking.amount_paid,
        booking.next_due_at,
        nowMs,
      );
    }
  }

  booking.room_occupancy_preference = next;

  const rooming = input.releaseRoomAssignments
    ? releaseBookingRooms(data, booking.id, false)
    : { released: 0, locked: countLockedRooms(data, booking.id) };
  const releasedRoomAssignments = rooming.released;
  const lockedRoomAssignments = rooming.locked;

  group.updated_at = now;

  const priceLabel = repricing
    ? ` and repriced to ${priceBefore > 0 || requestedPrice > 0 ? "LKR " : ""}${requestedPrice.toLocaleString(
        "en-US",
      )} per person`
    : "";
  const roomsLabel =
    releasedRoomAssignments > 0
      ? ` ${releasedRoomAssignments} room assignment${
          releasedRoomAssignments === 1 ? "" : "s"
        } released.`
      : "";

  data.activity.push({
    id: newId(),
    departure_group_id: booking.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_ROOM_PREFERENCE_CHANGED",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: {
      room_occupancy_preference: previous,
      ...(repricing
        ? {
            package_price_per_person: priceBefore,
            total_booking_value: totalBefore,
          }
        : {}),
    },
    after_value: {
      room_occupancy_preference: next,
      ...(repricing
        ? {
            package_price_per_person: booking.package_price_per_person,
            total_booking_value: booking.total_booking_value,
          }
        : {}),
    },
    message:
      previous === next
        ? `Booking ${booking.booking_reference} (${booking.primary_contact_name}) kept ${ROOM_TYPE_WORDS[next]} occupancy${priceLabel}.${roomsLabel}${
            input.note ? ` Note: ${input.note}` : ""
          }`
        : `Room preference for ${booking.booking_reference} (${booking.primary_contact_name}) changed from ${ROOM_TYPE_WORDS[previous]} to ${ROOM_TYPE_WORDS[next]}${priceLabel}.${roomsLabel}${
            input.note ? ` Note: ${input.note}` : ""
          }`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      primaryContactName: booking.primary_contact_name,
      travellerCount: booking.traveller_count,
      previousPreference: previous,
      roomOccupancyPreference: next,
      repriced: repricing,
      packagePricePerPerson: booking.package_price_per_person,
      totalBookingValue: booking.total_booking_value,
      outstandingBalance: booking.outstanding_balance,
      releasedRoomAssignments,
      lockedRoomAssignments,
    },
  };
}

/* ── Reminders ────────────────────────────────────────────────────────────── */

export type ReminderKind = "PAYMENT" | "DOCUMENT";
export type ReminderChannel = "WHATSAPP" | "SMS" | "EMAIL";

export interface SendBookingReminderInput {
  bookingId: string;
  departureGroupId: string;
  kind: ReminderKind;
  channel: ReminderChannel;
  /** The draft the operator reviewed, kept verbatim on the trail. */
  message: string;
  recipientName: string;
  recipientPhone: string;
}

export interface SendBookingReminderResult {
  bookingReference: string;
  kind: ReminderKind;
  channel: ReminderChannel;
  recipientName: string;
  recipientPhone: string;
  recordedAt: string;
}

export type SendBookingReminderOutcome =
  | { ok: true; result: SendBookingReminderResult }
  | { ok: false; error: string };

const CHANNEL_WORDS: Record<ReminderChannel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "email",
};

/**
 * Records a payment or document reminder against a booking.
 *
 * There is no messaging gateway in this codebase, so this deliberately does not
 * pretend to transmit anything: it writes the reminder — channel, recipient and
 * the exact draft the operator approved — to the activity trail, which is what
 * makes "when did we last chase this family?" answerable. The UI hands the
 * operator the draft to send.
 *
 * Reminders that have nothing to chase are refused rather than logged, so the
 * trail stays a record of real follow-up.
 */
export function sendBookingReminderInStore(
  data: DepartureGroupStore,
  input: SendBookingReminderInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): SendBookingReminderOutcome {
  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.booking_status === "CANCELLED") {
    return { ok: false, error: "This booking has been cancelled." };
  }

  const message = input.message.trim();
  if (!message) {
    return { ok: false, error: "The reminder message cannot be empty." };
  }

  const travellers = data.pilgrims.filter(
    (pilgrim) => pilgrim.booking_id === booking.id,
  );

  if (input.kind === "PAYMENT" && booking.outstanding_balance <= 0) {
    return {
      ok: false,
      error: "This booking is paid in full — there is nothing to chase.",
    };
  }
  if (
    input.kind === "DOCUMENT" &&
    travellers.length > 0 &&
    travellers.every(
      (pilgrim) => pilgrim.documents_completed >= pilgrim.documents_required,
    )
  ) {
    return {
      ok: false,
      error: "Every traveller on this booking has completed their documents.",
    };
  }

  const channelWord = CHANNEL_WORDS[input.channel];
  const kindWord = input.kind === "PAYMENT" ? "Payment" : "Document";

  // The recipient is the booking's own contact, read from the stored row. The
  // browser sends one too, but a reminder must not be addressable to an
  // arbitrary number typed into a request.
  const recipientName = booking.primary_contact_name;
  const recipientPhone = booking.primary_contact_phone;

  data.activity.push({
    id: newId(),
    departure_group_id: booking.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type:
      input.kind === "PAYMENT"
        ? "PAYMENT_REMINDER_SENT"
        : "DOCUMENT_REMINDER_SENT",
    entity_type: input.kind === "PAYMENT" ? "BOOKING" : "DOCUMENT",
    entity_id: booking.id,
    before_value: null,
    after_value: { channel: input.channel, message },
    message: `${kindWord} reminder for ${booking.booking_reference} prepared for ${recipientName} (${recipientPhone}) by ${channelWord}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      kind: input.kind,
      channel: input.channel,
      recipientName,
      recipientPhone,
      recordedAt: now,
    },
  };
}

/* ── Cancel a booking ─────────────────────────────────────────────────────── */

export interface CancelBookingInput {
  bookingId: string;
  departureGroupId: string;
  reason: string;
  /** What the agency will refund. 0 means the money paid is forfeited. */
  refundAmount?: number;
}

export interface CancelBookingResult {
  bookingReference: string;
  primaryContactName: string;
  travellerCount: number;
  /** Seats handed back to the group (0 for a waitlist booking). */
  seatsReleased: number;
  releasedRoomAssignments: number;
  amountPaid: number;
  refundAmount: number;
  availableSeats: number;
}

export type CancelBookingOutcome =
  | { ok: true; result: CancelBookingResult }
  | { ok: false; error: string };

/**
 * Cancels a booking and everyone on it.
 *
 * Cancelling is allowed even on a closed group — a pilgrim can always drop out —
 * but it must leave nothing dangling:
 *
 *   * seats go back to the group (a waitlist booking never held any),
 *   * rooming is released, locks included, so the beds can be resold,
 *   * every traveller's seat and flight move to CANCELLED,
 *   * the balance owed becomes zero and the due date clears, while
 *     `total_booking_value` and `amount_paid` stay as the historical record,
 *   * money already collected is marked REFUND_PENDING when a refund is owed,
 *     and left as-is when it is forfeited — the refund itself is a Payments
 *     movement, not something this step invents.
 *
 * The visa state is deliberately untouched: withdrawing a submitted application
 * is the visa team's job, and silently resetting it would hide that work.
 */
export function cancelGroupBookingInStore(
  data: DepartureGroupStore,
  input: CancelBookingInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): CancelBookingOutcome {
  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.booking_status === "CANCELLED") {
    return { ok: false, error: "This booking is already cancelled." };
  }

  const group = data.groups.find((g) => g.id === booking.departure_group_id);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  const reason = input.reason.trim();
  if (reason.length < 3) {
    return { ok: false, error: "Give a reason for the cancellation." };
  }

  const refundAmount = money(input.refundAmount ?? 0);
  if (!Number.isFinite(refundAmount) || refundAmount < 0) {
    return { ok: false, error: "Enter a refund of zero or more." };
  }
  if (refundAmount > booking.amount_paid) {
    return {
      ok: false,
      error: `The refund cannot exceed the ${booking.amount_paid.toLocaleString(
        "en-US",
      )} collected on this booking.`,
    };
  }

  const travellers = booking.traveller_count;
  const consumedSeats = bookingConsumesSeats(booking.booking_status);
  const wasHold = booking.booking_status === "HELD";
  const statusBefore = booking.booking_status;

  const { released: releasedRoomAssignments } = releaseBookingRooms(
    data,
    booking.id,
    true,
  );

  if (consumedSeats) {
    if (wasHold) {
      group.held_seats = Math.max(group.held_seats - travellers, 0);
    } else {
      group.booked_seats = Math.max(group.booked_seats - travellers, 0);
    }
    group.available_seats = Math.max(
      group.capacity - group.booked_seats - group.held_seats,
      0,
    );
    syncSalesStatusToSeats(data, group, actor, now);
  }
  group.updated_at = now;

  booking.booking_status = "CANCELLED";
  booking.cancellation_refund_amount = refundAmount;
  booking.seat_hold_expires_at = null;
  booking.waitlist_position = null;
  booking.outstanding_balance = 0;
  booking.next_due_at = null;

  for (const pilgrim of data.pilgrims) {
    if (pilgrim.booking_id !== booking.id) continue;
    // Ticket counters are group-level projections.  Withdrawn travellers
    // must be removed from every active sector they were counted against;
    // otherwise the Flights tab keeps reporting seats ticketed after the
    // booking has gone away.
    if (pilgrim.flight_status === "TICKETED") {
      for (const flight of data.flights) {
        if (flight.departure_group_id !== booking.departure_group_id) continue;
        if (flight.status === "CANCELLED") continue;
        flight.seats_ticketed = Math.max(flight.seats_ticketed - 1, 0);
      }
    }
    pilgrim.seat_status = "CANCELLED";
    pilgrim.flight_status = "CANCELLED";
    pilgrim.room_id = null;
    pilgrim.room_assignment_status = "UNASSIGNED";
    /**
     * A withdrawn traveller stops being an outstanding visa case.
     *
     * The visa status used to be left exactly as it was, so a cancelled
     * pilgrim sitting at `NOT_STARTED` stayed inside the Overview's "pilgrims
     * have visa applications pending" set forever — a CRITICAL blocker on the
     * group that no action could ever clear, because the only thing that
     * clears it is a visa nobody is going to apply for. An issued visa is
     * kept: it was really granted, and the agency may still have to account
     * for it.
     */
    if (pilgrim.visa_status !== "APPROVED") {
      pilgrim.visa_status = "NOT_STARTED";
      pilgrim.visa_submitted_at = null;
      pilgrim.visa_reviewed_at = null;
    }
    // Forfeited money keeps the status it had — it is revenue, not a liability.
    if (refundAmount > 0) pilgrim.payment_status = "REFUND_PENDING";
  }

  const moneyLabel =
    booking.amount_paid > 0
      ? refundAmount > 0
        ? ` Refund of ${refundAmount.toLocaleString("en-US")} pending on ${booking.amount_paid.toLocaleString(
            "en-US",
          )} collected.`
        : ` ${booking.amount_paid.toLocaleString("en-US")} collected is retained.`
      : "";
  const seatsLabel = consumedSeats
    ? ` ${travellers} seat${travellers === 1 ? "" : "s"} released.`
    : "";
  const roomsLabel =
    releasedRoomAssignments > 0
      ? ` ${releasedRoomAssignments} room assignment${
          releasedRoomAssignments === 1 ? "" : "s"
        } released.`
      : "";

  data.activity.push({
    id: newId(),
    departure_group_id: booking.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_CANCELLED",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: { booking_status: statusBefore },
    after_value: { booking_status: "CANCELLED", refund_amount: refundAmount },
    message: `Booking ${booking.booking_reference} (${booking.primary_contact_name}, ${travellers} traveller${
      travellers === 1 ? "" : "s"
    }) cancelled.${seatsLabel}${roomsLabel}${moneyLabel} Reason: ${reason}`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      primaryContactName: booking.primary_contact_name,
      travellerCount: travellers,
      seatsReleased: consumedSeats ? travellers : 0,
      releasedRoomAssignments,
      amountPaid: booking.amount_paid,
      refundAmount,
      availableSeats: group.available_seats,
    },
  };
}

/* ── Edit booking details ──────────────────────────────────────────────────── */

export interface EditBookingInput {
  bookingId: string;
  departureGroupId: string;
  primaryContactName: string;
  primaryContactPhone: string;
}

export interface EditBookingResult {
  bookingReference: string;
  primaryContactName: string;
  primaryContactPhone: string;
}

export type EditBookingOutcome =
  | { ok: true; result: EditBookingResult }
  | { ok: false; error: string };

/**
 * Corrects the primary contact's name and/or phone on a booking — the one
 * pair of fields captured at "Add Booking" time that had no way to be fixed
 * afterwards. Everything else about a booking (occupancy tier, pricing,
 * seats) already has its own dedicated flow — "Customise Traveller" for the
 * room tier, "Record Payment" for money, "Move to Another Group" and "Cancel
 * Booking" for the rest — so this stays narrowly scoped to just the contact
 * details rather than growing into a second, competing way to change those.
 */
export function updateBookingContactInStore(
  data: DepartureGroupStore,
  input: EditBookingInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): EditBookingOutcome {
  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.booking_status === "CANCELLED") {
    return { ok: false, error: "This booking has been cancelled." };
  }

  const name = input.primaryContactName.trim();
  const phone = input.primaryContactPhone.trim();
  if (!name) return { ok: false, error: "Enter the primary contact's name." };
  if (!phone) return { ok: false, error: "Enter the primary contact's phone number." };

  const before = {
    primary_contact_name: booking.primary_contact_name,
    primary_contact_phone: booking.primary_contact_phone,
  };
  if (before.primary_contact_name === name && before.primary_contact_phone === phone) {
    return { ok: false, error: "Nothing changed." };
  }

  booking.primary_contact_name = name;
  booking.primary_contact_phone = phone;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_CONTACT_UPDATED",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: before,
    after_value: {
      primary_contact_name: name,
      primary_contact_phone: phone,
    },
    message: `Contact details updated for booking ${booking.booking_reference}: ${before.primary_contact_name} (${before.primary_contact_phone}) → ${name} (${phone}).`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      primaryContactName: name,
      primaryContactPhone: phone,
    },
  };
}

/* ── Move a booking to another group ──────────────────────────────────────── */

export interface MoveBookingInput {
  bookingId: string;
  fromGroupId: string;
  toGroupId: string;
  /** New per-person rate, normally the target group's tier price. */
  pricePerPerson?: number;
  /** Reissue the reference against the target group's code. */
  reissueReference?: boolean;
  note?: string;
}

export interface MoveBookingResult {
  bookingReference: string;
  previousReference: string;
  primaryContactName: string;
  travellerCount: number;
  fromGroupName: string;
  toGroupId: string;
  toGroupName: string;
  toGroupCode: string;
  repriced: boolean;
  packagePricePerPerson: number;
  totalBookingValue: number;
  outstandingBalance: number;
  releasedRoomAssignments: number;
  /** Seats left in the target group once the booking has landed. */
  targetAvailableSeats: number;
}

export type MoveBookingOutcome =
  | { ok: true; result: MoveBookingResult }
  | { ok: false; error: string };

/**
 * Moves a booking — and every traveller on it — from one departure group to
 * another.
 *
 * A booking is tied to its group in more places than the foreign key, so the
 * move rebases all of them in one step rather than leaving the operator to
 * clean up:
 *
 *   * Seats: released in the source group and taken in the target, on the same
 *     held/booked split the booking status implies. The target's capacity is the
 *     gate — a move can no more oversell than a new booking can.
 *   * Rooming: released outright, locks included. Those rooms belong to the old
 *     group's hotels and cannot travel.
 *   * Flights: every traveller drops back to PENDING. A ticket on the old
 *     group's flight is not a seat on the new one.
 *   * Documents: the required count comes from the target group's frozen
 *     requirement snapshot, since that is what these travellers are now asked
 *     for. Completed documents are kept, capped at the new requirement.
 *   * Money: the payment due date rebases onto the target's departure date, and
 *     the caller may reprice to the target's tier rate at the same time.
 *   * The reference, optionally reissued against the target's group code.
 *
 * Both groups get an activity entry, so neither trail has a booking that
 * silently appears or disappears.
 */
export function moveBookingToGroupInStore(
  data: DepartureGroupStore,
  input: MoveBookingInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): MoveBookingOutcome {
  const booking = data.bookings.find(
    (b) => b.id === input.bookingId && b.departure_group_id === input.fromGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };
  if (booking.booking_status === "CANCELLED") {
    return { ok: false, error: "A cancelled booking cannot be moved." };
  }
  if (input.toGroupId === input.fromGroupId) {
    return { ok: false, error: "That booking is already in this group." };
  }

  const from = data.groups.find((g) => g.id === input.fromGroupId);
  const to = data.groups.find((g) => g.id === input.toGroupId);
  if (!from) {
    return { ok: false, error: "That departure group no longer exists." };
  }
  if (!to) {
    return { ok: false, error: "The group you picked no longer exists." };
  }
  if (to.archived) {
    return { ok: false, error: `${to.group_name} is archived.` };
  }
  if (to.group_status === "CANCELLED" || to.group_status === "CLOSED") {
    return { ok: false, error: `${to.group_name} is closed to new bookings.` };
  }
  if (to.group_status === "DEPARTED" || to.group_status === "COMPLETED") {
    return {
      ok: false,
      error: `${to.group_name} has already departed.`,
    };
  }

  const sourceCurrency = booking.currency ?? data.pricing.find((p) => p.departure_group_id === from.id)?.currency ?? "LKR";
  const targetCurrency = data.pricing.find((p) => p.departure_group_id === to.id)?.currency ?? "LKR";
  if (sourceCurrency !== targetCurrency) {
    return { ok: false, error: `This booking uses ${sourceCurrency}; it cannot move to a ${targetCurrency} group.` };
  }

  const travellers = booking.traveller_count;
  const consumesSeats = bookingConsumesSeats(booking.booking_status);

  // Same capacity gate a new booking faces — the seats have to exist.
  if (consumesSeats && travellers > to.available_seats) {
    return {
      ok: false,
      error: `${to.group_name} has only ${to.available_seats} seat${
        to.available_seats === 1 ? "" : "s"
      } left and this booking needs ${travellers}.`,
    };
  }

  const requestedPrice =
    input.pricePerPerson === undefined
      ? null
      : money(input.pricePerPerson);
  if (
    requestedPrice !== null &&
    (!Number.isFinite(requestedPrice) || requestedPrice < 0)
  ) {
    return { ok: false, error: "Enter a package price of zero or more." };
  }

  const repricing =
    requestedPrice !== null &&
    requestedPrice !== booking.package_price_per_person;

  if (repricing) {
    const newTotal = money(requestedPrice * travellers);
    if (newTotal < booking.amount_paid) {
      return {
        ok: false,
        error: `That rate puts the booking total at ${newTotal.toLocaleString(
          "en-US",
        )}, below the ${booking.amount_paid.toLocaleString(
          "en-US",
        )} already collected. Raise a refund first.`,
      };
    }
  }

  const previousReference = booking.booking_reference;
  const priceBefore = booking.package_price_per_person;
  const totalBefore = booking.total_booking_value;

  /* Rooming first — it reads `booking_id`, which the move does not change, but
     doing it before the group swap keeps the source group's room counts right. */
  const { released: releasedRoomAssignments } = releaseBookingRooms(
    data,
    booking.id,
    true,
  );

  // Seats: out of the source, into the target, on the same held/booked split.
  if (consumesSeats) {
    if (booking.booking_status === "HELD") {
      from.held_seats = Math.max(from.held_seats - travellers, 0);
      to.held_seats += travellers;
    } else {
      from.booked_seats = Math.max(from.booked_seats - travellers, 0);
      to.booked_seats += travellers;
    }
  }
  from.available_seats = Math.max(
    from.capacity - from.booked_seats - from.held_seats,
    0,
  );
  to.available_seats = Math.max(
    to.capacity - to.booked_seats - to.held_seats,
    0,
  );
  from.updated_at = now;
  to.updated_at = now;
  syncSalesStatusToSeats(data, from, actor, now);
  syncSalesStatusToSeats(data, to, actor, now);

  if (repricing && requestedPrice !== null) {
    // Regenerates every traveller's still-`SNAPSHOT` BASE_FARE line at the
    // target rate; a hand-repriced (`MANUAL`) traveller keeps their own fare
    // even across the move.
    regenerateSnapshotBaseFaresInStore(data, booking.id, requestedPrice, undefined, actor, now);
    booking.package_price_per_person = requestedPrice;
    booking.amount_paid = Math.min(
      booking.amount_paid,
      booking.total_booking_value,
    );
  }
  booking.outstanding_balance = money(
    Math.max(booking.total_booking_value - booking.amount_paid, 0),
  );
  // The due date is derived from the departure date and payment schedule, so
  // it follows the target group, not the one the booking is leaving.
  booking.next_due_at =
    booking.outstanding_balance > 0
      ? resolveNextMilestoneDueDate(
          groupMilestones(data, to.id),
          booking.total_booking_value,
          booking.amount_paid,
          to.departure_date,
          now,
        )
      : null;

  if (input.reissueReference) {
    booking.booking_reference = nextBookingReference(to.group_code, data);
  }
  booking.departure_group_id = to.id;

  // Document requirements are frozen per group, so they come from the target.
  const targetSnapshot = data.snapshots.find(
    (s) => s.departure_group_id === to.id,
  );
  const targetRequirements =
    targetSnapshot?.traveller_requirements_snapshot ?? [];

  const nowMs = Date.parse(now);
  for (const pilgrim of data.pilgrims) {
    if (pilgrim.booking_id !== booking.id) continue;

    pilgrim.departure_group_id = to.id;
    // Charge and deviation rows carry their own `departure_group_id` (for
    // repository scoping) independent of the pilgrim/booking they belong to,
    // so a move has to walk them across explicitly or they would vanish from
    // both groups' views.
    for (const charge of data.pilgrimCharges) {
      if (charge.group_pilgrim_id === pilgrim.id) charge.departure_group_id = to.id;
    }
    for (const deviation of data.pilgrimDeviations) {
      if (deviation.group_pilgrim_id === pilgrim.id) deviation.departure_group_id = to.id;
    }
    // `releaseBookingRooms` cleared the rooms that existed; this also clears a
    // status left over without one, so nobody arrives marked as roomed.
    pilgrim.room_id = null;
    pilgrim.room_assignment_status = "UNASSIGNED";
    // A ticket on the old group's flight is not a seat on the new one.
    if (pilgrim.flight_status !== "CANCELLED") {
      pilgrim.flight_status = "PENDING";
    }

    /**
     * Rebuild the checklist against the group the traveller is joining.
     *
     * The requirement a document answers is what carries forward, not its
     * position: matching on `requirement_id` means a passport scan already
     * verified for the old group stays verified if the new group asks for the
     * same thing, while a requirement only the new group has starts empty. The
     * previous code moved a *count* across, which silently marked arbitrary
     * requirements of the new group as done.
     */
    if (targetRequirements.length > 0) {
      const carried = new Map(
        data.pilgrimDocuments
          .filter((d) => d.pilgrim_id === pilgrim.id)
          .map((d) => [d.requirement_id, d]),
      );

      const rebuilt = buildPilgrimDocuments(
        targetRequirements,
        to.id,
        pilgrim.id,
        () => newId(),
        now,
      ).map((fresh) => {
        const previous = carried.get(fresh.requirement_id);
        if (!previous) return fresh;
        return {
          ...fresh,
          id: previous.id,
          status: previous.status,
          file_path: previous.file_path,
          file_name: previous.file_name,
          file_size_bytes: previous.file_size_bytes,
          rejection_reason: previous.rejection_reason,
          submitted_at: previous.submitted_at,
          verified_at: previous.verified_at,
          verified_by: previous.verified_by,
          verified_by_name: previous.verified_by_name,
          notes: previous.notes,
          created_at: previous.created_at,
        };
      });

      data.pilgrimDocuments = data.pilgrimDocuments.filter(
        (d) => d.pilgrim_id !== pilgrim.id,
      );
      data.pilgrimDocuments.push(...rebuilt);
    } else {
      // The target group froze no traveller requirements, so the checklist
      // moves across unchanged rather than being emptied.
      for (const document of data.pilgrimDocuments) {
        if (document.pilgrim_id === pilgrim.id) {
          document.departure_group_id = to.id;
        }
      }
    }

    if (pilgrim.payment_status !== "REFUND_PENDING") {
      pilgrim.payment_status = derivePaymentStatus(
        booking.total_booking_value,
        booking.amount_paid,
        booking.next_due_at,
        nowMs,
      );
    }

    // A visa is issued against a specific journey; changing group invalidates it.
    if (pilgrim.visa_status === "APPROVED") {
      pilgrim.visa_issue_note = `Issued against ${from.group_code}. Re-check validity for ${to.group_code}.`;
    }

    syncPilgrimDerivedState(data, pilgrim, now);
  }

  advanceGroupToPreparing(to, now);

  const referenceLabel =
    booking.booking_reference === previousReference
      ? booking.booking_reference
      : `${previousReference} → ${booking.booking_reference}`;
  const priceLabel = repricing
    ? ` Repriced to ${requestedPrice!.toLocaleString("en-US")} per person.`
    : "";
  const roomsLabel =
    releasedRoomAssignments > 0
      ? ` ${releasedRoomAssignments} room assignment${
          releasedRoomAssignments === 1 ? "" : "s"
        } released.`
      : "";
  const noteLabel = input.note ? ` Note: ${input.note}` : "";
  const travellerLabel = `${travellers} traveller${travellers === 1 ? "" : "s"}`;

  const beforeValue = {
    departure_group: from.group_code,
    booking_reference: previousReference,
    ...(repricing
      ? {
          package_price_per_person: priceBefore,
          total_booking_value: totalBefore,
        }
      : {}),
  };
  const afterValue = {
    departure_group: to.group_code,
    booking_reference: booking.booking_reference,
    ...(repricing
      ? {
          package_price_per_person: booking.package_price_per_person,
          total_booking_value: booking.total_booking_value,
        }
      : {}),
  };
  data.activity.push({
    id: newId(),
    departure_group_id: from.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_MOVED_OUT",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: beforeValue,
    after_value: afterValue,
    message: `Booking ${referenceLabel} (${booking.primary_contact_name}, ${travellerLabel}) moved out to ${to.group_name} (${to.group_code}).${priceLabel}${roomsLabel}${noteLabel}`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  data.activity.push({
    id: newId(),
    departure_group_id: to.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_MOVED_IN",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: beforeValue,
    after_value: afterValue,
    message: `Booking ${referenceLabel} (${booking.primary_contact_name}, ${travellerLabel}) moved in from ${from.group_name} (${from.group_code}). Rooming and flights need rebuilding.${priceLabel}${noteLabel}`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      previousReference,
      primaryContactName: booking.primary_contact_name,
      travellerCount: travellers,
      fromGroupName: from.group_name,
      toGroupId: to.id,
      toGroupName: to.group_name,
      toGroupCode: to.group_code,
      repriced: repricing,
      packagePricePerPerson: booking.package_price_per_person,
      totalBookingValue: booking.total_booking_value,
      outstandingBalance: booking.outstanding_balance,
      releasedRoomAssignments,
      targetAvailableSeats: to.available_seats,
    },
  };
}

/* ── Expiring seat holds ──────────────────────────────────────────────────── */

export interface ReleaseExpiredHoldsResult {
  releasedBookings: number;
  releasedSeats: number;
  references: string[];
}

/**
 * Returns the seats behind holds whose expiry has passed.
 *
 * The module already wrote `seat_hold_expires_at` on every hold, exposed
 * `seat_hold_expiry_hours` as a per-group setting in the edit sheet, and the
 * migration even ships a partial index built specifically for this sweep — but
 * nothing ever ran it. Held seats therefore leaked capacity permanently: a
 * 24-hour hold nobody followed up sat in `held_seats` until someone noticed and
 * cancelled the booking by hand, and `available_seats` was wrong the whole time.
 *
 * Idempotent and safe to run on every group read: a hold with no expiry, or one
 * whose expiry is still in the future, is untouched.
 */
export function releaseExpiredSeatHoldsInStore(
  data: DepartureGroupStore,
  departureGroupId: string,
  now: string = new Date().toISOString(),
): ReleaseExpiredHoldsResult {
  const nowMs = Date.parse(now);
  const result: ReleaseExpiredHoldsResult = {
    releasedBookings: 0,
    releasedSeats: 0,
    references: [],
  };

  const group = data.groups.find((g) => g.id === departureGroupId);
  if (!group) return result;

  for (const booking of data.bookings) {
    if (booking.departure_group_id !== departureGroupId) continue;
    if (booking.booking_status !== "HELD") continue;
    if (!booking.seat_hold_expires_at) continue;

    const expiry = Date.parse(booking.seat_hold_expires_at);
    if (!Number.isFinite(expiry) || expiry > nowMs) continue;

    // Money already taken means somebody committed. Expiring that silently
    // would strand a paid traveller with no seat, so it is left for a person.
    if (booking.amount_paid > 0) continue;

    releaseBookingRooms(data, booking.id, true);

    booking.booking_status = "CANCELLED";
    booking.seat_hold_expires_at = null;
    booking.hold_released_at = now;
    booking.outstanding_balance = 0;
    booking.next_due_at = null;

    for (const pilgrim of data.pilgrims) {
      if (pilgrim.booking_id !== booking.id) continue;
      pilgrim.seat_status = "CANCELLED";
      pilgrim.flight_status = "CANCELLED";
      pilgrim.room_id = null;
      pilgrim.room_assignment_status = "UNASSIGNED";
      if (pilgrim.visa_status !== "APPROVED") {
        pilgrim.visa_status = "NOT_STARTED";
        pilgrim.visa_submitted_at = null;
        pilgrim.visa_reviewed_at = null;
      }
    }

    group.held_seats = Math.max(group.held_seats - booking.traveller_count, 0);
    result.releasedBookings++;
    result.releasedSeats += booking.traveller_count;
    result.references.push(booking.booking_reference);

    data.activity.push({
      id: newId(),
      departure_group_id: departureGroupId,
      actor_id: null,
      actor_name_snapshot: "System",
      action_type: "SEAT_HOLD_EXPIRED",
      entity_type: "BOOKING",
      entity_id: booking.id,
      before_value: { booking_status: "HELD" },
      after_value: { booking_status: "CANCELLED" },
      message: `Seat hold on ${booking.booking_reference} (${booking.primary_contact_name}) expired — ${booking.traveller_count} seat${
        booking.traveller_count === 1 ? "" : "s"
      } released back to the group.`,
      is_system: true,
      is_high_impact: false,
      created_at: now,
    });
  }

  if (result.releasedBookings > 0) {
    group.available_seats = Math.max(
      group.capacity - group.booked_seats - group.held_seats,
      0,
    );
    group.updated_at = now;
    // System-triggered — no staff actor to attribute the sales reopen to.
    syncSalesStatusToSeats(data, group, null, now);
  }

  return result;
}

/* ── Waitlist promotion ───────────────────────────────────────────────────── */

export interface PromoteWaitlistResult {
  bookingReference: string;
  primaryContactName: string;
  travellerCount: number;
  seatHoldExpiresAt: string;
  remainingWaitlist: number;
}

export type PromoteWaitlistOutcome =
  | { ok: true; result: PromoteWaitlistResult }
  | { ok: false; error: string };

/**
 * Gives a freed seat to the longest-waiting booking.
 *
 * `waitlist_enabled` used to do nothing but change a label: a booking placed on
 * the waitlist could never become a real one, so when a seat came back — a
 * cancellation, an expired hold, a capacity increase — the person who had been
 * waiting for it had to be re-entered from scratch as a new booking, losing
 * their place, their reference and their history.
 *
 * The promoted booking becomes a hold rather than a confirmation: the traveller
 * has not paid yet, and the same expiry clock that governs every other hold
 * should govern this one, so an unanswered promotion returns the seat to the
 * next person in line instead of parking it indefinitely.
 */
export function promoteWaitlistBookingInStore(
  data: DepartureGroupStore,
  input: { departureGroupId: string; bookingId?: string },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): PromoteWaitlistOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }
  if (group.group_status === "CANCELLED" || group.group_status === "CLOSED") {
    return { ok: false, error: "This group is closed." };
  }
  if (group.group_status === "DEPARTED" || group.group_status === "COMPLETED") {
    return { ok: false, error: "This group has already departed." };
  }

  const waiting = data.bookings
    .filter(
      (b) =>
        b.departure_group_id === group.id && b.booking_status === "WAITLIST",
    )
    .sort(
      (a, b) =>
        (a.waitlist_position ?? Number.MAX_SAFE_INTEGER) -
          (b.waitlist_position ?? Number.MAX_SAFE_INTEGER) ||
        a.created_at.localeCompare(b.created_at),
    );

  if (waiting.length === 0) {
    return { ok: false, error: "Nobody is on the waitlist for this group." };
  }

  const booking = input.bookingId
    ? waiting.find((b) => b.id === input.bookingId)
    : waiting[0];
  if (!booking) {
    return { ok: false, error: "That booking is not on the waitlist." };
  }

  if (booking.traveller_count > group.available_seats) {
    return {
      ok: false,
      error: `${booking.booking_reference} needs ${booking.traveller_count} seat${
        booking.traveller_count === 1 ? "" : "s"
      } and only ${group.available_seats} ${
        group.available_seats === 1 ? "is" : "are"
      } free. Promote a smaller booking or raise the capacity.`,
    };
  }

  const expiresAt = new Date(
    Date.parse(now) + group.seat_hold_expiry_hours * 3_600_000,
  ).toISOString();

  booking.booking_status = "HELD";
  booking.seat_hold_expires_at = expiresAt;
  booking.hold_released_at = null;
  booking.waitlist_position = null;
  booking.outstanding_balance = money(
    Math.max(booking.total_booking_value - booking.amount_paid, 0),
  );
  booking.next_due_at =
    booking.outstanding_balance > 0
      ? resolveNextMilestoneDueDate(
          groupMilestones(data, group.id),
          booking.total_booking_value,
          booking.amount_paid,
          group.departure_date,
          now,
        )
      : null;

  for (const pilgrim of data.pilgrims) {
    if (pilgrim.booking_id !== booking.id) continue;
    pilgrim.seat_status = "HELD";
    if (pilgrim.flight_status === "CANCELLED") pilgrim.flight_status = "PENDING";
  }

  group.held_seats += booking.traveller_count;
  group.available_seats = Math.max(
    group.capacity - group.booked_seats - group.held_seats,
    0,
  );
  group.updated_at = now;
  syncSalesStatusToSeats(data, group, actor, now);
  advanceGroupToPreparing(group, now);

  // Everyone behind the promoted booking moves up, so the queue stays 1..n.
  let position = 1;
  for (const entry of waiting) {
    if (entry.id === booking.id) continue;
    entry.waitlist_position = position++;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: group.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "WAITLIST_PROMOTED",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: { booking_status: "WAITLIST" },
    after_value: { booking_status: "HELD", seat_hold_expires_at: expiresAt },
    message: `${booking.booking_reference} (${booking.primary_contact_name}) promoted from the waitlist — ${booking.traveller_count} seat${
      booking.traveller_count === 1 ? "" : "s"
    } held until ${expiresAt.slice(0, 16).replace("T", " ")} UTC.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      primaryContactName: booking.primary_contact_name,
      travellerCount: booking.traveller_count,
      seatHoldExpiresAt: expiresAt,
      remainingWaitlist: waiting.length - 1,
    },
  };
}

/* ── Booking payer ─────────────────────────────────────────────────────────── */

export interface SetBookingPayerInput {
  bookingId: string;
  departureGroupId: string;
  /** Exactly one of payerPilgrimId/payerLeadId/payerName should identify the payer; the others are cleared. */
  payerPilgrimId?: string | null;
  payerLeadId?: string | null;
  payerName?: string | null;
  payerEmail?: string | null;
  bookingType?: "GROUP" | "CUSTOM";
}

export interface SetBookingPayerResult {
  bookingReference: string;
  payerName: string | null;
  payerEmail: string | null;
  bookingType: "GROUP" | "CUSTOM";
}

export type SetBookingPayerOutcome =
  | { ok: true; result: SetBookingPayerResult }
  | { ok: false; error: string };

/**
 * Records who is actually paying for a booking, when that differs from the
 * on-the-ground `primary_contact_name/phone` — a relative settling the bill
 * for a traveller abroad, an agent paying on a customer's behalf. At most one
 * of `payerPilgrimId`/`payerLeadId` is kept; setting one clears the other, and
 * `payerName`/`payerEmail` cover a payer who is neither an onboarded pilgrim
 * nor a lead.
 */
export function setBookingPayerInStore(
  data: DepartureGroupStore,
  input: SetBookingPayerInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): SetBookingPayerOutcome {
  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };

  const payerName = input.payerName?.trim() || null;
  const payerEmail = input.payerEmail?.trim() || null;
  const payerPilgrimId = input.payerPilgrimId ?? null;
  const payerLeadId = payerPilgrimId ? null : (input.payerLeadId ?? null);
  const bookingType = input.bookingType ?? booking.booking_type ?? "GROUP";

  if (!payerPilgrimId && !payerLeadId && !payerName) {
    return { ok: false, error: "Identify the payer by name, or link a pilgrim or lead." };
  }

  const before = {
    payer_pilgrim_id: booking.payer_pilgrim_id,
    payer_lead_id: booking.payer_lead_id,
    payer_name: booking.payer_name,
    payer_email: booking.payer_email,
    booking_type: booking.booking_type,
  };

  booking.payer_pilgrim_id = payerPilgrimId;
  booking.payer_lead_id = payerLeadId;
  booking.payer_name = payerName;
  booking.payer_email = payerEmail;
  booking.booking_type = bookingType;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "BOOKING_PAYER_SET",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: before,
    after_value: {
      payer_pilgrim_id: payerPilgrimId,
      payer_lead_id: payerLeadId,
      payer_name: payerName,
      payer_email: payerEmail,
      booking_type: bookingType,
    },
    message: `Payer set on booking ${booking.booking_reference}: ${payerName ?? "linked pilgrim/lead"}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      bookingReference: booking.booking_reference,
      payerName,
      payerEmail,
      bookingType,
    },
  };
}

/* ── Traveller relationships ──────────────────────────────────────────────── */

export type TravellerRelationshipType =
  | "MAHRAM"
  | "SPOUSE"
  | "PARENT"
  | "CHILD"
  | "SIBLING"
  | "COMPANION"
  | "OTHER";

export interface AddTravellerRelationshipInput {
  bookingId: string;
  departureGroupId: string;
  fromPilgrimId: string;
  toPilgrimId: string;
  relationship: TravellerRelationshipType;
  isMahram: boolean;
  note?: string;
}

export interface AddTravellerRelationshipResult {
  id: string;
  fromName: string;
  toName: string;
}

export type AddTravellerRelationshipOutcome =
  | { ok: true; result: AddTravellerRelationshipResult }
  | { ok: false; error: string };

/**
 * Records a relationship edge between two travellers on the same booking —
 * a mahram accompanying a female pilgrim, a spouse, a minor's parent. Both
 * ends must already be travellers on this exact booking; a relationship
 * cannot reach across bookings or groups.
 */
export function addTravellerRelationshipInStore(
  data: DepartureGroupStore,
  input: AddTravellerRelationshipInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AddTravellerRelationshipOutcome {
  if (input.fromPilgrimId === input.toPilgrimId) {
    return { ok: false, error: "A traveller cannot be related to themselves." };
  }

  const booking = data.bookings.find(
    (b) =>
      b.id === input.bookingId &&
      b.departure_group_id === input.departureGroupId,
  );
  if (!booking) return { ok: false, error: "That booking no longer exists." };

  const from = data.pilgrims.find(
    (p) => p.id === input.fromPilgrimId && p.booking_id === booking.id,
  );
  const to = data.pilgrims.find(
    (p) => p.id === input.toPilgrimId && p.booking_id === booking.id,
  );
  if (!from || !to) {
    return { ok: false, error: "Both travellers must be on this booking." };
  }

  const exists = data.travellerRelationships.some(
    (r) =>
      r.booking_id === booking.id &&
      r.from_pilgrim_id === input.fromPilgrimId &&
      r.to_pilgrim_id === input.toPilgrimId,
  );
  if (exists) {
    return { ok: false, error: "That relationship is already recorded." };
  }

  const id = newId();
  data.travellerRelationships.push({
    id,
    departure_group_id: booking.departure_group_id,
    booking_id: booking.id,
    from_pilgrim_id: input.fromPilgrimId,
    to_pilgrim_id: input.toPilgrimId,
    relationship: input.relationship,
    is_mahram: input.isMahram,
    note: input.note?.trim() || null,
    created_by_name: actor.name,
    created_at: now,
  });

  data.activity.push({
    id: newId(),
    departure_group_id: booking.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRAVELLER_RELATIONSHIP_ADDED",
    entity_type: "BOOKING",
    entity_id: booking.id,
    before_value: null,
    after_value: {
      from_pilgrim_id: input.fromPilgrimId,
      to_pilgrim_id: input.toPilgrimId,
      relationship: input.relationship,
      is_mahram: input.isMahram,
    },
    message: `${from.full_name_snapshot} recorded as ${input.relationship.toLowerCase()}${
      input.isMahram ? " (mahram)" : ""
    } for ${to.full_name_snapshot} on booking ${booking.booking_reference}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      id,
      fromName: from.full_name_snapshot,
      toName: to.full_name_snapshot,
    },
  };
}

export interface RemoveTravellerRelationshipInput {
  relationshipId: string;
  bookingId: string;
  departureGroupId: string;
}

export type RemoveTravellerRelationshipOutcome =
  | { ok: true }
  | { ok: false; error: string };

export function removeTravellerRelationshipInStore(
  data: DepartureGroupStore,
  input: RemoveTravellerRelationshipInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): RemoveTravellerRelationshipOutcome {
  const index = data.travellerRelationships.findIndex(
    (r) =>
      r.id === input.relationshipId &&
      r.booking_id === input.bookingId &&
      r.departure_group_id === input.departureGroupId,
  );
  if (index === -1) {
    return { ok: false, error: "That relationship no longer exists." };
  }

  const [removed] = data.travellerRelationships.splice(index, 1);

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRAVELLER_RELATIONSHIP_REMOVED",
    entity_type: "BOOKING",
    entity_id: input.bookingId,
    before_value: { ...removed },
    after_value: null,
    message: `A traveller relationship was removed from booking ${input.bookingId}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true };
}
