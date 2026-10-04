/**
 * Flat, JSON-serialisable view models for the Operations Control Center.
 *
 * These are built once, server-side, in `lib/data/operations-repository.ts`
 * (which reuses `buildBlockers` / `buildSupplierLines` / `scoreReadiness` from
 * `lib/data/departure-groups.ts`) and handed to the Client Components as plain
 * objects — no raw database row and no Supabase client ever crosses that
 * boundary. `lib/data/operations.ts` re-derives KPIs, alerts and tones from
 * these arrays client-side, exactly as `lib/data/visa.ts` does from
 * `VisaListItem[]`.
 */

import type {
  AccommodationCity,
  BlockerSeverity,
  DepartureGroupTabId,
  FlightDirection,
  FlightStatus,
  GroupJourneyType,
  GroupReadinessStatus,
  GroupSalesStatus,
  ReadinessCategory,
  ReadinessItemStatus,
  SupplierStatus,
  TaskCategory,
  TaskStatus,
  VehicleType,
} from "@/app/(main)/departure-groups/types";

export type { BlockerSeverity };

/* ── Groups ───────────────────────────────────────────────────────────────── */

export interface OperationsReadinessCategoryCell {
  category: ReadinessCategory;
  percent: number;
  status: ReadinessItemStatus | "READY" | "AT_RISK" | "BLOCKED" | "NOT_STARTED";
}

export interface OperationsBlocker {
  id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  severity: BlockerSeverity;
  /** Severity re-weighted by proximity to departure — what the alert feed sorts on. */
  urgency: "CRITICAL" | "WARNING";
  message: string;
  actionLabel: string;
  tab: DepartureGroupTabId;
  filter?: string;
}

export interface OperationsServiceLine {
  label: string;
  status: SupplierStatus | FlightStatus;
  tab: DepartureGroupTabId;
}

export interface OperationsGroupSummary {
  id: string;
  groupName: string;
  groupCode: string;
  journeyType: GroupJourneyType;
  groupStatus: string;
  salesStatus: GroupSalesStatus;
  branch: string;
  departureDate: string;
  returnDate: string;
  daysUntilDeparture: number;
  capacity: number;
  bookedSeats: number;
  pilgrimCount: number;
  primaryGuideName: string | null;
  backupGuideName: string | null;
  operationsOwnerName: string | null;
  visaOwnerName: string | null;
  financeOwnerName: string | null;
  emergencyPhone: string | null;
  guideWhatsappLink: string | null;
  pilgrimBroadcastLink: string | null;
  localCoordinatorName: string | null;
  localCoordinatorPhone: string | null;
  readinessScore: number;
  readinessStatus: GroupReadinessStatus;
  readinessCategories: OperationsReadinessCategoryCell[];
  blockers: OperationsBlocker[];
  serviceLines: OperationsServiceLine[];
  visaPendingCount: number;
  documentsMissingCount: number;
  paymentsOverdueCount: number;
  roomingAssignedCount: number;
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export interface OperationsTaskItem {
  id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  title: string;
  description: string | null;
  ownerName: string | null;
  dueAt: string;
  status: TaskStatus;
  category: TaskCategory;
  linkedReadinessItemId: string | null;
  linkedReadinessLabel: string | null;
}

/* ── Supplier confirmations ──────────────────────────────────────────────── */

export type OperationsServiceKind = "FLIGHT" | "ACCOMMODATION" | "TRANSPORT";

export interface OperationsSupplierRow {
  id: string;
  serviceKind: OperationsServiceKind;
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  serviceLabel: string;
  category: string;
  supplierName: string | null;
  supplierId: string | null;
  reference: string | null;
  dueAt: string | null;
  status: string;
  ownerName: string | null;
  evidencePresent: boolean;
}

/* ── Flights ──────────────────────────────────────────────────────────────── */

export type FlightRiskState = "OK" | "AT_RISK" | "OVERDUE" | "NAME_MISMATCH" | "SEATS_SHORT";

export interface OperationsFlightItem {
  id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  direction: FlightDirection;
  status: FlightStatus;
  airline: string;
  flightNumber: string | null;
  pnr: string | null;
  bookingReference: string | null;
  originAirportCode: string;
  destinationAirportCode: string;
  departureAt: string;
  seatCapacity: number;
  seatsHeld: number;
  seatsTicketed: number;
  ticketingDeadline: string | null;
  supplierName: string | null;
  supplierId: string | null;
  nameMismatchCount: number;
  riskState: FlightRiskState;
  issueLabel: string | null;
}

/* ── Accommodation & rooming ─────────────────────────────────────────────── */

export interface OperationsAccommodationItem {
  id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  city: AccommodationCity;
  hotelName: string;
  supplierName: string | null;
  supplierId: string | null;
  bookingReference: string | null;
  status: SupplierStatus;
  checkInDate: string;
  checkOutDate: string;
  roomCapacity: number;
  roomsReserved: number;
  roomsAllocated: number;
  voucherUrl: string | null;
  pilgrimCount: number;
  pilgrimsAssigned: number;
  roomingTone: "success" | "warning" | "danger";
  roomingLabel: string;
}

/* ── Transport ────────────────────────────────────────────────────────────── */

export interface OperationsTransportItem {
  id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  routeLabel: string;
  origin: string;
  destination: string;
  status: SupplierStatus;
  supplierName: string | null;
  supplierId: string | null;
  bookingReference: string | null;
  vehicleType: VehicleType;
  vehicleCapacity: number | null;
  passengerCount: number | null;
  pickupAt: string | null;
  pickupLocation: string | null;
  driverName: string | null;
  driverPhone: string | null;
  confirmationUrl: string | null;
  warnings: string[];
}

/* ── Guides & briefings ───────────────────────────────────────────────────── */

export interface OperationsGuideBoardRow {
  groupId: string;
  groupName: string;
  groupCode: string;
  daysUntilDeparture: number;
  primaryGuideName: string | null;
  backupGuideName: string | null;
  pilgrimCount: number;
  hasWhatsappGroup: boolean;
  hasEmergencyContact: boolean;
  readinessStatus: GroupReadinessStatus;
}

/* ── Activity ─────────────────────────────────────────────────────────────── */

export interface OperationsActivityItem {
  id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  actorName: string;
  actionType: string;
  entityType: string;
  message: string;
  isHighImpact: boolean;
  isSystem: boolean;
  createdAt: string;
}

/* ── KPIs ─────────────────────────────────────────────────────────────────── */

export interface OperationsKpis {
  upcomingDepartures: number;
  groupsAtRisk: number;
  supplierConfirmationsPending: number;
  tasksDueToday: number;
  unassignedWork: number;
  readinessAverage: number;
}

/* ── The whole payload ────────────────────────────────────────────────────── */

export interface OperationsSnapshot {
  nowIso: string;
  groups: OperationsGroupSummary[];
  tasks: OperationsTaskItem[];
  supplierRows: OperationsSupplierRow[];
  flights: OperationsFlightItem[];
  accommodations: OperationsAccommodationItem[];
  transports: OperationsTransportItem[];
  guideBoard: OperationsGuideBoardRow[];
  activity: OperationsActivityItem[];
}
