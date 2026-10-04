/**
 * Row types for the Visa Operations module.
 *
 * `VisaApplicationRow` mirrors `public.visa_application_rows` (see
 * `supabase/migrations/20260815090000_visa_operations.sql`) — one row per
 * visa application (= one enrolment), already joined to the person, booking,
 * batch and group. Everything the Visa page renders is derived from this one
 * shape, the same way `DocumentQueueRow` anchors the Documents module.
 */

import type {
  DepartureGroupStatus,
  GroupJourneyType,
  PilgrimVisaStatus,
  SeatStatus,
} from "@/lib/types/departure-groups";

export type { PilgrimVisaStatus };

export interface VisaApplicationRow {
  journey_id: string;
  departure_group_id: string;
  booking_id: string;
  seat_status: SeatStatus;
  journey_status: string;
  visa_status: PilgrimVisaStatus;
  visa_type: string | null;
  visa_application_reference: string | null;
  visa_submitted_at: string | null;
  visa_reviewed_at: string | null;
  visa_rejected_at: string | null;
  visa_rejection_reason: string | null;
  visa_id: string | null;
  visa_issue_note: string | null;
  visa_file_path: string | null;
  visa_issue_date: string | null;
  visa_expiry_date: string | null;
  visa_valid_until: string | null;
  visa_entry_type: VisaEntryType | null;
  visa_verified_at: string | null;
  visa_verified_by_name: string | null;
  visa_evidence_source: string | null;
  visa_assigned_to: string | null;
  visa_assigned_to_name: string | null;
  visa_assigned_at: string | null;
  visa_batch_id: string | null;
  visa_status_checked_at: string | null;
  visa_last_update_at: string | null;
  visa_priority_score: number;
  documents_completed: number;
  documents_required: number;
  document_completion_percent: number;
  emergency_contact_status: string;
  enrolment_passport_expiry: string | null;

  pilgrim_id: string;
  pilgrim_reference: string;
  full_name: string;
  whatsapp_number: string;
  passport_number: string | null;
  date_of_birth: string | null;
  nationality: string | null;

  booking_reference: string;
  outstanding_balance: number;

  batch_reference: string | null;
  batch_sequence: number | null;
  batch_status: VisaBatchStatus | null;
  submission_deadline: string | null;
  batch_owner_name: string | null;

  group_id: string;
  group_name: string;
  group_code: string;
  journey_type: GroupJourneyType;
  departure_date: string;
  return_date: string;
  branch: string;
  group_status: DepartureGroupStatus;
  group_visa_owner_name: string | null;

  gating_outstanding: number;
  rejected_documents: number;
}

export type VisaEntryType = "SINGLE" | "MULTIPLE";

export type VisaBatchStatus = "DRAFT" | "SUBMITTED" | "PARTIALLY_RESOLVED" | "CLOSED" | "CANCELLED";

export interface VisaSubmissionBatchRow {
  id: string;
  departure_group_id: string;
  batch_reference: string;
  visa_type: string | null;
  sequence_number: number;
  status: VisaBatchStatus;
  owner_id: string | null;
  owner_name: string | null;
  submission_deadline: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export type VisaEventAction =
  | "READINESS_CHANGED"
  | "ASSIGNED"
  | "BATCH_ADDED"
  | "BATCH_REMOVED"
  | "REFERENCE_RECORDED"
  | "SUBMITTED"
  | "STATUS_CHECKED"
  | "MOVED_UNDER_REVIEW"
  | "REWORK_REQUESTED"
  | "RESUBMITTED"
  | "ISSUE_RECORDED"
  | "ISSUE_VERIFIED"
  | "ISSUE_AMENDED"
  | "REJECTED"
  | "EXPIRY_FLAGGED"
  | "REMINDER_DRAFTED"
  | "ESCALATED"
  | "NOTE_ADDED";

export interface VisaApplicationEventRow {
  id: string;
  journey_id: string;
  departure_group_id: string;
  batch_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  action: VisaEventAction;
  from_status: string | null;
  to_status: string | null;
  issue_type: string | null;
  note: string | null;
  evidence_path: string | null;
  created_at: string;
}

export type VisaIssueType =
  | "DOCUMENT_BLOCKER"
  | "PHOTO_REJECTED"
  | "NAME_MISMATCH"
  | "DOB_MISMATCH"
  | "PASSPORT_VALIDITY"
  | "PORTAL_ERROR"
  | "REFUSED"
  | "OTHER";

export type VisaEvidenceSource = "PORTAL_SCREENSHOT" | "AGENT_EMAIL" | "PDF" | "OTHER";
