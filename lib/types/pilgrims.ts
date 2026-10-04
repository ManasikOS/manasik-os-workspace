/**
 * Hand-maintained row types for the pilgrims schema.
 *
 * Keep in sync with `supabase/migrations/20260813090000_create_pilgrims.sql`.
 * Same convention as `lib/types/departure-groups.ts`: snake_case, exactly the
 * shape a `select *` (or, for `PilgrimJourneyRow`, the `pilgrim_journey_rows`
 * view) returns.
 */

import type {
  DocumentStatus,
  EmergencyContactStatus,
  GroupJourneyType,
  PilgrimFlightStatus,
  PilgrimPaymentStatus,
  PilgrimVisaStatus,
  RoomAssignmentStatus,
  SeatStatus,
} from "@/lib/types/departure-groups";
import type { ConsentFields } from "@/lib/types/consent";

/* ── Enumerations ─────────────────────────────────────────────────────────── */

export type PilgrimGender = "MALE" | "FEMALE";

export type PilgrimContactChannel = "WHATSAPP" | "CALL" | "EMAIL" | "SMS" | "IN_PERSON";

export type PilgrimJourneyStatus =
  | "PENDING_DETAILS"
  | "ONBOARDING"
  | "DOCUMENTS_PENDING"
  | "VISA_PROCESSING"
  | "PAYMENT_PENDING"
  | "PREPARING"
  | "READY_TO_TRAVEL"
  | "TRAVELLED"
  | "COMPLETED"
  | "CANCELLED";

export type PilgrimRelationship = "SELF" | "SPOUSE" | "CHILD" | "PARENT" | "SIBLING" | "OTHER";

export type PilgrimSupportCategory =
  | "MOBILITY"
  | "MEDICAL"
  | "DIETARY"
  | "FLIGHT"
  | "ROOMING"
  | "DOCUMENT"
  | "PAYMENT"
  | "COMPLAINT"
  | "OTHER";

export type PilgrimSupportPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type SupportCaseEventType =
  | "COMMENT"
  | "STATUS_CHANGE"
  | "ESCALATED"
  | "REOPENED"
  | "SUPPLIER_LINKED"
  | "ATTACHMENT_ADDED"
  | "ATTACHMENT_REMOVED";

export type PilgrimSupportStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";

export type PilgrimActivityEntityType =
  | "PILGRIM"
  | "DOCUMENT"
  | "VISA"
  | "PAYMENT"
  | "ROOM"
  | "FLIGHT"
  | "SUPPORT"
  | "MEDICAL"
  | "PORTAL"
  | "NOTE"
  | "STATUS";

/* ── Tables ───────────────────────────────────────────────────────────────── */

/** A. `pilgrims` — the person, stable across every journey. */
export interface PilgrimRow extends ConsentFields {
  id: string;
  reference: string;

  full_name: string;
  preferred_name: string | null;
  gender: PilgrimGender;
  date_of_birth: string | null;
  nationality: string;
  national_id: string | null;
  country_of_residence: string;
  city: string;
  preferred_language: string;
  photo_path: string | null;

  whatsapp_number: string;
  mobile_number: string | null;
  email: string | null;
  preferred_channel: PilgrimContactChannel;

  passport_number: string | null;
  passport_expiry: string | null;
  passport_issue_country: string | null;

  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_alt_phone: string | null;

  origin_lead_id: string | null;
  portal_user_id: string | null;
  portal_invited_at: string | null;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** B. `pilgrim_medical_records` — optional, one row per person. */
export interface PilgrimMedicalRecordRow {
  pilgrim_id: string;
  mobility_support: boolean;
  wheelchair_required: boolean;
  dietary_requirement: string | null;
  allergy_information: string | null;
  medication_note: string | null;
  accessibility_note: string | null;
  special_assistance: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** C. `pilgrim_support_requests` */
export interface PilgrimSupportRequestRow {
  id: string;
  pilgrim_id: string;
  departure_group_id: string | null;
  title: string;
  detail: string | null;
  category: PilgrimSupportCategory;
  priority: PilgrimSupportPriority;
  status: PilgrimSupportStatus;
  assigned_role: string;
  raised_by_portal: boolean;
  created_at: string;
  resolved_at: string | null;
  sla_due_at: string | null;
  escalated_at: string | null;
  escalated_to_role: string | null;
  supplier_id: string | null;
}

/** One entry in a support case's own timeline — comments, status changes, escalations. Append-only. */
export interface SupportCaseEventRow {
  id: string;
  support_request_id: string;
  pilgrim_id: string;
  event_type: SupportCaseEventType;
  message: string;
  actor_name: string;
  created_at: string;
}

/** A photo/document attached to a support case. `file_path` is an object key in the `pilgrim-documents` bucket. */
export interface SupportCaseAttachmentRow {
  id: string;
  support_request_id: string;
  pilgrim_id: string;
  file_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: string;
}

/** D. `pilgrim_activity_logs` — append-only. */
export interface PilgrimActivityLogRow {
  id: string;
  pilgrim_id: string;
  departure_group_id: string | null;
  actor_id: string | null;
  actor_name_snapshot: string;
  actor_role: string | null;
  action_type: string;
  entity_type: PilgrimActivityEntityType;
  entity_id: string | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  message: string;
  is_system: boolean;
  is_sensitive_access: boolean;
  created_at: string;
}

/** E. `pilgrim_payment_milestones` */
export interface PilgrimPaymentMilestoneRow {
  id: string;
  pilgrim_id: string;
  booking_id: string;
  label: string;
  sequence: number;
  amount: number;
  due_at: string | null;
  paid_amount: number;
  paid_at: string | null;
  proof_path: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  note: string | null;
  created_at: string;
}

/**
 * H. `pilgrim_journey_rows` — a database view, not a table.
 *
 * One row per enrolment (a repeat traveller appears once per journey),
 * joining the person to their booking and departure group. This is what the
 * list and profile screens read; nothing here is written directly.
 */
export interface PilgrimJourneyRow {
  pilgrim_id: string;
  pilgrim_reference: string;
  full_name: string;
  preferred_name: string | null;
  gender: PilgrimGender;
  city: string;
  photo_path: string | null;
  whatsapp_number: string;
  mobile_number: string | null;
  email: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  national_id: string | null;
  date_of_birth: string | null;
  nationality: string;

  journey_id: string;
  journey_status: PilgrimJourneyStatus;
  seat_status: SeatStatus;
  flight_status: PilgrimFlightStatus;
  visa_status: PilgrimVisaStatus;
  visa_submitted_at: string | null;
  payment_status: PilgrimPaymentStatus;
  room_assignment_status: RoomAssignmentStatus;
  room_id: string | null;
  documents_completed: number;
  documents_required: number;
  document_completion_percent: number;
  relationship_to_primary: PilgrimRelationship;
  emergency_contact_status: EmergencyContactStatus;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;

  booking_id: string;
  booking_reference: string;
  primary_contact_name: string;
  primary_contact_phone: string;
  total_booking_value: number;
  amount_paid: number;
  outstanding_balance: number;
  next_due_at: string | null;

  departure_group_id: string;
  group_name: string;
  group_code: string;
  journey_type: GroupJourneyType;
  departure_date: string;
  return_date: string;
  branch: string;
  primary_guide_name: string | null;
}

export type { DocumentStatus };
