/**
 * Transport route mutation logic, kept pure and store-passing so it can be
 * unit-tested without the Next server runtime (mirroring how
 * `departure-groups-flights.ts` and `departure-groups-rooming.ts` are
 * separated from the data layer). The thin wrappers in `departure-groups.ts`
 * supply the live store.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import type {
  DepartureGroupTransportRow,
  GroupActor,
  SupplierStatus,
  VehicleType,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/* ── Add / edit a transport route ─────────────────────────────────────────── */

export interface UpsertTransportInput {
  id?: string;
  departureGroupId: string;
  templateTransportRequirementId?: string | null;
  routeLabel: string;
  origin: string;
  destination: string;
  status: SupplierStatus;
  supplierName?: string | null;
  /** FK into `public.suppliers`. `supplierName` stays the printable snapshot. */
  supplierId?: string | null;
  bookingReference?: string | null;
  vehicleType: VehicleType;
  vehicleCapacity?: number | null;
  passengerCount?: number | null;
  pickupAt?: string | null;
  pickupLocation?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  coordinatorName?: string | null;
  coordinatorPhone?: string | null;
  internalCost?: number | null;
  notes?: string | null;
}

export interface UpsertTransportResult {
  transportId: string;
  created: boolean;
}

export type UpsertTransportOutcome =
  | { ok: true; result: UpsertTransportResult }
  | { ok: false; error: string };

/**
 * Creates or edits a transport route.
 *
 * A route confirmed or completed with a driver already assigned cannot be
 * cancelled here — that would silently strand pilgrims expecting a pickup.
 */
export function upsertTransportInStore(
  data: DepartureGroupStore,
  input: UpsertTransportInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpsertTransportOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  if (input.id) {
    const transport = data.transports.find(
      (t) => t.id === input.id && t.departure_group_id === input.departureGroupId,
    );
    if (!transport) {
      return { ok: false, error: "That transport route no longer exists." };
    }

    if (
      input.status === "CANCELLED" &&
      (transport.status === "CONFIRMED" || transport.status === "COMPLETED") &&
      transport.driver_name
    ) {
      return {
        ok: false,
        error:
          "Cannot cancel this route — a driver is already assigned. Reassign or clear the driver first.",
      };
    }

    const before = { status: transport.status };

    transport.route_label = input.routeLabel;
    transport.origin = input.origin;
    transport.destination = input.destination;
    transport.status = input.status;
    transport.supplier_name = input.supplierName?.trim() || null;
    transport.supplier_id = input.supplierId ?? null;
    transport.booking_reference = input.bookingReference?.trim() || null;
    transport.vehicle_type = input.vehicleType;
    transport.vehicle_capacity = input.vehicleCapacity ?? null;
    transport.passenger_count = input.passengerCount ?? null;
    transport.pickup_at = input.pickupAt || null;
    transport.pickup_location = input.pickupLocation?.trim() || null;
    transport.driver_name = input.driverName?.trim() || null;
    transport.driver_phone = input.driverPhone?.trim() || null;
    transport.coordinator_name = input.coordinatorName?.trim() || null;
    transport.coordinator_phone = input.coordinatorPhone?.trim() || null;
    transport.internal_cost = input.internalCost ?? null;
    transport.notes = input.notes?.trim() || null;

    group.updated_at = now;

    data.activity.push({
      id: newId(),
      departure_group_id: group.id,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      action_type: "TRANSPORT_UPDATED",
      entity_type: "TRANSPORT",
      entity_id: transport.id,
      before_value: { status: before.status },
      after_value: { status: transport.status },
      message: `Transport route (${transport.route_label}) updated.`,
      is_system: false,
      is_high_impact: false,
      created_at: now,
    });

    return { ok: true, result: { transportId: transport.id, created: false } };
  }

  const transportId = newId();

  const transport: DepartureGroupTransportRow = {
    id: transportId,
    departure_group_id: group.id,
    template_transport_requirement_id:
      input.templateTransportRequirementId ?? null,
    route_label: input.routeLabel,
    origin: input.origin,
    destination: input.destination,
    status: input.status,
    supplier_name: input.supplierName?.trim() || null,
    supplier_id: input.supplierId ?? null,
    booking_reference: input.bookingReference?.trim() || null,
    vehicle_type: input.vehicleType,
    vehicle_capacity: input.vehicleCapacity ?? null,
    passenger_count: input.passengerCount ?? null,
    pickup_at: input.pickupAt || null,
    pickup_location: input.pickupLocation?.trim() || null,
    driver_name: input.driverName?.trim() || null,
    driver_phone: input.driverPhone?.trim() || null,
    coordinator_name: input.coordinatorName?.trim() || null,
    coordinator_phone: input.coordinatorPhone?.trim() || null,
    internal_cost: input.internalCost ?? null,
    confirmation_url: null,
    notes: input.notes?.trim() || null,
  };
  data.transports.push(transport);
  group.updated_at = now;

  data.activity.push({
    id: newId(),
    departure_group_id: group.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRANSPORT_ADDED",
    entity_type: "TRANSPORT",
    entity_id: transportId,
    before_value: null,
    after_value: {
      route_label: transport.route_label,
      route: `${transport.origin} → ${transport.destination}`,
    },
    message: `Transport route added: ${transport.route_label} (${transport.origin} → ${transport.destination}).`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { transportId, created: true } };
}

/* ── Voucher / reference / confirm ────────────────────────────────────────── */

export type TransportTouchOutcome =
  | { ok: true; result: { routeLabel: string } }
  | { ok: false; error: string };

function findTransport(
  data: DepartureGroupStore,
  id: string,
  departureGroupId: string,
) {
  return data.transports.find(
    (t) => t.id === id && t.departure_group_id === departureGroupId,
  );
}

/** Attaches a confirmation link to a transport route ("Upload Confirmation"). */
export function setTransportConfirmationInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; confirmationUrl: string },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): TransportTouchOutcome {
  const transport = findTransport(data, input.id, input.departureGroupId);
  if (!transport) {
    return { ok: false, error: "That transport route no longer exists." };
  }

  transport.confirmation_url = input.confirmationUrl;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRANSPORT_CONFIRMATION_UPLOADED",
    entity_type: "TRANSPORT",
    entity_id: transport.id,
    before_value: null,
    after_value: { confirmation_url: input.confirmationUrl },
    message: `Confirmation attached for ${transport.route_label}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { routeLabel: transport.route_label } };
}

/**
 * Records the supplier's booking reference and/or the supplier's own name
 * ("Add Reference"). The Operations Supplier Confirmations board calls this
 * to satisfy the evidence gate on `markTransportConfirmedInStore` before
 * confirming.
 */
export function setTransportReferenceInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; bookingReference?: string; supplierName?: string; supplierId?: string | null },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): TransportTouchOutcome {
  const transport = findTransport(data, input.id, input.departureGroupId);
  if (!transport) {
    return { ok: false, error: "That transport route no longer exists." };
  }
  if (input.bookingReference === undefined && input.supplierName === undefined && input.supplierId === undefined) {
    return { ok: false, error: "Nothing to record." };
  }

  const after: Record<string, unknown> = {};
  if (input.bookingReference !== undefined) {
    transport.booking_reference = input.bookingReference;
    after.booking_reference = input.bookingReference;
  }
  if (input.supplierName !== undefined) {
    transport.supplier_name = input.supplierName;
    after.supplier_name = input.supplierName;
  }
  if (input.supplierId !== undefined) {
    transport.supplier_id = input.supplierId;
    after.supplier_id = input.supplierId;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRANSPORT_REFERENCE_SET",
    entity_type: "TRANSPORT",
    entity_id: transport.id,
    before_value: null,
    after_value: after,
    message: `Supplier details recorded for ${transport.route_label}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { routeLabel: transport.route_label } };
}

/**
 * Syncs the transport's `internal_cost` to a supplier commitment's
 * negotiated `amount` — the transport counterpart of
 * `setAccommodationInternalCostInStore` (lib/data/departure-groups-rooming.ts);
 * see that function's comment for why this exists.
 */
export function setTransportInternalCostInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string; internalCost: number },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): TransportTouchOutcome {
  const transport = findTransport(data, input.id, input.departureGroupId);
  if (!transport) {
    return { ok: false, error: "That transport route no longer exists." };
  }

  const before = transport.internal_cost;
  transport.internal_cost = input.internalCost;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRANSPORT_COST_SYNCED_FROM_COMMITMENT",
    entity_type: "TRANSPORT",
    entity_id: transport.id,
    before_value: { internal_cost: before },
    after_value: { internal_cost: input.internalCost },
    message: `Cost for ${transport.route_label} set to match the linked supplier commitment.`,
    is_system: true,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { routeLabel: transport.route_label } };
}

/** Marks a transport route confirmed ("Mark Confirmed"). */
export function markTransportConfirmedInStore(
  data: DepartureGroupStore,
  input: { id: string; departureGroupId: string },
  actor: GroupActor,
  now: string = new Date().toISOString(),
): TransportTouchOutcome {
  const transport = findTransport(data, input.id, input.departureGroupId);
  if (!transport) {
    return { ok: false, error: "That transport route no longer exists." };
  }
  if (transport.status === "CONFIRMED") {
    return { ok: false, error: "This transport route is already confirmed." };
  }
  if (transport.status === "CANCELLED") {
    return { ok: false, error: "This transport route has been cancelled." };
  }
  // Same evidence rule as accommodation: a supplier name plus either a
  // booking reference or a confirmation document, never a bare status flip.
  if (!transport.supplier_name?.trim()) {
    return { ok: false, error: "Record a supplier name before confirming this transport route." };
  }
  if (!transport.booking_reference?.trim() && !transport.confirmation_url?.trim()) {
    return { ok: false, error: "Record a booking reference or upload a confirmation document before confirming this transport route." };
  }

  const before = transport.status;
  transport.status = "CONFIRMED";

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TRANSPORT_CONFIRMED",
    entity_type: "TRANSPORT",
    entity_id: transport.id,
    before_value: { status: before },
    after_value: { status: "CONFIRMED" },
    message: `${transport.route_label} marked confirmed.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { routeLabel: transport.route_label } };
}
