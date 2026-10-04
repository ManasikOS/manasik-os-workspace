/**
 * Per-pilgrim operational deviations — the non-money half of traveller
 * customisation (extra nights, a private transfer, an opted-out itinerary
 * day, a traveller's own flight…).
 *
 * A deviation never edits the group snapshot or a group-level operational row
 * (`departure_group_accommodations`, `departure_group_transports`, …) — it
 * records that this one traveller's delivery differs from the group standard,
 * with a status Operations must actually move through the queue. When a
 * deviation has a money side, `charge_id` links to the paired
 * `departure_group_pilgrim_charges` row so the two can never say different
 * things.
 */

import {
  recomputeBookingTotalsInStore,
  recomputeHasCustomisationsInStore,
} from "@/lib/data/departure-groups-charges";
import { newId } from "@/lib/data/departure-groups-ids";
import type {
  DeviationDetail,
  DepartureGroupPilgrimDeviationRow,
  DepartureGroupStore,
  DeviationType,
  GroupActor,
  ResponsibleRole,
} from "@/lib/types/departure-groups";

export type DeviationMutationOutcome =
  | { ok: true; deviation: DepartureGroupPilgrimDeviationRow }
  | { ok: false; error: string };

/** Deviation types that, by default, must be resolved before the group departs. */
const DEFAULT_BLOCKS_DEPARTURE: DeviationType[] = [
  "LAND_ONLY",
  "OWN_FLIGHT",
  "EXTRA_NIGHTS",
  "HOTEL_UPGRADE",
  "PRIVATE_TRANSFER",
  "DOCUMENT_REQUIREMENT",
  "ASSISTANCE",
];

const DEFAULT_RESPONSIBLE_ROLE: Record<DeviationType, ResponsibleRole> = {
  ROOM_TYPE: "OPERATIONS",
  EXTRA_NIGHTS: "OPERATIONS",
  HOTEL_UPGRADE: "OPERATIONS",
  MEAL_PLAN: "OPERATIONS",
  ROOMMATE_REQUEST: "OPERATIONS",
  LAND_ONLY: "OPERATIONS",
  OWN_FLIGHT: "OPERATIONS",
  EXTENDED_STAY: "OPERATIONS",
  CABIN_UPGRADE: "OPERATIONS",
  SEAT_PREFERENCE: "OPERATIONS",
  PRIVATE_TRANSFER: "OPERATIONS",
  PICKUP_POINT: "OPERATIONS",
  ITINERARY_OPT_OUT: "OPERATIONS",
  ITINERARY_ADDITION: "OPERATIONS",
  SERVICE_ADDON: "OPERATIONS",
  DOCUMENT_REQUIREMENT: "VISA",
  ASSISTANCE: "OPERATIONS",
  OTHER: "OPERATIONS",
};

export interface RequestDeviationInput {
  departureGroupId: string;
  groupPilgrimId: string;
  deviationType: DeviationType;
  detail: DeviationDetail | Record<string, never>;
  summary: string;
  chargeId?: string | null;
  blocksDeparture?: boolean;
  responsibleRole?: ResponsibleRole;
  notes?: string;
}

/**
 * Resolves denormalised link columns from the typed detail payload and
 * validates that referenced entity ids belong to this departure group.
 */
function resolveLinksFromDetail(
  data: DepartureGroupStore,
  departureGroupId: string,
  detail: DeviationDetail | Record<string, never>,
): {
  ok: true;
  linkedFlightId: string | null;
  linkedAccommodationId: string | null;
  linkedTransportId: string | null;
  linkedItineraryItemIds: string[];
} | { ok: false; error: string } {
  let linkedFlightId: string | null = null;
  let linkedAccommodationId: string | null = null;
  let linkedTransportId: string | null = null;
  let linkedItineraryItemIds: string[] = [];

  if (!("kind" in detail)) {
    return { ok: true, linkedFlightId, linkedAccommodationId, linkedTransportId, linkedItineraryItemIds };
  }

  const groupFlights = data.flights.filter((f) => f.departure_group_id === departureGroupId);
  const groupAccommodations = data.accommodations.filter((a) => a.departure_group_id === departureGroupId);
  const groupTransports = data.transports.filter((t) => t.departure_group_id === departureGroupId);
  const snapshot = data.snapshots.find((s) => s.departure_group_id === departureGroupId);
  const snapshotItineraryIds = new Set(
    (snapshot?.itinerary_snapshot ?? []).map((it) => it.id),
  );

  switch (detail.kind) {
    case "OWN_FLIGHT":
    case "LAND_ONLY": {
      const ids = detail.replacesFlightIds;
      for (const fid of ids) {
        if (!groupFlights.some((f) => f.id === fid)) {
          return { ok: false, error: "That flight is not part of this group." };
        }
      }
      linkedFlightId = ids[0] ?? null;
      break;
    }
    case "CABIN_UPGRADE":
    case "SEAT_PREFERENCE": {
      if (!groupFlights.some((f) => f.id === detail.flightId)) {
        return { ok: false, error: "That flight is not part of this group." };
      }
      linkedFlightId = detail.flightId;
      break;
    }
    case "EXTENDED_STAY": {
      if (detail.returnFlightId && !groupFlights.some((f) => f.id === detail.returnFlightId)) {
        return { ok: false, error: "That return flight is not part of this group." };
      }
      linkedFlightId = detail.returnFlightId;
      break;
    }
    case "EXTRA_NIGHTS": {
      if (detail.accommodationId && !groupAccommodations.some((a) => a.id === detail.accommodationId)) {
        return { ok: false, error: "That accommodation is not part of this group." };
      }
      linkedAccommodationId = detail.accommodationId;
      break;
    }
    case "HOTEL_UPGRADE": {
      if (detail.fromAccommodationId && !groupAccommodations.some((a) => a.id === detail.fromAccommodationId)) {
        return { ok: false, error: "That accommodation is not part of this group." };
      }
      linkedAccommodationId = detail.fromAccommodationId;
      break;
    }
    case "MEAL_PLAN": {
      if (detail.accommodationId && !groupAccommodations.some((a) => a.id === detail.accommodationId)) {
        return { ok: false, error: "That accommodation is not part of this group." };
      }
      linkedAccommodationId = detail.accommodationId;
      break;
    }
    case "PRIVATE_TRANSFER":
    case "PICKUP_POINT": {
      if (detail.transportId && !groupTransports.some((t) => t.id === detail.transportId)) {
        return { ok: false, error: "That transport is not part of this group." };
      }
      linkedTransportId = detail.transportId;
      break;
    }
    case "ITINERARY_OPT_OUT": {
      for (const iid of detail.itineraryItemIds) {
        if (!snapshotItineraryIds.has(iid)) {
          return { ok: false, error: "That itinerary item is not part of this group." };
        }
      }
      linkedItineraryItemIds = detail.itineraryItemIds;
      break;
    }
  }

  return { ok: true, linkedFlightId, linkedAccommodationId, linkedTransportId, linkedItineraryItemIds };
}

/**
 * Recomputes `excluded_from_group_flight` on the pilgrim by scanning all live
 * (non-declined, non-cancelled) deviations. Idempotent — safe to call after
 * any deviation status change.
 */
export function recomputeExcludedFromGroupFlightInStore(
  data: DepartureGroupStore,
  groupPilgrimId: string,
): void {
  const pilgrim = data.pilgrims.find((p) => p.id === groupPilgrimId);
  if (!pilgrim) return;

  const liveDeviations = data.pilgrimDeviations.filter(
    (d) =>
      d.group_pilgrim_id === groupPilgrimId &&
      d.status !== "DECLINED" &&
      d.status !== "CANCELLED",
  );

  pilgrim.excluded_from_group_flight = liveDeviations.some(
    (d) =>
      (d.deviation_type === "OWN_FLIGHT" || d.deviation_type === "LAND_ONLY") &&
      (d.status === "APPROVED" || d.status === "ARRANGED"),
  );
}

/**
 * Applies operational side effects when a deviation is approved. Called from
 * `decideDeviationInStore` on approval.
 */
function applyDeviationSideEffectsInStore(
  data: DepartureGroupStore,
  deviation: DepartureGroupPilgrimDeviationRow,
): void {
  const detail = deviation.detail;
  const pilgrim = data.pilgrims.find((p) => p.id === deviation.group_pilgrim_id);
  if (!pilgrim) return;

  if (
    deviation.deviation_type === "OWN_FLIGHT" ||
    deviation.deviation_type === "LAND_ONLY"
  ) {
    recomputeExcludedFromGroupFlightInStore(data, pilgrim.id);
  }

  if (
    deviation.deviation_type === "ROOM_TYPE" &&
    "kind" in detail &&
    detail.kind === "ROOM_TYPE"
  ) {
    pilgrim.room_occupancy_type = detail.roomType;
  }

  if (
    deviation.deviation_type === "SERVICE_ADDON" &&
    "kind" in detail &&
    detail.kind === "SERVICE_ADDON"
  ) {
    const alreadySeeded = data.readinessItems.some(
      (r) => r.notes?.includes(`deviation:${deviation.id}`),
    );
    if (!alreadySeeded) {
      data.readinessItems.push({
        id: newId(),
        departure_group_id: pilgrim.departure_group_id,
        source_template_requirement_id: null,
        label: `Arrange: ${deviation.summary}`,
        category: "OTHER",
        responsible_role: deviation.responsible_role,
        assigned_to_user_id: null,
        assigned_to_name: null,
        due_type: "BEFORE_DEPARTURE",
        due_days_before_departure: 7,
        due_at: null,
        required: true,
        status: "NOT_STARTED",
        auto_source: null,
        evidence_url: null,
        notes: `Auto-created from deviation:${deviation.id}`,
        completed_at: null,
        completed_by: null,
        completed_by_name: null,
      });
    }
  }

  if (
    deviation.deviation_type === "DOCUMENT_REQUIREMENT" &&
    "kind" in detail &&
    detail.kind === "DOCUMENT_REQUIREMENT"
  ) {
    const alreadySeeded = data.pilgrimDocuments.some(
      (d) => d.notes?.includes(`deviation:${deviation.id}`),
    );
    if (!alreadySeeded && pilgrim.pilgrim_id) {
      const now = new Date().toISOString();
      data.pilgrimDocuments.push({
        id: newId(),
        departure_group_id: pilgrim.departure_group_id,
        pilgrim_id: pilgrim.pilgrim_id,
        requirement_id: deviation.id,
        name: detail.documentName,
        category: "MANUAL",
        required: true,
        required_by_stage: detail.requiredByStage,
        verified_by_role: deviation.responsible_role,
        status: "NOT_SUBMITTED",
        file_path: null,
        file_name: null,
        file_size_bytes: null,
        rejection_reason: null,
        submitted_at: null,
        verified_at: null,
        verified_by: null,
        verified_by_name: null,
        notes: `Auto-created from deviation:${deviation.id}`,
        created_at: now,
      });
    }
  }
}

/**
 * Reverses operational side effects when a deviation is cancelled or declined.
 */
function reverseDeviationSideEffectsInStore(
  data: DepartureGroupStore,
  deviation: DepartureGroupPilgrimDeviationRow,
): void {
  if (
    deviation.deviation_type === "OWN_FLIGHT" ||
    deviation.deviation_type === "LAND_ONLY"
  ) {
    recomputeExcludedFromGroupFlightInStore(data, deviation.group_pilgrim_id);
  }
}

/** Raises a deviation on a traveller. Starts life as `REQUESTED`. */
export function requestDeviationInStore(
  data: DepartureGroupStore,
  input: RequestDeviationInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): DeviationMutationOutcome {
  const pilgrim = data.pilgrims.find((p) => p.id === input.groupPilgrimId);
  if (!pilgrim || pilgrim.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That traveller no longer exists." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return { ok: false, error: "This traveller's seat has been cancelled." };
  }
  if (!input.summary.trim()) {
    return { ok: false, error: "Describe the deviation in one line." };
  }
  if (input.chargeId) {
    const charge = data.pilgrimCharges.find((c) => c.id === input.chargeId);
    if (!charge || charge.group_pilgrim_id !== pilgrim.id) {
      return { ok: false, error: "That charge does not belong to this traveller." };
    }
  }

  const links = resolveLinksFromDetail(data, input.departureGroupId, input.detail);
  if (!links.ok) return links;

  const deviation: DepartureGroupPilgrimDeviationRow = {
    id: newId(),
    departure_group_id: pilgrim.departure_group_id,
    group_pilgrim_id: pilgrim.id,
    deviation_type: input.deviationType,
    detail: input.detail,
    summary: input.summary.trim(),
    status: "REQUESTED",
    responsible_role:
      input.responsibleRole ?? DEFAULT_RESPONSIBLE_ROLE[input.deviationType],
    blocks_departure:
      input.blocksDeparture ?? DEFAULT_BLOCKS_DEPARTURE.includes(input.deviationType),
    charge_id: input.chargeId ?? null,
    supplier_commitment_id: null,
    linked_flight_id: links.linkedFlightId,
    linked_accommodation_id: links.linkedAccommodationId,
    linked_transport_id: links.linkedTransportId,
    linked_itinerary_item_ids: links.linkedItineraryItemIds,
    requested_at: now,
    requested_by_name: actor.name,
    decided_at: null,
    decided_by: null,
    decided_by_name: null,
    decision_note: null,
    arranged_at: null,
    notes: input.notes?.trim() || null,
    created_at: now,
    updated_at: now,
  };
  data.pilgrimDeviations.push(deviation);
  recomputeHasCustomisationsInStore(data, pilgrim.id);

  data.activity.push({
    id: newId(),
    departure_group_id: pilgrim.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_DEVIATION_REQUESTED",
    entity_type: "DEVIATION",
    entity_id: deviation.id,
    before_value: null,
    after_value: { deviation_type: deviation.deviation_type, summary: deviation.summary },
    message: `${pilgrim.full_name_snapshot}: ${deviation.summary}`,
    is_system: false,
    is_high_impact: deviation.blocks_departure,
    created_at: now,
  });

  return { ok: true, deviation };
}

export interface DecideDeviationInput {
  departureGroupId: string;
  deviationId: string;
  approve: boolean;
  note?: string;
}

/** Approves or declines a `REQUESTED` deviation. */
export function decideDeviationInStore(
  data: DepartureGroupStore,
  input: DecideDeviationInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): DeviationMutationOutcome {
  const deviation = data.pilgrimDeviations.find((d) => d.id === input.deviationId);
  if (!deviation || deviation.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That deviation no longer exists." };
  }
  if (deviation.status !== "REQUESTED") {
    return { ok: false, error: "This deviation has already been decided." };
  }
  if (!input.approve && !input.note?.trim()) {
    return { ok: false, error: "A decline needs a reason." };
  }

  deviation.status = input.approve ? "APPROVED" : "DECLINED";
  deviation.decided_at = now;
  deviation.decided_by = actor.id;
  deviation.decided_by_name = actor.name;
  deviation.decision_note = input.note?.trim() || null;
  deviation.updated_at = now;

  if (input.approve) {
    applyDeviationSideEffectsInStore(data, deviation);
  }

  if (input.approve && deviation.charge_id) {
    // The paired charge was created `requires_approval` so it wouldn't hit
    // the booking's balance until now — see `requestPilgrimCustomisation`
    // and `sumBillableChargeLines`. Approving the deviation is what makes it
    // billable.
    const charge = data.pilgrimCharges.find((c) => c.id === deviation.charge_id);
    if (charge && charge.voided_at === null && charge.approved_at === null) {
      charge.approved_by = actor.id;
      charge.approved_by_name = actor.name;
      charge.approved_at = now;
      charge.updated_at = now;
      recomputeBookingTotalsInStore(data, charge.booking_id, now);
    }
  }

  if (!input.approve && deviation.charge_id) {
    const charge = data.pilgrimCharges.find((c) => c.id === deviation.charge_id);
    if (charge && charge.voided_at === null) {
      charge.voided_at = now;
      charge.voided_by_name = actor.name;
      charge.void_reason = `Paired deviation declined: ${input.note?.trim() ?? ""}`.trim();
      charge.updated_at = now;
      recomputeBookingTotalsInStore(data, charge.booking_id, now);
    }
  }

  if (!input.approve) {
    reverseDeviationSideEffectsInStore(data, deviation);
  }

  const pilgrim = data.pilgrims.find((p) => p.id === deviation.group_pilgrim_id);
  recomputeHasCustomisationsInStore(data, deviation.group_pilgrim_id);

  data.activity.push({
    id: newId(),
    departure_group_id: deviation.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: input.approve ? "PILGRIM_DEVIATION_APPROVED" : "PILGRIM_DEVIATION_DECLINED",
    entity_type: "DEVIATION",
    entity_id: deviation.id,
    before_value: null,
    after_value: { status: deviation.status },
    message: `${pilgrim?.full_name_snapshot ?? "Traveller"}'s deviation "${deviation.summary}" ${
      input.approve ? "approved" : `declined — ${input.note?.trim()}`
    }.`,
    is_system: false,
    is_high_impact: deviation.blocks_departure,
    created_at: now,
  });

  return { ok: true, deviation };
}

export interface MarkDeviationArrangedInput {
  departureGroupId: string;
  deviationId: string;
  supplierCommitmentId?: string | null;
  notes?: string;
}

/** Marks an `APPROVED` deviation as actually arranged (booked/actioned). */
export function markDeviationArrangedInStore(
  data: DepartureGroupStore,
  input: MarkDeviationArrangedInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): DeviationMutationOutcome {
  const deviation = data.pilgrimDeviations.find((d) => d.id === input.deviationId);
  if (!deviation || deviation.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That deviation no longer exists." };
  }
  if (deviation.status !== "APPROVED") {
    return { ok: false, error: "Only an approved deviation can be marked arranged." };
  }

  deviation.status = "ARRANGED";
  deviation.arranged_at = now;
  deviation.supplier_commitment_id = input.supplierCommitmentId ?? null;
  if (input.notes?.trim()) deviation.notes = input.notes.trim();
  deviation.updated_at = now;

  const pilgrim = data.pilgrims.find((p) => p.id === deviation.group_pilgrim_id);
  data.activity.push({
    id: newId(),
    departure_group_id: deviation.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_DEVIATION_ARRANGED",
    entity_type: "DEVIATION",
    entity_id: deviation.id,
    before_value: null,
    after_value: { status: "ARRANGED" },
    message: `${pilgrim?.full_name_snapshot ?? "Traveller"}'s deviation "${deviation.summary}" arranged.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, deviation };
}

export interface CancelDeviationInput {
  departureGroupId: string;
  deviationId: string;
  reason: string;
}

/** Cancels a deviation that has not yet been arranged. */
export function cancelDeviationInStore(
  data: DepartureGroupStore,
  input: CancelDeviationInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): DeviationMutationOutcome {
  const deviation = data.pilgrimDeviations.find((d) => d.id === input.deviationId);
  if (!deviation || deviation.departure_group_id !== input.departureGroupId) {
    return { ok: false, error: "That deviation no longer exists." };
  }
  if (deviation.status === "ARRANGED") {
    return { ok: false, error: "An arranged deviation cannot be cancelled here." };
  }
  if (!input.reason.trim()) {
    return { ok: false, error: "A reason is required to cancel a deviation." };
  }

  deviation.status = "CANCELLED";
  deviation.decision_note = input.reason.trim();
  deviation.decided_at = now;
  deviation.decided_by = actor.id;
  deviation.decided_by_name = actor.name;
  deviation.updated_at = now;

  if (deviation.charge_id) {
    const charge = data.pilgrimCharges.find((c) => c.id === deviation.charge_id);
    if (charge && charge.voided_at === null) {
      charge.voided_at = now;
      charge.voided_by_name = actor.name;
      charge.void_reason = `Deviation cancelled: ${input.reason.trim()}`;
      charge.updated_at = now;
      recomputeBookingTotalsInStore(data, charge.booking_id, now);
    }
  }

  reverseDeviationSideEffectsInStore(data, deviation);
  recomputeHasCustomisationsInStore(data, deviation.group_pilgrim_id);

  const pilgrim = data.pilgrims.find((p) => p.id === deviation.group_pilgrim_id);
  data.activity.push({
    id: newId(),
    departure_group_id: deviation.departure_group_id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "PILGRIM_DEVIATION_CANCELLED",
    entity_type: "DEVIATION",
    entity_id: deviation.id,
    before_value: null,
    after_value: { status: "CANCELLED" },
    message: `${pilgrim?.full_name_snapshot ?? "Traveller"}'s deviation "${deviation.summary}" cancelled. Reason: ${input.reason.trim()}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, deviation };
}
