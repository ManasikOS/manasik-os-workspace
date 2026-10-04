/**
 * Readiness-checklist mutation logic, kept pure and store-passing so it can be
 * unit-tested without the Next server runtime (mirroring
 * `departure-groups-documents.ts`). The thin wrappers in `departure-groups.ts`
 * supply the live store.
 *
 * The group's readiness score is never written here: `scoreReadiness()` derives
 * it from these rows on every read, so there is no second copy to fall stale.
 */

import { isTravellingPilgrim } from "@/lib/data/departure-groups-bookings";
import { newId } from "@/lib/data/departure-groups-ids";
import type {
  DepartureGroupReadinessItemRow,
  GroupActor,
  ReadinessAutoSource,
  ReadinessItemStatus,
  DepartureGroupStore,
} from "@/lib/types/departure-groups";

/* ── Derived readiness ────────────────────────────────────────────────────── */

/**
 * Recomputes every readiness item that is a fact about other rows.
 *
 * Before this existed the whole checklist was manual, so the Readiness tab
 * could report "Makkah Hotel Booking Confirmed ✅" and a 100% score while the
 * accommodation row sat at `NOT_REQUESTED` and the Overview — which has always
 * derived its blockers from the real rows — said the confirmation was missing.
 * Two screens, one group, opposite answers, and `MARK_READY` trusted the
 * checkbox. An item's `auto_source` now names the rule that computes it;
 * `null` leaves the item manual and behaving exactly as it did.
 *
 * Called on every read and again before every persist, so the stored status,
 * the score column and the tab can never disagree.
 */
export function deriveReadinessStatuses(
  data: DepartureGroupStore,
  groupId: string,
): void {
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return;

  const items = data.readinessItems.filter(
    (item) => item.departure_group_id === groupId && item.auto_source !== null,
  );
  if (items.length === 0) return;

  // Cancelled travellers stop being anyone's problem the moment their booking
  // is withdrawn — counting them keeps a group permanently short of complete.
  // A waitlisted traveller has no seat yet, so their documents/rooming/visa
  // are not outstanding work either — see `isTravellingPilgrim`.
  const pilgrims = data.pilgrims.filter(
    (p) => p.departure_group_id === groupId && isTravellingPilgrim(data, p),
  );
  const bookings = data.bookings.filter(
    (b) =>
      b.departure_group_id === groupId &&
      b.booking_status !== "CANCELLED" &&
      b.booking_status !== "WAITLIST",
  );
  const accommodations = data.accommodations.filter(
    (a) => a.departure_group_id === groupId,
  );
  const roomAssignments = data.roomAssignments;
  const transports = data.transports.filter(
    (t) => t.departure_group_id === groupId,
  );
  const outbound = data.flights.find(
    (f) => f.departure_group_id === groupId && f.direction === "OUTBOUND",
  );

  for (const item of items) {
    const derived = deriveOne(item.auto_source!, {
      group,
      pilgrims,
      bookings,
      accommodations,
      roomAssignments,
      transports,
      outbound,
    });
    applyDerived(item, derived);
  }
}

interface DerivationContext {
  group: DepartureGroupStore["groups"][number];
  pilgrims: DepartureGroupStore["pilgrims"];
  bookings: DepartureGroupStore["bookings"];
  accommodations: DepartureGroupStore["accommodations"];
  roomAssignments: DepartureGroupStore["roomAssignments"];
  transports: DepartureGroupStore["transports"];
  outbound: DepartureGroupStore["flights"][number] | undefined;
}

/** Supplier rows share one status vocabulary, so they share one mapping. */
function fromSupplierStatus(
  status: string | undefined,
): ReadinessItemStatus {
  switch (status) {
    case "CONFIRMED":
    case "COMPLETED":
      return "COMPLETE";
    case "REQUESTED":
      return "IN_PROGRESS";
    case "CANCELLED":
      return "BLOCKED";
    default:
      return "NOT_STARTED";
  }
}

function transportMatching(
  transports: DerivationContext["transports"],
  pattern: RegExp,
) {
  return transports.find(
    (t) => pattern.test(t.route_label) || pattern.test(`${t.origin} ${t.destination}`),
  );
}

function deriveOne(
  source: ReadinessAutoSource,
  ctx: DerivationContext,
): ReadinessItemStatus {
  const { group, pilgrims, bookings, accommodations, transports, outbound } = ctx;

  switch (source) {
    case "FLIGHT_OUTBOUND_CONFIRMED": {
      if (!outbound) return "NOT_STARTED";
      if (outbound.status === "CANCELLED") return "BLOCKED";
      if (outbound.status === "CONFIRMED" || outbound.status === "TICKETED") {
        return "COMPLETE";
      }
      return outbound.status === "HELD" ? "IN_PROGRESS" : "NOT_STARTED";
    }

    case "FLIGHT_TICKETED": {
      if (!outbound) return "NOT_STARTED";
      if (outbound.status === "CANCELLED") return "BLOCKED";
      if (outbound.status === "TICKETED") return "COMPLETE";
      // A PNR held without tickets is real progress, and it is also the state
      // that expires — so it is at risk once the deadline is inside a week.
      if (!outbound.pnr) return "NOT_STARTED";
      if (outbound.ticketing_deadline) {
        const deadline = Date.parse(outbound.ticketing_deadline);
        if (Number.isFinite(deadline) && deadline - Date.now() < 7 * 86_400_000) {
          return "AT_RISK";
        }
      }
      return "IN_PROGRESS";
    }

    case "HOTEL_MAKKAH_CONFIRMED":
      return fromSupplierStatus(
        accommodations.find((a) => a.city === "MAKKAH")?.status,
      );

    case "HOTEL_MADINAH_CONFIRMED":
      return fromSupplierStatus(
        accommodations.find((a) => a.city === "MADINAH")?.status,
      );

    case "TRANSPORT_ARRIVAL_CONFIRMED":
      return fromSupplierStatus(
        transportMatching(transports, /arrival|airport.*hotel|reception/i)?.status,
      );

    case "TRANSPORT_INTERCITY_CONFIRMED":
      return fromSupplierStatus(
        transportMatching(transports, /intercity|makkah.*madinah|madinah.*makkah/i)
          ?.status,
      );

    case "TRANSPORT_DEPARTURE_CONFIRMED":
      return fromSupplierStatus(
        transportMatching(transports, /departure|hotel.*airport/i)?.status,
      );

    case "PAYMENTS_COLLECTED_IN_FULL": {
      if (bookings.length === 0) return "NOT_STARTED";
      const outstanding = bookings.reduce(
        (sum, b) => sum + b.outstanding_balance,
        0,
      );
      if (outstanding <= 0) return "COMPLETE";
      const overdue = bookings.some(
        (b) =>
          b.outstanding_balance > 0 &&
          b.next_due_at !== null &&
          Date.parse(b.next_due_at) < Date.now(),
      );
      if (overdue) return "AT_RISK";
      const collected = bookings.reduce((sum, b) => sum + b.amount_paid, 0);
      return collected > 0 ? "IN_PROGRESS" : "NOT_STARTED";
    }

    case "DOCUMENTS_ALL_VERIFIED": {
      if (pilgrims.length === 0) return "NOT_STARTED";
      const complete = pilgrims.filter(
        (p) => p.documents_completed >= p.documents_required,
      ).length;
      if (complete === pilgrims.length) return "COMPLETE";
      return complete > 0 ? "IN_PROGRESS" : "NOT_STARTED";
    }

    case "VISAS_ALL_APPROVED": {
      if (pilgrims.length === 0) return "NOT_STARTED";
      // A refusal that cannot be reworked is the one thing on this checklist
      // that genuinely stops a seat travelling.
      if (pilgrims.some((p) => p.visa_status === "REJECTED")) return "BLOCKED";
      const approved = pilgrims.filter(
        (p) => p.visa_status === "APPROVED",
      ).length;
      if (approved === pilgrims.length) return "COMPLETE";
      if (pilgrims.some((p) => p.visa_status === "REWORK_REQUIRED")) {
        return "AT_RISK";
      }
      return approved > 0 ||
        pilgrims.some((p) => p.visa_status !== "NOT_STARTED")
        ? "IN_PROGRESS"
        : "NOT_STARTED";
    }

    case "ROOMING_COMPLETE": {
      if (pilgrims.length === 0) return "NOT_STARTED";
      const requiredStays = ctx.accommodations.filter((a) => a.status !== "CANCELLED");
      const assigned = pilgrims.filter((p) => {
        const stays = requiredStays.filter((a) =>
          ctx.roomAssignments.some((r) => r.pilgrim_id === p.id && r.accommodation_id === a.id),
        );
        return stays.length === requiredStays.length;
      }).length;
      if (assigned === pilgrims.length) return "COMPLETE";
      return assigned > 0 ? "IN_PROGRESS" : "NOT_STARTED";
    }

    case "GUIDE_ASSIGNED":
      return group.primary_guide_name?.trim() ? "COMPLETE" : "NOT_STARTED";

    case "MANIFEST_READY": {
      if (pilgrims.length === 0) return "NOT_STARTED";
      // The manifest is the last gate: everyone ticketed, visa'd and roomed.
      const ready = pilgrims.filter(
        (p) =>
          p.flight_status === "TICKETED" &&
          p.visa_status === "APPROVED" &&
          p.room_assignment_status !== "UNASSIGNED",
      ).length;
      if (ready === pilgrims.length) return "COMPLETE";
      return ready > 0 ? "IN_PROGRESS" : "NOT_STARTED";
    }
  }
}

/**
 * Writes a derived status onto the item, keeping the completion stamp honest.
 *
 * A derived item that falls back out of `COMPLETE` — a hotel cancelled after
 * confirmation, a traveller added who has no room — loses its completion stamp,
 * because it is no longer complete and the trail should not claim someone
 * signed off the current state.
 */
function applyDerived(
  item: DepartureGroupReadinessItemRow,
  status: ReadinessItemStatus,
): void {
  // A deliberate "does not apply to this group" survives derivation; it is a
  // scoping decision about the group, not a claim about the underlying row.
  if (item.status === "NOT_REQUIRED") return;
  if (item.status === status) return;

  item.status = status;
  if (status === "COMPLETE") {
    item.completed_at ??= new Date().toISOString();
    item.completed_by_name ??= "System";
  } else {
    item.completed_at = null;
    item.completed_by = null;
    item.completed_by_name = null;
  }
}

export interface UpdateReadinessItemInput {
  id: string;
  departureGroupId: string;
  status?: ReadinessItemStatus;
  assignedToName?: string | null;
  dueAt?: string | null;
  evidenceUrl?: string | null;
  notes?: string | null;
  required?: boolean;
}

export type UpdateReadinessItemOutcome =
  | {
      ok: true;
      result: {
        label: string;
        status: ReadinessItemStatus;
        previousStatus: ReadinessItemStatus;
      };
    }
  | { ok: false; error: string };

/** Where to go to actually move a derived item, named in the refusal message. */
export const AUTO_SOURCE_HINTS: Record<ReadinessAutoSource, string> = {
  FLIGHT_OUTBOUND_CONFIRMED: "the outbound flight on the Flights tab",
  FLIGHT_TICKETED: "ticketing on the Flights tab",
  HOTEL_MAKKAH_CONFIRMED: "the Makkah hotel on the Hotels tab",
  HOTEL_MADINAH_CONFIRMED: "the Madinah hotel on the Hotels tab",
  TRANSPORT_ARRIVAL_CONFIRMED: "the arrival transfer on the Transport tab",
  TRANSPORT_INTERCITY_CONFIRMED: "the intercity transfer on the Transport tab",
  TRANSPORT_DEPARTURE_CONFIRMED: "the departure transfer on the Transport tab",
  PAYMENTS_COLLECTED_IN_FULL: "booking balances on the Payments tab",
  DOCUMENTS_ALL_VERIFIED: "traveller documents on the Documents & Visa tab",
  VISAS_ALL_APPROVED: "the visa queue on the Documents & Visa tab",
  ROOMING_COMPLETE: "room assignments on the Hotels tab",
  GUIDE_ASSIGNED: "the primary guide on the Guide & Operations tab",
  MANIFEST_READY: "the manifest on the Pilgrims tab",
};

const STATUS_LABELS: Record<ReadinessItemStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  AT_RISK: "At Risk",
  BLOCKED: "Blocked",
  NOT_REQUIRED: "Not Required",
};

/**
 * Applies one edit to a readiness requirement.
 *
 * A single mutation backs every entry point on the Readiness tab — assign an
 * owner, move the due date, attach evidence, mark complete/blocked/not
 * required — because they all write the same row and must all land on the
 * activity trail the same way. Only the fields actually supplied are touched,
 * so "Mark Complete" from a row menu cannot silently clear the notes someone
 * else just wrote.
 */
export function updateReadinessItemInStore(
  data: DepartureGroupStore,
  input: UpdateReadinessItemInput,
  actor: GroupActor,
  now: string = new Date().toISOString(),
): UpdateReadinessItemOutcome {
  const item = data.readinessItems.find(
    (row) =>
      row.id === input.id && row.departure_group_id === input.departureGroupId,
  );
  if (!item) {
    return { ok: false, error: "That requirement is no longer on this group." };
  }

  const before = {
    status: item.status,
    assigned_to_name: item.assigned_to_name,
    due_at: item.due_at,
    evidence_url: item.evidence_url,
    required: item.required,
  };

  // A derived item reports what the hotel, flight, payment or document rows
  // actually say. Ticking it by hand would put the checklist back into
  // disagreement with the Overview — the exact failure `auto_source` exists to
  // end — so the status is refused while the owner, due date, notes and
  // scoping stay editable.
  if (
    item.auto_source !== null &&
    input.status !== undefined &&
    input.status !== item.status &&
    input.status !== "NOT_REQUIRED"
  ) {
    return {
      ok: false,
      error: `${item.label} is tracked automatically from ${AUTO_SOURCE_HINTS[item.auto_source]}. Update that instead — this item follows it.`,
    };
  }

  // A required item cannot be waved through as "Not Required" — that is what
  // the required flag is for, and flipping it is a separate, deliberate edit.
  if (
    input.status === "NOT_REQUIRED" &&
    item.required &&
    input.required !== false
  ) {
    return {
      ok: false,
      error: `${item.label} is a required item. Mark it optional first if it genuinely does not apply to this group.`,
    };
  }

  if (input.status !== undefined) item.status = input.status;
  if (input.assignedToName !== undefined) {
    item.assigned_to_name = input.assignedToName?.trim() || null;
  }
  if (input.dueAt !== undefined) item.due_at = input.dueAt;
  if (input.evidenceUrl !== undefined) {
    item.evidence_url = input.evidenceUrl?.trim() || null;
  }
  if (input.notes !== undefined) item.notes = input.notes?.trim() || null;
  if (input.required !== undefined) item.required = input.required;

  // Completion is a fact about who signed it off and when, so it is stamped
  // here rather than trusted from the client — and cleared again the moment the
  // item moves back out of Complete.
  if (item.status === "COMPLETE") {
    if (before.status !== "COMPLETE") {
      item.completed_at = now;
      item.completed_by = actor.id;
      item.completed_by_name = actor.name;
    }
  } else {
    item.completed_at = null;
    item.completed_by = null;
    item.completed_by_name = null;
  }

  const statusChanged = before.status !== item.status;
  const message = statusChanged
    ? `${item.label} moved to ${STATUS_LABELS[item.status]}.`
    : `${item.label} updated.`;

  data.activity.push({
    id: newId(),
    departure_group_id: input.departureGroupId,
    actor_id: actor.id,
    actor_name_snapshot: actor.name,
    action_type: statusChanged
      ? "READINESS_ITEM_STATUS_CHANGED"
      : "READINESS_ITEM_UPDATED",
    entity_type: "READINESS_ITEM",
    entity_id: item.id,
    before_value: before,
    after_value: {
      status: item.status,
      assigned_to_name: item.assigned_to_name,
      due_at: item.due_at,
      evidence_url: item.evidence_url,
      required: item.required,
    },
    message,
    is_system: false,
    // Blocking a requirement is what turns a group red on the Overview, so it
    // belongs in the high-impact feed; routine progress does not.
    is_high_impact:
      statusChanged &&
      (item.status === "BLOCKED" ||
        item.status === "AT_RISK" ||
        item.status === "NOT_REQUIRED"),
    created_at: now,
  });

  return {
    ok: true,
    result: {
      label: item.label,
      status: item.status,
      previousStatus: before.status,
    },
  };
}
