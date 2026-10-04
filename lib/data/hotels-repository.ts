/**
 * Cross-group read access for `/hotels-rooming`.
 *
 * A hotel stay is still a child of its departure group —
 * `departure_group_accommodations` is not renamed or duplicated, and every
 * mutation (request/confirm a hotel, set the internal cost, generate rooms,
 * assign a pilgrim) still lives in `lib/data/departure-groups.ts` and is
 * only reachable from the group's own Hotels tab. This file only reads
 * across every group — same posture as `bookings-repository.ts` and
 * `flights-repository.ts`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class HotelsPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Hotels: ${operation} on ${table} failed — ${detail}`);
  }
}

export type AccommodationCity = "MAKKAH" | "MADINAH" | "MINA" | "ARAFAT" | "OTHER";
export type AccommodationStatus = "NOT_REQUESTED" | "REQUESTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";

export interface CrossGroupAccommodationRow {
  id: string;
  departureGroupId: string;
  city: AccommodationCity;
  hotelName: string;
  supplierName: string | null;
  status: AccommodationStatus;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  roomCapacity: number;
  roomsReserved: number;
  roomsAllocated: number;
  mealPlan: string | null;
  internalCost: number | null;
  groupName: string;
  groupCode: string;
  groupStatus: string;
}

/**
 * Every hotel stay segment across every group, soonest check-in first.
 * `internalCost` is nulled for a role without `viewSupplierCosts`, same
 * posture as the group's own Hotels tab.
 */
export async function listAllAccommodations(
  client: Db,
  can: DepartureGroupCapabilities,
): Promise<CrossGroupAccommodationRow[]> {
  const { data, error } = await client
    .from("departure_group_accommodations")
    .select(
      `id, departure_group_id, city, hotel_name, supplier_name, status,
       check_in_date, check_out_date, nights, room_capacity, rooms_reserved,
       rooms_allocated, meal_plan, internal_cost,
       departure_groups:departure_group_id ( group_name, group_code, group_status )`,
    )
    .order("check_in_date", { ascending: true })
    .limit(1000);

  if (error) throw new HotelsPersistenceError("departure_group_accommodations", "select", error);

  interface RawRow {
    id: string;
    departure_group_id: string;
    city: AccommodationCity;
    hotel_name: string;
    supplier_name: string | null;
    status: AccommodationStatus;
    check_in_date: string;
    check_out_date: string;
    nights: number;
    room_capacity: number;
    rooms_reserved: number;
    rooms_allocated: number;
    meal_plan: string | null;
    internal_cost: number | null;
    departure_groups: { group_name: string; group_code: string; group_status: string } | null;
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const group = row.departure_groups ?? { group_name: "—", group_code: "—", group_status: "PLANNING" };
    return {
      id: row.id,
      departureGroupId: row.departure_group_id,
      city: row.city,
      hotelName: row.hotel_name,
      supplierName: row.supplier_name,
      status: row.status,
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date,
      nights: row.nights,
      roomCapacity: row.room_capacity,
      roomsReserved: row.rooms_reserved,
      roomsAllocated: row.rooms_allocated,
      mealPlan: row.meal_plan,
      internalCost: can.viewSupplierCosts ? row.internal_cost : null,
      groupName: group.group_name,
      groupCode: group.group_code,
      groupStatus: group.group_status,
    } satisfies CrossGroupAccommodationRow;
  });
}

export type RoomType = "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "OTHER";
export type RoomStatus = "AVAILABLE" | "PARTIAL" | "COMPLETE" | "BLOCKED";

export interface CrossGroupRoomRow {
  id: string;
  accommodationId: string;
  departureGroupId: string;
  hotelName: string;
  city: AccommodationCity;
  checkInDate: string;
  checkOutDate: string;
  roomNumber: string | null;
  roomType: RoomType;
  occupancyCapacity: number;
  assignedPilgrimCount: number;
  status: RoomStatus;
  notes: string | null;
  groupName: string;
  groupCode: string;
}

/**
 * Every room across every hotel stay, grouped implicitly by hotel+city+dates
 * at read time by the board itself — this just returns the flat rows. The
 * rooming board's whole point is spotting PARTIAL rooms across different
 * groups sharing the same hotel at overlapping dates, so this pulls in the
 * accommodation's own hotel/city/date fields alongside each room, not just
 * the group it belongs to.
 */
export async function listAllRooms(client: Db): Promise<CrossGroupRoomRow[]> {
  const { data, error } = await client
    .from("departure_group_rooms")
    .select(
      `id, accommodation_id, room_number, room_type, occupancy_capacity,
       assigned_pilgrim_count, status, notes,
       departure_group_accommodations:accommodation_id (
         departure_group_id, hotel_name, city, check_in_date, check_out_date,
         departure_groups:departure_group_id ( group_name, group_code )
       )`,
    )
    .limit(2000);

  if (error) throw new HotelsPersistenceError("departure_group_rooms", "select", error);

  interface RawRow {
    id: string;
    accommodation_id: string;
    room_number: string | null;
    room_type: RoomType;
    occupancy_capacity: number;
    assigned_pilgrim_count: number;
    status: RoomStatus;
    notes: string | null;
    departure_group_accommodations: {
      departure_group_id: string;
      hotel_name: string;
      city: AccommodationCity;
      check_in_date: string;
      check_out_date: string;
      departure_groups: { group_name: string; group_code: string } | null;
    } | null;
  }

  return ((data ?? []) as unknown as RawRow[])
    .filter((row) => row.departure_group_accommodations)
    .map((row) => {
      const acc = row.departure_group_accommodations!;
      const group = acc.departure_groups ?? { group_name: "—", group_code: "—" };
      return {
        id: row.id,
        accommodationId: row.accommodation_id,
        departureGroupId: acc.departure_group_id,
        hotelName: acc.hotel_name,
        city: acc.city,
        checkInDate: acc.check_in_date,
        checkOutDate: acc.check_out_date,
        roomNumber: row.room_number,
        roomType: row.room_type,
        occupancyCapacity: row.occupancy_capacity,
        assignedPilgrimCount: row.assigned_pilgrim_count,
        status: row.status,
        notes: row.notes,
        groupName: group.group_name,
        groupCode: group.group_code,
      } satisfies CrossGroupRoomRow;
    })
    .sort((a, b) => a.hotelName.localeCompare(b.hotelName) || a.checkInDate.localeCompare(b.checkInDate));
}
