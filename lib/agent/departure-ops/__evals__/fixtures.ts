/**
 * Fixture builders for the offline eval harness — §13 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Every builder
 * returns a plain row with sensible, group-consistent defaults;
 * `overrides` sets exactly the fields one scenario cares about. No
 * database, no Next runtime — `DepartureGroupStore` is plain arrays, the
 * same property `departure-groups-readiness.ts` was written for.
 *
 * Starter set: 3 scenarios (healthy, critical-blockers, urgent-ticketing),
 * not the ~25 the plan describes. The reusable part — these builders and
 * `check.ts`'s runner — is what makes fixture #4 onward a short function,
 * not new plumbing; growing the set to 25 is now an authoring task, not an
 * infrastructure one. Disclosed, not hidden: a 3-fixture starter set is
 * real coverage of the plan's own named examples (a healthy group, an
 * urgent ticketing deadline, a refused visa + unconfirmed hotel), not the
 * full breadth Phase 7 originally called for.
 */

import { newId } from "@/lib/data/departure-groups-ids";
import { buildReadinessItems, TEMPLATE_LIBRARY } from "@/lib/data/departure-groups-copy";
import { emptyStore } from "@/lib/data/departure-groups-repository";
import type {
  DepartureGroupAccommodationRow,
  DepartureGroupBookingRow,
  DepartureGroupFlightRow,
  DepartureGroupPilgrimRow,
  DepartureGroupRow,
  DepartureGroupStore,
  DepartureGroupTransportRow,
} from "@/lib/types/departure-groups";

const TEMPLATE = TEMPLATE_LIBRARY[0]; // UMRAH_TEMPLATE — a representative, realistic checklist

/** Today + N days, as a date-only ISO string (matches every departure_date/check_in_date column). */
export function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function groupRow(overrides: Partial<DepartureGroupRow> & { id: string; departure_date: string }): DepartureGroupRow {
  return {
    agency_id: "fixture-agency",
    branch_id: null,
    branch: "Colombo",
    package_template_id: null,
    group_name: "Fixture Umrah Group",
    group_code: "FIX-001",
    journey_type: "UMRAH",
    group_status: "PREPARING",
    sales_status: "SELLING",
    return_date: daysFromNow(14),
    duration_days: 14,
    duration_nights: 13,
    capacity: 40,
    minimum_group_size: 10,
    booked_seats: 0,
    held_seats: 0,
    available_seats: 40,
    waitlist_enabled: true,
    seat_hold_expiry_hours: 24,
    primary_guide_id: null,
    primary_guide_name: "Fixture Guide",
    primary_guide_supplier_id: null,
    backup_guide_name: null,
    operations_owner_id: null,
    operations_owner_name: "Ops Owner",
    visa_owner_id: null,
    visa_owner_name: "Visa Owner",
    finance_owner_id: null,
    finance_owner_name: "Finance Owner",
    local_coordinator_name: null,
    local_coordinator_phone: null,
    emergency_phone: null,
    guide_whatsapp_link: null,
    pilgrim_broadcast_link: null,
    umrah_company_name: null,
    nusuk_program_ref: null,
    nusuk_group_ref: null,
    visa_batch_ref: null,
    visa_invoice_ref: null,
    nusuk_status: "NOT_LINKED",
    readiness_score: 0,
    readiness_status: "NOT_STARTED",
    ready_at: null,
    departed_at: null,
    completed_at: null,
    closed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

export function bookingRow(
  overrides: Partial<DepartureGroupBookingRow> & { id: string; departure_group_id: string },
): DepartureGroupBookingRow {
  return {
    lead_id: null,
    booking_reference: `BK-${overrides.id.slice(0, 6)}`,
    booking_status: "CONFIRMED",
    primary_contact_name: "Fixture Contact",
    primary_contact_phone: "0770000000",
    traveller_count: 1,
    room_occupancy_preference: "QUAD",
    package_price_per_person: 450_000,
    total_booking_value: 450_000,
    amount_paid: 450_000,
    outstanding_balance: 0,
    next_due_at: null,
    seat_hold_expires_at: null,
    hold_released_at: null,
    booked_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    waitlist_position: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function pilgrimRow(
  overrides: Partial<DepartureGroupPilgrimRow> & { id: string; departure_group_id: string; booking_id: string },
): DepartureGroupPilgrimRow {
  return {
    pilgrim_id: null,
    full_name_snapshot: "Fixture Pilgrim",
    phone_snapshot: null,
    passport_number_snapshot: "N1234567",
    passport_expiry: daysFromNow(400),
    passport_issue_country: "LK",
    date_of_birth: "1990-01-01",
    seat_status: "CONFIRMED",
    flight_status: "PENDING",
    room_assignment_status: "UNASSIGNED",
    room_id: null,
    documents_completed: 3,
    documents_required: 3,
    document_completion_percent: 100,
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
    payment_status: "PAID_IN_FULL",
    emergency_contact_status: "COMPLETE",
    emergency_contact_name: "Next of Kin",
    emergency_contact_phone: "0770000001",
    emergency_contact_relationship: "Spouse",
    room_occupancy_type: null,
    has_customisations: false,
    excluded_from_group_flight: false,
    ...overrides,
  };
}

export function accommodationRow(
  overrides: Partial<DepartureGroupAccommodationRow> & { id: string; departure_group_id: string; city: "MAKKAH" | "MADINAH" },
): DepartureGroupAccommodationRow {
  return {
    hotel_name: overrides.city === "MAKKAH" ? "Fixture Makkah Hotel" : "Fixture Madinah Hotel",
    supplier_name: "Fixture Supplier",
    supplier_id: null,
    booking_reference: null,
    status: "NOT_REQUESTED",
    check_in_date: daysFromNow(0),
    check_out_date: daysFromNow(7),
    nights: 7,
    room_capacity: 40,
    rooms_reserved: 0,
    rooms_allocated: 0,
    meal_plan: null,
    distance_description: "Within 500m",
    voucher_url: null,
    internal_cost: null,
    notes: null,
    ...overrides,
  };
}

export function flightRow(
  overrides: Partial<DepartureGroupFlightRow> & { id: string; departure_group_id: string; direction: "OUTBOUND" | "RETURN" },
): DepartureGroupFlightRow {
  return {
    status: "DRAFT",
    airline: "Fixture Air",
    flight_number: null,
    pnr: null,
    booking_reference: null,
    origin_airport_code: "CMB",
    origin_airport_name: "Colombo",
    destination_airport_code: "JED",
    destination_airport_name: "Jeddah",
    departure_at: `${daysFromNow(0)}T10:00:00.000Z`,
    arrival_at: `${daysFromNow(0)}T16:00:00.000Z`,
    cabin_class: "Economy",
    seat_capacity: 40,
    seats_held: 0,
    seats_ticketed: 0,
    ticketing_deadline: null,
    supplier_name: null,
    supplier_id: null,
    notes: null,
    ...overrides,
  };
}

export function transportRow(
  overrides: Partial<DepartureGroupTransportRow> & { id: string; departure_group_id: string },
): DepartureGroupTransportRow {
  return {
    template_transport_requirement_id: null,
    route_label: "Airport → Hotel (Arrival)",
    origin: "Jeddah Airport",
    destination: "Makkah Hotel",
    status: "NOT_REQUESTED",
    supplier_name: null,
    supplier_id: null,
    booking_reference: null,
    vehicle_type: "COACH",
    vehicle_capacity: 45,
    passenger_count: 40,
    pickup_at: null,
    pickup_location: null,
    driver_name: null,
    driver_phone: null,
    coordinator_name: null,
    coordinator_phone: null,
    internal_cost: null,
    confirmation_url: null,
    notes: null,
    ...overrides,
  };
}

/**
 * Assembles a full `DepartureGroupStore` for one group: the group row, N
 * confirmed bookings/pilgrims, the two hotels, both flight legs, and a
 * realistic readiness checklist seeded from `TEMPLATE_LIBRARY[0]` (the
 * real UMRAH template — the same categories, `auto_source` rules and due
 * dates a real group gets). `deriveReadinessStatuses()` re-derives every
 * auto-sourced item from the rows built here, so a scenario only needs to
 * shape the underlying rows correctly, never the checklist directly.
 */
export function buildScenarioStore(config: {
  groupOverrides?: Partial<DepartureGroupRow> & { id: string; departure_date: string };
  travellerCount?: number;
  pilgrimOverrides?: (index: number) => Partial<DepartureGroupPilgrimRow>;
  accommodationOverrides?: {
    makkah?: Omit<Partial<DepartureGroupAccommodationRow>, "city">;
    madinah?: Omit<Partial<DepartureGroupAccommodationRow>, "city">;
  };
  flightOverrides?: { outbound?: Partial<DepartureGroupFlightRow>; return?: Partial<DepartureGroupFlightRow> };
  transports?: Partial<DepartureGroupTransportRow>[];
}): { store: DepartureGroupStore; groupId: string } {
  const groupId = config.groupOverrides?.id ?? newId();
  const departureDate = config.groupOverrides?.departure_date ?? daysFromNow(30);
  const store = emptyStore();

  store.groups.push(groupRow({ id: groupId, departure_date: departureDate, ...config.groupOverrides }));

  const travellerCount = config.travellerCount ?? 4;
  let idx = 0;
  for (let i = 0; i < travellerCount; i++) {
    const bookingId = newId();
    store.bookings.push(bookingRow({ id: bookingId, departure_group_id: groupId }));
    store.pilgrims.push(
      pilgrimRow({
        id: newId(),
        departure_group_id: groupId,
        booking_id: bookingId,
        full_name_snapshot: `Fixture Pilgrim ${i + 1}`,
        ...(config.pilgrimOverrides?.(idx) ?? {}),
      }),
    );
    idx++;
  }

  store.accommodations.push(
    accommodationRow({ id: newId(), departure_group_id: groupId, city: "MAKKAH", ...config.accommodationOverrides?.makkah }),
    accommodationRow({ id: newId(), departure_group_id: groupId, city: "MADINAH", ...config.accommodationOverrides?.madinah }),
  );

  store.flights.push(
    flightRow({ id: newId(), departure_group_id: groupId, direction: "OUTBOUND", ...config.flightOverrides?.outbound }),
    flightRow({ id: newId(), departure_group_id: groupId, direction: "RETURN", ...config.flightOverrides?.return }),
  );

  for (const t of config.transports ?? []) {
    store.transports.push(transportRow({ id: newId(), departure_group_id: groupId, ...t }));
  }

  store.readinessItems.push(
    ...buildReadinessItems(TEMPLATE, groupId, departureDate, (i) => `${groupId}-ri-${i}`),
  );

  return { store, groupId };
}
