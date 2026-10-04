/**
 * Server-only read/write access for the Operations Control Center.
 *
 * The unit of work is `loadStore()` from `departure-groups-repository.ts`,
 * scoped to every group that has not departed — the same "load once, derive
 * everything" pattern `listDepartureGroups()` already uses, widened with
 * `tasks`, `rooms`, `roomAssignments` and `activity`. Cross-group blockers and
 * readiness reuse `buildBlockers` / `buildSupplierLines` / `scoreReadiness`
 * from `lib/data/departure-groups.ts` rather than re-implementing them, so
 * this module and the Departure Group detail page can never disagree about
 * what counts as a blocker.
 *
 * `buildOperationsSnapshot()` is the one function that produces the flat,
 * JSON-safe `OperationsSnapshot` the Client Components receive — no raw row
 * and no Supabase client crosses that boundary.
 */

import { cookies } from "next/headers";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  buildSupplierLines,
  buildBlockers,
  getCurrentStaffRole,
  scoreReadiness,
} from "@/lib/data/departure-groups";
import { isTravellingPilgrim } from "@/lib/data/departure-groups-bookings";
import { daysBetween } from "@/lib/data/departure-groups-copy";
import { syncGroupDerivedState } from "@/lib/data/departure-groups-documents";
import { deriveReadinessStatuses } from "@/lib/data/departure-groups-readiness";
import { loadStore, type Db } from "@/lib/data/departure-groups-repository";
import {
  TICKETING_DEADLINE_RISK_DAYS,
  TRANSPORT_DRIVER_REQUIRED_HOURS,
  TRANSPORT_PICKUP_REQUIRED_HOURS,
} from "@/lib/data/operations-copy";
import type {
  DepartureGroupAccommodationRow,
  DepartureGroupFlightRow,
  DepartureGroupRow,
  DepartureGroupTransportRow,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";
import type {
  FlightRiskState,
  OperationsAccommodationItem,
  OperationsActivityItem,
  OperationsBlocker,
  OperationsFlightItem,
  OperationsGroupSummary,
  OperationsGuideBoardRow,
  OperationsServiceLine,
  OperationsSnapshot,
  OperationsSupplierRow,
  OperationsTaskItem,
  OperationsTransportItem,
} from "@/lib/types/operations";
import { createClient } from "@/utils/supabase/server";

export type { Db };

export async function db(): Promise<Db> {
  return createClient(await cookies());
}

const ACTIVE_STATUSES = new Set(["PLANNING", "PREPARING", "READY_TO_DEPART"]);

const OPERATIONS_COLLECTIONS = [
  "groups",
  "snapshots",
  "readinessItems",
  "pilgrims",
  "accommodations",
  "rooms",
  "roomAssignments",
  "transports",
  "flights",
  "bookings",
  "tasks",
  "activity",
] as const;

const CRITICAL_DEPARTURE_WINDOW_DAYS = 14;

/* ── Loading ──────────────────────────────────────────────────────────────── */

/**
 * Hydrates every non-departed group in one round trip. Guides are restricted
 * to the groups they are assigned to before anything downstream is computed —
 * a query filter, not a UI conditional, so a guide's payload never contains
 * another group's rows in the first place.
 *
 * `assignedGroupIds` comes from `staff_group_assignments`
 * (`loadAssignedGroupIds()`), not a name match against `primary_guide_name` /
 * `backup_guide_name` — this used to compare display names, which meant two
 * guides sharing a name saw each other's groups, and renaming a guide
 * silently dropped every group they were assigned to. See the same fix in
 * `lib/access/departure-groups-access.ts`'s `filterGroupsForRole()`.
 */
async function loadActiveStore(
  supabase: Db,
  role: StaffRole,
  assignedGroupIds: string[],
): Promise<DepartureGroupStore> {
  const full = await loadStore(supabase, {
    only: OPERATIONS_COLLECTIONS,
    includeArchived: false,
    activityLimit: 300,
  });

  const assigned = new Set(assignedGroupIds);
  const scoped = full.groups.filter((g) => {
    if (!ACTIVE_STATUSES.has(g.group_status)) return false;
    if (role !== "GUIDE") return true;
    return assigned.has(g.id);
  });
  const groupIds = new Set(scoped.map((g) => g.id));
  const accommodationIds = new Set(
    full.accommodations.filter((a) => groupIds.has(a.departure_group_id)).map((a) => a.id),
  );

  return {
    groups: scoped,
    snapshots: full.snapshots.filter((s) => groupIds.has(s.departure_group_id)),
    pricing: full.pricing.filter((p) => groupIds.has(p.departure_group_id)),
    costEstimates: full.costEstimates.filter((c) =>
      groupIds.has(c.departure_group_id),
    ),
    flights: full.flights.filter((f) => groupIds.has(f.departure_group_id)),
    flightLegs: full.flightLegs,
    accommodations: full.accommodations.filter((a) => groupIds.has(a.departure_group_id)),
    rooms: full.rooms.filter((r) => accommodationIds.has(r.accommodation_id)),
    roomAssignments: full.roomAssignments,
    transports: full.transports.filter((t) => groupIds.has(t.departure_group_id)),
    bookings: full.bookings.filter((b) => groupIds.has(b.departure_group_id)),
    pilgrims: full.pilgrims.filter((p) => groupIds.has(p.departure_group_id)),
    pilgrimDocuments: full.pilgrimDocuments,
    pilgrimCharges: full.pilgrimCharges,
    pilgrimDeviations: full.pilgrimDeviations,
    travellerRelationships: full.travellerRelationships,
    readinessItems: full.readinessItems.filter((r) => groupIds.has(r.departure_group_id)),
    tasks: full.tasks.filter((t) => groupIds.has(t.departure_group_id)),
    activity: full.activity.filter((a) => groupIds.has(a.departure_group_id)),
  };
}

/* ── Per-row derivations ──────────────────────────────────────────────────── */

const VISA_PENDING_STATES = new Set([
  "NOT_STARTED",
  "DOCUMENTS_PENDING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REJECTED",
  "REWORK_REQUIRED",
]);

function urgencyFor(severity: "CRITICAL" | "WARNING", daysUntilDeparture: number): "CRITICAL" | "WARNING" {
  if (severity === "WARNING") return "WARNING";
  return daysUntilDeparture <= CRITICAL_DEPARTURE_WINDOW_DAYS ? "CRITICAL" : "WARNING";
}

function flightRisk(
  flight: DepartureGroupFlightRow,
  nowIso: string,
  groupBookedSeats: number,
  nameMismatchCount: number,
): { riskState: FlightRiskState; issueLabel: string | null } {
  const now = Date.parse(nowIso);
  const deadline = flight.ticketing_deadline ? Date.parse(flight.ticketing_deadline) : null;
  const ticketsPending = flight.seats_ticketed < flight.seats_held;
  const issues: string[] = [];
  let state: FlightRiskState = "OK";

  if (deadline !== null && deadline < now && ticketsPending) {
    state = "OVERDUE";
    issues.push(`Ticketing deadline passed with ${flight.seats_held - flight.seats_ticketed} ticket(s) pending`);
  } else if (deadline !== null && ticketsPending && (deadline - now) / 86_400_000 <= TICKETING_DEADLINE_RISK_DAYS) {
    state = "AT_RISK";
    const daysLeft = Math.max(0, Math.ceil((deadline - now) / 86_400_000));
    issues.push(`${flight.seats_held - flight.seats_ticketed} ticket(s) pending, deadline in ${daysLeft} day(s)`);
  } else if (flight.seats_held < groupBookedSeats) {
    state = "SEATS_SHORT";
    issues.push(`${groupBookedSeats - flight.seats_held} pilgrim(s) booked beyond seats held`);
  }

  if (nameMismatchCount > 0) {
    if (state === "OK") state = "NAME_MISMATCH";
    issues.push(`${nameMismatchCount} passenger name mismatch${nameMismatchCount === 1 ? "" : "es"}`);
  }

  return { riskState: state, issueLabel: issues.length ? issues.join(" · ") : null };
}

function roomingIndicator(
  acc: DepartureGroupAccommodationRow,
  capacity: number,
  assigned: number,
  pilgrimCount: number,
): { tone: "success" | "warning" | "danger"; label: string } {
  if (acc.status !== "CONFIRMED" && acc.status !== "COMPLETED") {
    return { tone: "danger", label: "Accommodation not confirmed" };
  }
  if (capacity < pilgrimCount) {
    return { tone: "danger", label: `Only ${capacity} beds for ${pilgrimCount} pilgrims` };
  }
  if (assigned > capacity) {
    return { tone: "danger", label: "Overbooked against room capacity" };
  }
  if (assigned < pilgrimCount) {
    return { tone: "warning", label: `${assigned} / ${pilgrimCount} pilgrims assigned` };
  }
  return { tone: "success", label: "All pilgrims assigned" };
}

function transportWarnings(t: DepartureGroupTransportRow, nowIso: string, groupDepartureDate: string): string[] {
  const now = Date.parse(nowIso);
  const pickupRef = t.pickup_at ? Date.parse(t.pickup_at) : Date.parse(`${groupDepartureDate}T09:00:00.000Z`);
  const hoursToPickup = (pickupRef - now) / 3_600_000;
  const warnings: string[] = [];

  if (t.vehicle_capacity !== null && t.passenger_count !== null && t.vehicle_capacity < t.passenger_count) {
    warnings.push(`Vehicle seats ${t.vehicle_capacity} but ${t.passenger_count} pilgrims are booked`);
  }
  if (!t.pickup_at && hoursToPickup <= TRANSPORT_PICKUP_REQUIRED_HOURS) {
    warnings.push(`Pickup time is not set and travel is in ${Math.max(0, Math.round(hoursToPickup))} hour(s)`);
  }
  if (!t.driver_phone && hoursToPickup <= TRANSPORT_DRIVER_REQUIRED_HOURS) {
    warnings.push(`No driver contact ${Math.max(0, Math.round(hoursToPickup))} hour(s) before pickup`);
  }
  if (t.status !== "CONFIRMED" && t.status !== "COMPLETED" && hoursToPickup <= TRANSPORT_PICKUP_REQUIRED_HOURS) {
    warnings.push("Not confirmed and pickup is approaching");
  }
  return warnings;
}

/* ── Snapshot ─────────────────────────────────────────────────────────────── */

export async function buildOperationsSnapshot(
  supabase: Db,
  role: StaffRole,
  /** From `loadAssignedGroupIds()` — only consulted when `role === "GUIDE"`. */
  assignedGroupIds: string[],
): Promise<OperationsSnapshot> {
  const store = await loadActiveStore(supabase, role, assignedGroupIds);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  for (const group of store.groups) {
    syncGroupDerivedState(store, group.id);
    deriveReadinessStatuses(store, group.id);
  }

  const groups: OperationsGroupSummary[] = store.groups.map((row: DepartureGroupRow) => {
    const readinessItems = store.readinessItems.filter((i) => i.departure_group_id === row.id);
    const allPilgrims = store.pilgrims.filter((p) => p.departure_group_id === row.id);
    // Matches `buildBlockers`' own traveller filter — a waitlisted pilgrim has
    // no seat yet and should not count here either.
    const pilgrims = allPilgrims.filter((p) => isTravellingPilgrim(store, p));
    const readiness = scoreReadiness(readinessItems);
    const daysUntilDeparture = daysBetween(today, row.departure_date);
    const rawBlockers = buildBlockers(row, store, readinessItems, allPilgrims);
    const bookings = store.bookings.filter((b) => b.departure_group_id === row.id);

    const blockers: OperationsBlocker[] = rawBlockers.map((b) => ({
      id: `${row.id}-${b.id}`,
      groupId: row.id,
      groupName: row.group_name,
      groupCode: row.group_code,
      daysUntilDeparture,
      severity: b.severity,
      urgency: urgencyFor(b.severity, daysUntilDeparture),
      message: b.message,
      actionLabel: b.actionLabel,
      tab: b.tab,
      filter: b.filter,
    }));

    const visaPendingCount = pilgrims.filter((p) => VISA_PENDING_STATES.has(p.visa_status)).length;
    const documentsMissingCount = pilgrims.filter((p) => p.document_completion_percent < 100).length;
    const paymentsOverdueCount = bookings.filter(
      (b) =>
        b.booking_status !== "CANCELLED" &&
        b.next_due_at !== null &&
        Date.parse(b.next_due_at) < Date.now() &&
        b.outstanding_balance > 0,
    ).length;
    const roomingAssignedCount = pilgrims.filter((p) => p.room_assignment_status !== "UNASSIGNED").length;

    const serviceLines: OperationsServiceLine[] = buildSupplierLines(row.id, store);

    return {
      id: row.id,
      groupName: row.group_name,
      groupCode: row.group_code,
      journeyType: row.journey_type,
      groupStatus: row.group_status,
      salesStatus: row.sales_status,
      branch: row.branch,
      departureDate: row.departure_date,
      returnDate: row.return_date,
      daysUntilDeparture,
      capacity: row.capacity,
      bookedSeats: row.booked_seats,
      pilgrimCount: pilgrims.length,
      primaryGuideName: row.primary_guide_name,
      backupGuideName: row.backup_guide_name,
      operationsOwnerName: row.operations_owner_name,
      visaOwnerName: row.visa_owner_name,
      financeOwnerName: row.finance_owner_name,
      emergencyPhone: row.emergency_phone,
      guideWhatsappLink: row.guide_whatsapp_link,
      pilgrimBroadcastLink: row.pilgrim_broadcast_link,
      localCoordinatorName: row.local_coordinator_name,
      localCoordinatorPhone: row.local_coordinator_phone,
      readinessScore: readiness.score,
      readinessStatus: readiness.status,
      readinessCategories: readiness.categories.map((c) => ({
        category: c.category,
        percent: c.percent,
        status: c.status,
      })),
      blockers,
      serviceLines,
      visaPendingCount,
      documentsMissingCount,
      paymentsOverdueCount,
      roomingAssignedCount,
    };
  });

  const groupById = new Map(groups.map((g) => [g.id, g]));

  /* ── Tasks ──────────────────────────────────────────────────────────────── */
  const tasks: OperationsTaskItem[] = store.tasks
    .map((t) => {
      const group = groupById.get(t.departure_group_id);
      if (!group) return null;
      const linked = t.linked_readiness_item_id
        ? store.readinessItems.find((i) => i.id === t.linked_readiness_item_id)
        : undefined;
      const item: OperationsTaskItem = {
        id: t.id,
        groupId: t.departure_group_id,
        groupName: group.groupName,
        groupCode: group.groupCode,
        daysUntilDeparture: group.daysUntilDeparture,
        title: t.title,
        description: t.description,
        ownerName: t.owner_name?.trim() ? t.owner_name : null,
        dueAt: t.due_at,
        status: t.status,
        category: t.category,
        linkedReadinessItemId: t.linked_readiness_item_id,
        linkedReadinessLabel: linked?.label ?? null,
      };
      return item;
    })
    .filter((t): t is OperationsTaskItem => t !== null);

  /* ── Flights ────────────────────────────────────────────────────────────── */
  const nameMismatchByGroup = new Map<string, number>();
  for (const p of store.pilgrims) {
    if (p.flight_status === "NAME_MISMATCH" && p.seat_status !== "CANCELLED") {
      nameMismatchByGroup.set(p.departure_group_id, (nameMismatchByGroup.get(p.departure_group_id) ?? 0) + 1);
    }
  }

  const flights: OperationsFlightItem[] = store.flights
    .filter((f) => f.status !== "CANCELLED")
    .map((f) => {
      const group = groupById.get(f.departure_group_id);
      if (!group) return null;
      const { riskState, issueLabel } = flightRisk(
        f,
        nowIso,
        group.bookedSeats,
        nameMismatchByGroup.get(f.departure_group_id) ?? 0,
      );
      const item: OperationsFlightItem = {
        id: f.id,
        groupId: f.departure_group_id,
        groupName: group.groupName,
        groupCode: group.groupCode,
        daysUntilDeparture: group.daysUntilDeparture,
        direction: f.direction,
        status: f.status,
        airline: f.airline,
        flightNumber: f.flight_number,
        pnr: f.pnr,
        bookingReference: f.booking_reference,
        originAirportCode: f.origin_airport_code,
        destinationAirportCode: f.destination_airport_code,
        departureAt: f.departure_at,
        seatCapacity: f.seat_capacity,
        seatsHeld: f.seats_held,
        seatsTicketed: f.seats_ticketed,
        ticketingDeadline: f.ticketing_deadline,
        supplierName: f.supplier_name,
        supplierId: f.supplier_id,
        nameMismatchCount: nameMismatchByGroup.get(f.departure_group_id) ?? 0,
        riskState,
        issueLabel,
      };
      return item;
    })
    .filter((f): f is OperationsFlightItem => f !== null);

  /* ── Accommodation & rooming ───────────────────────────────────────────── */
  const accommodations: OperationsAccommodationItem[] = store.accommodations
    .filter((a) => a.status !== "CANCELLED")
    .map((a) => {
      const group = groupById.get(a.departure_group_id);
      if (!group) return null;
      const roomsForAcc = store.rooms.filter((r) => r.accommodation_id === a.id);
      const assigned = roomsForAcc.reduce((sum, r) => sum + r.assigned_pilgrim_count, 0);
      const capacity = roomsForAcc.length > 0
        ? roomsForAcc.reduce((sum, r) => sum + r.occupancy_capacity, 0)
        : a.room_capacity;
      const indicator = roomingIndicator(a, capacity, assigned, group.pilgrimCount);
      const item: OperationsAccommodationItem = {
        id: a.id,
        groupId: a.departure_group_id,
        groupName: group.groupName,
        groupCode: group.groupCode,
        daysUntilDeparture: group.daysUntilDeparture,
        city: a.city,
        hotelName: a.hotel_name,
        supplierName: a.supplier_name,
        supplierId: a.supplier_id,
        bookingReference: a.booking_reference,
        status: a.status,
        checkInDate: a.check_in_date,
        checkOutDate: a.check_out_date,
        roomCapacity: capacity,
        roomsReserved: a.rooms_reserved,
        roomsAllocated: a.rooms_allocated,
        voucherUrl: a.voucher_url,
        pilgrimCount: group.pilgrimCount,
        pilgrimsAssigned: assigned,
        roomingTone: indicator.tone,
        roomingLabel: indicator.label,
      };
      return item;
    })
    .filter((a): a is OperationsAccommodationItem => a !== null);

  /* ── Transport ──────────────────────────────────────────────────────────── */
  const transports: OperationsTransportItem[] = store.transports
    .filter((t) => t.status !== "CANCELLED")
    .map((t) => {
      const group = groupById.get(t.departure_group_id);
      if (!group) return null;
      const item: OperationsTransportItem = {
        id: t.id,
        groupId: t.departure_group_id,
        groupName: group.groupName,
        groupCode: group.groupCode,
        daysUntilDeparture: group.daysUntilDeparture,
        routeLabel: t.route_label,
        origin: t.origin,
        destination: t.destination,
        status: t.status,
        supplierName: t.supplier_name,
        supplierId: t.supplier_id,
        bookingReference: t.booking_reference,
        vehicleType: t.vehicle_type,
        vehicleCapacity: t.vehicle_capacity,
        passengerCount: t.passenger_count,
        pickupAt: t.pickup_at,
        pickupLocation: t.pickup_location,
        driverName: t.driver_name,
        driverPhone: t.driver_phone,
        confirmationUrl: t.confirmation_url,
        warnings: transportWarnings(t, nowIso, group.departureDate),
      };
      return item;
    })
    .filter((t): t is OperationsTransportItem => t !== null);

  /* ── Supplier confirmations (union) ────────────────────────────────────── */
  const supplierRows: OperationsSupplierRow[] = [
    ...flights.map((f): OperationsSupplierRow => ({
      id: f.id,
      serviceKind: "FLIGHT",
      groupId: f.groupId,
      groupName: f.groupName,
      groupCode: f.groupCode,
      daysUntilDeparture: f.daysUntilDeparture,
      serviceLabel: f.direction === "OUTBOUND" ? "Outbound Flight" : "Return Flight",
      category: "FLIGHTS",
      supplierName: f.supplierName,
      supplierId: f.supplierId,
      reference: f.pnr ?? f.bookingReference,
      dueAt: f.ticketingDeadline,
      status: f.status,
      ownerName: groupById.get(f.groupId)?.operationsOwnerName ?? null,
      evidencePresent: !!(f.pnr || f.bookingReference),
    })),
    ...accommodations.map((a): OperationsSupplierRow => ({
      id: a.id,
      serviceKind: "ACCOMMODATION",
      groupId: a.groupId,
      groupName: a.groupName,
      groupCode: a.groupCode,
      daysUntilDeparture: a.daysUntilDeparture,
      serviceLabel: `${a.city.charAt(0)}${a.city.slice(1).toLowerCase()} Accommodation`,
      category: `ACCOMMODATION_${a.city}`,
      supplierName: a.supplierName,
      supplierId: a.supplierId,
      reference: a.bookingReference,
      dueAt: a.checkInDate,
      status: a.status,
      ownerName: groupById.get(a.groupId)?.operationsOwnerName ?? null,
      evidencePresent: !!(a.bookingReference || a.voucherUrl),
    })),
    ...transports.map((t): OperationsSupplierRow => ({
      id: t.id,
      serviceKind: "TRANSPORT",
      groupId: t.groupId,
      groupName: t.groupName,
      groupCode: t.groupCode,
      daysUntilDeparture: t.daysUntilDeparture,
      serviceLabel: t.routeLabel,
      category: "TRANSPORT",
      supplierName: t.supplierName,
      supplierId: t.supplierId,
      reference: t.bookingReference,
      dueAt: t.pickupAt,
      status: t.status,
      ownerName: groupById.get(t.groupId)?.operationsOwnerName ?? null,
      evidencePresent: !!(t.bookingReference || t.confirmationUrl),
    })),
  ];

  /* ── Guides & briefings ─────────────────────────────────────────────────── */
  const guideBoard: OperationsGuideBoardRow[] = groups
    .map((g) => ({
      groupId: g.id,
      groupName: g.groupName,
      groupCode: g.groupCode,
      daysUntilDeparture: g.daysUntilDeparture,
      primaryGuideName: g.primaryGuideName,
      backupGuideName: g.backupGuideName,
      pilgrimCount: g.pilgrimCount,
      hasWhatsappGroup: !!g.guideWhatsappLink,
      hasEmergencyContact: !!g.emergencyPhone,
      readinessStatus: g.readinessStatus,
    }))
    .sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture);

  /* ── Activity ───────────────────────────────────────────────────────────── */
  const activity: OperationsActivityItem[] = store.activity
    .map((a) => {
      const group = groupById.get(a.departure_group_id);
      return {
        id: a.id,
        groupId: a.departure_group_id,
        groupName: group?.groupName ?? "—",
        groupCode: group?.groupCode ?? "—",
        actorName: a.actor_name_snapshot,
        actionType: a.action_type,
        entityType: a.entity_type,
        message: a.message,
        isHighImpact: a.is_high_impact,
        isSystem: a.is_system,
        createdAt: a.created_at,
      };
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    nowIso,
    groups: groups.sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture),
    tasks,
    supplierRows,
    flights,
    accommodations,
    transports,
    guideBoard,
    activity,
  };
}

export { getCurrentStaffRole };

/** Every currently-assigned owner name across active groups, for filter pickers. */
export function distinctOwnerNames(snapshot: OperationsSnapshot): string[] {
  return [...new Set(snapshot.tasks.map((t) => t.ownerName).filter((n): n is string => !!n))].sort();
}
