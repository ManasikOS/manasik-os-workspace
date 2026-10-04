/**
 * Hand-maintained row types for the Agency Settings schema.
 *
 * Keep these in sync with `supabase/migrations/20260821090000_agency_settings.sql`.
 * Same convention as `lib/types/team.ts` / `lib/types/suppliers.ts`: snake_case,
 * exactly the shape a `select *` (or, for the two views, the view itself) returns.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";

/* ── A. branches ──────────────────────────────────────────────────────────── */

export type BranchStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface BranchRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  manager_id: string | null;
  manager_name: string | null;
  default_currency: string;
  status: BranchStatus;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

/** `branch_directory_rows` — a database view, not a table. */
export interface BranchDirectoryRow extends BranchRow {
  staff_count: number;
  active_group_count: number;
}

export type BranchWritable = Pick<
  BranchRow,
  "name" | "code" | "address" | "phone" | "email" | "manager_id" | "manager_name" | "default_currency" | "status" | "is_primary"
>;

/* ── B. agency_settings ───────────────────────────────────────────────────── */

export interface PortalFlags {
  allowDocumentUploads: boolean;
  allowViewPaymentSchedule: boolean;
  allowUploadPaymentProof: boolean;
  showItineraryAfterConfirmation: boolean;
  showHotelDetailsAfterConfirmation: boolean;
  showGuideContact7DaysBefore: boolean;
  allowSupportRequests: boolean;
}

export interface CriticalFlags {
  missingFlightsIsCritical: boolean;
  missingHotelConfirmationIsCritical: boolean;
  pendingVisaWithin7DaysIsCritical: boolean;
  overduePaymentsIsHighPriority: boolean;
}

export interface BranchRules {
  restrictStaffToAssignedBranch: boolean;
  allowAdminViewAllBranches: boolean;
  allowCeoViewAllBranches: boolean;
  /** Read-only in V1 — see the Settings plan §5.2. No enforcement point exists yet. */
  allowCrossBranchBookingManagement: boolean;
}

export interface AccessRestrictionFlags {
  restrictGuidesToAssignedGroups: boolean;
  restrictMarketingFromPassportVisaData: boolean;
  restrictGuidesFromFinanceData: boolean;
  restrictFinanceFromMedicalRecords: boolean;
}

export interface AgencySettingsRow {
  id: string;
  singleton: true;

  // Organisation
  agency_name: string;
  legal_name: string | null;
  registration_number: string | null;
  default_country: string;
  default_currency: string;
  timezone: string;
  default_language: string;
  supported_languages: string[];
  primary_email: string | null;
  primary_whatsapp: string | null;
  office_address: string | null;

  // Branding & pilgrim portal
  logo_path: string | null;
  portal_primary_colour: string;
  portal_secondary_colour: string | null;
  portal_welcome_message: string | null;
  portal_support_whatsapp: string | null;
  portal_support_email: string | null;
  website_url: string | null;
  terms_url: string | null;
  invoice_footer: string;
  portal_flags: PortalFlags;

  // Operational defaults
  default_group_capacity: number;
  minimum_group_size: number;
  default_seat_hold_hours: number;
  default_guide_ratio: number;
  default_group_status: string;
  default_sales_status: string;
  waitlists_enabled_by_default: boolean;
  readiness_ready_threshold: number;
  readiness_at_risk_threshold: number;
  critical_flags: CriticalFlags;
  passport_validity_months: number;
  passport_photo_requirement: string;
  document_reminder_days: number;
  document_rework_deadline_hours: number;
  visa_escalation_days: number;
  require_document_verification: boolean;
  require_visa_verification: boolean;

  // Branch rules
  branch_rules: BranchRules;

  // Finance defaults
  supported_currencies: string[];
  invoice_prefix: string;
  receipt_prefix: string;
  payment_prefix: string;
  supplier_bill_prefix: string;
  default_payment_terms: string;
  enabled_payment_methods: string[];
  tax_config: Record<string, unknown> | null;
  auto_generate_receipt: boolean;
  require_bank_proof: boolean;
  margin_visible_roles: StaffRole[];

  // Security & access defaults
  default_staff_role: StaffRole;
  require_account_approval: boolean;
  seasonal_auto_expiry_enabled: boolean;
  seasonal_expiry_days: number;
  session_idle_timeout_minutes: number;
  access_restriction_flags: AccessRestrictionFlags;

  // Data retention
  document_retention_years: number;
  archived_group_retention_years: number;
  deactivated_user_retention_years: number;
  immutable_finance_history: boolean;
  keep_document_verification_history: boolean;

  // Danger zone state
  portal_active: boolean;

  created_at: string;
  updated_at: string;
}

/* ── C. message_templates ─────────────────────────────────────────────────── */

export const TEMPLATE_CATEGORIES = [
  "LEAD_RECEIVED",
  "FIRST_FOLLOW_UP",
  "PACKAGE_QUOTATION",
  "BOOKING_CONFIRMATION",
  "DEPOSIT_REMINDER",
  "PAYMENT_DUE_REMINDER",
  "MISSING_DOCUMENT_REMINDER",
  "DOCUMENT_REWORK_REQUEST",
  "VISA_STATUS_UPDATE",
  "VISA_APPROVED",
  "PRE_DEPARTURE_BRIEFING",
  "GUIDE_CONTACT_MESSAGE",
  "DEPARTURE_REMINDER",
  "POST_TRIP_FEEDBACK_REQUEST",
  "REFUND_UPDATE",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateChannel = "WHATSAPP" | "EMAIL" | "PORTAL" | "SMS";
export type TemplateAudience = "LEAD" | "BOOKING_CONTACT" | "PILGRIM" | "GROUP" | "STAFF";

export interface MessageTemplateRow {
  id: string;
  category: TemplateCategory;
  name: string;
  channel: TemplateChannel;
  audience: TemplateAudience;
  subject: string | null;
  body: string;
  language: string;
  is_active: boolean;
  requires_approval: boolean;
  assigned_roles: StaffRole[];
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export type MessageTemplateWritable = Pick<
  MessageTemplateRow,
  "category" | "name" | "channel" | "audience" | "subject" | "body" | "language" | "is_active" | "assigned_roles"
>;

/* ── D. integration_connections ───────────────────────────────────────────── */

export type IntegrationProvider =
  | "WHATSAPP_BUSINESS"
  | "EMAIL"
  | "SMS"
  | "PAYMENT_GATEWAY"
  | "FILE_STORAGE"
  | "ACCOUNTING"
  | "NUSUK";

export type IntegrationStatus = "NOT_CONNECTED" | "CONNECTED" | "MANUAL_WORKFLOW" | "ERROR" | "DISCONNECTED";

export interface IntegrationConnectionRow {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  connected_account: string | null;
  scopes: string[];
  credential_hint: string | null;
  notes: string | null;
  last_sync_at: string | null;
  connected_at: string | null;
  connected_by: string | null;
  connected_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/* ── E. settings_activity_logs ────────────────────────────────────────────── */

export interface SettingsActivityLogRow {
  id: string;
  actor_id: string | null;
  actor_name_snapshot: string;
  section: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_value: unknown;
  after_value: unknown;
  message: string;
  created_at: string;
}

/* ── F. audit_log_rows — a database view, not a table. ───────────────────── */

export type AuditLogSource = "GROUP" | "PILGRIM" | "STAFF" | "SETTINGS";

export interface AuditLogRow {
  source: AuditLogSource;
  actor_id: string | null;
  actor_name_snapshot: string;
  action: string;
  entity_type: string;
  entity_label: string;
  before_value: unknown;
  after_value: unknown;
  branch: string | null;
  created_at: string;
}
