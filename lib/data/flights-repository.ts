/**
 * Cross-group read access for `/flights-tickets`.
 *
 * A flight is still a child of its departure group — `departure_group_flights`
 * is not renamed or duplicated, and every mutation (add/edit a flight, record
 * PNR, mark ticketed, upload tickets) still lives in
 * `lib/data/departure-groups.ts` and is only reachable from inside the
 * group's own Flights tab. This file only reads across every group so a
 * flight can be found without knowing its group first — same posture as
 * `bookings-repository.ts`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class FlightsPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Flights: ${operation} on ${table} failed — ${detail}`);
  }
}

export type FlightStatus = "DRAFT" | "HELD" | "CONFIRMED" | "TICKETED" | "CANCELLED";
export type FlightDirection = "OUTBOUND" | "RETURN";

export interface FlightManifestPassenger {
  /** departure_group_pilgrims.id — the booking-row id, not pilgrims.id. */
  rowId: string;
  fullName: string;
  phone: string | null;
  passportNumber: string | null;
  seatStatus: string;
  flightStatus: string;
  assignedAt: string;
}

export interface CrossGroupFlightRow {
  id: string;
  departureGroupId: string;
  direction: FlightDirection;
  status: FlightStatus;
  airline: string;
  flightNumber: string | null;
  pnr: string | null;
  bookingReference: string | null;
  originAirportCode: string;
  destinationAirportCode: string;
  departureAt: string;
  arrivalAt: string;
  cabinClass: string;
  seatCapacity: number;
  seatsHeld: number;
  seatsTicketed: number;
  ticketingDeadline: string | null;
  supplierName: string | null;
  baggageAllowanceKg: number | null;
  baggageNotes: string | null;
  groupName: string;
  groupCode: string;
  groupStatus: string;
}

/** Every flight leg across every group the tenant owns, soonest departure first. */
export async function listAllFlights(client: Db): Promise<CrossGroupFlightRow[]> {
  const { data, error } = await client
    .from("departure_group_flights")
    .select(
      `id, departure_group_id, direction, status, airline, flight_number, pnr,
       booking_reference, origin_airport_code, destination_airport_code,
       departure_at, arrival_at, cabin_class, seat_capacity, seats_held,
       seats_ticketed, ticketing_deadline, supplier_name,
       baggage_allowance_kg, baggage_notes,
       departure_groups:departure_group_id ( group_name, group_code, group_status )`,
    )
    .order("departure_at", { ascending: true })
    .limit(1000);

  if (error) throw new FlightsPersistenceError("departure_group_flights", "select", error);

  interface RawRow {
    id: string;
    departure_group_id: string;
    direction: FlightDirection;
    status: FlightStatus;
    airline: string;
    flight_number: string | null;
    pnr: string | null;
    booking_reference: string | null;
    origin_airport_code: string;
    destination_airport_code: string;
    departure_at: string;
    arrival_at: string;
    cabin_class: string;
    seat_capacity: number;
    seats_held: number;
    seats_ticketed: number;
    ticketing_deadline: string | null;
    supplier_name: string | null;
    baggage_allowance_kg: number | null;
    baggage_notes: string | null;
    departure_groups: { group_name: string; group_code: string; group_status: string } | null;
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const group = row.departure_groups ?? { group_name: "—", group_code: "—", group_status: "PLANNING" };
    return {
      id: row.id,
      departureGroupId: row.departure_group_id,
      direction: row.direction,
      status: row.status,
      airline: row.airline,
      flightNumber: row.flight_number,
      pnr: row.pnr,
      bookingReference: row.booking_reference,
      originAirportCode: row.origin_airport_code,
      destinationAirportCode: row.destination_airport_code,
      departureAt: row.departure_at,
      arrivalAt: row.arrival_at,
      cabinClass: row.cabin_class,
      seatCapacity: row.seat_capacity,
      seatsHeld: row.seats_held,
      seatsTicketed: row.seats_ticketed,
      ticketingDeadline: row.ticketing_deadline,
      supplierName: row.supplier_name,
      baggageAllowanceKg: row.baggage_allowance_kg,
      baggageNotes: row.baggage_notes,
      groupName: group.group_name,
      groupCode: group.group_code,
      groupStatus: group.group_status,
    } satisfies CrossGroupFlightRow;
  });
}

export async function getFlight(client: Db, flightId: string): Promise<CrossGroupFlightRow | null> {
  const rows = await listAllFlights(client);
  return rows.find((f) => f.id === flightId) ?? null;
}

/** Everyone currently assigned to this specific flight — the manifest. */
export async function listFlightManifest(client: Db, flightId: string): Promise<FlightManifestPassenger[]> {
  const { data, error } = await client
    .from("departure_group_pilgrim_flights")
    .select(
      "assigned_at, departure_group_pilgrims:departure_group_pilgrim_id ( id, full_name_snapshot, phone_snapshot, passport_number_snapshot, seat_status, flight_status )",
    )
    .eq("flight_id", flightId);
  if (error) throw new FlightsPersistenceError("departure_group_pilgrim_flights", "select", error);

  interface RawRow {
    assigned_at: string;
    departure_group_pilgrims: {
      id: string;
      full_name_snapshot: string;
      phone_snapshot: string | null;
      passport_number_snapshot: string | null;
      seat_status: string;
      flight_status: string;
    } | null;
  }

  return ((data ?? []) as unknown as RawRow[])
    .filter((row) => row.departure_group_pilgrims)
    .map((row) => {
      const p = row.departure_group_pilgrims!;
      return {
        rowId: p.id,
        fullName: p.full_name_snapshot,
        phone: p.phone_snapshot,
        passportNumber: p.passport_number_snapshot,
        seatStatus: p.seat_status,
        flightStatus: p.flight_status,
        assignedAt: row.assigned_at,
      } satisfies FlightManifestPassenger;
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Every traveller in the flight's own group who is not already on this flight — the assign picker's candidate pool. */
export async function listUnassignedForFlight(
  client: Db,
  departureGroupId: string,
  flightId: string,
): Promise<FlightManifestPassenger[]> {
  const { data: assignedRows, error: assignedError } = await client
    .from("departure_group_pilgrim_flights")
    .select("departure_group_pilgrim_id")
    .eq("flight_id", flightId);
  if (assignedError) throw new FlightsPersistenceError("departure_group_pilgrim_flights", "select", assignedError);
  const assignedIds = new Set(((assignedRows ?? []) as { departure_group_pilgrim_id: string }[]).map((r) => r.departure_group_pilgrim_id));

  const { data, error } = await client
    .from("departure_group_pilgrims")
    .select("id, full_name_snapshot, phone_snapshot, passport_number_snapshot, seat_status, flight_status")
    .eq("departure_group_id", departureGroupId);
  if (error) throw new FlightsPersistenceError("departure_group_pilgrims", "select", error);

  return ((data ?? []) as {
    id: string;
    full_name_snapshot: string;
    phone_snapshot: string | null;
    passport_number_snapshot: string | null;
    seat_status: string;
    flight_status: string;
  }[])
    .filter((row) => !assignedIds.has(row.id))
    .map((row) => ({
      rowId: row.id,
      fullName: row.full_name_snapshot,
      phone: row.phone_snapshot,
      passportNumber: row.passport_number_snapshot,
      seatStatus: row.seat_status,
      flightStatus: row.flight_status,
      assignedAt: "",
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function assignPassengerToFlight(
  client: Db,
  flightId: string,
  departureGroupPilgrimId: string,
  assignedByName: string,
): Promise<void> {
  const { error } = await client.from("departure_group_pilgrim_flights").upsert(
    {
      flight_id: flightId,
      departure_group_pilgrim_id: departureGroupPilgrimId,
      assigned_by_name: assignedByName,
    },
    { onConflict: "departure_group_pilgrim_id,flight_id" },
  );
  if (error) throw new FlightsPersistenceError("departure_group_pilgrim_flights", "insert", error);
}

export async function removePassengerFromFlight(
  client: Db,
  flightId: string,
  departureGroupPilgrimId: string,
): Promise<void> {
  const { error } = await client
    .from("departure_group_pilgrim_flights")
    .delete()
    .eq("flight_id", flightId)
    .eq("departure_group_pilgrim_id", departureGroupPilgrimId);
  if (error) throw new FlightsPersistenceError("departure_group_pilgrim_flights", "delete", error);
}

export async function updateFlightBaggageRules(
  client: Db,
  flightId: string,
  input: { allowanceKg: number | null; notes: string | null },
): Promise<void> {
  const { error } = await client
    .from("departure_group_flights")
    .update({ baggage_allowance_kg: input.allowanceKg, baggage_notes: input.notes })
    .eq("id", flightId);
  if (error) throw new FlightsPersistenceError("departure_group_flights", "update", error);
}
