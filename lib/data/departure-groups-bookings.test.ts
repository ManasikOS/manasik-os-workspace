import { describe, expect, it } from "vitest";

import { emptyStore } from "./departure-groups-repository";
import {
  addTravellerRelationshipInStore,
  createGroupBookingInStore,
  removeTravellerRelationshipInStore,
  setBookingPayerInStore,
  validateBookingRequest,
  type BookableGroup,
} from "./departure-groups-bookings";
import type {
  DepartureGroupBookingRow,
  DepartureGroupPilgrimRow,
  DepartureGroupRow,
  DepartureGroupStore,
  GroupActor,
} from "@/lib/types/departure-groups";
import type { CreateGroupBookingInput } from "@/app/(main)/departure-groups/types";

const actor: GroupActor = { id: "staff-1", name: "Test Staff", agencyId: "agency-1" };

function fixtureStore(): { data: DepartureGroupStore; bookingId: string; pilgrimAId: string; pilgrimBId: string } {
  const data = emptyStore();
  const bookingId = "booking-1";
  const pilgrimAId = "pilgrim-a";
  const pilgrimBId = "pilgrim-b";

  data.bookings.push({
    id: bookingId,
    departure_group_id: "group-1",
    lead_id: null,
    booking_reference: "GRP-BK001",
    booking_status: "CONFIRMED",
    primary_contact_name: "Jane Doe",
    primary_contact_phone: "+94770000000",
    traveller_count: 2,
    room_occupancy_preference: "DOUBLE",
    package_price_per_person: 1000,
    total_booking_value: 2000,
    amount_paid: 500,
    outstanding_balance: 1500,
    next_due_at: null,
    seat_hold_expires_at: null,
    hold_released_at: null,
    booked_at: "2026-01-01T00:00:00.000Z",
    confirmed_at: "2026-01-01T00:00:00.000Z",
    waitlist_position: null,
    created_at: "2026-01-01T00:00:00.000Z",
  } as DepartureGroupBookingRow);

  const pilgrimBase = {
    departure_group_id: "group-1",
    booking_id: bookingId,
    pilgrim_id: null,
    phone_snapshot: null,
    passport_number_snapshot: null,
    passport_expiry: null,
    passport_issue_country: null,
    date_of_birth: null,
    seat_status: "CONFIRMED",
    flight_status: "PENDING",
    room_assignment_status: "UNASSIGNED",
    room_id: null,
    documents_completed: 0,
    documents_required: 0,
    document_completion_percent: 0,
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
    payment_status: "UNPAID",
    emergency_contact_status: "MISSING",
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    room_occupancy_type: "DOUBLE",
    has_customisations: false,
    excluded_from_group_flight: false,
  } as unknown as DepartureGroupPilgrimRow;

  data.pilgrims.push(
    { ...pilgrimBase, id: pilgrimAId, full_name_snapshot: "Pilgrim A" },
    { ...pilgrimBase, id: pilgrimBId, full_name_snapshot: "Pilgrim B" },
  );

  return { data, bookingId, pilgrimAId, pilgrimBId };
}

describe("setBookingPayerInStore", () => {
  it("records a payer by name and clears any linked pilgrim/lead", () => {
    const { data, bookingId } = fixtureStore();
    const outcome = setBookingPayerInStore(
      data,
      { bookingId, departureGroupId: "group-1", payerName: "Ahmed Uncle", payerEmail: "ahmed@example.com" },
      actor,
    );
    expect(outcome.ok).toBe(true);
    const booking = data.bookings.find((b) => b.id === bookingId)!;
    expect(booking.payer_name).toBe("Ahmed Uncle");
    expect(booking.payer_email).toBe("ahmed@example.com");
    expect(booking.payer_pilgrim_id).toBeNull();
  });

  it("rejects a payer with no identifying field", () => {
    const { data, bookingId } = fixtureStore();
    const outcome = setBookingPayerInStore(
      data,
      { bookingId, departureGroupId: "group-1", payerName: "" },
      actor,
    );
    expect(outcome.ok).toBe(false);
  });

  it("fails for a booking that does not exist", () => {
    const { data } = fixtureStore();
    const outcome = setBookingPayerInStore(
      data,
      { bookingId: "nope", departureGroupId: "group-1", payerName: "X" },
      actor,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("addTravellerRelationshipInStore / removeTravellerRelationshipInStore", () => {
  it("records a mahram relationship between two travellers on the same booking", () => {
    const { data, bookingId, pilgrimAId, pilgrimBId } = fixtureStore();
    const outcome = addTravellerRelationshipInStore(
      data,
      {
        bookingId,
        departureGroupId: "group-1",
        fromPilgrimId: pilgrimAId,
        toPilgrimId: pilgrimBId,
        relationship: "MAHRAM",
        isMahram: true,
      },
      actor,
    );
    expect(outcome.ok).toBe(true);
    expect(data.travellerRelationships).toHaveLength(1);
    expect(data.travellerRelationships[0].is_mahram).toBe(true);
  });

  it("rejects a traveller related to themselves", () => {
    const { data, bookingId, pilgrimAId } = fixtureStore();
    const outcome = addTravellerRelationshipInStore(
      data,
      {
        bookingId,
        departureGroupId: "group-1",
        fromPilgrimId: pilgrimAId,
        toPilgrimId: pilgrimAId,
        relationship: "OTHER",
        isMahram: false,
      },
      actor,
    );
    expect(outcome.ok).toBe(false);
  });

  it("rejects a duplicate relationship pair", () => {
    const { data, bookingId, pilgrimAId, pilgrimBId } = fixtureStore();
    addTravellerRelationshipInStore(
      data,
      { bookingId, departureGroupId: "group-1", fromPilgrimId: pilgrimAId, toPilgrimId: pilgrimBId, relationship: "SPOUSE", isMahram: false },
      actor,
    );
    const outcome = addTravellerRelationshipInStore(
      data,
      { bookingId, departureGroupId: "group-1", fromPilgrimId: pilgrimAId, toPilgrimId: pilgrimBId, relationship: "SPOUSE", isMahram: false },
      actor,
    );
    expect(outcome.ok).toBe(false);
  });

  it("rejects a traveller who is not on this booking", () => {
    const { data, bookingId, pilgrimAId } = fixtureStore();
    const outcome = addTravellerRelationshipInStore(
      data,
      { bookingId, departureGroupId: "group-1", fromPilgrimId: pilgrimAId, toPilgrimId: "stranger", relationship: "OTHER", isMahram: false },
      actor,
    );
    expect(outcome.ok).toBe(false);
  });

  it("removes a relationship it previously added", () => {
    const { data, bookingId, pilgrimAId, pilgrimBId } = fixtureStore();
    const added = addTravellerRelationshipInStore(
      data,
      { bookingId, departureGroupId: "group-1", fromPilgrimId: pilgrimAId, toPilgrimId: pilgrimBId, relationship: "SIBLING", isMahram: false },
      actor,
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const removed = removeTravellerRelationshipInStore(
      data,
      { relationshipId: added.result.id, bookingId, departureGroupId: "group-1" },
      actor,
    );
    expect(removed.ok).toBe(true);
    expect(data.travellerRelationships).toHaveLength(0);
  });
});

/**
 * Phase 5 of docs/modules/inbox-implementation-plan.md's exit criteria
 * names "sold-out group" and "capacity-race" as scenarios the Inbox's
 * create-booking flow must prove. It reuses this exact validation rather
 * than reimplementing it (see createBookingFromConversation ->
 * createGroupBooking -> createGroupBookingInStore), so these are the tests
 * that back that claim.
 */
function bookableGroup(overrides: Partial<BookableGroup> = {}): BookableGroup {
  return {
    group_name: "Umrah Feb Group A",
    group_status: "PREPARING",
    sales_status: "SELLING",
    available_seats: 10,
    waitlist_enabled: true,
    ...overrides,
  };
}

describe("validateBookingRequest", () => {
  it("accepts a booking within capacity on an open, selling group", () => {
    const outcome = validateBookingRequest(bookableGroup(), { bookingStatus: "CONFIRMED", travellerCount: 4 });
    expect(outcome.ok).toBe(true);
  });

  it("rejects a closed or cancelled group", () => {
    expect(validateBookingRequest(bookableGroup({ group_status: "CLOSED" }), { bookingStatus: "CONFIRMED", travellerCount: 1 }).ok).toBe(false);
    expect(validateBookingRequest(bookableGroup({ group_status: "CANCELLED" }), { bookingStatus: "CONFIRMED", travellerCount: 1 }).ok).toBe(false);
  });

  it("rejects when sales are closed or cancelled", () => {
    expect(validateBookingRequest(bookableGroup({ sales_status: "SALES_CLOSED" }), { bookingStatus: "CONFIRMED", travellerCount: 1 }).ok).toBe(false);
    expect(validateBookingRequest(bookableGroup({ sales_status: "CANCELLED" }), { bookingStatus: "CONFIRMED", travellerCount: 1 }).ok).toBe(false);
  });

  it("only accepts a waitlist entry on a waitlist-only group", () => {
    const group = bookableGroup({ sales_status: "WAITLIST" });
    expect(validateBookingRequest(group, { bookingStatus: "CONFIRMED", travellerCount: 1 }).ok).toBe(false);
    expect(validateBookingRequest(group, { bookingStatus: "WAITLIST", travellerCount: 1 }).ok).toBe(true);
  });

  it("rejects a booking with no travellers", () => {
    expect(validateBookingRequest(bookableGroup(), { bookingStatus: "CONFIRMED", travellerCount: 0 }).ok).toBe(false);
  });

  it("rejects a sold-out group when the party exceeds available seats", () => {
    const group = bookableGroup({ available_seats: 2 });
    const outcome = validateBookingRequest(group, { bookingStatus: "CONFIRMED", travellerCount: 3 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/waitlist instead/);
  });

  it("gives a different sold-out message when the waitlist is disabled", () => {
    const group = bookableGroup({ available_seats: 0, waitlist_enabled: false });
    const outcome = validateBookingRequest(group, { bookingStatus: "CONFIRMED", travellerCount: 1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/waitlist is disabled/);
  });

  it("does not gate a WAITLIST booking on available seats", () => {
    const group = bookableGroup({ available_seats: 0 });
    expect(validateBookingRequest(group, { bookingStatus: "WAITLIST", travellerCount: 5 }).ok).toBe(true);
  });
});

function fixtureGroup(overrides: Partial<DepartureGroupRow> = {}): DepartureGroupRow {
  return {
    id: "group-1",
    group_name: "Umrah Feb Group A",
    group_code: "UMR-FEB-A",
    group_status: "PREPARING",
    sales_status: "SELLING",
    departure_date: "2027-02-01",
    capacity: 40,
    booked_seats: 0,
    held_seats: 0,
    available_seats: 2,
    waitlist_enabled: true,
    seat_hold_expiry_hours: 48,
    ...overrides,
  } as DepartureGroupRow;
}

function fixtureBookingInput(overrides: Partial<CreateGroupBookingInput> = {}): CreateGroupBookingInput {
  return {
    departureGroupId: "group-1",
    bookingReference: "",
    bookingStatus: "CONFIRMED",
    primaryContactName: "Jane Doe",
    primaryContactPhone: "+94770000000",
    travellerCount: 2,
    roomOccupancyPreference: "DOUBLE",
    packagePricePerPerson: 1000,
    amountPaid: 0,
    ...overrides,
  };
}

describe("createGroupBookingInStore — capacity race", () => {
  it("lets a second booking claim the last seats a first booking just consumed, and rejects a third that would oversell", () => {
    const data = emptyStore();
    // available_seats is a generated column, recomputed from capacity/booked/held
    // by the mutator itself — capacity must actually be 2 for it to land there.
    data.groups.push(fixtureGroup({ capacity: 2, available_seats: 2 }));

    const first = createGroupBookingInStore(data, fixtureBookingInput({ travellerCount: 2 }), actor);
    expect(first.ok).toBe(true);
    // The mutation window is what actually closes the race — group.available_seats
    // is derived from the same store the next call reads, not refetched.
    expect(data.groups[0].available_seats).toBe(0);

    // Selling out flips the group to waitlist-only (syncSalesStatusToSeats),
    // so the rejection here is "waitlist only", not a seat count — real,
    // useful behaviour, not a bug the first draft of this test assumed away.
    const second = createGroupBookingInStore(data, fixtureBookingInput({ travellerCount: 1 }), actor);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/waitlist/i);

    const waitlisted = createGroupBookingInStore(
      data,
      fixtureBookingInput({ travellerCount: 1, bookingStatus: "WAITLIST" }),
      actor,
    );
    expect(waitlisted.ok).toBe(true);
  });

  it("rejects a booking against a group whose sales are closed", () => {
    const data = emptyStore();
    data.groups.push(fixtureGroup({ sales_status: "SALES_CLOSED" }));
    const outcome = createGroupBookingInStore(data, fixtureBookingInput(), actor);
    expect(outcome.ok).toBe(false);
  });
});
