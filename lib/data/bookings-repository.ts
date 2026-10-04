/**
 * Cross-group read access for the top-level `/bookings` screen.
 *
 * A booking is still a child of its departure group — `departure_group_bookings`
 * is not renamed or promoted, and every mutation (record payment, edit, move,
 * cancel, invoice) still lives in `lib/data/departure-groups.ts` and is only
 * ever reachable from inside a group. This file only *reads* across every
 * group the caller's tenant owns, so a "find this booking" list doesn't
 * require knowing which group it lives in first. RLS on
 * `departure_group_bookings` and `departure_groups` (agency_id =
 * current_agency_id()) is what actually enforces tenant isolation here — this
 * file adds capability-based redaction on top, the same posture as
 * `suppliers-repository.ts` and `finance-repository.ts`.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class BookingsPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Bookings: ${operation} on ${table} failed — ${detail}`);
  }
}

export interface CrossGroupBookingRow {
  id: string;
  bookingReference: string;
  bookingStatus:
    | "HELD"
    | "DEPOSIT_PENDING"
    | "CONFIRMED"
    | "CANCELLED"
    | "WAITLIST";
  primaryContactName: string;
  primaryContactPhone: string;
  travellerCount: number;
  roomOccupancyPreference: string;
  totalBookingValue: number | null;
  amountPaid: number | null;
  outstandingBalance: number | null;
  nextDueAt: string | null;
  seatHoldExpiresAt: string | null;
  bookedAt: string | null;
  createdAt: string;
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  groupStatus: string;
  departureDate: string;
  currency: string;
  bookingType: "GROUP" | "CUSTOM";
  payerName: string | null;
}

/**
 * Every booking across every group the tenant owns, newest first. Money
 * fields are nulled out for a role without `viewFinance` before the row ever
 * reaches a Client Component — same as `PilgrimsBookingsTab` does per group.
 */
export async function listAllBookings(
  client: Db,
  can: DepartureGroupCapabilities,
): Promise<CrossGroupBookingRow[]> {
  const { data, error } = await client
    .from("departure_group_bookings")
    .select(
      `id, booking_reference, booking_status, primary_contact_name,
       primary_contact_phone, traveller_count, room_occupancy_preference,
       total_booking_value, amount_paid, outstanding_balance, next_due_at,
       seat_hold_expires_at, booked_at, created_at, departure_group_id,
       booking_type, payer_name,
       departure_groups:departure_group_id (
         group_name, group_code, group_status, departure_date
       )`,
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw new BookingsPersistenceError("departure_group_bookings", "select", error);

  interface RawRow {
    id: string;
    booking_reference: string;
    booking_status: CrossGroupBookingRow["bookingStatus"];
    primary_contact_name: string;
    primary_contact_phone: string;
    traveller_count: number;
    room_occupancy_preference: string;
    total_booking_value: number;
    amount_paid: number;
    outstanding_balance: number;
    next_due_at: string | null;
    seat_hold_expires_at: string | null;
    booked_at: string | null;
    created_at: string;
    departure_group_id: string;
    booking_type: CrossGroupBookingRow["bookingType"] | null;
    payer_name: string | null;
    departure_groups: {
      group_name: string;
      group_code: string;
      group_status: string;
      departure_date: string;
    } | null;
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => {
    const group = row.departure_groups ?? {
      group_name: "",
      group_code: "",
      group_status: "PLANNING",
      departure_date: "",
    };
    return {
      id: row.id,
      bookingReference: row.booking_reference,
      bookingStatus: row.booking_status,
      primaryContactName: row.primary_contact_name,
      primaryContactPhone: row.primary_contact_phone,
      travellerCount: row.traveller_count,
      roomOccupancyPreference: row.room_occupancy_preference,
      totalBookingValue: can.viewFinance ? Number(row.total_booking_value) : null,
      amountPaid: can.viewFinance ? Number(row.amount_paid) : null,
      outstandingBalance: can.viewFinance ? Number(row.outstanding_balance) : null,
      nextDueAt: can.viewFinance ? row.next_due_at : null,
      seatHoldExpiresAt: row.seat_hold_expires_at,
      bookedAt: row.booked_at,
      createdAt: row.created_at,
      departureGroupId: row.departure_group_id,
      groupName: group.group_name ?? "—",
      groupCode: group.group_code ?? "—",
      groupStatus: group.group_status ?? "PLANNING",
      departureDate: group.departure_date ?? "",
      currency: "LKR",
      bookingType: row.booking_type ?? "GROUP",
      payerName: row.payer_name,
    } satisfies CrossGroupBookingRow;
  });
}

export interface GroupPickerOption {
  id: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  groupStatus: string;
}

/**
 * Open (not departed/completed/closed/cancelled) groups for the "New
 * Booking → pick a departure group" flow on `/bookings`. Selecting one
 * navigates to `/departure-groups/{id}?tab=pilgrims&add=1` — the exact deep
 * link the groups list's own "Add Booking" row action already uses — so the
 * actual form (occupancy, pricing, deposit) is the one existing
 * `AddBookingSheet`, not a second implementation of it.
 */
export async function listOpenGroupsForBookingPicker(
  client: Db,
): Promise<GroupPickerOption[]> {
  const { data, error } = await client
    .from("departure_groups")
    .select("id, group_name, group_code, departure_date, group_status")
    .not("group_status", "in", "(DEPARTED,COMPLETED,CLOSED,CANCELLED)")
    .order("departure_date", { ascending: true });

  if (error) throw new BookingsPersistenceError("departure_groups", "select", error);

  return (data ?? []).map((row) => ({
    id: row.id,
    groupName: row.group_name,
    groupCode: row.group_code,
    departureDate: row.departure_date,
    groupStatus: row.group_status,
  }));
}
