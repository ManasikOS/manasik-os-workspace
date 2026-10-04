/**
 * View models and UI-only types for the Pilgrims module.
 *
 * Row shapes live in `lib/types/pilgrims.ts`; the view models components
 * render come from `lib/data/pilgrims.ts` and are re-exported here, so no
 * component reaches past this file into the data layer — same convention as
 * `app/(main)/leads/types.ts`.
 */

export type {
  PilgrimActivityItem,
  PilgrimListItem,
  PilgrimListKpis,
  PilgrimProfile,
} from "@/lib/data/pilgrims";
export type { NextAction } from "@/lib/data/pilgrims-readiness";
export type {
  PilgrimContactChannel,
  PilgrimGender,
  PilgrimJourneyStatus,
  PilgrimRelationship,
  PilgrimSupportCategory,
  PilgrimSupportPriority,
  PilgrimSupportRequestRow,
} from "@/lib/types/pilgrims";
export type {
  DocumentStatus,
  GroupJourneyType,
  PilgrimFlightStatus,
  PilgrimPaymentStatus,
  PilgrimVisaStatus,
  RoomAssignmentStatus,
  SeatStatus,
} from "@/lib/types/departure-groups";

/* ── Saved views ──────────────────────────────────────────────────────────── */

export const PILGRIM_SAVED_VIEWS = [
  "All Active Pilgrims",
  "My Group Pilgrims",
  "Documents Missing",
  "Visa Pending",
  "Visa Rework Required",
  "Payments Overdue",
  "Rooming Incomplete",
  "Flight Ticket Pending",
  "Ready to Travel",
  "Departing in 14 Days",
  "Cancelled / Replaced",
] as const;

export type PilgrimSavedView = (typeof PILGRIM_SAVED_VIEWS)[number];

/* ── Filters ──────────────────────────────────────────────────────────────── */

export const ALL = "ALL";

export interface PilgrimFilters {
  departureGroupId: string;
  journeyType: string;
  documentStatus: string;
  visaStatus: string;
  paymentStatus: string;
  readiness: string;
  roomAssignment: string;
  flightStatus: string;
  branch: string;
}

export const EMPTY_PILGRIM_FILTERS: PilgrimFilters = {
  departureGroupId: ALL,
  journeyType: ALL,
  documentStatus: ALL,
  visaStatus: ALL,
  paymentStatus: ALL,
  readiness: ALL,
  roomAssignment: ALL,
  flightStatus: ALL,
  branch: ALL,
};

export type PilgrimQuickFilter =
  | "documentsPending"
  | "visaIssues"
  | "paymentAttention"
  | "readyToTravel";
