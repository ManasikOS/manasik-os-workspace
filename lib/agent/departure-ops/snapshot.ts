/**
 * The deterministic read model — the single hydration the Departure
 * Operations Agent gets. See §7 of
 * docs/modules/departure-operations-agent-implementation-plan.md.
 *
 * Two rules this module exists to enforce:
 *
 *   1. The model never computes readiness (D2). Every derived fact here
 *      comes from the same four calls `getDepartureGroupDetail()` makes —
 *      `syncGroupDerivedState()`, `deriveReadinessStatuses()`,
 *      `scoreReadiness()`, `buildBlockers()` — reused verbatim. This module
 *      adds no second implementation of readiness, blockers, or scoring.
 *
 *   2. This is NOT `getDepartureGroupDetail()` (F1/F2). That function is
 *      wrapped in React `cache()` — request-scoped memoisation, correct for
 *      a page render, wrong for a worker that may hydrate many groups in
 *      one drain invocation (a read-after-write inside that invocation
 *      would return the pre-write value). `buildOpsSnapshot()` calls
 *      `loadStore()` directly, uncached, every time.
 *
 * No supplier cost, no margin, no passport number, no traveller PII beyond
 * counts ever leaves this module — an operations agent needs statuses and
 * counts, never a passport number, and `agent_tool_calls`/`departure_ops_tool_calls`
 * persist tool arguments, so anything returned here ends up in a log table.
 */

import "server-only";

import { hashObject } from "@/lib/agent/kernel/hash";
import { colomboDayKey } from "@/lib/date";
import { buildBlockers, scoreReadiness } from "@/lib/data/departure-groups";
import { isTravellingPilgrim } from "@/lib/data/departure-groups-bookings";
import { daysBetween } from "@/lib/data/departure-groups-copy";
import { syncGroupDerivedState } from "@/lib/data/departure-groups-documents";
import {
  AUTO_SOURCE_HINTS,
  deriveReadinessStatuses,
} from "@/lib/data/departure-groups-readiness";
import { loadStore, type Db } from "@/lib/data/departure-groups-repository";
import type {
  DepartureGroupBlocker,
  DepartureGroupReadinessSummary,
} from "@/app/(main)/departure-groups/types";
import type {
  DepartureGroupStatus,
  DepartureGroupStore,
  GroupJourneyType,
  GroupSalesStatus,
  PilgrimVisaStatus,
  ReadinessAutoSource,
  ReadinessItemStatus,
} from "@/lib/types/departure-groups";

/* ── Escalation tier (§10.1) ──────────────────────────────────────────────── */

/**
 * How urgently a group needs the agent's attention, derived purely from
 * `daysUntilDeparture`. Lives here rather than in a not-yet-built
 * `scheduler.ts` because the snapshot itself carries the tier — Phase 5's
 * scheduler imports this same function rather than re-deriving it.
 */
export type EscalationTier =
  | "PLANNING"
  | "BUILDING"
  | "CONFIRMING"
  | "FINALISING"
  | "IMMINENT"
  | "CRITICAL"
  | "POST";

export function escalationTierFor(daysUntilDeparture: number): EscalationTier {
  if (daysUntilDeparture < 0) return "POST";
  if (daysUntilDeparture <= 2) return "CRITICAL";
  if (daysUntilDeparture <= 7) return "IMMINENT";
  if (daysUntilDeparture <= 21) return "FINALISING";
  if (daysUntilDeparture <= 45) return "CONFIRMING";
  if (daysUntilDeparture <= 90) return "BUILDING";
  return "PLANNING";
}

/** `effort` follows consequence (D13) — a mistake 90 days out is cheap, a mistake on Thursday is not. */
export function effortForTier(tier: EscalationTier): "low" | "medium" | "high" {
  switch (tier) {
    case "PLANNING":
    case "BUILDING":
    case "POST":
      return "low";
    case "CONFIRMING":
    case "FINALISING":
      return "medium";
    case "IMMINENT":
    case "CRITICAL":
      return "high";
  }
}

/* ── The snapshot shape ───────────────────────────────────────────────────── */

export interface OpsSnapshotOwners {
  operations: string | null;
  visa: string | null;
  finance: string | null;
  guide: string | null;
  coordinator: string | null;
}

export interface OpsSnapshotReadinessItem {
  id: string;
  label: string;
  status: ReadinessItemStatus;
  required: boolean;
  autoSource: ReadinessAutoSource | null;
  /** Where a human must go to actually move a derived item — AUTO_SOURCE_HINTS[autoSource] (F9). Null for a manual item. */
  movedBy: string | null;
  dueAt: string | null;
  assignedToName: string | null;
  /** Positive when overdue, null when there's no due date or it isn't overdue. */
  daysOverdue: number | null;
}

export interface OpsSnapshotFlight {
  direction: string;
  status: string;
  hasPnr: boolean;
  ticketingDeadline: string | null;
  daysToTicketingDeadline: number | null;
}

export interface OpsSnapshotAccommodation {
  id: string;
  city: string;
  status: string;
  nights: number;
  hasReference: boolean;
  hasVoucher: boolean;
}

export interface OpsSnapshotTransport {
  id: string;
  routeLabel: string;
  status: string;
  hasReference: boolean;
}

export interface OpsSnapshotTask {
  id: string;
  title: string;
  ownerName: string;
  dueAt: string;
  status: string;
  category: string;
}

export interface OpsSnapshotOpenProposal {
  id: string;
  kind: string;
  title: string;
  risk: string;
  createdAt: string;
}

export interface OpsSnapshotRejection {
  kind: string;
  fingerprint: string;
  reason: string | null;
  decidedAt: string;
}

export interface OpsSnapshotActivity {
  message: string;
  createdAt: string;
  actorName: string;
}

export interface OpsSnapshot {
  group: {
    id: string;
    code: string;
    name: string;
    branch: string;
    journeyType: GroupJourneyType;
    departureDate: string;
    returnDate: string;
    daysUntilDeparture: number;
    tier: EscalationTier;
    groupStatus: DepartureGroupStatus;
    salesStatus: GroupSalesStatus;
    capacity: number;
    bookedSeats: number;
    heldSeats: number;
    availableSeats: number;
    minimumGroupSize: number;
    owners: OpsSnapshotOwners;
  };
  readiness: {
    score: number;
    status: DepartureGroupReadinessSummary["status"];
    categories: DepartureGroupReadinessSummary["categories"];
    items: OpsSnapshotReadinessItem[];
  };
  blockers: DepartureGroupBlocker[];
  suppliers: {
    flights: OpsSnapshotFlight[];
    accommodations: OpsSnapshotAccommodation[];
    transports: OpsSnapshotTransport[];
  };
  travellers: {
    total: number;
    travelling: number;
    waitlisted: number;
    cancelled: number;
    visaCounts: Partial<Record<PilgrimVisaStatus, number>>;
    passportExpiryMissing: number;
    documentsOutstanding: number;
    roomsAssigned: number;
    blockingDeviations: number;
  };
  payments: {
    bookingsOverdue: number;
    bookingsWithBalance: number;
  };
  work: {
    openTasks: OpsSnapshotTask[];
    /** Populated once Phase 3's proposal queue exists; empty until then. */
    openProposals: OpsSnapshotOpenProposal[];
    /** Populated once Phase 3's proposal queue exists; empty until then. */
    recentRejections: OpsSnapshotRejection[];
    recentHighImpactActivity: OpsSnapshotActivity[];
  };
  /** D9 — hashed over the material fields below, excluding updated_at/activity/score arithmetic, so ordinary churn does not force a model call. */
  fingerprint: string;
}

/* ── Building the snapshot ────────────────────────────────────────────────── */

const HIGH_IMPACT_ACTIVITY_LIMIT = 10;

interface ProposalRow {
  id: string;
  kind: string;
  title: string;
  risk: string;
  status: string;
  fingerprint: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

/**
 * Builds one group's operational snapshot straight from the store — the
 * agent's only read. Admin client, explicitly scoped by `agencyId`; never
 * the cached UI entrypoint (see this module's header).
 */
export async function buildOpsSnapshot(
  agencyId: string,
  groupId: string,
  client: Db,
  options?: {
    /** ai_settings.departure_ops_rejection_cooldown_days — how far back a rejection still counts as "settled". Defaults to 14, matching that column's own default. */
    rejectionCooldownDays?: number;
  },
): Promise<OpsSnapshot | null> {
  const [data, proposalsResult] = await Promise.all([
    loadStore(client, {
      groupIds: [groupId],
      only: [
        "groups",
        "readinessItems",
        "pilgrims",
        "accommodations",
        "transports",
        "flights",
        "bookings",
        "tasks",
        "activity",
        "pilgrimDeviations",
      ],
      activityLimit: 50,
    }),
    // agent_proposals isn't part of DepartureGroupStore (it's kernel/shared
    // infra — see that table's own migration comment), so it's read
    // directly here rather than through loadStore.
    client
      .from("agent_proposals")
      .select("id, kind, title, risk, status, fingerprint, decision_note, decided_at, created_at")
      .eq("departure_group_id", groupId)
      .in("status", ["PROPOSED", "APPROVED", "REJECTED"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return buildOpsSnapshotFromStore(data, groupId, agencyId, {
    rejectionCooldownDays: options?.rejectionCooldownDays,
    proposalRows: (proposalsResult.data ?? []) as ProposalRow[],
  });
}

/**
 * The pure core — everything `buildOpsSnapshot()` does once it has a store,
 * with no database or Next runtime involved. Split out so
 * `__evals__/` can run the exact derivation logic a live review uses
 * against a hand-built `DepartureGroupStore` fixture, the same "plain
 * arrays, pure mutators" property `departure-groups-readiness.ts` was
 * written for (§13 of the plan).
 */
export function buildOpsSnapshotFromStore(
  data: DepartureGroupStore,
  groupId: string,
  agencyId: string,
  options?: {
    rejectionCooldownDays?: number;
    proposalRows?: ProposalRow[];
  },
): OpsSnapshot | null {
  const proposalsResult = { data: options?.proposalRows ?? [] };

  const group = data.groups.find((g) => g.id === groupId);
  if (!group || group.agency_id !== agencyId) return null;

  // Same four calls getDepartureGroupDetail() makes — see this module's
  // header. This is a read, so the results are not written back; the next
  // mutation (a human approving a proposal) persists them through
  // syncDerivedColumns().
  syncGroupDerivedState(data, groupId);
  deriveReadinessStatuses(data, groupId);

  const readinessRows = data.readinessItems.filter(
    (item) => item.departure_group_id === groupId,
  );
  const readiness = scoreReadiness(readinessRows);

  const allPilgrims = data.pilgrims.filter(
    (p) => p.departure_group_id === groupId,
  );
  const blockers = buildBlockers(group, data, readinessRows, allPilgrims);

  const now = colomboDayKey();
  const daysUntilDeparture = daysBetween(now, group.departure_date);
  const tier = escalationTierFor(daysUntilDeparture);

  const items: OpsSnapshotReadinessItem[] = readinessRows.map((item) => {
    const daysOverdue =
      item.status !== "COMPLETE" && item.due_at !== null
        ? -daysBetween(colomboDayKey(), item.due_at.slice(0, 10))
        : null;
    return {
      id: item.id,
      label: item.label,
      status: item.status,
      required: item.required,
      autoSource: item.auto_source,
      movedBy: item.auto_source ? AUTO_SOURCE_HINTS[item.auto_source] : null,
      dueAt: item.due_at,
      assignedToName: item.assigned_to_name,
      daysOverdue: daysOverdue !== null && daysOverdue > 0 ? daysOverdue : null,
    };
  });

  const flights: OpsSnapshotFlight[] = data.flights
    .filter((f) => f.departure_group_id === groupId)
    .map((f) => ({
      direction: f.direction,
      status: f.status,
      hasPnr: !!f.pnr,
      ticketingDeadline: f.ticketing_deadline,
      daysToTicketingDeadline: f.ticketing_deadline
        ? daysBetween(colomboDayKey(), f.ticketing_deadline.slice(0, 10))
        : null,
    }));

  const accommodations: OpsSnapshotAccommodation[] = data.accommodations
    .filter((a) => a.departure_group_id === groupId)
    .map((a) => ({
      id: a.id,
      city: a.city,
      status: a.status,
      nights: a.nights,
      hasReference: !!a.booking_reference,
      hasVoucher: !!a.voucher_url,
    }));

  const transports: OpsSnapshotTransport[] = data.transports
    .filter((t) => t.departure_group_id === groupId)
    .map((t) => ({
      id: t.id,
      routeLabel: t.route_label,
      status: t.status,
      hasReference: !!t.booking_reference,
    }));

  // Cancelled travellers and waitlisted travellers are not anyone's
  // operational problem right now — see isTravellingPilgrim and the
  // matching comment in buildBlockers().
  const travellingPilgrims = allPilgrims.filter((p) =>
    isTravellingPilgrim(data, p),
  );
  const waitlisted = allPilgrims.filter(
    (p) => p.seat_status === "WAITLIST",
  ).length;
  const cancelled = allPilgrims.filter(
    (p) => p.seat_status === "CANCELLED",
  ).length;

  const visaCounts: Partial<Record<PilgrimVisaStatus, number>> = {};
  for (const p of travellingPilgrims) {
    visaCounts[p.visa_status] = (visaCounts[p.visa_status] ?? 0) + 1;
  }

  const passportExpiryMissing = travellingPilgrims.filter(
    (p) => !p.passport_expiry,
  ).length;
  const documentsOutstanding = travellingPilgrims.filter(
    (p) => p.documents_completed < p.documents_required,
  ).length;
  const roomsAssigned = travellingPilgrims.filter(
    (p) => p.room_assignment_status !== "UNASSIGNED",
  ).length;

  const blockingDeviations = data.pilgrimDeviations.filter(
    (d) =>
      d.departure_group_id === groupId &&
      d.blocks_departure &&
      !["ARRANGED", "DECLINED", "CANCELLED"].includes(d.status),
  ).length;

  const liveBookings = data.bookings.filter(
    (b) => b.departure_group_id === groupId && b.booking_status !== "CANCELLED",
  );
  const bookingsOverdue = liveBookings.filter(
    (b) =>
      b.outstanding_balance > 0 &&
      b.next_due_at !== null &&
      Date.parse(b.next_due_at) < Date.now(),
  ).length;
  const bookingsWithBalance = liveBookings.filter(
    (b) => b.outstanding_balance > 0,
  ).length;

  const openTasks: OpsSnapshotTask[] = data.tasks
    .filter(
      (t) =>
        t.departure_group_id === groupId &&
        t.status !== "COMPLETE",
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      ownerName: t.owner_name,
      dueAt: t.due_at,
      status: t.status,
      category: t.category,
    }));

  const recentHighImpactActivity: OpsSnapshotActivity[] = data.activity
    .filter((a) => a.departure_group_id === groupId && a.is_high_impact)
    .slice(0, HIGH_IMPACT_ACTIVITY_LIMIT)
    .map((a) => ({
      message: a.message,
      createdAt: a.created_at,
      actorName: a.actor_name_snapshot,
    }));

  const cooldownDays = options?.rejectionCooldownDays ?? 14;
  const cooldownCutoff = Date.now() - cooldownDays * 86_400_000;
  const proposalRows = (proposalsResult.data ?? []) as {
    id: string;
    kind: string;
    title: string;
    risk: string;
    status: string;
    fingerprint: string;
    decision_note: string | null;
    decided_at: string | null;
    created_at: string;
  }[];

  const openProposals: OpsSnapshotOpenProposal[] = proposalRows
    .filter((p) => p.status === "PROPOSED" || p.status === "APPROVED")
    .map((p) => ({ id: p.id, kind: p.kind, title: p.title, risk: p.risk, createdAt: p.created_at }));

  // D7: only within the cooldown window still counts as "settled" — past
  // that, the same ask is fair to propose again.
  const recentRejections: OpsSnapshotRejection[] = proposalRows
    .filter((p) => p.status === "REJECTED" && p.decided_at !== null && Date.parse(p.decided_at) >= cooldownCutoff)
    .map((p) => ({
      kind: p.kind,
      fingerprint: p.fingerprint,
      reason: p.decision_note,
      decidedAt: p.decided_at as string,
    }));

  const snapshot: Omit<OpsSnapshot, "fingerprint"> = {
    group: {
      id: group.id,
      code: group.group_code,
      name: group.group_name,
      branch: group.branch,
      journeyType: group.journey_type,
      departureDate: group.departure_date,
      returnDate: group.return_date,
      daysUntilDeparture,
      tier,
      groupStatus: group.group_status,
      salesStatus: group.sales_status,
      capacity: group.capacity,
      bookedSeats: group.booked_seats,
      heldSeats: group.held_seats,
      availableSeats: group.available_seats,
      minimumGroupSize: group.minimum_group_size,
      owners: {
        operations: group.operations_owner_name,
        visa: group.visa_owner_name,
        finance: group.finance_owner_name,
        guide: group.primary_guide_name,
        coordinator: group.local_coordinator_name,
      },
    },
    readiness: {
      score: readiness.score,
      status: readiness.status,
      categories: readiness.categories,
      items,
    },
    blockers,
    suppliers: { flights, accommodations, transports },
    travellers: {
      total: allPilgrims.length,
      travelling: travellingPilgrims.length,
      waitlisted,
      cancelled,
      visaCounts,
      passportExpiryMissing,
      documentsOutstanding,
      roomsAssigned,
      blockingDeviations,
    },
    payments: { bookingsOverdue, bookingsWithBalance },
    work: {
      openTasks,
      openProposals,
      recentRejections,
      recentHighImpactActivity,
    },
  };

  return { ...snapshot, fingerprint: fingerprintOf(snapshot) };
}

/**
 * D9's material-state hash. Deliberately narrow: every readiness item
 * status, every supplier status/deadline, blocker ids, traveller status
 * counts, seat counts, group status, and open-work ids/statuses — nothing
 * that changes without the group's actual operational state changing.
 * Excludes `updated_at`, activity rows, and score arithmetic (the score is
 * a function of the items already hashed, so hashing it too would be
 * redundant, not additional signal).
 */
function fingerprintOf(snapshot: Omit<OpsSnapshot, "fingerprint">): string {
  const material = {
    groupStatus: snapshot.group.groupStatus,
    salesStatus: snapshot.group.salesStatus,
    bookedSeats: snapshot.group.bookedSeats,
    heldSeats: snapshot.group.heldSeats,
    availableSeats: snapshot.group.availableSeats,
    blockerIds: snapshot.blockers.map((b) => b.id).sort(),
    readinessItems: [...snapshot.readiness.items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((i) => `${i.id}:${i.status}`),
    flights: snapshot.suppliers.flights.map(
      (f) => `${f.direction}:${f.status}:${f.hasPnr}:${f.ticketingDeadline}`,
    ),
    accommodations: [...snapshot.suppliers.accommodations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => `${a.id}:${a.status}:${a.hasReference}:${a.hasVoucher}`),
    transports: [...snapshot.suppliers.transports]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) => `${t.id}:${t.status}:${t.hasReference}`),
    travellers: snapshot.travellers,
    payments: snapshot.payments,
    openTaskIds: snapshot.work.openTasks.map((t) => `${t.id}:${t.status}`).sort(),
    // A newly-decided proposal (approved, rejected, or freshly proposed by
    // someone/something else) is material — it changes what the agent
    // should say next, even when nothing else on the group has moved.
    openProposalIds: snapshot.work.openProposals.map((p) => p.id).sort(),
    rejectionFingerprints: snapshot.work.recentRejections.map((r) => r.fingerprint).sort(),
  };
  return hashObject(material);
}
