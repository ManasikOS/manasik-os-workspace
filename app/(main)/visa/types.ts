/**
 * View models and UI-only types for the Visa Operations module.
 *
 * Row shapes live in `lib/types/visa.ts`; view models come from
 * `lib/data/visa.ts` and are re-exported here, so no component reaches past
 * this file into the data layer — same convention as
 * `app/(main)/documents/types.ts`.
 */

export type {
  GroupVisaBoard,
  VisaAlert,
  VisaKpis,
  VisaListItem,
  VisaRiskBand,
  VisaValidityState,
} from "@/lib/data/visa";
export type { VisaCapabilities } from "@/lib/access/visa-access";
export type {
  VisaApplicationEventRow,
  VisaBatchStatus,
  VisaEntryType,
  VisaEvidenceSource,
  VisaEventAction,
  VisaIssueType,
  VisaSubmissionBatchRow,
} from "@/lib/types/visa";

/* ── Work queue tabs ──────────────────────────────────────────────────────── */

export const VISA_QUEUES = [
  "All Applications",
  "Ready to Submit",
  "Submitted",
  "Under Review",
  "Issued",
  "Rework Required",
  "Rejected",
  "Expiring / Validity Risk",
  "By Group",
] as const;

export type VisaQueue = (typeof VISA_QUEUES)[number];

/* ── Saved views ──────────────────────────────────────────────────────────── */

export const VISA_SAVED_VIEWS = [
  "All",
  "My Visa Queue",
  "Ready to Submit Today",
  "Departing in 7 Days",
  "Submitted but Unresolved",
  "Visa Rework Required",
  "Rejected Applications",
  "Visa Validity Risk",
] as const;

export type VisaSavedView = (typeof VISA_SAVED_VIEWS)[number];

/* ── Filters ──────────────────────────────────────────────────────────────── */

export const ALL = "ALL";

export interface VisaFilters {
  groupId: string;
  visaStatus: string;
  journeyType: string;
  visaType: string;
  batchId: string;
  assignedTo: string;
  branch: string;
}

export const EMPTY_VISA_FILTERS: VisaFilters = {
  groupId: ALL,
  visaStatus: ALL,
  journeyType: ALL,
  visaType: ALL,
  batchId: ALL,
  assignedTo: ALL,
  branch: ALL,
};
