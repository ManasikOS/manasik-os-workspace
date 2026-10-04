/**
 * Consent & contactability — shared across `leads` and `pilgrims`.
 *
 * Keep in sync with
 * `supabase/migrations/20261012090000_consent_and_contactability.sql`.
 * `ConsentFields` is mixed into `LeadRow` and `PilgrimRow` rather than
 * duplicated — the columns and their meaning are identical on both tables.
 */

export type ConsentStatus = "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
export type ConsentChannel = "WHATSAPP" | "EMAIL" | "SMS" | "CALL";
export type ConsentEventAction = "OPT_IN" | "OPT_OUT" | "DNC_SET" | "DNC_CLEARED" | "CHANNELS_UPDATED";
export type ConsentSubjectType = "LEAD" | "PILGRIM";

/** Mixed into `LeadRow` / `PilgrimRow` — see supabase/migrations/20261012090000. */
export interface ConsentFields {
  consent_status: ConsentStatus;
  consent_source: string | null;
  consent_at: string | null;
  do_not_contact: boolean;
  contactable_channels: ConsentChannel[];
}

/** `consent_events` — append-only. */
export interface ConsentEventRow {
  id: string;
  subject_type: ConsentSubjectType;
  subject_id: string;
  action: ConsentEventAction;
  channel: ConsentChannel | null;
  source: string;
  note: string | null;
  actor_name: string;
  created_at: string;
}
