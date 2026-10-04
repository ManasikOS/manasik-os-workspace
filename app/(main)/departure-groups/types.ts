/**
 * View models for the Departure Groups module.
 *
 * The database rows (snake_case) live in `lib/types/departure-groups.ts`;
 * these are what the components render. `lib/data/departure-groups.ts` owns the
 * row → view-model mapping, so no component ever touches a raw row.
 */

import type {
  AiReviewIssue,
  AiReviewStatus,
  NusukStatus,
  AccommodationCity,
  ActivityEntityType,
  BookingStatus,
  ChargeSource,
  ChargeType,
  DepartureGroupStatus,
  DeviationDetail,
  DeviationStatus,
  DeviationType,
  DocumentStage,
  DocumentStatus,
  EmergencyContactStatus,
  FlightDirection,
  FlightStatus,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
  PilgrimFlightStatus,
  PilgrimPaymentStatus,
  PilgrimVisaStatus,
  ReadinessAutoSource,
  ReadinessCategory,
  ReadinessDueType,
  ReadinessItemStatus,
  ResponsibleRole,
  RoomAssignmentStatus,
  RoomStatus,
  RoomType,
  SeatStatus,
  SupplierStatus,
  TaskCategory,
  TaskStatus,
  VehicleType,
} from "@/lib/types/departure-groups";

export type {
  AiReviewIssue,
  AiReviewStatus,
  NusukStatus,
  AccommodationCity,
  ActivityEntityType,
  BookingStatus,
  ChargeSource,
  ChargeType,
  DepartureGroupStatus,
  DeviationDetail,
  DeviationStatus,
  DeviationType,
  DocumentStage,
  DocumentStatus,
  EmergencyContactStatus,
  FlightDirection,
  FlightStatus,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
  PilgrimFlightStatus,
  PilgrimPaymentStatus,
  PilgrimVisaStatus,
  ReadinessAutoSource,
  ReadinessCategory,
  ReadinessDueType,
  ReadinessItemStatus,
  ResponsibleRole,
  RoomAssignmentStatus,
  RoomStatus,
  RoomType,
  SeatStatus,
  SupplierStatus,
  TaskCategory,
  TaskStatus,
  VehicleType,
};

/* ── Core group ───────────────────────────────────────────────────────────── */

export interface DepartureGroup {
  id: string;
  agencyId: string | null;
  branchId: string | null;
  branch: string;
  packageTemplateId: string;

  groupName: string;
  groupCode: string;
  journeyType: GroupJourneyType;
  groupStatus: DepartureGroupStatus;
  salesStatus: GroupSalesStatus;

  departureDate: string;
  returnDate: string;
  durationDays: number;
  durationNights: number;

  capacity: number;
  minimumGroupSize: number;
  bookedSeats: number;
  heldSeats: number;
  availableSeats: number;
  waitlistEnabled: boolean;
  seatHoldExpiryHours: number;

  primaryGuideId: string | null;
  primaryGuideName: string | null;
  /** FK into the Supplier Directory, for a guide sourced externally rather than an internal staff member (`primaryGuideId`). */
  primaryGuideSupplierId: string | null;
  backupGuideName: string | null;
  operationsOwnerName: string | null;
  visaOwnerName: string | null;
  financeOwnerName: string | null;
  localCoordinatorName: string | null;
  localCoordinatorPhone: string | null;
  emergencyPhone: string | null;
  guideWhatsappLink: string | null;
  pilgrimBroadcastLink: string | null;

  /** Masar Nusuk / regulatory identifiers — see `NusukStatus`. */
  umrahCompanyName: string | null;
  nusukProgramRef: string | null;
  nusukGroupRef: string | null;
  visaBatchRef: string | null;
  visaInvoiceRef: string | null;
  nusukStatus: NusukStatus;

  readinessScore: number;
  readinessStatus: GroupReadinessStatus;

  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Row shape for the Departure Groups list table. */
export interface DepartureGroupListItem extends DepartureGroup {
  /** Snapshot name, never the template's current name. */
  packageTemplateName: string;
  packageTemplateCode: string;
  /** "Departs in 7 days" / "Departed 3 days ago". Negative when in the past. */
  daysUntilDeparture: number;
  /** The single most urgent unresolved issue, or "All clear". */
  primaryBlocker: string;
}

/* ── Flights ──────────────────────────────────────────────────────────────── */

export interface FlightLeg {
  id: string;
  flightId: string;
  legOrder: number;
  airline: string;
  flightNumber: string;
  originAirportCode: string;
  destinationAirportCode: string;
  departureAt: string;
  arrivalAt: string;
  transitDurationMinutes: number | null;
}

export interface DepartureGroupFlight {
  id: string;
  departureGroupId: string;
  direction: FlightDirection;
  status: FlightStatus;
  airline: string;
  flightNumber: string | null;
  pnr: string | null;
  bookingReference: string | null;
  originAirportCode: string;
  originAirportName: string;
  destinationAirportCode: string;
  destinationAirportName: string;
  departureAt: string;
  arrivalAt: string;
  cabinClass: string;
  seatCapacity: number;
  seatsHeld: number;
  seatsTicketed: number;
  ticketingDeadline: string | null;
  supplierName: string | null;
  supplierId: string | null;
  notes: string | null;
  legs: FlightLeg[];
}

/* ── Accommodation & rooming ──────────────────────────────────────────────── */

export interface DepartureGroupRoom {
  id: string;
  accommodationId: string;
  hotelName: string;
  city: AccommodationCity;
  roomNumber: string | null;
  roomType: RoomType;
  occupancyCapacity: number;
  assignedPilgrimCount: number;
  status: RoomStatus;
  notes: string | null;
}

export interface DepartureGroupAccommodation {
  id: string;
  departureGroupId: string;
  city: AccommodationCity;
  hotelName: string;
  supplierName: string | null;
  /** FK into the Supplier Directory. `supplierName` stays the printable snapshot. */
  supplierId: string | null;
  bookingReference: string | null;
  status: SupplierStatus;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  roomCapacity: number;
  roomsReserved: number;
  roomsAllocated: number;
  mealPlan: string | null;
  distanceDescription: string | null;
  voucherUrl: string | null;
  /** Null for roles without supplier-cost visibility — never merely hidden in CSS. */
  internalCost: number | null;
  notes: string | null;
  rooms: DepartureGroupRoom[];
}

/* ── Transport ────────────────────────────────────────────────────────────── */

export interface DepartureGroupTransport {
  id: string;
  departureGroupId: string;
  templateTransportRequirementId: string | null;
  routeLabel: string;
  origin: string;
  destination: string;
  status: SupplierStatus;
  supplierName: string | null;
  /** FK into the Supplier Directory. `supplierName` stays the printable snapshot. */
  supplierId: string | null;
  bookingReference: string | null;
  vehicleType: VehicleType;
  vehicleCapacity: number | null;
  passengerCount: number | null;
  pickupAt: string | null;
  pickupLocation: string | null;
  driverName: string | null;
  driverPhone: string | null;
  coordinatorName: string | null;
  coordinatorPhone: string | null;
  internalCost: number | null;
  confirmationUrl: string | null;
  notes: string | null;
}

/* ── Bookings & pilgrims ──────────────────────────────────────────────────── */

/**
 * A group a booking can be moved into: enough to judge fit — seats, dates,
 * package and the tier rates the move would reprice against — and nothing more.
 */
export interface MoveTargetGroupOption {
  id: string;
  groupName: string;
  groupCode: string;
  packageName: string;
  departureDate: string;
  returnDate: string;
  branch: string;
  salesStatus: GroupSalesStatus;
  groupStatus: DepartureGroupStatus;
  capacity: number;
  availableSeats: number;
  waitlistEnabled: boolean;
  currency: string;
  /** Snapshot rate per occupancy tier in the target group; null when unpriced. */
  priceByRoomType: Record<RoomType, number | null>;
}

export interface DepartureGroupBooking {
  id: string;
  departureGroupId: string;
  leadId: string | null;
  bookingReference: string;
  bookingStatus: BookingStatus;
  primaryContactName: string;
  primaryContactPhone: string;
  travellerCount: number;
  roomOccupancyPreference: RoomType;
  packagePricePerPerson: number;
  totalBookingValue: number;
  amountPaid: number;
  outstandingBalance: number;
  nextDueAt: string | null;
  seatHoldExpiresAt: string | null;
  bookedAt: string | null;
  createdAt: string;
  /** Who is actually paying — distinct from primaryContactName/Phone, the on-the-ground contact. */
  payerPilgrimId: string | null;
  payerLeadId: string | null;
  payerName: string | null;
  payerEmail: string | null;
  bookingType: "GROUP" | "CUSTOM";
}

/** A relationship edge (mahram, spouse, ...) between two travellers on the same booking. */
export interface TravellerRelationship {
  id: string;
  bookingId: string;
  fromPilgrimId: string;
  fromName: string;
  toPilgrimId: string;
  toName: string;
  relationship:
    | "MAHRAM"
    | "SPOUSE"
    | "PARENT"
    | "CHILD"
    | "SIBLING"
    | "COMPANION"
    | "OTHER";
  isMahram: boolean;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface DepartureGroupPilgrim {
  id: string;
  departureGroupId: string;
  bookingId: string;
  pilgrimId: string | null;
  fullName: string;
  phone: string | null;
  passportNumber: string | null;
  seatStatus: SeatStatus;
  flightStatus: PilgrimFlightStatus;
  roomAssignmentStatus: RoomAssignmentStatus;
  /** The most recently assigned room — kept for callers that only care about
   * "has a room at all". A pilgrim can hold one room per accommodation
   * (Makkah and Madinah simultaneously), so `roomAssignments` below is the
   * authoritative, per-city list; this scalar is a convenience rollup. */
  roomId: string | null;
  roomLabel: string | null;
  /** One entry per accommodation this pilgrim currently holds a room in. */
  roomAssignments: {
    accommodationId: string;
    city: AccommodationCity;
    roomId: string;
    roomLabel: string;
  }[];
  /** Null for roles without `viewSensitiveTravellerData`. */
  passportExpiry: string | null;
  /**
   * Why this traveller fails the six-month passport rule, or null when they
   * pass. Computed server-side against the group's return date so every screen
   * showing it agrees.
   */
  passportValidityIssue: string | null;
  documentsCompleted: number;
  documentsRequired: number;
  documentCompletionPercent: number;
  /**
   * The traveller's actual checklist. Empty for roles that may not see
   * traveller PII — the counters above still render for them.
   */
  documents: PilgrimDocument[];
  visaStatus: PilgrimVisaStatus;
  visaSubmittedAt: string | null;
  visaId: string | null;
  visaIssueNote: string | null;
  visaRejectionReason: string | null;
  visaExpiryDate: string | null;
  /** Object path in the private bucket; null in the manifest for a role without `viewSensitiveTravellerData`. */
  visaFilePath: string | null;
  visaAiStatus: AiReviewStatus | null;
  visaAiExtracted: Record<string, string> | null;
  visaAiIssues: AiReviewIssue[] | null;
  visaAiAnalyzedAt: string | null;
  visaAiError: string | null;
  /** Object path in the private bucket; null for a role without `viewSensitiveTravellerData`. */
  ticketFilePath: string | null;
  ticketFileName: string | null;
  ticketUploadedAt: string | null;
  ticketAiStatus: AiReviewStatus | null;
  ticketAiExtracted: Record<string, string> | null;
  ticketAiIssues: AiReviewIssue[] | null;
  ticketAiAnalyzedAt: string | null;
  ticketAiError: string | null;
  paymentStatus: PilgrimPaymentStatus;
  emergencyContactStatus: EmergencyContactStatus;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /**
   * What this traveller is actually roomed/billed against. Falls back to the
   * booking's `roomOccupancyPreference` when no per-person override exists.
   */
  roomOccupancyType: RoomType | null;
  /** Sum of this traveller's live charge lines. Null for roles without `viewPilgrimPricing`. */
  totalPrice: number | null;
  /** This traveller's priced lines. Empty for roles without `viewPilgrimPricing`. */
  charges: PilgrimCharge[];
  /** This traveller's operational deviations. Always visible — amounts live only in `charges`. */
  deviations: PilgrimDeviation[];
  /** True whenever a non-base-fare charge or any deviation exists for this traveller. */
  hasCustomisations: boolean;
}

/** One priced line on one traveller — see `departure_group_pilgrim_charges`. */
export interface PilgrimCharge {
  id: string;
  groupPilgrimId: string;
  chargeType: ChargeType;
  addonId: string | null;
  label: string;
  amount: number;
  quantity: number;
  currency: string;
  source: ChargeSource;
  pricedRoomType: RoomType | null;
  reason: string | null;
  requiresApproval: boolean;
  approvedByName: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdByName: string;
  createdAt: string;
}

/** One operational deviation on one traveller — see `departure_group_pilgrim_deviations`. */
export interface PilgrimDeviation {
  id: string;
  groupPilgrimId: string;
  deviationType: DeviationType;
  detail: DeviationDetail | Record<string, never>;
  summary: string;
  status: DeviationStatus;
  responsibleRole: ResponsibleRole;
  blocksDeparture: boolean;
  chargeId: string | null;
  linkedFlightId: string | null;
  linkedAccommodationId: string | null;
  linkedTransportId: string | null;
  linkedItineraryItemIds: string[];
  requestedAt: string;
  requestedByName: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  arrangedAt: string | null;
  notes: string | null;
}

/** One requirement on one traveller's checklist. */
export interface PilgrimDocument {
  id: string;
  pilgrimId: string;
  requirementId: string;
  name: string;
  category: string;
  required: boolean;
  requiredByStage: DocumentStage;
  verifiedByRole: ResponsibleRole;
  status: DocumentStatus;
  /** Object path in the private bucket; exchanged for a signed URL on demand. */
  filePath: string | null;
  fileName: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  notes: string | null;
}

/** A pilgrim joined to its booking — what the Pilgrims & Bookings table renders. */
export interface DepartureGroupManifestRow extends DepartureGroupPilgrim {
  bookingReference: string;
  bookingLabel: string;
  bookingStatus: BookingStatus;
  roomTypePreference: RoomType;
  outstandingBalance: number;
  nextDueAt: string | null;
}

/* ── Money ────────────────────────────────────────────────────────────────── */

export interface DepartureGroupPaymentSummary {
  expectedRevenue: number;
  collectedAmount: number;
  outstandingAmount: number;
  overdueAmount: number;
  refundPendingAmount: number;
  supplierPayablesDue: number;
  currency: string;
  /**
   * Which bookings make up `overdueAmount`. Returned rather than recomputed in
   * the client so the count on screen can never disagree with the money figure
   * beside it — "overdue" is decided once, server-side, against one clock.
   */
  overdueBookingIds: string[];
}

/* ── Readiness ────────────────────────────────────────────────────────────── */

export interface DepartureGroupReadinessItem {
  id: string;
  departureGroupId: string;
  sourceTemplateRequirementId: string | null;
  label: string;
  category: ReadinessCategory;
  responsibleRole: ResponsibleRole;
  assignedToUserId: string | null;
  assignedToName: string | null;
  dueType: ReadinessDueType;
  dueDaysBeforeDeparture: number | null;
  dueAt: string | null;
  /** "21 days before departure" — resolved from dueType + dueDays. */
  dueLabel: string;
  required: boolean;
  status: ReadinessItemStatus;
  /**
   * Set when the item's status is computed from live operational rows rather
   * than ticked by hand. The tab renders it as a locked row pointing at the tab
   * that actually moves it.
   */
  autoSource: ReadinessAutoSource | null;
  /** Where to go to move a derived item, e.g. "the Makkah hotel on the Hotels tab". */
  autoSourceHint: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export interface ReadinessCategoryProgress {
  category: ReadinessCategory;
  label: string;
  percent: number;
  total: number;
  complete: number;
  status: GroupReadinessStatus;
  /** Detail tab this bar drills into. */
  tab: DepartureGroupTabId;
}

export interface DepartureGroupReadinessSummary {
  score: number;
  status: GroupReadinessStatus;
  blockerCount: number;
  dueTodayCount: number;
  dueInSevenDaysCount: number;
  categories: ReadinessCategoryProgress[];
}

/* ── Tasks & activity ─────────────────────────────────────────────────────── */

export interface DepartureGroupTask {
  id: string;
  departureGroupId: string;
  title: string;
  description: string | null;
  ownerName: string;
  dueAt: string;
  dueLabel: string;
  status: TaskStatus;
  category: TaskCategory;
  linkedReadinessItemId: string | null;
}

export interface GroupActivityLog {
  id: string;
  departureGroupId: string;
  actorName: string;
  actionType: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  message: string;
  isSystem: boolean;
  isHighImpact: boolean;
  createdAt: string;
}

/* ── Overview composition ─────────────────────────────────────────────────── */

export type BlockerSeverity = "CRITICAL" | "WARNING";

export interface DepartureGroupBlocker {
  id: string;
  severity: BlockerSeverity;
  message: string;
  actionLabel: string;
  /** Every blocker resolves to a concrete filtered destination. */
  tab: DepartureGroupTabId;
  filter?: string;
}

export interface SupplierStatusLine {
  label: string;
  status: SupplierStatus | FlightStatus;
  tab: DepartureGroupTabId;
}

/** Everything the Overview tab needs, assembled server-side. */
export interface DepartureGroupOverview {
  group: DepartureGroupListItem;
  readiness: DepartureGroupReadinessSummary;
  payments: DepartureGroupPaymentSummary | null;
  blockers: DepartureGroupBlocker[];
  suppliers: SupplierStatusLine[];
  recentActivity: GroupActivityLog[];
}

/** The full control-center payload for `/departure-groups/[groupId]`. */
export interface ServiceAddon {
  id: string;
  code: string;
  name: string;
  category: string;
  defaultAmount: number | null;
  unit: string;
  createsDeviation: boolean;
}

export interface DepartureGroupDetail {
  group: DepartureGroupListItem;
  snapshot: DepartureGroupPackageSnapshot;
  pricing: DepartureGroupPricing;
  costing: DepartureGroupCosting | null;
  overview: DepartureGroupOverview;
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  bookings: DepartureGroupBooking[];
  manifest: DepartureGroupManifestRow[];
  payments: DepartureGroupPaymentSummary | null;
  readinessItems: DepartureGroupReadinessItem[];
  tasks: DepartureGroupTask[];
  activity: GroupActivityLog[];
  serviceAddons: ServiceAddon[];
  travellerRelationships: TravellerRelationship[];
}

export interface DepartureGroupPackageSnapshot {
  packageTemplateId: string;
  packageName: string;
  packageCode: string;
  overview: string;
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  advanceDeposit: number | null;
  inclusions: string[];
  exclusions: string[];
  itinerary: {
    id: string;
    dayNumber: number;
    title: string;
    location: string;
    description: string;
  }[];
  copiedAt: string;
  /**
   * The package_versions row this group was actually built from — null for
   * a group created before this column existed, or from a template with no
   * publish history at creation time. Compared against
   * `livePackagePublishedVersionId` to answer "has the template been
   * republished since this group was created" honestly, instead of the
   * old "compare the snapshot with itself" bug (finding C8) —
   * `packageName` above and `livePackageTitle` used to always be equal
   * because both were read from this same frozen snapshot; there was
   * nothing live to actually compare against.
   */
  packageVersionId: string | null;
  /** The live package's current title, fetched fresh — null if the package no longer exists (deleted) or could not be read. */
  livePackageTitle: string | null;
  /** The live package's current `published_version_id` — null if it has never been published (or no longer exists). */
  livePackagePublishedVersionId: string | null;
}

/**
 * The group's CURRENT, editable price — from `departure_group_pricing`, never
 * from the frozen `DepartureGroupPackageSnapshot` above. Every screen that
 * prices a booking, a room-preference change, an invoice line, or shows "the
 * price" in a KPI should read this, not `snapshot.quadPrice`. `snapshot`
 * stays reserved for the template-comparison dialog's "what did we promise at
 * sale time" view.
 */
export interface DepartureGroupPricing {
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  childPrice: number | null;
  infantPrice: number | null;
  earlyBirdPrice: number | null;
  advanceDeposit: number | null;
  /** `OVERRIDDEN` once an operator has repriced this departure by hand. */
  priceSource: "TEMPLATE" | "OVERRIDDEN";
}

/**
 * Per-departure margin — Finance-only. `null` for any role without
 * `viewFinance`, not just hidden: the query is never run for them.
 */
export interface DepartureGroupCosting {
  listPrice: number;
  confirmedPax: number;
  estimatedVariableCostPerPax: number;
  fixedCostPerDeparture: number;
  actualSupplierCost: number;
  /** Seats needed to cover the fixed cost at today's price. `null` when the margin per seat is not positive. */
  breakEvenHeadcount: number | null;
  estimatedGrossMargin: number;
}

/* ── Tabs & saved views ───────────────────────────────────────────────────── */

export type DepartureGroupTabId =
  | "overview"
  | "pilgrims"
  | "flights"
  | "hotels"
  | "transport"
  | "payments"
  | "documents"
  | "readiness"
  | "guide"
  | "agent"
  | "activity";

export const DEPARTURE_GROUP_TABS: {
  id: DepartureGroupTabId;
  label: string;
}[] = [
  { id: "overview", label: "Overview" },
  { id: "pilgrims", label: "Pilgrims & Bookings" },
  { id: "flights", label: "Flights" },
  { id: "hotels", label: "Hotels & Rooms" },
  { id: "transport", label: "Transport" },
  { id: "payments", label: "Payments" },
  { id: "documents", label: "Documents & Visa" },
  { id: "readiness", label: "Readiness" },
  { id: "guide", label: "Guide & Operations" },
  { id: "agent", label: "Agent" },
  { id: "activity", label: "Activity" },
];

export const DEPARTURE_GROUP_SAVED_VIEWS = [
  "All Groups",
  "Open for Sale",
  "Preparing",
  "At Risk",
  "Departing in 14 Days",
  "Ready to Depart",
  "Completed",
  "My Assigned Groups",
] as const;

export type DepartureGroupSavedView =
  (typeof DEPARTURE_GROUP_SAVED_VIEWS)[number];

export interface DepartureGroupListKpis {
  upcomingDepartures: number;
  atRiskGroups: number;
  seatsAvailable: number;
  groupsPreparing: number;
  departingInFourteenDays: number;
}

/* ── Creation input ───────────────────────────────────────────────────────── */

/**
 * Which parts of the template get copied into editable group-level records.
 *
 * Pricing is deliberately not one of these — a group's own
 * `departure_group_pricing` row is always seeded from the template (see
 * `buildGroupPricing()`); a group with no price of its own is not a valid
 * state, so it is never behind an optional toggle.
 */
export interface TemplateCopyOptions {
  itinerary: boolean;
  inclusionsAndExclusions: boolean;
  travellerRequirements: boolean;
  readinessChecklist: boolean;
  accommodation: boolean;
  transport: boolean;
  /** Seeds two DRAFT flights (OUTBOUND, RETURN) from the template's routing intent. */
  flights: boolean;
}

/**
 * This departure's own price — a template carries no price of its own (see
 * `docs/architecture/package-departure-architecture-master-plan.md`), so this is always
 * required when creating a group, never defaulted from the template.
 */
export interface CreateGroupPricingInput {
  currency: string;
  quadPrice: number | null;
  triplePrice: number | null;
  doublePrice: number | null;
  singlePrice: number | null;
  childPrice: number | null;
  infantPrice: number | null;
  earlyBirdPrice: number | null;
  advanceDeposit: number | null;
}

/** This departure's own internal cost estimate — same reasoning as pricing. */
export interface CreateGroupCostEstimateInput {
  flightCostPerPilgrim: number | null;
  accommodationCostPerPilgrim: number | null;
  transportCostPerPilgrim: number | null;
  visaInsuranceCostPerPilgrim: number | null;
  cateringCostPerPilgrim: number | null;
  guideOperationsCostPerPilgrim: number | null;
  contingencyCostPerPilgrim: number | null;
  fixedCostPerDeparture: number;
}

/** This departure's own flight routing intent — same reasoning as pricing. */
export interface CreateGroupFlightRoutingInput {
  flightsIncluded: boolean;
  departureOrigin: string;
  arrivalGateway: string;
  returnGateway: string;
  preferredAirline: string;
  cabinClass: string;
}

export interface CreateDepartureGroupInput {
  packageTemplateId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  returnDate: string;
  capacity: number;
  minimumGroupSize: number;
  salesStatus: GroupSalesStatus;
  branch: string;
  operationsOwnerName?: string;
  primaryGuideName?: string;
  waitlistEnabled: boolean;
  seatHoldExpiryHours: number;
  copyOptions: TemplateCopyOptions;
  pricing: CreateGroupPricingInput;
  costEstimate: CreateGroupCostEstimateInput;
  flightRouting: CreateGroupFlightRoutingInput;
}

export interface UpdateDepartureGroupInput {
  groupId: string;
  groupName?: string;
  groupCode?: string;
  departureDate?: string;
  returnDate?: string;
  capacity?: number;
  minimumGroupSize?: number;
  salesStatus?: GroupSalesStatus;
  groupStatus?: DepartureGroupStatus;
  branch?: string;
  operationsOwnerName?: string | null;
  primaryGuideName?: string | null;
  visaOwnerName?: string | null;
  financeOwnerName?: string | null;
  localCoordinatorName?: string | null;
  localCoordinatorPhone?: string | null;
  waitlistEnabled?: boolean;
  seatHoldExpiryHours?: number;
}

/** One traveller on a booking. Index 0 is the primary contact / lead traveller. */
export interface BookingTravellerInput {
  fullName: string;
  phone?: string;
  passportNumber?: string;
  /**
   * Captured at booking where it is known, because the six-month validity rule
   * is checked against it — a passport number alone cannot answer that, which
   * is why the requirement used to be an un-checkable tick box.
   */
  passportExpiry?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  /**
   * Resolved by `resolveOrCreatePilgrimPerson()` before the pure mutator runs
   * — the traveller's link to the shared `pilgrims` person record. Never set
   * by a form directly.
   */
  pilgrimPersonId?: string;
  /**
   * Per-traveller occupancy override. Omitted falls back to the booking's
   * `roomOccupancyPreference` — what makes a mixed-occupancy family (one
   * single, three sharing a triple) representable on one booking.
   */
  roomOccupancyType?: RoomType;
  /**
   * Per-traveller base fare override. Omitted falls back to the booking's
   * `packagePricePerPerson`, so a uniform-price booking needs no per-traveller
   * input at all.
   */
  pricePerPerson?: number;
}

/** Payload for creating a booking (and its pilgrim records) against a group. */
export interface CreateGroupBookingInput {
  departureGroupId: string;
  leadId?: string | null;
  bookingReference: string;
  bookingStatus: BookingStatus;
  primaryContactName: string;
  primaryContactPhone: string;
  travellerCount: number;
  roomOccupancyPreference: RoomType;
  packagePricePerPerson: number;
  amountPaid: number;
  seatHoldExpiresAt?: string | null;
  /**
   * Per-traveller details, one entry per seat. Index 0 falls back to the
   * primary contact; later entries fall back to "Traveller N" if omitted.
   */
  travellers?: BookingTravellerInput[];
}

/** A selectable Package Template in the create flow's step 1. */
export interface PackageTemplateOption {
  id: string;
  name: string;
  code: string;
  journeyType: GroupJourneyType;
  category: string;
  status: string;
  defaultCapacity: number;
  minGroupSize: number;
  durationDays: number;
  durationNights: number;
  durationLabel: string;
  waitlistEnabled: boolean;
  seatHoldExpiryHours: number;
  isOpenForSale: boolean;
  /**
   * 0-100, the same "how many of the six wizard steps are complete" measure
   * the packages list shows (`listCompletenessPercent`/`computeListStepGaps`
   * in lib/validations/packages.ts). Mainly useful when an admin has
   * switched on "Include drafts" — an Open for Sale package is always 100
   * by construction (publishing already requires it), so this is the
   * signal for "is this draft actually usable yet".
   */
  completeness: number;
}
