/**
 * Row types for the Documents Operations module.
 *
 * `DocumentQueueRow` mirrors `public.document_queue_rows` (see
 * `supabase/migrations/20260814090000_documents_operations.sql`) — one row
 * per document requirement per pilgrim, already joined to the person and the
 * group it blocks. Everything the Documents page renders is derived from this
 * one shape, the same way `PilgrimJourneyRow` anchors the Pilgrims module.
 */

import type {
  DocumentStage,
  DocumentStatus,
  DocumentType,
  GroupJourneyType,
  PilgrimVisaStatus,
  ResponsibleRole,
  SeatStatus,
} from "@/lib/types/departure-groups";

export type { DocumentStage, DocumentStatus, DocumentType, ResponsibleRole };

export interface DocumentQueueRow {
  document_id: string;
  departure_group_id: string;
  requirement_id: string;
  name: string;
  category: string;
  document_type: DocumentType;
  required: boolean;
  required_by_stage: DocumentStage;
  verified_by_role: ResponsibleRole;
  status: DocumentStatus;
  file_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  rejection_reason: string | null;
  notes: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by_name: string | null;
  due_at: string | null;
  expires_at: string | null;
  visible_in_portal: boolean;
  last_activity_at: string;
  priority_score: number;
  assigned_to: string | null;
  assigned_to_name: string | null;
  ai_verdict: AiVerdict | null;
  ai_confidence: number | null;
  ai_analysis_id: string | null;

  pilgrim_id: string;
  pilgrim_reference: string;
  full_name: string;
  whatsapp_number: string;
  passport_number: string | null;
  passport_expiry: string | null;

  journey_id: string;
  seat_status: SeatStatus;
  visa_status: PilgrimVisaStatus;
  journey_status: string;
  documents_completed: number;
  documents_required: number;
  document_completion_percent: number;

  group_id: string;
  group_name: string;
  group_code: string;
  journey_type: GroupJourneyType;
  departure_date: string;
  return_date: string;
  branch: string;
  group_status: string;
}

export type AiVerdict = "PASS" | "WARNING" | "BLOCKED" | "ERROR";
export type AiAnalysisStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "SKIPPED";
export type AiRecommendedAction =
  | "VERIFY"
  | "REQUEST_BETTER_COPY"
  | "REJECT"
  | "MANUAL_REVIEW"
  | "NOT_APPLICABLE";

export interface DocumentAiCheck {
  code: string;
  label: string;
  outcome: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export interface DocumentAiAnalysisRow {
  id: string;
  document_id: string;
  file_path: string;
  file_checksum: string | null;
  model_id: string;
  pipeline_version: string;
  status: AiAnalysisStatus;
  detected_type: DocumentType | null;
  type_confidence: number | null;
  verdict: "PENDING" | AiVerdict;
  confidence: number | null;
  recommended_action: AiRecommendedAction | null;
  recommendation_reason: string | null;
  extracted: Record<string, unknown>;
  checks: DocumentAiCheck[];
  drafted_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export type DocumentReviewAction =
  | "REQUESTED"
  | "UPLOADED"
  | "AI_ANALYSED"
  | "ASSIGNED"
  | "DRAFT_SAVED"
  | "VERIFIED"
  | "REJECTED"
  | "REWORK_REQUESTED"
  | "WAIVED"
  | "REMINDER_SENT"
  | "AI_OVERRIDDEN"
  | "EXPIRY_FLAGGED";

export interface DocumentReviewEventRow {
  id: string;
  document_id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  action: DocumentReviewAction;
  from_status: string | null;
  to_status: string | null;
  reason_code: string | null;
  note: string | null;
  overrode_ai_analysis_id: string | null;
  override_reason: string | null;
  created_at: string;
}

export type ReworkReasonCode =
  | "BLURRED"
  | "EXPIRY_INSUFFICIENT"
  | "MISSING_PAGE"
  | "NAME_MISMATCH"
  | "OTHER";
