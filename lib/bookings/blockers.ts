/**
 * Per-booking blockers — plan §4.5 Copilot "identifyBlockers": code builds
 * this list (same posture as the group-level `buildBlockers` in
 * `lib/data/departure-groups.ts`, but scoped to one booking's own
 * travellers instead of a whole group's manifest); the AI layer
 * (`lib/ai/surfaces/bookings/workflows.ts`) only ever orders these into a
 * resolution sequence and narrates impact — it never invents a blocker.
 *
 * Cutoff windows (60/45/21 days) are placeholders pending an agency-
 * configurable cutoff setting, same posture as
 * `lib/quotes/signals.ts`'s discount-band default.
 */

export type BookingBlockerSeverity = "CRITICAL" | "WARNING";

export interface BookingBlocker {
  id: string;
  severity: BookingBlockerSeverity;
  message: string;
}

export interface BookingBlockerTravellerInput {
  fullName: string;
  passportNumber: string | null;
  visaStatus: string;
  roomAssignmentStatus: string;
  flightStatus: string;
}

export interface BookingBlockerInput {
  outstandingBalance: number;
  nextDueAt: string | null;
  primaryContactName: string;
  primaryContactPhone: string;
  departureDate: string | null;
  travellers: readonly BookingBlockerTravellerInput[];
}

const PASSPORT_WINDOW_DAYS = 60;
const VISA_CUTOFF_WINDOW_DAYS = 45;
const ALLOCATION_WINDOW_DAYS = 21;

// Matches `lib/types/departure-groups.ts`'s `PilgrimVisaStatus` — anything
// before SUBMITTED counts as "not yet submitted".
const VISA_NOT_SUBMITTED_STATES = new Set(["NOT_STARTED", "DOCUMENTS_PENDING", "READY_TO_SUBMIT"]);
const ROOM_UNASSIGNED_STATES = new Set(["UNASSIGNED"]);
const FLIGHT_UNTICKETED_STATES = new Set(["PENDING"]);

function daysUntil(dateIso: string | null, nowIso: string): number | null {
  if (!dateIso) return null;
  return Math.round((Date.parse(dateIso) - Date.parse(nowIso)) / 86_400_000);
}

/** True when there's an outstanding balance already past its next due date. */
export function isDepositOverdue(input: BookingBlockerInput, nowIso: string): boolean {
  if (input.outstandingBalance <= 0 || !input.nextDueAt) return false;
  return Date.parse(input.nextDueAt) < Date.parse(nowIso);
}

function travellersMissingPassport(input: BookingBlockerInput, nowIso: string): BookingBlockerTravellerInput[] {
  const days = daysUntil(input.departureDate, nowIso);
  if (days === null || days > PASSPORT_WINDOW_DAYS) return [];
  return input.travellers.filter((t) => !t.passportNumber);
}

function travellersWithVisaNotSubmitted(input: BookingBlockerInput, nowIso: string): BookingBlockerTravellerInput[] {
  const days = daysUntil(input.departureDate, nowIso);
  if (days === null || days > VISA_CUTOFF_WINDOW_DAYS) return [];
  return input.travellers.filter((t) => VISA_NOT_SUBMITTED_STATES.has(t.visaStatus));
}

function travellersWithoutAllocation(input: BookingBlockerInput, nowIso: string): BookingBlockerTravellerInput[] {
  const days = daysUntil(input.departureDate, nowIso);
  if (days === null || days > ALLOCATION_WINDOW_DAYS) return [];
  return input.travellers.filter((t) => ROOM_UNASSIGNED_STATES.has(t.roomAssignmentStatus) || FLIGHT_UNTICKETED_STATES.has(t.flightStatus));
}

/** True when the primary contact isn't one of the travellers, and there's no phone on file to reach them. */
export function isPayerMismatchWithoutContact(input: BookingBlockerInput): boolean {
  const normalise = (s: string) => s.trim().toLowerCase();
  const contactIsTraveller = input.travellers.some((t) => normalise(t.fullName) === normalise(input.primaryContactName));
  return !contactIsTraveller && input.primaryContactPhone.trim().length === 0;
}

export function identifyBookingBlockers(input: BookingBlockerInput, nowIso: string): BookingBlocker[] {
  const blockers: BookingBlocker[] = [];

  if (isDepositOverdue(input, nowIso)) {
    blockers.push({ id: "deposit-overdue", severity: "CRITICAL", message: "The next instalment is overdue." });
  }

  const missingPassport = travellersMissingPassport(input, nowIso);
  if (missingPassport.length > 0) {
    blockers.push({
      id: "passport-missing",
      severity: "CRITICAL",
      message: `${missingPassport.length} traveller${missingPassport.length === 1 ? "" : "s"} missing a passport number within ${PASSPORT_WINDOW_DAYS} days of departure.`,
    });
  }

  const visaNotSubmitted = travellersWithVisaNotSubmitted(input, nowIso);
  if (visaNotSubmitted.length > 0) {
    blockers.push({
      id: "visa-not-submitted",
      severity: "WARNING",
      message: `${visaNotSubmitted.length} traveller${visaNotSubmitted.length === 1 ? "" : "s"} with a visa not yet submitted within ${VISA_CUTOFF_WINDOW_DAYS} days of departure.`,
    });
  }

  const noAllocation = travellersWithoutAllocation(input, nowIso);
  if (noAllocation.length > 0) {
    blockers.push({
      id: "allocation-missing",
      severity: "WARNING",
      message: `${noAllocation.length} traveller${noAllocation.length === 1 ? "" : "s"} without a room or flight within ${ALLOCATION_WINDOW_DAYS} days of departure.`,
    });
  }

  if (isPayerMismatchWithoutContact(input)) {
    blockers.push({
      id: "payer-mismatch-no-contact",
      severity: "CRITICAL",
      message: "The paying contact is not a traveller on this booking, and no phone number is on file for them.",
    });
  }

  return blockers;
}
