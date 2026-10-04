import { emptyStore } from "@/lib/data/departure-groups-repository";
import { createGroupBookingInStore } from "@/lib/data/departure-groups-bookings";
import { buildGroupPricing } from "@/lib/data/departure-groups-copy";
import type { CreateGroupBookingInput } from "@/app/(main)/departure-groups/types";
import type { DepartureGroupRow, GroupActor, PaymentMilestoneSnapshot, DepartureGroupReadinessItemRow } from "@/lib/types/departure-groups";

export const NOW = "2026-09-15T12:00:00.000Z";
export const TENANTS = {
  a: "10000000-0000-4000-8000-000000000001",
  b: "10000000-0000-4000-8000-000000000002",
};

export function schedule(): PaymentMilestoneSnapshot[] {
  return [
    { id: "deposit", label: "Deposit", amount_type: "Percentage", amount: 30,
      due_rule: "On Booking", due_date: null, days_before_departure: null, refundable: true },
    { id: "fixed", label: "Fixed installment", amount_type: "Fixed Amount", amount: 100,
      due_rule: "Fixed Date", due_date: "2026-09-20", days_before_departure: null, refundable: true },
    { id: "balance", label: "Balance", amount_type: "Remaining Balance", amount: null,
      due_rule: "Days Before Departure", due_date: null, days_before_departure: 14, refundable: true },
  ];
}

export function group(tenant: keyof typeof TENANTS = "a"): DepartureGroupRow {
  return {
    id: tenant === "a" ? "20000000-0000-4000-8000-000000000001" : "20000000-0000-4000-8000-000000000002",
    agency_id: TENANTS[tenant], branch_id: null, branch: "Test branch", package_template_id: null,
    group_name: `Fixture ${tenant}`, group_code: `FIX-${tenant}`, journey_type: "UMRAH",
    group_status: "PLANNING", sales_status: "SELLING", departure_date: "2026-10-15",
    return_date: "2026-10-25", duration_days: 11, duration_nights: 10,
    capacity: 10, minimum_group_size: 1, booked_seats: 0, held_seats: 0, available_seats: 10,
    waitlist_enabled: true, seat_hold_expiry_hours: 48,
    primary_guide_id: null, primary_guide_name: null, primary_guide_supplier_id: null,
    backup_guide_name: null, operations_owner_id: null, operations_owner_name: null,
    visa_owner_id: null, visa_owner_name: null, finance_owner_id: null, finance_owner_name: null,
    local_coordinator_name: null, local_coordinator_phone: null, emergency_phone: null,
    guide_whatsapp_link: null, pilgrim_broadcast_link: null, umrah_company_name: null,
    nusuk_program_ref: null, nusuk_group_ref: null, visa_batch_ref: null, visa_invoice_ref: null,
    nusuk_status: "NOT_LINKED", readiness_score: 0, readiness_status: "NOT_STARTED",
    ready_at: null, departed_at: null, completed_at: null, closed_at: null, cancelled_at: null,
    cancellation_reason: null, archived: false, created_at: NOW, updated_at: NOW,
    created_by: null, updated_by: null,
  };
}

/** Isolated application-domain fixture, never inserted into a live database. */
export function bookingFixture(options: {
  tenant?: keyof typeof TENANTS;
  currency?: "LKR" | "USD";
  fares?: number[];
  paid?: number;
  status?: CreateGroupBookingInput["bookingStatus"];
} = {}) {
  const data = emptyStore();
  const g = group(options.tenant);
  const actor: GroupActor = { id: null, name: "Phase A fixture", agencyId: g.agency_id };
  data.groups.push(g);
  data.pricing.push(buildGroupPricing(g.id, {
    currency: options.currency ?? "LKR", quadPrice: 1000, triplePrice: 1100,
    doublePrice: 1200, singlePrice: 1500, childPrice: 600, infantPrice: 100,
    earlyBirdPrice: null, advanceDeposit: 300,
  }, schedule(), NOW));
  const fares = options.fares ?? [1000];
  const outcome = createGroupBookingInStore(data, {
    departureGroupId: g.id, bookingReference: "", bookingStatus: options.status ?? "CONFIRMED",
    primaryContactName: "Synthetic traveller", primaryContactPhone: "+94000000000",
    travellerCount: fares.length, roomOccupancyPreference: "QUAD", packagePricePerPerson: 1000,
    amountPaid: options.paid ?? 0,
    travellers: fares.map((pricePerPerson, index) => ({ fullName: `Synthetic ${index + 1}`, pricePerPerson })),
  }, actor, NOW);
  if (!outcome.ok) throw new Error(`Fixture creation failed: ${outcome.error}`);
  const booking = data.bookings.find((b) => b.id === outcome.result.bookingId)!;
  return { data, group: g, actor, booking };
}

export const SCENARIOS = [
  { name: "individual-unpaid", fares: [1000], paid: 0 },
  { name: "family-mixed-partial", fares: [1000, 600, 100], paid: 300 },
  { name: "individual-settled", fares: [1000], paid: 1000 },
  { name: "held", fares: [1000], paid: 0, status: "HELD" },
  { name: "waitlist", fares: [1000], paid: 0, status: "WAITLIST" },
] as const;

export function operationalFixture(mode: "GROUP" | "OWN_FLIGHT" | "LAND_ONLY" = "GROUP") {
  const fixture = bookingFixture();
  const { data, group: g } = fixture;
  for (const city of ["MAKKAH", "MADINAH"] as const) {
    const id = `hotel-${city}`;
    data.accommodations.push({
      id, departure_group_id: g.id, city, hotel_name: `Test ${city}`, supplier_name: null,
      supplier_id: null, booking_reference: null, status: "CONFIRMED", check_in_date: "2026-10-15",
      check_out_date: "2026-10-20", nights: 5, room_capacity: 4, rooms_reserved: 1,
      rooms_allocated: city === "MAKKAH" ? 1 : 0, meal_plan: null, distance_description: null,
      voucher_url: null, internal_cost: 100, notes: null,
    });
    data.rooms.push({ id: `room-${city}`, accommodation_id: id, room_number: "101",
      room_type: "QUAD", occupancy_capacity: 4, assigned_pilgrim_count: city === "MAKKAH" ? 1 : 0,
      status: city === "MAKKAH" ? "PARTIAL" : "AVAILABLE", notes: null });
  }
  const pilgrim = data.pilgrims[0];
  pilgrim.room_id = "room-MAKKAH";
  pilgrim.room_assignment_status = "ASSIGNED";
  pilgrim.excluded_from_group_flight = mode !== "GROUP";
  data.roomAssignments.push({ id: "assignment", room_id: "room-MAKKAH", accommodation_id: "hotel-MAKKAH",
    pilgrim_id: pilgrim.id, assigned_at: NOW, assigned_by: null, assigned_by_name: "Fixture" });
  for (const direction of ["OUTBOUND", "RETURN"] as const) {
    data.flights.push({ id: `flight-${direction}`, departure_group_id: g.id, direction, status: "CONFIRMED",
      airline: "Synthetic airline", flight_number: "TEST1", pnr: "TESTPNR", booking_reference: null,
      origin_airport_code: "CMB", origin_airport_name: "Colombo", destination_airport_code: "JED",
      destination_airport_name: "Jeddah", departure_at: "2026-10-15T00:00:00Z", arrival_at: "2026-10-15T06:00:00Z",
      cabin_class: "Economy", seat_capacity: 10, seats_held: 1, seats_ticketed: 0,
      ticketing_deadline: null, supplier_name: null, supplier_id: null, notes: null });
  }
  const readiness: DepartureGroupReadinessItemRow = {
    id: "rooming", departure_group_id: g.id, source_template_requirement_id: null, label: "All stays assigned",
    category: "ROOMING", responsible_role: "OPERATIONS", assigned_to_user_id: null, assigned_to_name: null,
    due_type: "DAYS_BEFORE_DEPARTURE", due_days_before_departure: 7, due_at: null,
    required: true, status: "NOT_STARTED", auto_source: "ROOMING_COMPLETE", evidence_url: null,
    notes: null, completed_at: null, completed_by: null, completed_by_name: null,
  };
  data.readinessItems.push(readiness);
  return { ...fixture, pilgrim, readiness, mode };
}
