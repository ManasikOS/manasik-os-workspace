/**
 * Journey-status derivation and the Overview tab's "Next actions" list.
 *
 * `journey_status` is a hybrid: derived here from documents / visa / payment /
 * rooming, but persisted on `departure_group_pilgrims.journey_status` so the
 * list can filter and index on it. This is the one function that computes it —
 * called from `syncPilgrimJourneyStatus` after any mutation that could move it.
 */

import type { PilgrimJourneyRow, PilgrimJourneyStatus } from "@/lib/types/pilgrims";

const MS_PER_DAY = 86_400_000;

export function daysUntil(iso: string, nowIso: string): number {
  return Math.round((Date.parse(iso) - Date.parse(nowIso)) / MS_PER_DAY);
}

/**
 * Precedence, first match wins — mirrors the table in the implementation plan.
 */
export function derivePilgrimJourneyStatus(
  journey: Pick<
    PilgrimJourneyRow,
    | "seat_status"
    | "departure_date"
    | "return_date"
    | "documents_completed"
    | "documents_required"
    | "visa_status"
    | "payment_status"
    | "outstanding_balance"
    | "room_assignment_status"
    | "flight_status"
  >,
  nowIso: string,
): PilgrimJourneyStatus {
  if (journey.seat_status === "CANCELLED") return "CANCELLED";

  const departed = Date.parse(journey.departure_date) < Date.parse(nowIso);
  const returned = Date.parse(journey.return_date) < Date.parse(nowIso);
  if (returned) return "COMPLETED";
  if (departed) return "TRAVELLED";

  const docsComplete =
    journey.documents_required === 0 || journey.documents_completed >= journey.documents_required;
  const visaApproved = journey.visa_status === "APPROVED";
  const paidInFull = journey.outstanding_balance <= 0;
  const roomReady = journey.room_assignment_status !== "UNASSIGNED";
  const ticketed = journey.flight_status === "TICKETED";

  if (docsComplete && visaApproved && paidInFull && roomReady && ticketed) {
    return "READY_TO_TRAVEL";
  }
  if (visaApproved && paidInFull) return "PREPARING";
  if (visaApproved && !paidInFull) return "PAYMENT_PENDING";
  if (["SUBMITTED", "UNDER_REVIEW", "REWORK_REQUIRED", "REJECTED"].includes(journey.visa_status)) {
    return "VISA_PROCESSING";
  }
  if (!docsComplete) return "DOCUMENTS_PENDING";
  if (journey.documents_completed > 0 || journey.visa_status === "READY_TO_SUBMIT") {
    return "ONBOARDING";
  }
  return "PENDING_DETAILS";
}

export interface NextAction {
  id: string;
  tone: "danger" | "warning" | "info";
  label: string;
  dueLabel: string;
  actionLabel: string;
  targetTab: "documents" | "visa" | "payments" | "travel";
}

/** The Overview tab's ranked "what must happen next" list for one journey. */
export function nextActionsFor(
  journey: PilgrimJourneyRow,
  nowIso: string,
): NextAction[] {
  const actions: NextAction[] = [];
  const daysToDeparture = daysUntil(journey.departure_date, nowIso);
  const urgent = daysToDeparture <= 14;

  if (journey.documents_required > 0 && journey.documents_completed < journey.documents_required) {
    const missing = journey.documents_required - journey.documents_completed;
    actions.push({
      id: "documents",
      tone: urgent ? "danger" : "warning",
      label: `${missing} document${missing === 1 ? "" : "s"} still missing`,
      dueLabel: urgent ? "Due before departure" : "Outstanding",
      actionLabel: "Request document",
      targetTab: "documents",
    });
  }

  if (
    journey.visa_status === "NOT_STARTED" ||
    journey.visa_status === "DOCUMENTS_PENDING" ||
    journey.visa_status === "REWORK_REQUIRED" ||
    journey.visa_status === "REJECTED"
  ) {
    actions.push({
      id: "visa",
      tone: journey.visa_status === "REJECTED" ? "danger" : "warning",
      label:
        journey.visa_status === "REJECTED"
          ? "Visa was rejected — rework required"
          : journey.visa_status === "REWORK_REQUIRED"
            ? "Visa needs rework before resubmission"
            : "Visa application not yet started",
      dueLabel: "Blocks travel",
      actionLabel: "Open visa",
      targetTab: "visa",
    });
  }

  if (journey.outstanding_balance > 0) {
    const overdue = journey.next_due_at ? Date.parse(journey.next_due_at) < Date.parse(nowIso) : false;
    actions.push({
      id: "payment",
      tone: overdue ? "danger" : "warning",
      label: `LKR ${journey.outstanding_balance.toLocaleString("en-US")} outstanding`,
      dueLabel: overdue ? "Overdue" : "Due before departure",
      actionLabel: "Send payment reminder",
      targetTab: "payments",
    });
  }

  if (journey.room_assignment_status === "UNASSIGNED" && journey.visa_status !== "REJECTED") {
    actions.push({
      id: "room",
      tone: "info",
      label: "Room not yet assigned",
      dueLabel: "Group rooming incomplete",
      actionLabel: "Open rooming",
      targetTab: "travel",
    });
  }

  if (journey.flight_status !== "TICKETED" && journey.flight_status !== "CANCELLED") {
    actions.push({
      id: "flight",
      tone: urgent ? "danger" : "info",
      label: "Flight not yet ticketed",
      dueLabel: urgent ? "Departure is close" : "Pending ticketing",
      actionLabel: "Open travel",
      targetTab: "travel",
    });
  }

  return actions;
}
