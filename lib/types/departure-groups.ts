/**
 * Hand-maintained row types for the departure-groups schema.
 *
 * Keep these in sync with `supabase/migrations/20260809090000_create_departure_groups.sql`.
 * Same convention as `lib/types/database.ts`: snake_case, exactly the shape a
 * `select *` returns, so swapping the seeded repository for a real Supabase
 * query is a one-line change in `lib/data/departure-groups.ts`.
 */

/* ── The acting staff member ──────────────────────────────────────────────── */

/**
 * Who is performing a mutation.
 *
 * `id` and `name` are needed and neither substitutes for the other: `id` is
 * the `auth.users` foreign key the audit columns are declared against, `name`
 * is what the activity trail and the Readiness drawer print. Storing the name
 * in a uuid column — which the module used to do — fails on insert; storing
 * only the id leaves the trail unreadable once a staff account is removed.
 *
 * `agencyId` is the tenant every row this actor creates gets stamped with —
 * see `persistStore()` in `departure-groups-repository.ts`. `null` only for
 * a caller with no resolvable tenant (no `staff_profiles` row); the session
 * client's own RLS default still applies in that case, but a service-role
 * caller (the WhatsApp agent) has no RLS default to fall back on, so it must
 * always supply a real `agencyId`.
 */
export interface GroupActor {
  id: string | null;
  name: string;
  agencyId: string | null;
}

/* ── Enumerations ─────────────────────────────────────────────────────────── */

export type GroupJourneyType = "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";

export type DepartureGroupStatus =
  | "PLANNING"
  | "PREPARING"
  | "READY_TO_DEPART"
  | "DEPARTED"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELLED";

/**
 * The group-level Masar Nusuk visa-batch gate — matches the regulator's own
 * per-group issuance flow: qualify/contract → link to a program → submit the
 * group → pay the invoice → visas issue. Distinct from, and never derived
 * from, any individual pilgrim's `visa_status`.
 */
export type NusukStatus =
  | "NOT_LINKED"
  | "PROGRAM_LINKED"
  | "GROUP_SUBMITTED"
  | "INVOICE_PENDING"
  | "INVOICE_PAID"
  | "VISAS_ISSUED"
  | "REJECTED";

export type GroupSalesStatus =
  | "SELLING"
  | "LIMITED_AVAILABILITY"
  | "WAITLIST"
  | "SALES_CLOSED"
  | "CANCELLED";

export type GroupReadinessStatus =
  | "READY"
  | "AT_RISK"
  | "BLOCKED"
  | "NOT_STARTED";

export type FlightDirection = "OUTBOUND" | "RETURN";

export type FlightStatus =
  | "DRAFT"
  | "HELD"
  | "CONFIRMED"
  | "TICKETED"
  | "CANCELLED";

export type AccommodationCity =
  | "MAKKAH"
  | "MADINAH"
  | "MINA"
  | "ARAFAT"
  | "OTHER";

export type SupplierStatus =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED";

export type RoomType = "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "OTHER";

export type RoomStatus = "AVAILABLE" | "PARTIAL" | "COMPLETE" | "BLOCKED";

export type VehicleType = "COACH" | "VAN" | "PRIVATE_CAR" | "TRAIN" | "OTHER";

export type BookingStatus =
  | "HELD"
  | "DEPOSIT_PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "WAITLIST";

export type SeatStatus =
  | "HELD"
  | "CONFIRMED"
  | "TICKETED"
  | "CANCELLED"
  | "WAITLIST";

export type RoomAssignmentStatus = "UNASSIGNED" | "ASSIGNED" | "LOCKED";

export type PilgrimVisaStatus =
  | "NOT_STARTED"
  | "DOCUMENTS_PENDING"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "REWORK_REQUIRED";

export type PilgrimPaymentStatus =
  | "NOT_STARTED"
  | "DEPOSIT_PAID"
  | "PARTIAL"
  | "PAID_IN_FULL"
  | "OVERDUE"
  | "REFUND_PENDING";

export type EmergencyContactStatus = "COMPLETE" | "INCOMPLETE" | "MISSING";

export type PilgrimFlightStatus =
  | "TICKETED"
  | "PENDING"
  | "NAME_MISMATCH"
  | "CANCELLED"
  | "CHANGE_REQUESTED";

export type ReadinessCategory =
  | "FLIGHT"
  | "HOTEL"
  | "TRANSPORT"
  | "PAYMENT"
  | "DOCUMENT"
  | "VISA"
  | "ROOMING"
  | "GUIDE"
  | "MANIFEST"
  | "CATERING"
  | "OTHER";

export type ResponsibleRole =
  | "ADMIN"
  | "OPERATIONS"
  | "VISA"
  | "FINANCE"
  | "GUIDE"
  | "MARKETING";

export type ReadinessDueType =
  | "BEFORE_GROUP_OPENS"
  | "BEFORE_FIRST_BOOKING"
  | "BEFORE_VISA_SUBMISSION"
  | "BEFORE_FINAL_PAYMENT"
  | "DAYS_BEFORE_DEPARTURE"
  | "BEFORE_DEPARTURE";

export type ReadinessItemStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "AT_RISK"
  | "BLOCKED"
  | "NOT_REQUIRED";

/**
 * The rule that computes a readiness item, when it is a fact about other rows
 * rather than an assertion someone makes.
 *
 * An item carrying one of these is never ticked by hand: the Readiness tab used
 * to be able to claim "Makkah Hotel Booking Confirmed" while the accommodation
 * row said `NOT_REQUESTED` and the Overview derived the opposite from the same
 * data. `null` means a genuinely manual item — a briefing held, a buffet
 * confirmed by phone — which keeps its old behaviour exactly.
 */
export type ReadinessAutoSource =
  | "FLIGHT_OUTBOUND_CONFIRMED"
  | "FLIGHT_TICKETED"
  | "HOTEL_MAKKAH_CONFIRMED"
  | "HOTEL_MADINAH_CONFIRMED"
  | "TRANSPORT_ARRIVAL_CONFIRMED"
  | "TRANSPORT_INTERCITY_CONFIRMED"
  | "TRANSPORT_DEPARTURE_CONFIRMED"
  | "PAYMENTS_COLLECTED_IN_FULL"
  | "DOCUMENTS_ALL_VERIFIED"
  | "VISAS_ALL_APPROVED"
  | "ROOMING_COMPLETE"
  | "GUIDE_ASSIGNED"
  | "MANIFEST_READY";

/* ── Traveller documents ──────────────────────────────────────────────────── */

/**
 * The gate a document blocks.
 *
 * Parsed from the template's free-text `requiredByStage` at copy time so the
 * gate is a value the code can branch on, rather than a label nothing reads.
 * `BEFORE_VISA_SUBMISSION` is the one that answers "when does the visa stage
 * come?" — an application cannot be submitted while a document carrying it is
 * still outstanding.
 */
export type DocumentStage =
  | "ON_BOOKING"
  | "BEFORE_VISA_SUBMISSION"
  | "BEFORE_FINAL_PAYMENT"
  | "BEFORE_DEPARTURE";

export type DocumentStatus =
  | "NOT_SUBMITTED"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  /** Genuinely does not apply to this traveller — an infant's NIC, say. */
  | "NOT_APPLICABLE";

export type TaskStatus = "OPEN" | "IN_PROGRESS" | "COMPLETE" | "OVERDUE";

export type TaskCategory =
  | "OPERATIONS"
  | "VISA"
  | "FINANCE"
  | "GUIDE"
  | "MARKETING"
  | "OTHER";

export type ActivityEntityType =
  | "GROUP"
  | "FLIGHT"
  | "ACCOMMODATION"
  | "ROOM"
  | "TRANSPORT"
  | "BOOKING"
  | "PILGRIM"
  | "PAYMENT"
  | "READINESS_ITEM"
  | "TASK"
  | "DOCUMENT"
  | "VISA"
  | "CHARGE"
  | "DEVIATION";

/* ── Per-pilgrim customisation ────────────────────────────────────────────── */

export type ChargeType =
  | "BASE_FARE"
  | "ROOM_UPGRADE"
  | "EXTRA_NIGHTS"
  | "FLIGHT_VARIATION"
  | "TRANSPORT_VARIATION"
  | "ADDON"
  | "DISCOUNT"
  | "SURCHARGE"
  | "PRICE_CORRECTION"
  | "CANCELLATION_FEE";

export type ChargeSource = "SNAPSHOT" | "MANUAL" | "ADDON_CATALOGUE" | "SYSTEM";

export type DeviationType =
  | "ROOM_TYPE"
  | "EXTRA_NIGHTS"
  | "HOTEL_UPGRADE"
  | "MEAL_PLAN"
  | "ROOMMATE_REQUEST"
  | "LAND_ONLY"
  | "OWN_FLIGHT"
  | "EXTENDED_STAY"
  | "CABIN_UPGRADE"
  | "SEAT_PREFERENCE"
  | "PRIVATE_TRANSFER"
  | "PICKUP_POINT"
  | "ITINERARY_OPT_OUT"
  | "ITINERARY_ADDITION"
  | "SERVICE_ADDON"
  | "DOCUMENT_REQUIREMENT"
  | "ASSISTANCE"
  | "OTHER";

export type DeviationStatus =
  | "REQUESTED"
  | "APPROVED"
  | "ARRANGED"
  | "DECLINED"
  | "CANCELLED";

/* ── Deviation detail (typed jsonb payload) ───────────────────────────────── */

export type DeviationDetail =
  | { kind: "ROOM_TYPE"; roomType: RoomType; roommatePilgrimIds?: string[] }
  | {
      kind: "EXTRA_NIGHTS";
      accommodationId: string | null;
      city: AccommodationCity;
      nights: number;
      side: "BEFORE" | "AFTER";
      checkInDate?: string;
      checkOutDate?: string;
    }
  | {
      kind: "HOTEL_UPGRADE";
      fromAccommodationId: string | null;
      city: AccommodationCity;
      hotelName: string;
      supplierName?: string;
      distanceDescription?: string;
      bookingReference?: string;
      checkInDate?: string;
      checkOutDate?: string;
    }
  | { kind: "MEAL_PLAN"; accommodationId: string | null; mealPlan: string }
  | { kind: "ROOMMATE_REQUEST"; withPilgrimIds: string[]; note?: string }
  | {
      kind: "OWN_FLIGHT";
      replacesFlightIds: string[];
      direction: FlightDirection | "BOTH";
      airline: string;
      flightNumber?: string;
      pnr?: string;
      originAirportCode?: string;
      destinationAirportCode?: string;
      departureAt?: string;
      arrivalAt?: string;
      arrivesWithGroup: boolean;
    }
  | { kind: "LAND_ONLY"; replacesFlightIds: string[]; note?: string }
  | {
      kind: "CABIN_UPGRADE";
      flightId: string;
      fromCabin: string;
      toCabin: string;
      pnr?: string;
    }
  | {
      kind: "SEAT_PREFERENCE";
      flightId: string;
      preference:
        | "WINDOW"
        | "AISLE"
        | "EXTRA_LEGROOM"
        | "BULKHEAD"
        | "TOGETHER"
        | "OTHER";
      note?: string;
    }
  | {
      kind: "EXTENDED_STAY";
      returnFlightId: string | null;
      newReturnDate: string;
      onwardArrangement: string;
    }
  | { kind: "ITINERARY_OPT_OUT"; itineraryItemIds: string[]; reason?: string }
  | {
      kind: "ITINERARY_ADDITION";
      title: string;
      dayNumber: number | null;
      location: string;
      description: string;
      scheduledAt?: string;
      supplierName?: string;
    }
  | {
      kind: "SERVICE_ADDON";
      addonId: string | null;
      addonCode?: string;
      quantity: number;
      note?: string;
    }
  | {
      kind: "PRIVATE_TRANSFER";
      transportId: string | null;
      route: string;
      vehicleType: VehicleType;
      pickupAt?: string;
    }
  | {
      kind: "PICKUP_POINT";
      transportId: string | null;
      pickupLocation: string;
      pickupAt?: string;
    }
  | {
      kind: "DOCUMENT_REQUIREMENT";
      documentName: string;
      requiredByStage: DocumentStage;
    }
  | {
      kind: "ASSISTANCE";
      assistanceType:
        | "WHEELCHAIR"
        | "MEDICAL"
        | "DIETARY"
        | "MOBILITY"
        | "OTHER";
      details: string;
    }
  | { kind: "OTHER"; note: string };

/* ── Snapshot payloads (JSONB columns) ────────────────────────────────────── */

/**
 * The package configuration frozen at group-creation time. Deliberately loose
 * unions of the wizard's own types so a later Package Template edit can never
 * reshape an already-running group.
 */
export interface PricingSnapshot {
  currency: string;
  quad_price: number | null;
  triple_price: number | null;
  double_price: number | null;
  single_price: number | null;
  child_price: number | null;
  infant_price: number | null;
  advance_deposit: number | null;
}

export interface PaymentMilestoneSnapshot {
  id: string;
  label: string;
  amount_type: "Fixed Amount" | "Percentage" | "Remaining Balance";
  amount: number | null;
  due_rule: "On Booking" | "Fixed Date" | "Days Before Departure";
  due_date: string | null;
  days_before_departure: number | null;
  refundable: boolean;
}

export interface ItinerarySnapshotItem {
  id: string;
  day_number: number;
  title: string;
  location: string;
  description: string;
  category: string;
}

export interface AccommodationStandardSnapshot {
  city: AccommodationCity;
  standard: string;
  customer_wording: string;
  nights: number;
  meal_plan: string;
  target_distance: string;
  occupancies: string[];
}

export interface TransportRequirementSnapshot {
  id: string;
  route_label: string;
  origin: string;
  destination: string;
  required: boolean;
  vehicle_standard: string;
  vehicle_notes: string;
}

export interface TravellerRequirementSnapshot {
  id: string;
  name: string;
  category: string;
  required: boolean;
  required_by_stage: string;
  verified_by_role: string;
}

/** Machine key for a document requirement, independent of its free-text name. */
export type DocumentType =
  | "PASSPORT_BIO"
  | "PASSPORT_ADDITIONAL"
  | "PASSPORT_PHOTO"
  | "NATIONAL_ID"
  | "VISA_COPY"
  | "INSURANCE"
  | "VACCINATION"
  | "MEDICAL"
  | "EMERGENCY_CONTACT"
  | "PAYMENT_PROOF"
  | "FLIGHT_TICKET"
  | "HOTEL_VOUCHER"
  | "OTHER";

export interface ReadinessRequirementSnapshot {
  id: string;
  label: string;
  required: boolean;
  responsible_role: ResponsibleRole;
  category: ReadinessCategory;
  due_type: ReadinessDueType;
  due_days_before_departure: number | null;
}

/* ── Tables ───────────────────────────────────────────────────────────────── */

/** A. `departure_groups` */
export interface DepartureGroupRow {
  id: string;
  agency_id: string | null;
  branch_id: string | null;
  /** Display/filter value, mirroring `packages.branch`. */
  branch: string;
  /**
   * Null when the group was built from a built-in template that has no
   * `packages` row; the frozen snapshot still carries the name and code.
   */
  package_template_id: string | null;

  group_name: string;
  group_code: string;
  journey_type: GroupJourneyType;
  group_status: DepartureGroupStatus;
  sales_status: GroupSalesStatus;

  departure_date: string;
  return_date: string;
  duration_days: number;
  duration_nights: number;

  capacity: number;
  minimum_group_size: number;
  booked_seats: number;
  held_seats: number;
  /** Generated column: capacity - booked_seats - held_seats, floored at 0. */
  available_seats: number;
  waitlist_enabled: boolean;
  seat_hold_expiry_hours: number;

  primary_guide_id: string | null;
  primary_guide_name: string | null;
  /** FK into `public.suppliers`, for a guide sourced externally rather than an internal staff member (`primary_guide_id`). */
  primary_guide_supplier_id: string | null;
  backup_guide_name: string | null;
  operations_owner_id: string | null;
  operations_owner_name: string | null;
  visa_owner_id: string | null;
  visa_owner_name: string | null;
  finance_owner_id: string | null;
  finance_owner_name: string | null;
  local_coordinator_name: string | null;
  local_coordinator_phone: string | null;
  emergency_phone: string | null;
  guide_whatsapp_link: string | null;
  pilgrim_broadcast_link: string | null;

  /**
   * Masar Nusuk / regulatory identifiers. `nusuk_status` is a group-level
   * batch gate — never a substitute for a pilgrim's own `visa_status`. See
   * migration `20260910090000`.
   */
  umrah_company_name: string | null;
  nusuk_program_ref: string | null;
  nusuk_group_ref: string | null;
  visa_batch_ref: string | null;
  visa_invoice_ref: string | null;
  nusuk_status: NusukStatus;

  readiness_score: number;
  readiness_status: GroupReadinessStatus;

  /** Lifecycle stamps. Each is set by exactly one transition and never cleared. */
  ready_at: string | null;
  departed_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;

  archived: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/** B. `departure_group_package_snapshots` */
export interface DepartureGroupPackageSnapshotRow {
  departure_group_id: string;
  /** Null for a built-in template — see `source_template_key`. */
  package_template_id: string | null;
  /** The template identifier as given, whether or not it is a `packages` row. */
  source_template_key: string | null;
  package_name_snapshot: string;
  package_code_snapshot: string;
  overview_snapshot: string;
  pricing_snapshot: PricingSnapshot;
  payment_schedule_snapshot: PaymentMilestoneSnapshot[];
  itinerary_snapshot: ItinerarySnapshotItem[];
  inclusions_snapshot: string[];
  exclusions_snapshot: string[];
  accommodation_standards_snapshot: AccommodationStandardSnapshot[];
  transport_requirements_snapshot: TransportRequirementSnapshot[];
  traveller_requirements_snapshot: TravellerRequirementSnapshot[];
  readiness_requirements_snapshot: ReadinessRequirementSnapshot[];
  copied_at: string;
  /** The package_versions row this group was built from — null when the template had no publish history at creation time, or the group predates this column. */
  package_version_id: string | null;
  policy_snapshot: {
    cancellationPolicy: string;
    paymentTerms: string;
    latePaymentPolicy: string;
    priceChangeDisclaimer: string;
  };
  included_services_snapshot: string[];
  duration_days_snapshot: number | null;
  duration_nights_snapshot: number | null;
  seat_reservation_rule_snapshot: string;
  communication_templates_snapshot: string[];
}

/**
 * A. bis. `departure_group_pricing` — the group's CURRENT, editable price.
 *
 * `pricing_snapshot` on `DepartureGroupPackageSnapshotRow` is an immutable
 * audit record of what the template said at creation time; this table is
 * the live value every booking, KPI and dialog should actually price
 * against. Seeded from the snapshot at creation (`price_source =
 * 'TEMPLATE'`), then editable independently of both the template and any
 * other departure created from it.
 */
export interface DepartureGroupPricingRow {
  departure_group_id: string;
  currency: string;
  quad_price: number | null;
  triple_price: number | null;
  double_price: number | null;
  single_price: number | null;
  child_price: number | null;
  infant_price: number | null;
  early_bird_price: number | null;
  early_bird_valid_until: string | null;
  advance_deposit: number | null;
  payment_milestones: PaymentMilestoneSnapshot[];
  price_source: "TEMPLATE" | "OVERRIDDEN";
  priced_by: string | null;
  priced_at: string;
  updated_at: string;
}

/**
 * A. ter. `departure_group_cost_estimates` — the group's own, editable cost
 * sheet. Seeded from `packages.finance_estimate` at creation;
 * `fixed_cost_per_departure` has no template equivalent and starts at 0.
 * Source for the read-only `departure_group_costing` view (margin, break-even
 * headcount) fetched via `getGroupCostingRow()`.
 */
export interface DepartureGroupCostEstimateRow {
  departure_group_id: string;
  flight_cost_per_pilgrim: number | null;
  accommodation_cost_per_pilgrim: number | null;
  transport_cost_per_pilgrim: number | null;
  visa_insurance_cost_per_pilgrim: number | null;
  catering_cost_per_pilgrim: number | null;
  guide_operations_cost_per_pilgrim: number | null;
  contingency_cost_per_pilgrim: number | null;
  fixed_cost_per_departure: number;
  updated_at: string;
  updated_by: string | null;
}

/** Read-only projection of the `departure_group_costing` view. */
export interface DepartureGroupCostingRow {
  departure_group_id: string;
  list_price: number;
  confirmed_pax: number;
  estimated_variable_cost_per_pax: number;
  fixed_cost_per_departure: number;
  actual_supplier_cost: number;
  break_even_headcount: number | null;
  estimated_gross_margin: number;
}

/** C. `departure_group_flights` */
export interface DepartureGroupFlightRow {
  id: string;
  departure_group_id: string;
  direction: FlightDirection;
  status: FlightStatus;
  airline: string;
  flight_number: string | null;
  pnr: string | null;
  booking_reference: string | null;
  origin_airport_code: string;
  origin_airport_name: string;
  destination_airport_code: string;
  destination_airport_name: string;
  departure_at: string;
  arrival_at: string;
  cabin_class: string;
  seat_capacity: number;
  seats_held: number;
  seats_ticketed: number;
  ticketing_deadline: string | null;
  supplier_name: string | null;
  supplier_id: string | null;
  notes: string | null;
}

/** D. `departure_group_flight_legs` */
export interface DepartureGroupFlightLegRow {
  id: string;
  flight_id: string;
  leg_order: number;
  airline: string;
  flight_number: string;
  origin_airport_code: string;
  destination_airport_code: string;
  departure_at: string;
  arrival_at: string;
  transit_duration_minutes: number | null;
}

/** E. `departure_group_accommodations` */
export interface DepartureGroupAccommodationRow {
  id: string;
  departure_group_id: string;
  city: AccommodationCity;
  hotel_name: string;
  supplier_name: string | null;
  /** FK into `public.suppliers`. `supplier_name` stays the printable snapshot. */
  supplier_id: string | null;
  booking_reference: string | null;
  status: SupplierStatus;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_capacity: number;
  rooms_reserved: number;
  rooms_allocated: number;
  meal_plan: string | null;
  distance_description: string | null;
  voucher_url: string | null;
  internal_cost: number | null;
  notes: string | null;
}

/** F. `departure_group_rooms` */
export interface DepartureGroupRoomRow {
  id: string;
  accommodation_id: string;
  room_number: string | null;
  room_type: RoomType;
  occupancy_capacity: number;
  assigned_pilgrim_count: number;
  status: RoomStatus;
  notes: string | null;
}

/** G. `departure_group_room_assignments` */
export interface DepartureGroupRoomAssignmentRow {
  id: string;
  room_id: string;
  /**
   * Denormalized from `room_id`'s accommodation at write time — this is what
   * the `unique (pilgrim_id, accommodation_id)` constraint is keyed on, so a
   * pilgrim can hold one room in Makkah and a separate one in Madinah at the
   * same time instead of the schema treating "a room" as one global bed.
   */
  accommodation_id: string;
  pilgrim_id: string;
  assigned_at: string;
  /** auth.users id of whoever made the assignment. */
  assigned_by: string | null;
  /** Printable name, kept beside the FK so the trail survives a deleted user. */
  assigned_by_name: string | null;
}

/** H. `departure_group_transports` */
export interface DepartureGroupTransportRow {
  id: string;
  departure_group_id: string;
  template_transport_requirement_id: string | null;
  route_label: string;
  origin: string;
  destination: string;
  status: SupplierStatus;
  supplier_name: string | null;
  /** FK into `public.suppliers`. `supplier_name` stays the printable snapshot. */
  supplier_id: string | null;
  booking_reference: string | null;
  vehicle_type: VehicleType;
  vehicle_capacity: number | null;
  passenger_count: number | null;
  pickup_at: string | null;
  pickup_location: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  internal_cost: number | null;
  confirmation_url: string | null;
  notes: string | null;
}

/** I. `departure_group_bookings` */
export interface DepartureGroupBookingRow {
  id: string;
  departure_group_id: string;
  lead_id: string | null;
  booking_reference: string;
  booking_status: BookingStatus;
  primary_contact_name: string;
  primary_contact_phone: string;
  traveller_count: number;
  room_occupancy_preference: RoomType;
  package_price_per_person: number;
  total_booking_value: number;
  /** Contract currency fixed when the booking is created. */
  currency?: string;
  /** Refund liability requested when this booking was cancelled. */
  cancellation_refund_amount?: number;
  amount_paid: number;
  outstanding_balance: number;
  next_due_at: string | null;
  seat_hold_expires_at: string | null;
  /** Stamped when the expiry sweeper — not a person — took the seats back. */
  hold_released_at: string | null;
  booked_at: string | null;
  confirmed_at: string | null;
  /** 1-based queue position, so the longest-waiting booking is promoted first. */
  waitlist_position: number | null;
  created_at: string;
  /**
   * Optimistic-concurrency guard, incremented by a database trigger on every
   * update — never set by application code, which is why this is optional
   * rather than required on every constructed row (a freshly created
   * booking has none to set; the column's own `default 1` covers it). See
   * `versionColumn` on the `bookings` collection in
   * `departure-groups-repository.ts`.
   */
  row_version?: number;
  /**
   * Who is actually paying — distinct from primary_contact_name/phone, the
   * on-the-ground contact. At most one of payer_pilgrim_id/payer_lead_id is
   * set. Optional (like row_version) so existing row constructors elsewhere
   * in the codebase (fixtures, evals, other mutators) don't all need
   * updating — the column's own `default` values cover an omitted field.
   */
  payer_pilgrim_id?: string | null;
  payer_lead_id?: string | null;
  payer_name?: string | null;
  payer_email?: string | null;
  booking_type?: "GROUP" | "CUSTOM";
}

/**
 * A directed relationship edge between two travellers on the same booking —
 * a mahram, a spouse, a minor's parent. `is_mahram` is its own column rather
 * than derived from `relationship` because a COMPANION or OTHER edge can
 * still satisfy a mahram requirement in practice.
 */
export interface BookingTravellerRelationshipRow {
  id: string;
  departure_group_id: string;
  booking_id: string;
  from_pilgrim_id: string;
  to_pilgrim_id: string;
  relationship:
    | "MAHRAM"
    | "SPOUSE"
    | "PARENT"
    | "CHILD"
    | "SIBLING"
    | "COMPANION"
    | "OTHER";
  is_mahram: boolean;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

/**
 * J. `departure_group_pilgrims`
 *
 * `pilgrim_id` points at the shared pilgrim record once that module lands; the
 * `*_snapshot` name/phone columns keep the manifest readable until then.
 */
/** Lifecycle of one AI review run — ticket or visa, same shape either way. */
export type AiReviewStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";

/**
 * One finding from an AI review — a name that doesn't match the passport on
 * file, a flight date that doesn't match the group's booked leg, a visa
 * expiring inside the six-month window. Assistive only: nothing in this
 * module changes a status from an issue alone except nudging `flight_status`
 * to the existing `NAME_MISMATCH` value for a name-mismatch finding — a human
 * still makes every other call.
 */
export interface AiReviewIssue {
  code: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
}

export interface DepartureGroupPilgrimRow {
  id: string;
  departure_group_id: string;
  booking_id: string;
  pilgrim_id: string | null;
  full_name_snapshot: string;
  phone_snapshot: string | null;
  passport_number_snapshot: string | null;
  /**
   * Required to evaluate the six-month validity rule. Without it the template's
   * "Passport Validity (Minimum 6 Months)" requirement is a checkbox someone
   * ticks from memory rather than a check the system can actually perform.
   */
  passport_expiry: string | null;
  passport_issue_country: string | null;
  date_of_birth: string | null;
  seat_status: SeatStatus;
  flight_status: PilgrimFlightStatus;
  room_assignment_status: RoomAssignmentStatus;
  room_id: string | null;
  /**
   * Derived caches of `departure_group_pilgrim_documents`, recomputed by
   * `syncPilgrimDocumentCounters()` after every document mutation. They exist
   * so the manifest and list screens can sort and filter without joining the
   * document rows; they are never the source of truth.
   */
  documents_completed: number;
  documents_required: number;
  document_completion_percent: number;
  visa_status: PilgrimVisaStatus;
  visa_submitted_at: string | null;
  visa_reviewed_at: string | null;
  visa_rejected_at: string | null;
  visa_rejection_reason: string | null;
  visa_id: string | null;
  visa_issue_note: string | null;
  /** Object path in the private `pilgrim-documents` bucket, never a public URL. */
  visa_file_path: string | null;
  visa_expiry_date: string | null;
  visa_ai_status: AiReviewStatus | null;
  visa_ai_extracted: Record<string, string> | null;
  visa_ai_issues: AiReviewIssue[] | null;
  visa_ai_analyzed_at: string | null;
  visa_ai_error: string | null;
  /** Object path in the private `pilgrim-documents` bucket, never a public URL. */
  ticket_file_path: string | null;
  ticket_file_name: string | null;
  ticket_uploaded_at: string | null;
  ticket_uploaded_by: string | null;
  ticket_ai_status: AiReviewStatus | null;
  ticket_ai_extracted: Record<string, string> | null;
  ticket_ai_issues: AiReviewIssue[] | null;
  ticket_ai_analyzed_at: string | null;
  ticket_ai_error: string | null;
  payment_status: PilgrimPaymentStatus;
  /** Derived from the emergency contact columns below, never set by hand. */
  emergency_contact_status: EmergencyContactStatus;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  /** Set when this traveller's sensitive details were erased (retention or request); see `departure-groups-erasure.ts`. */
  sensitive_data_erased_at?: string | null;
  /**
   * The traveller's actual occupancy — may differ from
   * `departure_group_bookings.room_occupancy_preference` once a per-person
   * `ROOM_TYPE` deviation is approved. Null falls back to the booking default.
   */
  room_occupancy_type: RoomType | null;
  /** True whenever a non-BASE_FARE charge or any deviation exists for this traveller. */
  has_customisations: boolean;
  /** True when an approved OWN_FLIGHT or LAND_ONLY deviation removes this traveller from the group flight. */
  excluded_from_group_flight: boolean;
}

/**
 * `departure_group_pilgrim_charges` — one priced line per chargeable thing on
 * one traveller. A booking's total is the sum of its pilgrims' live
 * (non-voided) lines; see `sumChargeLines()` in `lib/data/departure-groups-money.ts`.
 */
export interface DepartureGroupPilgrimChargeRow {
  id: string;
  departure_group_id: string;
  booking_id: string;
  group_pilgrim_id: string;
  charge_type: ChargeType;
  addon_id: string | null;
  label: string;
  /** Signed: discounts are negative, everything else non-negative. */
  amount: number;
  quantity: number;
  currency: string;
  source: ChargeSource;
  /** The occupancy tier a BASE_FARE was priced at. Null for every other type. */
  priced_room_type: RoomType | null;
  reason: string | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

/**
 * `departure_group_pilgrim_deviations` — the operational fact behind a
 * customisation. Never edits the group snapshot or a group-level operational
 * row; `charge_id` links to the money side when the deviation has one.
 */
export interface DepartureGroupPilgrimDeviationRow {
  id: string;
  departure_group_id: string;
  group_pilgrim_id: string;
  deviation_type: DeviationType;
  detail: DeviationDetail | Record<string, never>;
  summary: string;
  status: DeviationStatus;
  responsible_role: ResponsibleRole;
  blocks_departure: boolean;
  charge_id: string | null;
  supplier_commitment_id: string | null;
  linked_flight_id: string | null;
  linked_accommodation_id: string | null;
  linked_transport_id: string | null;
  linked_itinerary_item_ids: string[];
  requested_at: string;
  requested_by_name: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  arranged_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `departure_group_pilgrim_documents` — one row per pilgrim per traveller
 * requirement copied from the group's frozen snapshot.
 *
 * This is what makes "4 / 8 documents" answerable. Before it existed the two
 * counters on the pilgrim row were the whole record, so nothing could say which
 * four were done, who verified them, or why one was sent back.
 */
export interface DepartureGroupPilgrimDocumentRow {
  id: string;
  departure_group_id: string;
  pilgrim_id: string;
  /** Points into the snapshot's `traveller_requirements_snapshot` array. */
  requirement_id: string;
  name: string;
  category: string;
  required: boolean;
  required_by_stage: DocumentStage;
  /** The role whose sign-off counts for this document. */
  verified_by_role: ResponsibleRole;
  status: DocumentStatus;
  /** Object path in the private `pilgrim-documents` bucket, never a public URL. */
  file_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  notes: string | null;
  created_at: string;
  /** Set on insert by `buildPilgrimDocuments`; owned by the Documents module thereafter. */
  document_type?: DocumentType;
}

/** L. `departure_group_readiness_items` */
export interface DepartureGroupReadinessItemRow {
  id: string;
  departure_group_id: string;
  source_template_requirement_id: string | null;
  label: string;
  category: ReadinessCategory;
  responsible_role: ResponsibleRole;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  due_type: ReadinessDueType;
  due_days_before_departure: number | null;
  due_at: string | null;
  required: boolean;
  status: ReadinessItemStatus;
  /**
   * When set, `status` is recomputed from live operational rows on every read
   * and the item cannot be ticked by hand — only its owner, due date and notes
   * are editable. See `deriveReadinessStatuses()`.
   */
  auto_source: ReadinessAutoSource | null;
  evidence_url: string | null;
  notes: string | null;
  completed_at: string | null;
  /** auth.users id of whoever signed the item off. */
  completed_by: string | null;
  /** Printable name, kept beside the FK so the trail survives a deleted user. */
  completed_by_name: string | null;
}

/** M. `departure_group_tasks` */
export interface DepartureGroupTaskRow {
  id: string;
  departure_group_id: string;
  title: string;
  description: string | null;
  owner_id: string | null;
  owner_name: string;
  due_at: string;
  status: TaskStatus;
  category: TaskCategory;
  linked_readiness_item_id: string | null;
}

/** N. `departure_group_activity_logs` */
export interface DepartureGroupActivityLogRow {
  id: string;
  departure_group_id: string;
  actor_id: string | null;
  actor_name_snapshot: string;
  action_type: string;
  entity_type: ActivityEntityType;
  entity_id: string | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  message: string;
  is_system: boolean;
  is_high_impact: boolean;
  created_at: string;
}

/**
 * K. `departure_group_payment_summaries` — a database view, not a table.
 * Aggregated from bookings plus the supplier-cost columns on accommodations
 * and transports.
 */
export interface DepartureGroupPaymentSummaryRow {
  departure_group_id: string;
  expected_revenue: number;
  collected_amount: number;
  outstanding_amount: number;
  overdue_amount: number;
  refund_pending_amount: number;
  supplier_payables_due: number;
}

/**
 * L. In-memory unit of work for one mutation — the slice of Departure Groups
 * tables `lib/data/departure-groups.ts`'s `mutate()` loads, hands to a pure
 * mutator, and writes back the diff of. See `MUTABLE_COLLECTIONS` there for
 * which of these collections a given mutation actually touches.
 */
export interface DepartureGroupStore {
  groups: DepartureGroupRow[];
  snapshots: DepartureGroupPackageSnapshotRow[];
  pricing: DepartureGroupPricingRow[];
  costEstimates: DepartureGroupCostEstimateRow[];
  flights: DepartureGroupFlightRow[];
  flightLegs: DepartureGroupFlightLegRow[];
  accommodations: DepartureGroupAccommodationRow[];
  rooms: DepartureGroupRoomRow[];
  roomAssignments: DepartureGroupRoomAssignmentRow[];
  transports: DepartureGroupTransportRow[];
  bookings: DepartureGroupBookingRow[];
  pilgrims: DepartureGroupPilgrimRow[];
  pilgrimDocuments: DepartureGroupPilgrimDocumentRow[];
  pilgrimCharges: DepartureGroupPilgrimChargeRow[];
  pilgrimDeviations: DepartureGroupPilgrimDeviationRow[];
  readinessItems: DepartureGroupReadinessItemRow[];
  tasks: DepartureGroupTaskRow[];
  activity: DepartureGroupActivityLogRow[];
  travellerRelationships: BookingTravellerRelationshipRow[];
}
