/**
 * View models and UI-only types for the Documents Operations module.
 *
 * Row shapes live in `lib/types/documents.ts`; view models come from
 * `lib/data/documents.ts` and are re-exported here, so no component reaches
 * past this file into the data layer — same convention as
 * `app/(main)/pilgrims/types.ts`.
 */

export type {
  CriticalAlert,
  DocumentKpis,
  DocumentListItem,
  GroupDocumentBoard,
} from "@/lib/data/documents";
export type { DocumentCapabilities } from "@/lib/access/documents-access";
export type {
  AiRecommendedAction,
  AiVerdict,
  DocumentAiAnalysisRow,
  DocumentAiCheck,
  DocumentReviewEventRow,
  DocumentStage,
  DocumentStatus,
  DocumentType,
  ReworkReasonCode,
} from "@/lib/types/documents";

/* ── Work queue tabs ──────────────────────────────────────────────────────── */

export const DOCUMENT_QUEUES = [
  "All Documents",
  "Missing",
  "Awaiting Review",
  "AI Flagged",
  "Rework Required",
  "Verified",
  "Expiring Soon",
  "By Group",
] as const;

export type DocumentQueue = (typeof DOCUMENT_QUEUES)[number];

/* ── Saved views ──────────────────────────────────────────────────────────── */

export const DOCUMENT_SAVED_VIEWS = [
  "All",
  "My Review Queue",
  "Departing in 7 Days",
  "Visa Submission Ready",
  "Missing Passport Copies",
  "Passport Expiry Risk",
  "AI Low Confidence",
  "Rework Required",
  "Unassigned Documents",
] as const;

export type DocumentSavedView = (typeof DOCUMENT_SAVED_VIEWS)[number];

/* ── Filters ──────────────────────────────────────────────────────────────── */

export const ALL = "ALL";

export interface DocumentFilters {
  groupId: string;
  documentType: string;
  status: string;
  aiFinding: string;
  journeyType: string;
  assignedTo: string;
  branch: string;
}

export const EMPTY_DOCUMENT_FILTERS: DocumentFilters = {
  groupId: ALL,
  documentType: ALL,
  status: ALL,
  aiFinding: ALL,
  journeyType: ALL,
  assignedTo: ALL,
  branch: ALL,
};
