/**
 * Flight sector and transit-leg mutation logic, kept pure and store-passing so
 * it can be unit-tested without the Next server runtime (mirroring how
 * `departure-groups-bookings.ts` is separated from the data layer).
 *
 * The thin wrappers in `departure-groups.ts` supply the live store.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import type {
  DepartureGroupFlightLegRow,
  DepartureGroupFlightRow,
  FlightDirection,
  GroupActor,
  FlightStatus,
  PilgrimFlightStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/* ── Add / edit a flight sector ───────────────────────────────────────────── */

export interface UpsertFlightInput {
  id?: string;
  departureGroupId: string;
  direction: FlightDirection;
  status: FlightStatus;
  airline: string;
  flightNumber?: string | null;
  pnr?: string | null;
  bookingReference?: string | null;
  originAirportCode: string;
  originAirportName: string;
  destinationAirportCode: string;
  destinationAirportName: string;
  departureAt: string;
  arrivalAt: string;
  /**
   * Operator's local calendar date (YYYY-MM-DD) for departure/arrival, used
   * for the trip-window check. Optional so non-UI callers don't have to
   * supply it; when absent the check falls back to the UTC date component
   * of the ISO timestamp.
   */
  departureLocalDate?: string;
  arrivalLocalDate?: string;
  cabinClass: string;
  seatCapacity: number;
  seatsHeld: number;
  ticketingDeadline?: string | null;
  supplierName?: string | null;
  supplierId?: string | null;
  notes?: string | null;
}

export interface UpsertFlightResult {
  flightId: string;
  direction: FlightDirection;
  created: boolean;
}

export type UpsertFlightOutcome =
  | { ok: true; result: UpsertFlightResult }
  | { ok: false; error: string };

const DIRECTION_WORDS: Record<FlightDirection, string> = {
  OUTBOUND: "Outbound",
  RETURN: "Return",
};

/**
 * Checks that both ends of the flight sit inside the group's trip window.
 * Strict — a flight departing on Aug 31 for a trip that ends Aug 30 is
 * rejected. Comparison is done on the calendar date portion of each
 * timestamp so timezone-shifted ISO storage doesn't turn "Aug 31 local" into
 * an accepted Aug 30 UTC.
 */
function checkFlightWithinTripWindow(
  input: Pick<
    UpsertFlightInput,
    "departureAt" | "arrivalAt" | "departureLocalDate" | "arrivalLocalDate"
  >,
  group: { departure_date: string; return_date: string },
): string | null {
  const start = group.departure_date;
  const end = group.return_date;
  if (!start || !end) return null;

  // Prefer the operator's local calendar date when the client supplied it —
  // toISOString() on a naive-local picker value shifts to UTC and can make
  // the calendar date read as one day earlier, letting a truly-outside
  // flight slip through if we only look at the UTC date.
  const depDay = input.departureLocalDate ?? input.departureAt.slice(0, 10);
  const arrDay = input.arrivalLocalDate ?? input.arrivalAt.slice(0, 10);

  if (depDay < start || depDay > end) {
    return `Flight departure (${depDay}) is outside the trip window (${start} → ${end}).`;
  }
  if (arrDay < start || arrDay > end) {
    return `Flight arrival (${arrDay}) is outside the trip window (${start} → ${end}).`;
  }
  return null;
}

/**
 * Checks the ordering of outbound vs return sectors — an outbound cannot
 * arrive after the return departs, and vice versa. A cancelled other-side
 * flight is ignored so it doesn't block a legitimate replacement.
 */
function checkDirectionOrdering(
  input: UpsertFlightInput,
  data: DepartureGroupStore,
): string | null {
  const other = data.flights.find(
    (f) =>
      f.departure_group_id === input.departureGroupId &&
      f.id !== input.id &&
      f.direction !== input.direction &&
      f.status !== "CANCELLED",
  );
  if (!other) return null;

  const dep = Date.parse(input.departureAt);
  const arr = Date.parse(input.arrivalAt);
  const otherDep = Date.parse(other.departure_at);
  const otherArr = Date.parse(other.arrival_at);
  if ([dep, arr, otherDep, otherArr].some(Number.isNaN)) return null;

  if (input.direction === "OUTBOUND" && arr > otherDep) {
    return `Outbound arrival is after the return flight's departure (${other.departure_at}). Fix the outbound arrival or the return departure.`;
  }
  if (input.direction === "RETURN" && dep < otherArr) {
    return `Return departure is before the outbound flight's arrival (${other.arrival_at}). Fix the return departure or the outbound arrival.`;
  }
  return null;
}

function checkTicketingDeadline(
  input: Pick<UpsertFlightInput, "departureAt" | "ticketingDeadline">,
): string | null {
  if (!input.ticketingDeadline) return null;
  const dep = Date.parse(input.departureAt);
  const deadline = Date.parse(input.ticketingDeadline);
  if (Number.isNaN(dep) || Number.isNaN(deadline)) return null;
  if (deadline > dep) {
    return "Ticketing deadline cannot be after the flight's departure.";
  }
  return null;
}

/**
 * Creates or edits a flight sector.
 *
 * A group has at most one flight per direction, so creating a second
 * OUTBOUND (or RETURN) sector is refused — the operator edits the existing
 * one instead. Editing never touches `seats_ticketed` or the flight's legs;
 * those move through their own dedicated mutators so a routine detail edit
 * can't silently un-ticket seats or drop a transit leg.
 */
export function upsertFlightInStore(
  data: DepartureGroupStore,
  input: UpsertFlightInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpsertFlightOutcome {
  const group = data.groups.find((g) => g.id === input.departureGroupId);
  if (!group) {
    return { ok: false, error: "That departure group no longer exists." };
  }

  const windowError = checkFlightWithinTripWindow(input, group);
  if (windowError) return { ok: false, error: windowError };

  const deadlineError = checkTicketingDeadline(input);
  if (deadlineError) return { ok: false, error: deadlineError };

  const orderingError = checkDirectionOrdering(input, data);
  if (orderingError) return { ok: false, error: orderingError };

  if (input.id) {
    const flight = data.flights.find(
      (f) => f.id === input.id && f.departure_group_id === input.departureGroupId,
    );
    if (!flight) {
      return { ok: false, error: "That flight no longer exists." };
    }

    const ticketed = flight.seats_ticketed;

    if (input.seatCapacity < ticketed) {
      return {
        ok: false,
        error: `Seat capacity cannot be less than ${ticketed} (tickets already issued).`,
      };
    }
    if (input.seatsHeld < ticketed) {
      return {
        ok: false,
        error: `Seats held cannot be less than ${ticketed} (tickets already issued).`,
      };
    }
    if (input.seatsHeld > input.seatCapacity) {
      return {
        ok: false,
        error: "Seats held cannot exceed seat capacity.",
      };
    }

    if (input.status === "CANCELLED" && ticketed > 0) {
      return {
        ok: false,
        error: `Cannot cancel this flight — ${ticketed} ticket${ticketed === 1 ? " has" : "s have"} already been issued.`,
      };
    }

    if (
      flight.status === "TICKETED" &&
      input.status !== "TICKETED" &&
      input.status !== "CANCELLED" &&
      ticketed > 0
    ) {
      return {
        ok: false,
        error: `Cannot move a ticketed flight back to ${input.status} — ${ticketed} ticket${ticketed === 1 ? " has" : "s have"} been issued.`,
      };
    }

    // If the flight already has saved transit legs, the sector still has to
    // decompose into them. Editing the sector's window or its
    // origin/destination cannot leave the leg chain dangling.
    const existingLegs = data.flightLegs
      .filter((l) => l.flight_id === flight.id)
      .sort((a, b) => a.leg_order - b.leg_order);
    if (existingLegs.length > 0) {
      const firstLeg = existingLegs[0];
      const lastLeg = existingLegs[existingLegs.length - 1];
      const newDep = Date.parse(input.departureAt);
      const newArr = Date.parse(input.arrivalAt);
      const firstLegDep = Date.parse(firstLeg.departure_at);
      const lastLegArr = Date.parse(lastLeg.arrival_at);
      if (!Number.isNaN(newDep) && !Number.isNaN(firstLegDep) && newDep > firstLegDep) {
        return {
          ok: false,
          error: `Sector departure would be after Leg 1's departure (${firstLeg.departure_at}). Edit or remove the leg first.`,
        };
      }
      if (!Number.isNaN(newArr) && !Number.isNaN(lastLegArr) && newArr < lastLegArr) {
        return {
          ok: false,
          error: `Sector arrival would be before Leg ${lastLeg.leg_order}'s arrival (${lastLeg.arrival_at}). Edit or remove the leg first.`,
        };
      }
      if (input.originAirportCode !== firstLeg.origin_airport_code) {
        return {
          ok: false,
          error: `Sector origin (${input.originAirportCode}) no longer matches Leg 1's origin (${firstLeg.origin_airport_code}). Edit or remove the leg first.`,
        };
      }
      if (input.destinationAirportCode !== lastLeg.destination_airport_code) {
        return {
          ok: false,
          error: `Sector destination (${input.destinationAirportCode}) no longer matches Leg ${lastLeg.leg_order}'s destination (${lastLeg.destination_airport_code}). Edit or remove the leg first.`,
        };
      }
    }

    const before = { ...flight };

    flight.status = input.status;
    flight.airline = input.airline;
    flight.flight_number = input.flightNumber?.trim() || null;
    flight.pnr = input.pnr?.trim() || null;
    flight.booking_reference = input.bookingReference?.trim() || null;
    flight.origin_airport_code = input.originAirportCode;
    flight.origin_airport_name = input.originAirportName;
    flight.destination_airport_code = input.destinationAirportCode;
    flight.destination_airport_name = input.destinationAirportName;
    flight.departure_at = input.departureAt;
    flight.arrival_at = input.arrivalAt;
    flight.cabin_class = input.cabinClass;
    flight.seat_capacity = input.seatCapacity;
    flight.seats_held = input.seatsHeld;
    flight.ticketing_deadline = input.ticketingDeadline || null;
    flight.supplier_name = input.supplierName?.trim() || null;
    flight.supplier_id = input.supplierId ?? null;
    flight.notes = input.notes?.trim() || null;

    group.updated_at = now;

    data.activity.push({
      id: newId(),
      departure_group_id: group.id,
      actor_id: actor.id,
      actor_name_snapshot: actor.name,
      action_type: "FLIGHT_UPDATED",
      entity_type: "FLIGHT",
      entity_id: flight.id,
      before_value: {
        status: before.status,
        airline: before.airline,
        departure_at: before.departure_at,
      },
      after_value: {
        status: flight.status,
        airline: flight.airline,
        departure_at: flight.departure_at,
      },
      message: `${DIRECTION_WORDS[flight.direction]} flight (${flight.airline}${
        flight.flight_number ? ` ${flight.flight_number}` : ""
      }) updated.`,
      is_system: false,
      is_high_impact: false,
      created_at: now,
    });

    return {
      ok: true,
      result: { flightId: flight.id, direction: flight.direction, created: false },
    };
  }

  const existing = data.flights.find(
    (f) =>
      f.departure_group_id === input.departureGroupId &&
      f.direction === input.direction,
  );
  if (existing) {
    return {
      ok: false,
      error: `A ${DIRECTION_WORDS[input.direction].toLowerCase()} flight already exists for this group. Edit it instead of adding another.`,
    };
  }

  if (input.seatsHeld > input.seatCapacity) {
    return {
      ok: false,
      error: "Seats held cannot exceed seat capacity.",
    };
  }

  const flightId = newId();

  const flight: DepartureGroupFlightRow = {
    id: flightId,
    departure_group_id: group.id,
    direction: input.direction,
    status: input.status,
    airline: input.airline,
    flight_number: input.flightNumber?.trim() || null,
    pnr: input.pnr?.trim() || null,
    booking_reference: input.bookingReference?.trim() || null,
    origin_airport_code: input.originAirportCode,
    origin_airport_name: input.originAirportName,
    destination_airport_code: input.destinationAirportCode,
    destination_airport_name: input.destinationAirportName,
    departure_at: input.departureAt,
    arrival_at: input.arrivalAt,
    cabin_class: input.cabinClass,
    seat_capacity: input.seatCapacity,
    seats_held: input.seatsHeld,
    seats_ticketed: 0,
    ticketing_deadline: input.ticketingDeadline || null,
    supplier_name: input.supplierName?.trim() || null,
    supplier_id: input.supplierId ?? null,
    notes: input.notes?.trim() || null,
  };
  data.flights.push(flight);
  group.updated_at = now;

  data.activity.push({
    id: newId(),
    departure_group_id: group.id,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "FLIGHT_ADDED",
    entity_type: "FLIGHT",
    entity_id: flightId,
    before_value: null,
    after_value: {
      direction: flight.direction,
      airline: flight.airline,
      route: `${flight.origin_airport_code} → ${flight.destination_airport_code}`,
    },
    message: `${DIRECTION_WORDS[flight.direction]} flight added: ${flight.airline}${
      flight.flight_number ? ` ${flight.flight_number}` : ""
    }, ${flight.origin_airport_code} → ${flight.destination_airport_code}.`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return { ok: true, result: { flightId, direction: flight.direction, created: true } };
}

/* ── Add a transit leg ────────────────────────────────────────────────────── */

export interface AddFlightLegInput {
  flightId: string;
  departureGroupId: string;
  airline: string;
  flightNumber: string;
  originAirportCode: string;
  destinationAirportCode: string;
  departureAt: string;
  arrivalAt: string;
}

export interface AddFlightLegResult {
  legId: string;
  legOrder: number;
}

export type AddFlightLegOutcome =
  | { ok: true; result: AddFlightLegResult }
  | { ok: false; error: string };

/**
 * Appends one transit leg to a flight's itinerary.
 *
 * Legs form a chronological chain: a new leg must depart at or after the
 * previous leg's arrival, and the previous leg's `transit_duration_minutes`
 * (its layover before this connection) is recomputed from the real gap
 * between the two timestamps rather than trusted from the client. The new
 * leg becomes the last one, so it starts with no layover of its own.
 */
export function addFlightLegInStore(
  data: DepartureGroupStore,
  input: AddFlightLegInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): AddFlightLegOutcome {
  const flight = data.flights.find(
    (f) => f.id === input.flightId && f.departure_group_id === input.departureGroupId,
  );
  if (!flight) return { ok: false, error: "That flight no longer exists." };

  const legs = data.flightLegs
    .filter((leg) => leg.flight_id === flight.id)
    .sort((a, b) => a.leg_order - b.leg_order);

  const previousLeg = legs[legs.length - 1];
  if (previousLeg && Date.parse(input.departureAt) < Date.parse(previousLeg.arrival_at)) {
    return {
      ok: false,
      error: `This leg must depart at or after the previous leg's arrival (${previousLeg.arrival_at}).`,
    };
  }

  const legOrder = legs.length + 1;
  const legId = newId();

  if (previousLeg) {
    previousLeg.transit_duration_minutes = Math.max(
      0,
      Math.round(
        (Date.parse(input.departureAt) - Date.parse(previousLeg.arrival_at)) / 60_000,
      ),
    );
  }

  const leg: DepartureGroupFlightLegRow = {
    id: legId,
    flight_id: flight.id,
    leg_order: legOrder,
    airline: input.airline,
    flight_number: input.flightNumber,
    origin_airport_code: input.originAirportCode,
    destination_airport_code: input.destinationAirportCode,
    departure_at: input.departureAt,
    arrival_at: input.arrivalAt,
    transit_duration_minutes: null,
  };
  data.flightLegs.push(leg);

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "FLIGHT_LEG_ADDED",
    entity_type: "FLIGHT",
    entity_id: flight.id,
    before_value: null,
    after_value: {
      leg_order: legOrder,
      route: `${leg.origin_airport_code} → ${leg.destination_airport_code}`,
    },
    message: `Transit leg ${legOrder} added to the ${DIRECTION_WORDS[flight.direction].toLowerCase()} flight: ${leg.airline} ${leg.flight_number}, ${leg.origin_airport_code} → ${leg.destination_airport_code}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { legId, legOrder } };
}

export interface UpdateFlightLegInput {
  legId: string;
  departureGroupId: string;
  airline: string;
  flightNumber: string;
  originAirportCode: string;
  destinationAirportCode: string;
  departureAt: string;
  arrivalAt: string;
}

export type UpdateFlightLegOutcome =
  | { ok: true; result: { legId: string } }
  | { ok: false; error: string };

/**
 * Corrects an already-saved transit leg's own fields — the edit path
 * `addFlightLegInStore` never covered. A leg was append-only until now: once
 * saved, a typo in its airline, flight number, connecting airport or times
 * could never be fixed short of deleting the whole flight sector and
 * rebuilding it from scratch.
 *
 * Chronology is re-checked against whichever neighbours this leg actually
 * has — the previous leg's arrival and the next leg's departure — and both
 * neighbours' `transit_duration_minutes` (the layover either side of this
 * leg) are recomputed from the edited times rather than left stale.
 */
export function updateFlightLegInStore(
  data: DepartureGroupStore,
  input: UpdateFlightLegInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdateFlightLegOutcome {
  const leg = data.flightLegs.find((l) => l.id === input.legId);
  if (!leg) return { ok: false, error: "That transit leg no longer exists." };

  const flight = data.flights.find(
    (f) => f.id === leg.flight_id && f.departure_group_id === input.departureGroupId,
  );
  if (!flight) return { ok: false, error: "That flight no longer exists." };

  if (Date.parse(input.arrivalAt) < Date.parse(input.departureAt)) {
    return { ok: false, error: "Arrival cannot be before departure." };
  }
  if (Date.parse(input.departureAt) < Date.parse(flight.departure_at)) {
    return {
      ok: false,
      error: `This leg cannot depart before the flight sector's own departure (${flight.departure_at}).`,
    };
  }
  if (Date.parse(input.arrivalAt) > Date.parse(flight.arrival_at)) {
    return {
      ok: false,
      error: `This leg cannot arrive after the flight sector's own arrival (${flight.arrival_at}).`,
    };
  }

  const siblings = data.flightLegs
    .filter((l) => l.flight_id === flight.id)
    .sort((a, b) => a.leg_order - b.leg_order);
  const index = siblings.findIndex((l) => l.id === leg.id);
  const previousLeg = index > 0 ? siblings[index - 1] : null;
  const nextLeg = index < siblings.length - 1 ? siblings[index + 1] : null;

  if (previousLeg && Date.parse(input.departureAt) < Date.parse(previousLeg.arrival_at)) {
    return {
      ok: false,
      error: `This leg must depart at or after the previous leg's arrival (${previousLeg.arrival_at}).`,
    };
  }
  if (nextLeg && Date.parse(input.arrivalAt) > Date.parse(nextLeg.departure_at)) {
    return {
      ok: false,
      error: `This leg must arrive at or before the next leg's departure (${nextLeg.departure_at}).`,
    };
  }

  const before = {
    airline: leg.airline,
    flight_number: leg.flight_number,
    route: `${leg.origin_airport_code} → ${leg.destination_airport_code}`,
  };

  leg.airline = input.airline;
  leg.flight_number = input.flightNumber;
  leg.origin_airport_code = input.originAirportCode;
  leg.destination_airport_code = input.destinationAirportCode;
  leg.departure_at = input.departureAt;
  leg.arrival_at = input.arrivalAt;

  if (previousLeg) {
    previousLeg.transit_duration_minutes = Math.max(
      0,
      Math.round((Date.parse(input.departureAt) - Date.parse(previousLeg.arrival_at)) / 60_000),
    );
  }
  if (nextLeg) {
    leg.transit_duration_minutes = Math.max(
      0,
      Math.round((Date.parse(nextLeg.departure_at) - Date.parse(input.arrivalAt)) / 60_000),
    );
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "FLIGHT_LEG_UPDATED",
    entity_type: "FLIGHT",
    entity_id: flight.id,
    before_value: before,
    after_value: {
      airline: leg.airline,
      flight_number: leg.flight_number,
      route: `${leg.origin_airport_code} → ${leg.destination_airport_code}`,
    },
    message: `Transit leg ${leg.leg_order} on the ${DIRECTION_WORDS[flight.direction].toLowerCase()} flight updated: ${leg.airline} ${leg.flight_number}, ${leg.origin_airport_code} → ${leg.destination_airport_code}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { legId: leg.id } };
}

export interface RemoveFlightLegInput {
  legId: string;
  departureGroupId: string;
}

export type RemoveFlightLegOutcome =
  | { ok: true; result: { removedLegOrder: number } }
  | { ok: false; error: string };

/**
 * Removes one transit leg and closes the gap it leaves in the chain — the
 * legs after it shift down a position, and whichever leg is now immediately
 * before where it sat gets its layover recomputed against the new next leg
 * (or cleared to null if it's now the last leg in the sector).
 */
export function removeFlightLegInStore(
  data: DepartureGroupStore,
  input: RemoveFlightLegInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): RemoveFlightLegOutcome {
  const leg = data.flightLegs.find((l) => l.id === input.legId);
  if (!leg) return { ok: false, error: "That transit leg no longer exists." };

  const flight = data.flights.find(
    (f) => f.id === leg.flight_id && f.departure_group_id === input.departureGroupId,
  );
  if (!flight) return { ok: false, error: "That flight no longer exists." };

  const siblings = data.flightLegs
    .filter((l) => l.flight_id === flight.id)
    .sort((a, b) => a.leg_order - b.leg_order);
  const index = siblings.findIndex((l) => l.id === leg.id);
  const previousLeg = index > 0 ? siblings[index - 1] : null;
  const nextLeg = index < siblings.length - 1 ? siblings[index + 1] : null;
  const removedOrder = leg.leg_order;

  data.flightLegs = data.flightLegs.filter((l) => l.id !== leg.id);
  for (const sibling of siblings) {
    if (sibling.leg_order > removedOrder) sibling.leg_order -= 1;
  }

  if (previousLeg) {
    previousLeg.transit_duration_minutes = nextLeg
      ? Math.max(
          0,
          Math.round(
            (Date.parse(nextLeg.departure_at) - Date.parse(previousLeg.arrival_at)) / 60_000,
          ),
        )
      : null;
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "FLIGHT_LEG_REMOVED",
    entity_type: "FLIGHT",
    entity_id: flight.id,
    before_value: {
      leg_order: removedOrder,
      route: `${leg.origin_airport_code} → ${leg.destination_airport_code}`,
    },
    after_value: null,
    message: `Transit leg ${removedOrder} removed from the ${DIRECTION_WORDS[flight.direction].toLowerCase()} flight: ${leg.airline} ${leg.flight_number}, ${leg.origin_airport_code} → ${leg.destination_airport_code}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { removedLegOrder: removedOrder } };
}

/* ── Atomic: upsert a flight sector + append new legs ─────────────────────── */

export interface NewFlightLegInput {
  airline: string;
  flightNumber: string;
  originAirportCode: string;
  destinationAirportCode: string;
  departureAt: string;
  arrivalAt: string;
}

export interface UpsertFlightWithLegsInput extends UpsertFlightInput {
  /** New transit legs to append to the flight in the same unit of work. */
  newLegs?: readonly NewFlightLegInput[];
}

/**
 * Atomic wrapper around `upsertFlightInStore` + `addFlightLegInStore`.
 *
 * All new legs are chronology-validated up front so a chain break in leg 3
 * cannot leave legs 1 and 2 committed. In-memory JS is single-threaded and
 * `mutate()` holds the group lock, so once pre-validation passes the whole
 * sequence commits as one unit.
 */
export function upsertFlightWithLegsInStore(
  data: DepartureGroupStore,
  input: UpsertFlightWithLegsInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpsertFlightOutcome {
  const newLegs = input.newLegs ?? [];

  if (newLegs.length > 0) {
    // The starting point for the chain is either the last already-saved leg
    // (when editing a flight that had stops) or nothing (fresh flight).
    let previousArrival: string | null = null;
    if (input.id) {
      const existing = data.flightLegs
        .filter((l) => l.flight_id === input.id)
        .sort((a, b) => a.leg_order - b.leg_order);
      const last = existing[existing.length - 1];
      if (last) previousArrival = last.arrival_at;
    }
    const flightDep = Date.parse(input.departureAt);
    const flightArr = Date.parse(input.arrivalAt);
    for (let i = 0; i < newLegs.length; i++) {
      const leg = newLegs[i];
      const legDep = Date.parse(leg.departureAt);
      const legArr = Date.parse(leg.arrivalAt);

      if (legArr < legDep) {
        return {
          ok: false,
          error: `Transit stop ${i + 1}: arrival cannot be before departure.`,
        };
      }
      // Every leg must sit inside the flight sector's own window — otherwise
      // the leg chain no longer decomposes the sector and the itinerary
      // shows impossible timelines.
      if (!Number.isNaN(flightDep) && legDep < flightDep) {
        return {
          ok: false,
          error: `Transit stop ${i + 1} departs before the flight sector's departure (${input.departureAt}).`,
        };
      }
      if (!Number.isNaN(flightArr) && legArr > flightArr) {
        return {
          ok: false,
          error: `Transit stop ${i + 1} arrives after the flight sector's arrival (${input.arrivalAt}).`,
        };
      }
      if (
        previousArrival &&
        legDep < Date.parse(previousArrival)
      ) {
        return {
          ok: false,
          error: `Transit stop ${i + 1} must depart at or after the previous stop's arrival.`,
        };
      }
      previousArrival = leg.arrivalAt;
    }
  }

  const flightOutcome = upsertFlightInStore(data, input, actor, now);
  if (!flightOutcome.ok) return flightOutcome;

  for (const leg of newLegs) {
    const legOutcome = addFlightLegInStore(
      data,
      {
        flightId: flightOutcome.result.flightId,
        departureGroupId: input.departureGroupId,
        airline: leg.airline,
        flightNumber: leg.flightNumber,
        originAirportCode: leg.originAirportCode,
        destinationAirportCode: leg.destinationAirportCode,
        departureAt: leg.departureAt,
        arrivalAt: leg.arrivalAt,
      },
      actor,
      now,
    );
    if (!legOutcome.ok) {
      // Pre-validation should have caught this; kept as a defensive guard.
      return { ok: false, error: legOutcome.error };
    }
  }

  return flightOutcome;
}

/* ── Ticketing ─────────────────────────────────────────────────────────────── */

export interface FlightTicketingInput {
  flightId: string;
  departureGroupId: string;
  pnr: string;
  bookingReference?: string | null;
}

export interface FlightTicketingResult {
  flightId: string;
  pnr: string;
  bookingReference: string | null;
}

export type FlightTicketingOutcome =
  | { ok: true; result: FlightTicketingResult }
  | { ok: false; error: string };

/** Attaches a PNR / booking code to a flight ("Upload Ticket / PNR"). */
export function recordFlightTicketingInStore(
  data: DepartureGroupStore,
  input: FlightTicketingInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): FlightTicketingOutcome {
  const flight = data.flights.find(
    (f) => f.id === input.flightId && f.departure_group_id === input.departureGroupId,
  );
  if (!flight) return { ok: false, error: "That flight no longer exists." };
  if (flight.status === "CANCELLED") {
    return { ok: false, error: "This flight has been cancelled." };
  }

  const pnr = input.pnr.trim().toUpperCase();
  const bookingReference = input.bookingReference?.trim() || flight.booking_reference;

  flight.pnr = pnr;
  flight.booking_reference = bookingReference;
  if (flight.status === "DRAFT" || flight.status === "HELD") {
    flight.status = "CONFIRMED";
  }

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "FLIGHT_TICKETING_UPDATED",
    entity_type: "FLIGHT",
    entity_id: flight.id,
    before_value: null,
    after_value: { pnr, booking_reference: bookingReference },
    message: `PNR ${pnr} attached to the ${DIRECTION_WORDS[flight.direction].toLowerCase()} flight (${flight.airline}${
      flight.flight_number ? ` ${flight.flight_number}` : ""
    }).`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return {
    ok: true,
    result: { flightId: flight.id, pnr, bookingReference },
  };
}

/* ── Mark tickets issued ──────────────────────────────────────────────────── */

/**
 * Whether a traveller is actually owed a ticket right now: not cancelled or
 * waitlisted, not already ticketed or sitting on an open ticketing issue, and
 * paid past a bare hold. Shared by the bulk "Mark Tickets Issued" sweep and
 * the automatic advance a clean ticket-document review triggers
 * (`recordTicketAiResultInStore`) so the two ways a pilgrim reaches
 * `TICKETED` agree on who is eligible instead of each keeping its own copy of
 * this rule.
 */
function isPilgrimReadyToTicket(
  data: DepartureGroupStore,
  pilgrim: DepartureGroupStore["pilgrims"][number],
): boolean {
  if (pilgrim.seat_status === "CANCELLED") return false;
  if (pilgrim.seat_status === "WAITLIST") return false;
  if (pilgrim.flight_status !== "PENDING") return false;

  const booking = data.bookings.find((b) => b.id === pilgrim.booking_id);
  if (!booking || booking.booking_status === "CANCELLED") return false;
  if (booking.booking_status === "HELD" || booking.booking_status === "WAITLIST") {
    return false;
  }
  return true;
}

/**
 * Recomputes both directions' `seats_ticketed` from the manifest's actual
 * `TICKETED` count, capped by seats held. Called after *any* write that can
 * change how many pilgrims are ticketed — the bulk sweep and the per-pilgrim
 * auto-advance alike — so the flight card's counter never drifts out of sync
 * with whichever path put a traveller there.
 */
function recomputeSeatsTicketed(
  data: DepartureGroupStore,
  departureGroupId: string,
): void {
  const outbound = data.flights.find(
    (f) => f.departure_group_id === departureGroupId && f.direction === "OUTBOUND",
  );

  if (outbound) {
    const ticketedTravellers = data.pilgrims.filter(
      (p) =>
        p.departure_group_id === departureGroupId &&
        p.flight_status === "TICKETED" &&
        !p.excluded_from_group_flight,
    ).length;
    outbound.seats_ticketed = Math.min(ticketedTravellers, outbound.seats_held);
  }

  // The return sector has no per-traveller status of its own, so its counter
  // follows the outbound one. Missing outbound evidence means zero ticketed,
  // never all return seats held (which fabricated a full manifest).
  const returnFlight = data.flights.find(
    (f) => f.departure_group_id === departureGroupId && f.direction === "RETURN",
  );
  if (returnFlight) {
    returnFlight.seats_ticketed = Math.min(
      outbound?.seats_ticketed ?? 0,
      returnFlight.seats_held,
    );
  }
}

export interface MarkFlightTicketsIssuedInput {
  flightId: string;
  departureGroupId: string;
}

export interface MarkFlightTicketsIssuedResult {
  flightId: string;
  direction: FlightDirection;
  seatsTicketed: number;
  pilgrimsUpdated: number;
}

export type MarkFlightTicketsIssuedOutcome =
  | { ok: true; result: MarkFlightTicketsIssuedResult }
  | { ok: false; error: string };

/**
 * Bulk-flips a flight's held seats to ticketed.
 *
 * `seats_ticketed` is a flight-level counter for both sectors, but the
 * per-pilgrim `flight_status` on the manifest tracks only one journey, which
 * in this schema is the outbound leg. Marking the OUTBOUND flight ticketed
 * therefore also promotes every traveller sitting at PENDING to TICKETED;
 * marking the RETURN flight only moves the flight's own counters, since
 * there is no separate return-leg status to flip. A traveller flagged
 * NAME_MISMATCH or CHANGE_REQUESTED is left alone — those need a human, not
 * a bulk sweep.
 */
export function markFlightTicketsIssuedInStore(
  data: DepartureGroupStore,
  input: MarkFlightTicketsIssuedInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): MarkFlightTicketsIssuedOutcome {
  const flight = data.flights.find(
    (f) => f.id === input.flightId && f.departure_group_id === input.departureGroupId,
  );
  if (!flight) return { ok: false, error: "That flight no longer exists." };
  if (flight.status === "CANCELLED") {
    return { ok: false, error: "This flight has been cancelled." };
  }
  if (flight.seats_held <= 0) {
    return { ok: false, error: "This flight has no seats held yet." };
  }
  // An airline issues tickets against a booking reference. Without one there is
  // nothing to have been ticketed, and recording it anyway put a group into
  // "tickets issued" on the strength of a number typed into a form.
  if (!flight.pnr?.trim()) {
    return {
      ok: false,
      error:
        "Attach the PNR before recording tickets — there is nothing to issue against.",
    };
  }

  /**
   * Only committed seats get tickets.
   *
   * This used to flip every `PENDING` traveller on the group, which meant an
   * unpaid hold — or a seat whose booking was still provisional — was marked
   * `TICKETED` on the manifest alongside travellers who had actually paid. The
   * flight's own counter was set to `seats_held`, a manually typed number with
   * no relationship to the people on the group, so "38 seats ticketed" could
   * sit above a manifest of twelve.
   */
  const eligible: typeof data.pilgrims = [];
  const stillHeld: string[] = [];

  for (const pilgrim of data.pilgrims) {
    if (pilgrim.departure_group_id !== input.departureGroupId) continue;
    if (pilgrim.flight_status !== "PENDING") continue;
    if (!isPilgrimReadyToTicket(data, pilgrim)) {
      const booking = data.bookings.find((b) => b.id === pilgrim.booking_id);
      if (
        booking &&
        (booking.booking_status === "HELD" || booking.booking_status === "WAITLIST")
      ) {
        stillHeld.push(pilgrim.full_name_snapshot);
      }
      continue;
    }
    eligible.push(pilgrim);
  }

  if (flight.direction === "OUTBOUND" && eligible.length === 0) {
    return {
      ok: false,
      error:
        stillHeld.length > 0
          ? `No traveller is ready to ticket — ${stillHeld.length} ${
              stillHeld.length === 1 ? "seat is" : "seats are"
            } still only held. Confirm those bookings first.`
          : "No traveller on this group is waiting on a ticket.",
    };
  }

  let pilgrimsUpdated = 0;
  if (flight.direction === "OUTBOUND") {
    for (const pilgrim of eligible) {
      pilgrim.flight_status = "TICKETED";
      pilgrimsUpdated++;
    }
  }
  // Recomputed from the manifest either way — including on a RETURN run,
  // where it just re-derives the mirrored figure from whatever the outbound
  // side already stands at (from this run, an earlier bulk run, or a
  // per-pilgrim ticket document that was auto-ticketed on its own; see
  // `recordTicketAiResultInStore`).
  recomputeSeatsTicketed(data, input.departureGroupId);

  flight.status = "TICKETED";

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "FLIGHT_TICKETS_ISSUED",
    entity_type: "FLIGHT",
    entity_id: flight.id,
    before_value: null,
    after_value: { seats_ticketed: flight.seats_ticketed },
    message: `Tickets issued for the ${DIRECTION_WORDS[flight.direction].toLowerCase()} flight — ${flight.seats_ticketed} seat${
      flight.seats_ticketed === 1 ? "" : "s"
    } ticketed.${
      pilgrimsUpdated > 0
        ? ` ${pilgrimsUpdated} pilgrim${pilgrimsUpdated === 1 ? "" : "s"} moved to Ticketed.`
        : ""
    }${
      stillHeld.length > 0
        ? ` ${stillHeld.length} still-held seat${
            stillHeld.length === 1 ? "" : "s"
          } skipped: ${stillHeld.slice(0, 3).join(", ")}${stillHeld.length > 3 ? "…" : ""}.`
        : ""
    }`,
    is_system: false,
    is_high_impact: true,
    created_at: now,
  });

  return {
    ok: true,
    result: {
      flightId: flight.id,
      direction: flight.direction,
      seatsTicketed: flight.seats_ticketed,
      pilgrimsUpdated,
    },
  };
}

/* ── Per-traveller ticketing issues ───────────────────────────────────────── */

export type PilgrimFlightIssue =
  | "NAME_MISMATCH"
  | "CHANGE_REQUESTED"
  | "RESOLVED";

export interface FlagPilgrimFlightIssueInput {
  pilgrimId: string;
  departureGroupId: string;
  issue: PilgrimFlightIssue;
  note?: string | null;
}

export type FlagPilgrimFlightIssueOutcome =
  | { ok: true; result: { fullName: string; flightStatus: PilgrimFlightStatus } }
  | { ok: false; error: string };

const ISSUE_WORDS: Record<Exclude<PilgrimFlightIssue, "RESOLVED">, string> = {
  NAME_MISMATCH: "a name mismatch against the passport",
  CHANGE_REQUESTED: "a requested flight change",
};

/**
 * Flags — or clears — a per-traveller ticketing problem.
 *
 * `NAME_MISMATCH` and `CHANGE_REQUESTED` were declared on the pilgrim row, given
 * badge colours in the manifest, and reachable from nothing: no code path could
 * assign either. That left the most common real ticketing failure — the ticket
 * spelling not matching the passport bio-page, which the airline refuses at
 * check-in — with nowhere to be recorded, so it lived in WhatsApp until
 * somebody remembered.
 *
 * A flagged traveller is deliberately skipped by the bulk "mark tickets issued"
 * sweep, because that is exactly the case that needs a person.
 */
export function flagPilgrimFlightIssueInStore(
  data: DepartureGroupStore,
  input: FlagPilgrimFlightIssueInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): FlagPilgrimFlightIssueOutcome {
  const pilgrim = data.pilgrims.find(
    (p) =>
      p.id === input.pilgrimId &&
      p.departure_group_id === input.departureGroupId,
  );
  if (!pilgrim) {
    return { ok: false, error: "That pilgrim is no longer on this group." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot}'s booking has been cancelled.`,
    };
  }

  const before = pilgrim.flight_status;

  if (input.issue === "RESOLVED") {
    if (before !== "NAME_MISMATCH" && before !== "CHANGE_REQUESTED") {
      return {
        ok: false,
        error: `${pilgrim.full_name_snapshot} has no open ticketing issue.`,
      };
    }
    // Back into the queue the bulk sweep works, not straight to ticketed: the
    // airline still has to reissue.
    pilgrim.flight_status = "PENDING";
  } else {
    if (before === "CANCELLED") {
      return {
        ok: false,
        error: `${pilgrim.full_name_snapshot}'s seat has been cancelled.`,
      };
    }
    if (before === input.issue) {
      return {
        ok: false,
        error: `${pilgrim.full_name_snapshot} is already flagged for that.`,
      };
    }
    pilgrim.flight_status = input.issue;
  }

  const note = input.note?.trim();
  const message =
    input.issue === "RESOLVED"
      ? `Ticketing issue cleared for ${pilgrim.full_name_snapshot} — back in the ticketing queue.${note ? ` ${note}` : ""}`
      : `${pilgrim.full_name_snapshot} flagged for ${ISSUE_WORDS[input.issue]}. The bulk ticketing sweep will skip this traveller until it is resolved.${note ? ` ${note}` : ""}`;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type:
      input.issue === "RESOLVED"
        ? "FLIGHT_ISSUE_RESOLVED"
        : "FLIGHT_ISSUE_FLAGGED",
    entity_type: "PILGRIM",
    entity_id: pilgrim.id,
    before_value: { flight_status: before },
    after_value: { flight_status: pilgrim.flight_status },
    message,
    is_system: false,
    is_high_impact: input.issue !== "RESOLVED",
    created_at: now,
  });

  return {
    ok: true,
    result: {
      fullName: pilgrim.full_name_snapshot,
      flightStatus: pilgrim.flight_status,
    },
  };
}

/* ── Ticket upload + AI review ────────────────────────────────────────────── */

export interface RecordTicketUploadInput {
  departureGroupId: string;
  pilgrimId: string;
  filePath: string;
  fileName: string;
}

export type RecordTicketUploadOutcome =
  | { ok: true; result: { fullName: string } }
  | { ok: false; error: string };

/** Attaches an uploaded ticket file to one pilgrim ("Upload Ticket"). */
export function recordTicketUploadInStore(
  data: DepartureGroupStore,
  input: RecordTicketUploadInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): RecordTicketUploadOutcome {
  const pilgrim = data.pilgrims.find(
    (p) =>
      p.id === input.pilgrimId &&
      p.departure_group_id === input.departureGroupId,
  );
  if (!pilgrim) {
    return { ok: false, error: "That pilgrim is no longer on this group." };
  }
  if (pilgrim.seat_status === "CANCELLED") {
    return {
      ok: false,
      error: `${pilgrim.full_name_snapshot}'s booking has been cancelled.`,
    };
  }

  pilgrim.ticket_file_path = input.filePath;
  pilgrim.ticket_file_name = input.fileName;
  pilgrim.ticket_uploaded_at = now;
  pilgrim.ticket_uploaded_by = actor.id;
  // A fresh upload invalidates any prior review — a re-uploaded ticket is
  // reviewed again from scratch, not left showing a stale verdict.
  pilgrim.ticket_ai_status = "PENDING";
  pilgrim.ticket_ai_extracted = null;
  pilgrim.ticket_ai_issues = null;
  pilgrim.ticket_ai_analyzed_at = null;
  pilgrim.ticket_ai_error = null;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: "TICKET_UPLOADED",
    entity_type: "PILGRIM",
    entity_id: pilgrim.id,
    before_value: null,
    after_value: { ticket_file_name: input.fileName },
    message: `Ticket uploaded for ${pilgrim.full_name_snapshot}.`,
    is_system: false,
    is_high_impact: false,
    created_at: now,
  });

  return { ok: true, result: { fullName: pilgrim.full_name_snapshot } };
}

export interface RecordTicketAiResultInput {
  departureGroupId: string;
  pilgrimId: string;
  status: "COMPLETE" | "FAILED";
  extracted: Record<string, string>;
  issues: { code: string; severity: "INFO" | "WARNING" | "CRITICAL"; message: string }[];
  error: string | null;
}

/**
 * Records the outcome of a ticket document review and reconciles it with the
 * seat-based ticketing state `markFlightTicketsIssuedInStore` (the "Mark
 * Tickets Issued" bulk sweep) drives — the two used to be entirely
 * independent, so an uploaded, cleanly-reviewed ticket could sit at
 * `flight_status = PENDING` forever unless someone separately ran the bulk
 * sweep, while the bulk sweep could just as easily mark a pilgrim `TICKETED`
 * who never had a document on file at all.
 *
 * Two outcomes now feed back into `flight_status`, under the same rules the
 * bulk sweep already enforces (`isPilgrimReadyToTicket`, a PNR attached to
 * the outbound flight):
 * - A name mismatch flags the pilgrim via `flagPilgrimFlightIssueInStore` —
 *   the same state a human raising the same concern would set, so the bulk
 *   sweep skips them exactly as it already does for a manually-flagged
 *   mismatch.
 * - A review that comes back COMPLETE with nothing at all to flag — no name
 *   mismatch, no flight-details mismatch, no PNR mismatch — advances the
 *   pilgrim straight to TICKETED, the same field value the bulk sweep would
 *   have set, so a document-first ticketing workflow doesn't need that
 *   separate manual click just to catch up. Any other kind of finding (a
 *   flight-details or PNR mismatch, a missing field) is recorded for a human
 *   to read but leaves `flight_status` at PENDING for the bulk sweep or a
 *   manual flag to resolve.
 */
export function recordTicketAiResultInStore(
  data: DepartureGroupStore,
  input: RecordTicketAiResultInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): void {
  const pilgrim = data.pilgrims.find(
    (p) =>
      p.id === input.pilgrimId &&
      p.departure_group_id === input.departureGroupId,
  );
  if (!pilgrim) return;

  pilgrim.ticket_ai_status = input.status;
  pilgrim.ticket_ai_extracted = input.extracted;
  pilgrim.ticket_ai_issues = input.issues;
  pilgrim.ticket_ai_analyzed_at = now;
  pilgrim.ticket_ai_error = input.error;

  const hasNameMismatch = input.issues.some((i) => i.code === "NAME_MISMATCH");
  if (
    hasNameMismatch &&
    pilgrim.flight_status !== "NAME_MISMATCH" &&
    pilgrim.flight_status !== "CANCELLED"
  ) {
    flagPilgrimFlightIssueInStore(
      data,
      {
        departureGroupId: input.departureGroupId,
        pilgrimId: input.pilgrimId,
        issue: "NAME_MISMATCH",
        note: "Flagged automatically by the AI ticket review.",
      },
      actor,
      now,
    );
    return;
  }

  if (
    input.status === "COMPLETE" &&
    input.issues.length === 0 &&
    pilgrim.flight_status === "PENDING"
  ) {
    const outboundFlight = data.flights.find(
      (f) =>
        f.departure_group_id === input.departureGroupId &&
        f.direction === "OUTBOUND",
    );
    if (
      outboundFlight &&
      outboundFlight.status !== "CANCELLED" &&
      outboundFlight.seats_held > 0 &&
      outboundFlight.pnr?.trim() &&
      isPilgrimReadyToTicket(data, pilgrim)
    ) {
      pilgrim.flight_status = "TICKETED";
      recomputeSeatsTicketed(data, input.departureGroupId);

      data.activity.push({
        id: newId(),
        departure_group_id: input.departureGroupId,
        actor_id: actor.id,
        actor_name_snapshot: actor.name,
        action_type: "TICKET_AI_AUTO_TICKETED",
        entity_type: "PILGRIM",
        entity_id: pilgrim.id,
        before_value: { flight_status: "PENDING" },
        after_value: { flight_status: "TICKETED" },
        message: `${pilgrim.full_name_snapshot} moved to Ticketed — the uploaded ticket document reviewed clean against PNR ${outboundFlight.pnr}.`,
        is_system: true,
        is_high_impact: false,
        created_at: now,
      });
    }
  }
}
