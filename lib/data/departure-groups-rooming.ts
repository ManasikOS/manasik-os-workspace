/**
 * Accommodation and room-assignment mutation logic, kept pure and
 * store-passing so it can be unit-tested without the Next server runtime
 * (mirroring how `departure-groups-bookings.ts` is separated from the data
 * layer). The thin wrappers in `departure-groups.ts` supply the live store.
 */

import { daysBetween } from "@/lib/data/departure-groups-copy";
import {
  isTravellingPilgrim,
  recomputeRoomStatus,
} from "@/lib/data/departure-groups-bookings";
import { newId } from "@/lib/data/departure-groups-ids";
import { describeAutoAssignSkipped } from "@/app/(main)/departure-groups/utils";
import type {
  AccommodationCity,
  DepartureGroupAccommodationRow,
  DepartureGroupRoomRow,
  GroupActor,
  RoomType,
  SupplierStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/**
 * Recomputes a pilgrim's rollup room fields (`room_id`, `room_assignment_status`)
 * from their actual `roomAssignments` rows after one of those rows changed.
 *
 * A pilgrim can hold at most one room per accommodation (Makkah and Madinah
 * simultaneously — see the `unique (pilgrim_id, accommodation_id)` constraint
 * on `departure_group_room_assignments`), so the single `room_id` scalar can
 * no longer name "the" room; it is kept only as a "last touched room"
 * convenience for callers that just want *a* room reference. `LOCKED` is
 * never set anywhere in this app (only pre-set on imported/seeded data — see
 * `unlockPilgrimRoomAssignmentInStore`), so it is left untouched here rather
 * than risk clobbering a state nothing else in this module can re-derive.
 */
function syncPilgrimRoomSummary(data: DepartureGroupStore, pilgrimId: string): void {
  const pilgrim = data.pilgrims.find((p) => p.id === pilgrimId);
  if (!pilgrim || pilgrim.room_assignment_status === "LOCKED") return;

  const remaining = data.roomAssignments
    .filter((row) => row.pilgrim_id === pilgrimId)
    .sort((a, b) => (a.assigned_at < b.assigned_at ? 1 : -1));

  if (remaining.length === 0) {
    pilgrim.room_id = null;
    pilgrim.room_assignment_status = "UNASSIGNED";
  } else {
    pilgrim.room_id = remaining[0].room_id;
    pilgrim.room_assignment_status = "ASSIGNED";
  }
}

/* ── Add a new accommodation block ────────────────────────────────────────── */

export interface CreateAccommodationInput {
  departureGroupId: string;
  city: AccommodationCity;
  hotelName: string;
  supplierName?: string | null;
  /** FK into `public.suppliers`. `supplierName` stays the printable snapshot. */
  supplierId?: string | null;
  bookingReference?: string | null;
  status: SupplierStatus;
  checkInDate: string;
  checkOutDate: string;
  roomCapacity: number;
  roomsReserved: number;
  mealPlan?: string | null;
  distanceDescription?: string | null;
  internalCost?: number | null;
  notes?: string | null;
}

export type CreateAccommodationOutcome =
  | { ok: true; result: { id: string; hotelName: string } }
  | { ok: false; error: string };

/**
 * Adds a new accommodation block to a group ("Add Hotel"). This is the only
 * insert path for accommodations — until this existed, a group whose
 * "Accommodation and transport requirements" copy option was unticked at
 * creation had no way to ever get a hotel added, since `updateAccommodationInStore`
 * below only ever edits a block that already exists.
 */
export function createAccommodationInStore(
  data: DepartureGroupStore,
  input: CreateAccommodationInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): CreateAccommodationOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  const accommodation: DepartureGroupAccommodationRow = {
    id: newId(),
    departure_group_id: input.departureGroupId,
    city: input.city,
    hotel_name: input.hotelName,
    supplier_name: input.supplierName?.trim() || null,
    supplier_id: input.supplierId ?? null,
    booking_reference: input.bookingReference?.trim() || null,
    status: input.status,
    check_in_date: input.checkInDate,
    check_out_date: input.checkOutDate,
    nights: Math.max(daysBetween(input.checkInDate, input.checkOutDate), 0),
    room_capacity: input.roomCapacity,
    rooms_reserved: input.roomsReserved,
    rooms_allocated: 0,
    meal_plan: input.mealPlan?.trim() || null,
    distance_description: input.distanceDescription?.trim() || null,
    voucher_url: null,
    internal_cost: input.internalCost ?? null,
    notes: input.notes?.trim() || null,
  };
  data.accommodations.push(accommodation);
  group.updated_at = now;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ACCOMMODATION_ADDED",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: null,
    after_value: { hotel_name: accommodation.hotel_name, city: accommodation.city },
    message: `Accommodation added: ${accommodation.hotel_name} (${accommodation.city}).`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { id: accommodation.id, hotelName: accommodation.hotel_name } };
}

/* ── Edit accommodation details ───────────────────────────────────────────── */

export interface UpdateAccommodationInput {
  id: string;
  departureGroupId: string;
  hotelName: string;
  supplierName?: string | null;
  /** FK into `public.suppliers`. `supplierName` stays the printable snapshot. */
  supplierId?: string | null;
  bookingReference?: string | null;
  status: SupplierStatus;
  checkInDate: string;
  checkOutDate: string;
  roomCapacity: number;
  roomsReserved: number;
  mealPlan?: string | null;
  distanceDescription?: string | null;
  internalCost?: number | null;
  notes?: string | null;
}

export type UpdateAccommodationOutcome =
  | { ok: true; result: { hotelName: string } }
  | { ok: false; error: string };

/**
 * Clears rooming under one accommodation block. Cancelling the block means
 * its rooms are no longer reserved at all, so — unlike a booking-level tier
 * change — locked assignments are released too rather than preserved; there
 * is no hotel left underneath them to keep a traveller locked into.
 */
function releaseAccommodationRooms(
  data: DepartureGroupStore,
  accommodationId: string,
): number {
  const roomIds = new Set(
    data.rooms
      .filter((r) => r.accommodation_id === accommodationId)
      .map((r) => r.id),
  );
  if (roomIds.size === 0) return 0;

  // Read off the assignment rows directly rather than `pilgrim.room_id` — a
  // pilgrim can hold a room in another accommodation too, and that scalar
  // only ever names their most recently touched one, so it can miss (or
  // wrongly match) an assignment under *this* accommodation.
  const affectedAssignments = data.roomAssignments.filter((row) =>
    roomIds.has(row.room_id),
  );
  if (affectedAssignments.length === 0) return 0;

  const pilgrimIds = new Set(affectedAssignments.map((row) => row.pilgrim_id));

  data.roomAssignments = data.roomAssignments.filter(
    (row) => !roomIds.has(row.room_id),
  );

  // Recomputed rather than blindly cleared: a pilgrim released from this
  // accommodation may still hold a room in a different one.
  for (const pilgrimId of pilgrimIds) {
    syncPilgrimRoomSummary(data, pilgrimId);
  }

  for (const room of data.rooms) {
    if (!roomIds.has(room.id)) continue;
    room.assigned_pilgrim_count = 0;
    recomputeRoomStatus(room);
  }

  return pilgrimIds.size;
}

export function updateAccommodationInStore(
  data: DepartureGroupStore,
  input: UpdateAccommodationInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdateAccommodationOutcome {
  const accommodation = data.accommodations.find(
    (a) => a.id === input.id && a.departure_group_id === input.departureGroupId,
  );
  if (!accommodation) {
    return { ok: false, error: "That accommodation block no longer exists." };
  }

  const before = { status: accommodation.status };

  const nextSupplierName = input.supplierName?.trim() || null;
  const nextBookingReference = input.bookingReference?.trim() || null;

  // Confirming asserts a supplier promise exists and is evidenced. This
  // dropdown is a second path into CONFIRMED besides "Mark Confirmed" below,
  // so it must not be allowed to skip the same evidence gate.
  if (input.status === "CONFIRMED" && accommodation.status !== "CONFIRMED") {
    if (!nextSupplierName) {
      return { ok: false, error: "Record a supplier name before confirming this accommodation." };
    }
    if (!nextBookingReference && !accommodation.voucher_url?.trim()) {
      return { ok: false, error: "Record a booking reference or upload a voucher before confirming this accommodation." };
    }
  }

  accommodation.hotel_name = input.hotelName;
  accommodation.supplier_name = nextSupplierName;
  accommodation.supplier_id = input.supplierId ?? null;
  accommodation.booking_reference = nextBookingReference;
  accommodation.status = input.status;
  accommodation.check_in_date = input.checkInDate;
  accommodation.check_out_date = input.checkOutDate;
  accommodation.nights = Math.max(
    daysBetween(input.checkInDate, input.checkOutDate),
    0,
  );
  accommodation.room_capacity = input.roomCapacity;
  accommodation.rooms_reserved = input.roomsReserved;
  accommodation.meal_plan = input.mealPlan?.trim() || null;
  accommodation.distance_description = input.distanceDescription?.trim() || null;
  accommodation.internal_cost = input.internalCost ?? null;
  accommodation.notes = input.notes?.trim() || null;

  const justCancelled =
    accommodation.status === "CANCELLED" && before.status !== "CANCELLED";
  const releasedCount = justCancelled
    ? releaseAccommodationRooms(data, accommodation.id)
    : 0;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ACCOMMODATION_UPDATED",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: { status: before.status },
    after_value: { status: accommodation.status },
    message: `${accommodation.city.charAt(0)}${accommodation.city
      .slice(1)
      .toLowerCase()} accommodation (${accommodation.hotel_name}) updated.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  if (justCancelled && releasedCount > 0) {
    data.activity.push({
      id: newId(),
      departure_group_id: input.departureGroupId,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      action_type: "ACCOMMODATION_UPDATED",
      entity_type: "ACCOMMODATION",
      entity_id: accommodation.id,
      before_value: null,
      after_value: { releasedRoomAssignments: releasedCount },
      message: `${releasedCount} room assignment${
        releasedCount === 1 ? "" : "s"
      } released at ${accommodation.hotel_name} after cancellation.`,
      is_system: true,
      is_high_impact: true,
      created_at: now,
    });
  }

  return { ok: true, result: { hotelName: accommodation.hotel_name } };
}

/* ── Voucher / reference / confirm ────────────────────────────────────────── */

export type AccommodationTouchOutcome =
  | { ok: true; result: { hotelName: string } }
  | { ok: false; error: string };

function findAccommodation(
  data: DepartureGroupStore,
  id: string,
  departureGroupId: string,
) {
  return data.accommodations.find(
    (a) => a.id === id && a.departure_group_id === departureGroupId,
  );
}

export function setAccommodationVoucherInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; voucherUrl: string },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AccommodationTouchOutcome {
  const accommodation = findAccommodation(data, input.id, input.departureGroupId);
  if (!accommodation) {
    return { ok: false, error: "That accommodation block no longer exists." };
  }

  accommodation.voucher_url = input.voucherUrl;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ACCOMMODATION_VOUCHER_UPLOADED",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: null,
    after_value: { voucher_url: input.voucherUrl },
    message: `Voucher attached for ${accommodation.hotel_name}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { hotelName: accommodation.hotel_name } };
}

/**
 * Records the supplier's booking reference and/or the supplier's own name.
 * The Operations Supplier Confirmations board calls this to satisfy the
 * evidence gate on `markAccommodationConfirmedInStore` before confirming.
 */
export function setAccommodationReferenceInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; bookingReference?: string; supplierName?: string; supplierId?: string | null },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AccommodationTouchOutcome {
  const accommodation = findAccommodation(data, input.id, input.departureGroupId);
  if (!accommodation) {
    return { ok: false, error: "That accommodation block no longer exists." };
  }
  if (input.bookingReference === undefined && input.supplierName === undefined && input.supplierId === undefined) {
    return { ok: false, error: "Nothing to record." };
  }

  const after: Record<string, unknown> = {};
  if (input.bookingReference !== undefined) {
    accommodation.booking_reference = input.bookingReference;
    after.booking_reference = input.bookingReference;
  }
  if (input.supplierName !== undefined) {
    accommodation.supplier_name = input.supplierName;
    after.supplier_name = input.supplierName;
  }
  if (input.supplierId !== undefined) {
    accommodation.supplier_id = input.supplierId;
    after.supplier_id = input.supplierId;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ACCOMMODATION_REFERENCE_SET",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: null,
    after_value: after,
    message: `Supplier details recorded for ${accommodation.hotel_name}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { hotelName: accommodation.hotel_name } };
}

/**
 * Syncs the accommodation's `internal_cost` to a supplier commitment's
 * negotiated `amount`. Called only from `createCommitment()`
 * (lib/data/suppliers-repository.ts) when a new commitment is linked to this
 * accommodation — a commitment's `amount` is otherwise immutable after
 * creation, so this is the one point the two records can actually diverge.
 * Before this, the commitment (what Suppliers tracks as payable) and this
 * row (what the group's own Payments tab sums as `supplierPayablesDue`) were
 * two independently maintained numbers for the same real cost, with nothing
 * keeping them in step.
 */
export function setAccommodationInternalCostInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; internalCost: number },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AccommodationTouchOutcome {
  const accommodation = findAccommodation(data, input.id, input.departureGroupId);
  if (!accommodation) {
    return { ok: false, error: "That accommodation block no longer exists." };
  }

  const before = accommodation.internal_cost;
  accommodation.internal_cost = input.internalCost;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ACCOMMODATION_COST_SYNCED_FROM_COMMITMENT",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: { internal_cost: before },
    after_value: { internal_cost: input.internalCost },
    message: `Cost for ${accommodation.hotel_name} set to match the linked supplier commitment.`,
    is_system: true,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { hotelName: accommodation.hotel_name } };
}

export function markAccommodationConfirmedInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AccommodationTouchOutcome {
  const accommodation = findAccommodation(data, input.id, input.departureGroupId);
  if (!accommodation) {
    return { ok: false, error: "That accommodation block no longer exists." };
  }
  if (accommodation.status === "CONFIRMED") {
    return { ok: false, error: "This accommodation is already confirmed." };
  }
  if (accommodation.status === "CANCELLED") {
    return { ok: false, error: "This accommodation has been cancelled." };
  }
  // Confirming asserts a supplier promise exists and is evidenced — never
  // just a status flip. A supplier name plus either a booking reference or a
  // voucher is the minimum the Operations control tower is allowed to trust.
  if (!accommodation.supplier_name?.trim()) {
    return { ok: false, error: "Record a supplier name before confirming this accommodation." };
  }
  if (!accommodation.booking_reference?.trim() && !accommodation.voucher_url?.trim()) {
    return { ok: false, error: "Record a booking reference or upload a voucher before confirming this accommodation." };
  }

  const before = accommodation.status;
  accommodation.status = "CONFIRMED";

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ACCOMMODATION_CONFIRMED",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: { status: before },
    after_value: { status: "CONFIRMED" },
    message: `${accommodation.hotel_name} marked confirmed.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { hotelName: accommodation.hotel_name } };
}

/* ── Room assignment ──────────────────────────────────────────────────────── */

export interface AssignRoomInput {
  departureGroupId: string;
  pilgrimId: string;
  roomId: string;
}

export interface AssignRoomResult {
  pilgrimName: string;
  roomLabel: string;
  previousRoomLabel: string | null;
}

export type AssignRoomOutcome =
  | { ok: true; result: AssignRoomResult }
  | { ok: false; error: string };

/**
 * Removes one pilgrim from whatever room they currently hold *in this specific
 * accommodation*, if any — not every room they hold. A pilgrim legitimately
 * holds one room per accommodation (their Makkah room and their Madinah room
 * are different beds, held at once), so releasing every accommodation just
 * because one of them is being reassigned would silently evict them from
 * cities they were never touching.
 */
function releaseCurrentRoomInAccommodation(
  data: DepartureGroupStore,
  pilgrimId: string,
  accommodationId: string,
): void {
  const toRelease = data.roomAssignments.filter(
    (row) => row.pilgrim_id === pilgrimId && row.accommodation_id === accommodationId,
  );
  if (toRelease.length === 0) return;

  const releasedRoomIds = new Set(toRelease.map((row) => row.room_id));
  data.roomAssignments = data.roomAssignments.filter(
    (row) => !(row.pilgrim_id === pilgrimId && row.accommodation_id === accommodationId),
  );
  for (const roomId of releasedRoomIds) {
    const room = data.rooms.find((r) => r.id === roomId);
    if (!room) continue;
    room.assigned_pilgrim_count = Math.max(room.assigned_pilgrim_count - 1, 0);
    recomputeRoomStatus(room);
  }
}

/**
 * Assigns one pilgrim to one room ("Assign Manually").
 *
 * A pilgrim holds at most one room per accommodation — Makkah and Madinah
 * are separate beds held at the same time (see the `unique (pilgrim_id,
 * accommodation_id)` constraint on `departure_group_room_assignments`).
 * Assigning them elsewhere *within the same accommodation* first releases
 * that room — the bed they vacate becomes available again in the same step —
 * but a room they hold in a different accommodation is left untouched.
 */
export function assignPilgrimToRoomInStore(
  data: DepartureGroupStore,
  input: AssignRoomInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AssignRoomOutcome {
  const pilgrim = data.pilgrims.find(
    (p) => p.id === input.pilgrimId && p.departure_group_id === input.departureGroupId,
  );
  if (!pilgrim) return { ok: false, error: "That pilgrim no longer exists." };
  if (pilgrim.seat_status === "CANCELLED") {
    return { ok: false, error: "This pilgrim's booking has been cancelled." };
  }
  if (pilgrim.room_assignment_status === "LOCKED") {
    return {
      ok: false,
      error: "This pilgrim's room assignment is locked and cannot be changed here.",
    };
  }

  const room = data.rooms.find((r) => r.id === input.roomId);
  if (!room) return { ok: false, error: "That room no longer exists." };

  const accommodation = data.accommodations.find(
    (a) => a.id === room.accommodation_id,
  );
  if (!accommodation || accommodation.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That room does not belong to this group." };
  }

  const alreadyInThisRoom = data.roomAssignments.some(
    (row) => row.pilgrim_id === pilgrim.id && row.room_id === room.id,
  );
  if (alreadyInThisRoom) {
    return { ok: false, error: `${pilgrim.full_name_snapshot} is already in this room.` };
  }
  if (room.status === "BLOCKED") {
    return {
      ok: false,
      error: "This room is blocked. Unblock it before assigning anyone to it.",
    };
  }
  if (room.assigned_pilgrim_count >= room.occupancy_capacity) {
    return { ok: false, error: "This room is already full." };
  }

  // Only a room in the SAME accommodation counts as "the room being
  // replaced" — a room this pilgrim holds in a different accommodation
  // (their Madinah room, say, while this assignment is for Makkah) is a
  // separate, simultaneous booking and must not be touched.
  const previousAssignment = data.roomAssignments.find(
    (row) => row.pilgrim_id === pilgrim.id && row.accommodation_id === accommodation.id,
  );
  const previousRoom = previousAssignment
    ? data.rooms.find((r) => r.id === previousAssignment.room_id)
    : undefined;
  const previousRoomLabel = previousRoom
    ? `${previousRoom.room_number ?? "—"} · ${previousRoom.room_type}`
    : null;

  releaseCurrentRoomInAccommodation(data, pilgrim.id, accommodation.id);

  data.roomAssignments.push({
    id: newId(),
    room_id: room.id,
    accommodation_id: accommodation.id,
    pilgrim_id: pilgrim.id,
    assigned_at: now,
    assigned_by: actor.id,
    assigned_by_name: actor.name,
  });
  room.assigned_pilgrim_count += 1;
  recomputeRoomStatus(room);

  pilgrim.room_id = room.id;
  pilgrim.room_assignment_status = "ASSIGNED";

  const roomLabel = `${room.room_number ?? "—"} · ${room.room_type}`;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_ROOM_ASSIGNED",
    entity_type: "ROOM",
    entity_id: room.id,
    before_value: previousRoomLabel ? { room: previousRoomLabel } : null,
    after_value: { room: roomLabel },
    message: `${pilgrim.full_name_snapshot} assigned to room ${roomLabel}.${
      previousRoomLabel ? ` (moved from ${previousRoomLabel})` : ""
    }`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      pilgrimName: pilgrim.full_name_snapshot,
      roomLabel,
      previousRoomLabel,
    },
  };
}

/* ── Auto-assign ───────────────────────────────────────────────────────────── */

export interface AutoAssignRoomsInput {
  departureGroupId: string;
  /**
   * Scopes the fill to one accommodation (city). Auto-assign used to pool
   * rooms across every accommodation in the group and mark a pilgrim
   * "ASSIGNED" (globally) the moment they landed anywhere, which meant a
   * pilgrim auto-assigned a Madinah room was silently skipped forever after
   * for Makkah. One accommodation per run mirrors how the Hotels tab is
   * already organised (a tab per city) and how manual assignment now works.
   */
  accommodationId: string;
}

export interface AutoAssignRoomsResult {
  assigned: number;
  skipped: number;
  /** Of `skipped`, how many were left over solely because their occupancy type had no free beds. */
  typeMismatched: number;
}

export type AutoAssignRoomsOutcome =
  | { ok: true; result: AutoAssignRoomsResult }
  | { ok: false; error: string };

/**
 * Bulk-fills every unassigned pilgrim into available rooms across confirmed
 * or requested accommodation blocks ("Auto Assign Rooms").
 *
 * Travellers on the same booking are kept together where capacity allows: a
 * pilgrim is offered a room that already holds someone from their own
 * booking before a fresh one, so families and groups of friends don't end up
 * scattered purely by fill order. Pilgrims left over once every room is full
 * are reported, not silently dropped.
 */
export function autoAssignRoomsInStore(
  data: DepartureGroupStore,
  input: AutoAssignRoomsInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AutoAssignRoomsOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) return { ok: false, error: "That departure group no longer exists." };

  const accommodation = data.accommodations.find(
    (a) =>
      a.id === input.accommodationId &&
      a.departure_group_id === input.departureGroupId &&
      (a.status === "CONFIRMED" || a.status === "REQUESTED"),
  );
  if (!accommodation) {
    return { ok: false, error: "That accommodation is not ready to assign rooms yet." };
  }

  // A blocked room is out of service — maintenance, a supplier dispute, a
  // held-back upgrade — so the bulk fill must skip it even though it has beds
  // free. Only manual assignment can put someone into one.
  const rooms = data.rooms
    .filter(
      (r) => r.accommodation_id === accommodation.id && r.status !== "BLOCKED",
    )
    .sort((a, b) => (a.room_number ?? "").localeCompare(b.room_number ?? ""));

  if (rooms.length === 0) {
    return { ok: false, error: "No rooms are available to assign yet." };
  }

  // "Unassigned" here means "no room in THIS accommodation yet" — a pilgrim
  // already roomed in a different city is still owed a room here.
  const alreadyAssignedHere = new Set(
    data.roomAssignments
      .filter((row) => row.accommodation_id === accommodation.id)
      .map((row) => row.pilgrim_id),
  );

  const pilgrims = data.pilgrims
    .filter(
      (p) =>
        p.departure_group_id === input.departureGroupId &&
        // A waitlisted traveller has no seat to room yet — filling a real
        // bed with them would strand it the moment they either get promoted
        // into a different room split or never travel at all.
        isTravellingPilgrim(data, p) &&
        p.room_assignment_status !== "LOCKED" &&
        !alreadyAssignedHere.has(p.id),
    )
    .sort((a, b) => a.booking_id.localeCompare(b.booking_id));

  if (pilgrims.length === 0) {
    return { ok: false, error: "Every pilgrim already has a room in this accommodation." };
  }

  // A booking's `room_occupancy_preference` is the fallback for any traveller
  // on it with no individual override.
  const bookingPreference = new Map(
    data.bookings
      .filter((b) => b.departure_group_id === input.departureGroupId)
      .map((b) => [b.id, b.room_occupancy_preference] as const),
  );

  // booking_id -> room the booking's other travellers landed in, so far.
  const bookingRoom = new Map<string, string>();
  let assigned = 0;
  let skipped = 0;
  let typeMismatched = 0;

  for (const pilgrim of pilgrims) {
    // What this traveller is actually billed/expected for — never filled
    // into a different occupancy tier just because a bed happened to be
    // free there. A pilgrim billed QUAD landing in a DOUBLE was previously
    // silent and undetectable; now it is refused and counted instead.
    const desiredType =
      pilgrim.room_occupancy_type ?? bookingPreference.get(pilgrim.booking_id) ?? null;
    const fitsType = (r: (typeof rooms)[number]) =>
      !desiredType || r.room_type === desiredType;
    const hasCapacity = (r: (typeof rooms)[number]) =>
      r.assigned_pilgrim_count < r.occupancy_capacity;

    const preferredRoomId = bookingRoom.get(pilgrim.booking_id);
    const preferredRoom = preferredRoomId
      ? rooms.find((r) => r.id === preferredRoomId && hasCapacity(r) && fitsType(r))
      : undefined;
    const room = preferredRoom ?? rooms.find((r) => hasCapacity(r) && fitsType(r));

    if (!room) {
      skipped++;
      if (desiredType && rooms.some((r) => hasCapacity(r) && !fitsType(r))) {
        // Capacity exists, just not of the type this traveller needs.
        typeMismatched++;
      }
      continue;
    }

    data.roomAssignments.push({
      id: newId(),
      room_id: room.id,
      accommodation_id: accommodation.id,
      pilgrim_id: pilgrim.id,
      assigned_at: now,
      assigned_by: actor.id,
      assigned_by_name: actor.name,
    });
    room.assigned_pilgrim_count += 1;
    recomputeRoomStatus(room);
    pilgrim.room_id = room.id;
    pilgrim.room_assignment_status = "ASSIGNED";
    bookingRoom.set(pilgrim.booking_id, room.id);
    assigned++;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ROOMS_AUTO_ASSIGNED",
    entity_type: "ROOM",
    entity_id: null,
    before_value: null,
    after_value: { assigned, skipped, typeMismatched },
    message: `Auto-assigned ${assigned} pilgrim${assigned === 1 ? "" : "s"} to rooms.${describeAutoAssignSkipped(
      skipped,
      typeMismatched,
    )}`,
    is_system: false,
    is_high_impact: assigned > 0,
    created_at: now,
  });

  return { ok: true, result: { assigned, skipped, typeMismatched } };
}

/* ── Generate rooms ───────────────────────────────────────────────────────── */

export interface GenerateRoomsInput {
  accommodationId: string;
  departureGroupId: string;
  roomType: RoomType;
  occupancyCapacity: number;
  count: number;
  /** First room number/label to use; subsequent rooms increment from it. */
  startingRoomNumber?: string | null;
}

export type GenerateRoomsOutcome =
  | { ok: true; result: { created: number; hotelName: string } }
  | { ok: false; error: string };

/**
 * Produces the next `count` room labels starting from `start`. A numeric tail
 * is incremented (`"101"` -> `"102"`, `"A101"` -> `"A102"`) so a hotel's usual
 * numbering scheme survives; a label with no trailing digits is disambiguated
 * with a suffix instead (`"Annex"` -> `"Annex (2)"`). Labels already used by
 * another room under the same accommodation are skipped so two batches never
 * collide.
 */
function nextRoomNumbers(
  start: string | null,
  count: number,
  taken: Set<string>,
): (string | null)[] {
  if (!start?.trim()) return Array.from({ length: count }, () => null);

  const trimmed = start.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/);
  const out: string[] = [];

  if (!match) {
    let n = 1;
    let candidate = trimmed;
    while (out.length < count) {
      if (!taken.has(candidate)) {
        out.push(candidate);
        taken.add(candidate);
      }
      n++;
      candidate = `${trimmed} (${n})`;
    }
    return out;
  }

  const [, prefix, digits] = match;
  let n = parseInt(digits, 10);
  const width = digits.length;
  while (out.length < count) {
    const candidate = `${prefix}${String(n).padStart(width, "0")}`;
    if (!taken.has(candidate)) {
      out.push(candidate);
      taken.add(candidate);
    }
    n++;
  }
  return out;
}

/**
 * Creates the physical room inventory for an accommodation block ("Generate
 * Rooms"). Nothing else in this module ever inserts a `Room` row — an
 * accommodation's `rooms_reserved` count on its own is just a target number,
 * not proof that assignable rooms exist, which is what let a CONFIRMED
 * accommodation with "40 rooms reserved" reach Auto Assign with zero actual
 * rooms to place anyone into. This is the one place that gap is closed.
 */
export function generateRoomsInStore(
  data: DepartureGroupStore,
  input: GenerateRoomsInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): GenerateRoomsOutcome {
  const accommodation = data.accommodations.find(
    (a) =>
      a.id === input.accommodationId &&
      a.departure_group_id === input.departureGroupId,
  );
  if (!accommodation) {
    return { ok: false, error: "That accommodation block no longer exists." };
  }
  if (!Number.isFinite(input.count) || input.count < 1) {
    return { ok: false, error: "Enter at least one room to create." };
  }
  if (input.count > 500) {
    return { ok: false, error: "Create at most 500 rooms at a time." };
  }
  if (!Number.isFinite(input.occupancyCapacity) || input.occupancyCapacity < 1) {
    return { ok: false, error: "Room capacity must be at least one." };
  }

  const takenNumbers = new Set(
    data.rooms
      .filter((r) => r.accommodation_id === accommodation.id)
      .map((r) => r.room_number)
      .filter((n): n is string => !!n),
  );

  const numbers = nextRoomNumbers(
    input.startingRoomNumber ?? null,
    input.count,
    takenNumbers,
  );

  const created: DepartureGroupRoomRow[] = numbers.map((roomNumber) => ({
    id: newId(),
    accommodation_id: accommodation.id,
    room_number: roomNumber,
    room_type: input.roomType,
    occupancy_capacity: Math.round(input.occupancyCapacity),
    assigned_pilgrim_count: 0,
    status: "AVAILABLE",
    notes: null,
  }));

  data.rooms.push(...created);

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ROOMS_GENERATED",
    entity_type: "ACCOMMODATION",
    entity_id: accommodation.id,
    before_value: null,
    after_value: { created: created.length, roomType: input.roomType },
    message: `${created.length} ${input.roomType.toLowerCase()} room${
      created.length === 1 ? "" : "s"
    } created at ${accommodation.hotel_name}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: { created: created.length, hotelName: accommodation.hotel_name },
  };
}

/* ── Unlock room assignment ───────────────────────────────────────────────── */

export interface UnlockRoomAssignmentInput {
  departureGroupId: string;
  pilgrimId: string;
}

export type UnlockRoomAssignmentOutcome =
  | { ok: true; result: { pilgrimName: string } }
  | { ok: false; error: string };

/**
 * Reverts a LOCKED assignment back to ASSIGNED so it can be moved again —
 * the only route out of LOCKED anywhere in this module. Nothing sets LOCKED
 * either (that only ever arrives pre-set on imported/seeded data), but once a
 * pilgrim is in that state every other rooming mutation refuses to touch
 * them, so without this they would be stuck forever on a genuine mistake.
 */
export function unlockPilgrimRoomAssignmentInStore(
  data: DepartureGroupStore,
  input: UnlockRoomAssignmentInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UnlockRoomAssignmentOutcome {
  const pilgrim = data.pilgrims.find(
    (p) =>
      p.id === input.pilgrimId && p.departure_group_id === input.departureGroupId,
  );
  if (!pilgrim) return { ok: false, error: "That pilgrim no longer exists." };
  if (pilgrim.room_assignment_status !== "LOCKED") {
    return { ok: false, error: "This pilgrim's room assignment is not locked." };
  }

  pilgrim.room_assignment_status = "ASSIGNED";

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_ROOM_ASSIGNMENT_UNLOCKED",
    entity_type: "PILGRIM",
    entity_id: pilgrim.id,
    before_value: { room_assignment_status: "LOCKED" },
    after_value: { room_assignment_status: "ASSIGNED" },
    message: `${pilgrim.full_name_snapshot}'s room assignment unlocked.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { pilgrimName: pilgrim.full_name_snapshot } };
}

/* ── Edit / delete a single room ──────────────────────────────────────────── */

export interface UpdateRoomInput {
  id: string;
  departureGroupId: string;
  roomNumber?: string | null;
  roomType: RoomType;
  occupancyCapacity: number;
  blocked: boolean;
  notes?: string | null;
}

export type UpdateRoomOutcome =
  | { ok: true; result: { roomLabel: string } }
  | { ok: false; error: string };

function findGroupRoom(
  data: DepartureGroupStore,
  roomId: string,
  departureGroupId: string,
): DepartureGroupRoomRow | undefined {
  const room = data.rooms.find((r) => r.id === roomId);
  if (!room) return undefined;
  const accommodation = data.accommodations.find(
    (a) => a.id === room.accommodation_id,
  );
  if (!accommodation || accommodation.departure_group_id !== departureGroupId) {
    return undefined;
  }
  return room;
}

/** Edits one room's own details, including manually blocking/unblocking it. */
export function updateRoomInStore(
  data: DepartureGroupStore,
  input: UpdateRoomInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdateRoomOutcome {
  const room = findGroupRoom(data, input.id, input.departureGroupId);
  if (!room) return { ok: false, error: "That room no longer exists." };
  if (input.occupancyCapacity < room.assigned_pilgrim_count) {
    return {
      ok: false,
      error: `This room has ${room.assigned_pilgrim_count} pilgrim${
        room.assigned_pilgrim_count === 1 ? "" : "s"
      } in it — capacity cannot go below that.`,
    };
  }

  room.room_number = input.roomNumber?.trim() || null;
  room.room_type = input.roomType;
  room.occupancy_capacity = Math.round(input.occupancyCapacity);
  room.notes = input.notes?.trim() || null;
  room.status = input.blocked ? "BLOCKED" : "AVAILABLE";
  recomputeRoomStatus(room);
  // A block is a deliberate hold, not a fact derived from occupancy — force
  // it even though `recomputeRoomStatus` otherwise only ever preserves an
  // existing BLOCKED, never sets one.
  if (input.blocked) room.status = "BLOCKED";

  const roomLabel = `${room.room_number ?? "—"} · ${room.room_type}`;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ROOM_UPDATED",
    entity_type: "ROOM",
    entity_id: room.id,
    before_value: null,
    after_value: { room: roomLabel, blocked: input.blocked },
    message: `Room ${roomLabel} updated.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { roomLabel } };
}

export interface DeleteRoomInput {
  id: string;
  departureGroupId: string;
}

export type DeleteRoomOutcome =
  | { ok: true; result: { roomLabel: string } }
  | { ok: false; error: string };

/**
 * Removes a room outright. Refused while anyone is in it — deleting an
 * occupied room would silently unroom a pilgrim with no record of why, so
 * that traveller has to be moved out (Assign Manually, or Change Room
 * Preference) before the room itself can go.
 */
export function deleteRoomInStore(
  data: DepartureGroupStore,
  input: DeleteRoomInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): DeleteRoomOutcome {
  const room = findGroupRoom(data, input.id, input.departureGroupId);
  if (!room) return { ok: false, error: "That room no longer exists." };
  if (room.assigned_pilgrim_count > 0) {
    return {
      ok: false,
      error: "Move everyone out of this room before deleting it.",
    };
  }

  const roomLabel = `${room.room_number ?? "—"} · ${room.room_type}`;
  data.rooms = data.rooms.filter((r) => r.id !== room.id);
  data.roomAssignments = data.roomAssignments.filter(
    (row) => row.room_id !== room.id,
  );

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "ROOM_DELETED",
    entity_type: "ROOM",
    entity_id: room.id,
    before_value: { room: roomLabel },
    after_value: null,
    message: `Room ${roomLabel} deleted.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { roomLabel } };
}
