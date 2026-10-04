/**
 * Hand-maintained row types for the supplier directory schema.
 *
 * Keep in sync with `supabase/migrations/20260817090000_supplier_directory.sql`.
 * Same convention as `lib/types/pilgrims.ts` / `lib/types/visa.ts`: snake_case,
 * exactly the shape a `select *` (or, for `SupplierDirectoryRow`, the
 * `supplier_directory_rows` view) returns.
 */

/* ── Enumerations ─────────────────────────────────────────────────────────── */

export type SupplierType =
  | "BROKER"
  | "HOTEL"
  | "TRANSPORT"
  | "CATERING"
  | "TICKETING"
  | "VISA_PARTNER"
  | "INSURANCE"
  | "GUIDE_PARTNER"
  | "ZIYARAH"
  | "ANCILLARY"
  | "OTHER";

export type SupplierStatus = "ACTIVE" | "INACTIVE";

export type SupplierReliability = "RELIABLE" | "NEEDS_ATTENTION" | "ON_HOLD" | "INACTIVE";

export type SupplierCurrency = "SAR" | "LKR" | "USD" | "AED" | "OTHER";

export type SupplierPaymentTerms = "DEPOSIT_REQUIRED" | "PAY_AFTER_CONFIRMATION" | "CUSTOM";

export type SupplierPreferredChannel = "WHATSAPP" | "PHONE" | "EMAIL";

export type SupplierServiceCategory =
  | "MAKKAH_ACCOMMODATION"
  | "MADINAH_ACCOMMODATION"
  | "ACCOMMODATION_OTHER"
  | "AIRPORT_TRANSFER"
  | "INTERCITY_TRANSPORT"
  | "ZIYARAH_TRANSPORT"
  | "CATERING"
  | "TICKETING"
  | "VISA_SERVICE"
  | "INSURANCE"
  | "GUIDE_SERVICE"
  | "ANCILLARY"
  | "OTHER";

export type SupplierServiceSeason = "STANDARD" | "RAMADAN" | "HAJJ" | "PEAK" | "OTHER";

export type SupplierCommitmentStatus =
  | "DRAFT"
  | "REQUESTED"
  | "SUPPLIER_RESPONDED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "DISPUTED";

export type SupplierCommitmentLinkedEntityType = "ACCOMMODATION" | "TRANSPORT" | "FLIGHT";

export type SupplierCommitmentPaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";

export type SupplierActivityAction =
  | "SUPPLIER_CREATED"
  | "SUPPLIER_UPDATED"
  | "RELIABILITY_CHANGED"
  | "CONTACT_ADDED"
  | "CONTACT_UPDATED"
  | "COMMITMENT_CREATED"
  | "COMMITMENT_REQUESTED"
  | "SUPPLIER_RESPONDED"
  | "COMMITMENT_CONFIRMED"
  | "COMMITMENT_COMPLETED"
  | "COMMITMENT_CANCELLED"
  | "COMMITMENT_DISPUTED"
  | "EVIDENCE_UPLOADED"
  | "PAYMENT_RECORDED"
  | "PAYMENT_REFUNDED"
  | "NOTE_ADDED";

/* ── Tables ───────────────────────────────────────────────────────────────── */

/** A. `suppliers` — the reusable partner. */
export interface SupplierRow {
  id: string;
  supplier_code: string;
  name: string;
  supplier_type: SupplierType;
  status: SupplierStatus;
  reliability: SupplierReliability;
  reliability_reason: string | null;
  reliability_reviewed_at: string | null;
  reliability_reviewed_by: string | null;
  reliability_reviewed_by_name: string | null;
  city: string | null;
  country: string | null;
  currency: SupplierCurrency;
  payment_terms: SupplierPaymentTerms;
  payment_terms_note: string | null;
  lead_time_days: number | null;
  preferred_channel: SupplierPreferredChannel | null;
  internal_notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** B. `supplier_services` — capabilities and internal-only rate references. */
export interface SupplierServiceRow {
  id: string;
  supplier_id: string;
  category: SupplierServiceCategory;
  typical_service: string | null;
  typical_rate: number | null;
  rate_currency: SupplierCurrency | null;
  rate_unit: string | null;
  season: SupplierServiceSeason | null;
  notes: string | null;
}

/** C. `supplier_contacts` */
export interface SupplierContactRow {
  id: string;
  supplier_id: string;
  name: string;
  role_title: string | null;
  whatsapp_number: string | null;
  phone_number: string | null;
  email: string | null;
  languages: string | null;
  is_primary: boolean;
  is_emergency: boolean;
  preferred_time_from: string | null;
  preferred_time_to: string | null;
  timezone: string | null;
  notes: string | null;
  created_at: string;
}

/** D. `supplier_commitments` — one supplier promise to one Departure Group. */
export interface SupplierCommitmentRow {
  id: string;
  supplier_id: string;
  departure_group_id: string;
  reference_code: string;
  service_category: SupplierServiceCategory;
  service_label: string;
  service_details: string | null;
  service_start_date: string | null;
  service_end_date: string | null;
  booking_reference: string | null;
  status: SupplierCommitmentStatus;
  linked_entity_type: SupplierCommitmentLinkedEntityType | null;
  linked_entity_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  amount: number | null;
  currency: SupplierCurrency;
  payment_terms_note: string | null;
  amount_paid: number;
  payment_due_at: string | null;
  evidence_path: string | null;
  evidence_uploaded_at: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** E. `supplier_payments` — a thin ledger against a commitment. */
export interface SupplierPaymentRow {
  id: string;
  commitment_id: string;
  amount: number;
  currency: SupplierCurrency;
  paid_at: string;
  method: string | null;
  reference: string | null;
  document_path: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

/** F. `supplier_activity_events` — append-only. */
export interface SupplierActivityEventRow {
  id: string;
  supplier_id: string;
  commitment_id: string | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  action: SupplierActivityAction;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  is_high_impact: boolean;
  created_at: string;
}

/**
 * H. `supplier_directory_rows` — a database view, not a table. One row per
 * supplier with commitment aggregates and the primary contact folded in. This
 * is what the directory list reads; nothing here is written directly.
 */
export interface SupplierDirectoryRow extends SupplierRow {
  active_group_count: number;
  confirmed_count: number;
  pending_count: number;
  issue_count: number;
  outstanding_amount: number;
  next_payment_due_at: string | null;
  service_categories: string | null;
  primary_contact_name: string | null;
  primary_contact_whatsapp: string | null;
  primary_contact_phone: string | null;
}
