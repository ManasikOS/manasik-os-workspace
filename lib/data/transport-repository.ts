/**
 * Cross-group read access for `/transport-movements`.
 *
 * A movement is still a child of its departure group —
 * `departure_group_transports` is not renamed or duplicated, and every
 * mutation (request/confirm transport, set the internal cost) still lives
 * in `lib/data/departure-groups.ts` and is only reachable from the group's
 * own Transport tab. Same posture as `flights-repository.ts` and
 * `hotels-repository.ts`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class TransportPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Transport: ${operation} on ${table} failed — ${detail}`);
  }
}

export type TransportStatus = "NOT_REQUESTED" | "REQUESTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
export type VehicleType = "COACH" | "VAN" | "PRIVATE_CAR" | "TRAIN" | "OTHER";

export interface CrossGroupTransportRow {
  id: string;
  departureGroupId: string;
  routeLabel: string;
  origin: string;
  destination: string;
  status: TransportStatus;
  supplierName: string | null;
  vehicleType: VehicleType;
  vehicleCapacity: number | null;
  passengerCount: number | null;
  pickupAt: string | null;
  pickupLocation: string | null;
  driverName: string | null;
  driverPhone: string | null;
  internalCost: number | null;
  groupName: string;
  groupCode: string;
  groupStatus: string;
}

/**
 * Every movement across every group, soonest pickup first (movements with no
 * pickup time yet sort last). `internalCost` is nulled without
 * `viewSupplierCosts`, same posture as the group's own Transport tab.
 */
export async function listAllTransports(
  client: Db,
  can: DepartureGroupCapabilities,
): Promise<CrossGroupTransportRow[]> {
  const { data, error } = await client
    .from("departure_group_transports")
    .select(
      `id, departure_group_id, route_label, origin, destination, status,
       supplier_name, vehicle_type, vehicle_capacity, passenger_count,
       pickup_at, pickup_location, driver_name, driver_phone, internal_cost,
       departure_groups:departure_group_id ( group_name, group_code, group_status )`,
    )
    .order("pickup_at", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (error) throw new TransportPersistenceError("departure_group_transports", "select", error);

  interface RawRow {
    id: string;
    departure_group_id: string;
    route_label: string;
    origin: string;
    destination: string;
    status: TransportStatus;
    supplier_name: string | null;
    vehicle_type: VehicleType;
    vehicle_capacity: number | null;
    passenger_count: number | null;
    pickup_at: string | null;
    pickup_location: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    internal_cost: number | null;
    departure_groups: { group_name: string; group_code: string; group_status: string } | null;
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const group = row.departure_groups ?? { group_name: "—", group_code: "—", group_status: "PLANNING" };
    return {
      id: row.id,
      departureGroupId: row.departure_group_id,
      routeLabel: row.route_label,
      origin: row.origin,
      destination: row.destination,
      status: row.status,
      supplierName: row.supplier_name,
      vehicleType: row.vehicle_type,
      vehicleCapacity: row.vehicle_capacity,
      passengerCount: row.passenger_count,
      pickupAt: row.pickup_at,
      pickupLocation: row.pickup_location,
      driverName: row.driver_name,
      driverPhone: row.driver_phone,
      internalCost: can.viewSupplierCosts ? row.internal_cost : null,
      groupName: group.group_name,
      groupCode: group.group_code,
      groupStatus: group.group_status,
    } satisfies CrossGroupTransportRow;
  });
}
