/**
 * Row shapes for the Leads module.
 *
 * These mirror the `leads` / `lead_activity` / `lead_notes` / `lead_quotes` /
 * `lead_sources` tables created by
 * `supabase/migrations/20260812100000_create_leads.sql`. Components never see
 * them — `lib/data/leads.ts` maps rows to the view models in
 * `app/(main)/leads/types.ts`.
 *
 * Everything that a screen might want to sort, filter or total is stored as a
 * machine value: timestamps as ISO-8601 strings, money as an integer number of
 * rupees, party size as two counts. The formatted strings the old table stored
 * ("Tomorrow, 10:00 AM", "LKR 5.2M") are derived at render time instead, so a
 * lead's follow-up can actually become overdue while the app is open.
 */

import type {
  CopilotSuggestionType,
  OccupancyType,
  QuoteMilestone,
  QuoteStatus,
  ReasoningSource,
  ReplyLanguage,
  ReplyPurpose,
  ReplyTone,
  SelectedOfferSnapshot,
  TravelIntent,
} from "@/lib/copilot/sales/types";
import type { ConsentFields } from "@/lib/types/consent";
import type { AttributionType } from "@/lib/types/campaigns";

export type LeadStage =
  | "NEW_LEAD"
  | "CONTACTED"
  | "QUALIFIED"
  | "PROPOSAL_SENT"
  | "NEGOTIATION"
  | "DEPOSIT_PENDING"
  | "BOOKED"
  | "LOST"
  | "POSTPONED"
  | "DUPLICATE"
  | "SPAM";

/**
 * Stages a lead can no longer progress from without a deliberate reopen.
 * `POSTPONED` / `DUPLICATE` / `SPAM` are terminal in the sense the spec
 * describes them ("terminal states") but — unlike `BOOKED` / `LOST` — remain
 * reachable back into the working pipeline.
 */
export const CLOSED_STAGES: readonly LeadStage[] = [
  "BOOKED",
  "LOST",
  "POSTPONED",
  "DUPLICATE",
  "SPAM",
];

/**
 * The one set of display labels for `LeadStage`, shared by the Leads module
 * (`app/(main)/leads/utils.ts` re-exports this as `STAGE_LABELS`) and the
 * Sales & Leads report (`lib/data/reports-sales.ts`) — the two used to carry
 * separate copies that disagreed ("New Lead" vs "New Leads").
 */
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW_LEAD: "New Lead",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL_SENT: "Proposal Sent",
  NEGOTIATION: "Negotiation",
  DEPOSIT_PENDING: "Deposit Pending",
  BOOKED: "Booked",
  LOST: "Lost",
  POSTPONED: "Postponed",
  DUPLICATE: "Duplicate",
  SPAM: "Spam / Invalid",
};

export type LeadJourneyType = "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";

export type LeadSource =
  | "WHATSAPP"
  | "PHONE_CALL"
  | "WALK_IN"
  | "FACEBOOK"
  | "INSTAGRAM"
  | "WEBSITE"
  | "GOOGLE"
  | "REFERRAL"
  | "REPEAT_CUSTOMER"
  | "COMMUNITY_EVENT"
  | "OTHER";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

export type LeadRoomPreference = "QUAD" | "TRIPLE" | "DOUBLE" | "SINGLE" | "UNDECIDED";

export type LeadContactChannel = "WHATSAPP" | "CALL" | "EMAIL" | "SMS" | "IN_PERSON" | "INSTAGRAM" | "MESSENGER";

export type FollowUpType =
  | "CALL"
  | "WHATSAPP_MESSAGE"
  | "SEND_QUOTE"
  | "SEND_BROCHURE"
  | "IN_PERSON_VISIT"
  | "DEPOSIT_REMINDER";

export type LeadLostReason =
  | "PRICE_TOO_HIGH"
  | "DATE_UNAVAILABLE"
  | "NO_SEATS"
  | "COMPETITOR"
  | "VISA_CONCERN"
  | "NO_RESPONSE"
  | "POSTPONED_TRAVEL"
  | "PAYMENT_ISSUE"
  | "DUPLICATE"
  | "OTHER";

/**
 * Derived, never stored: comparing a stored status against the clock is how
 * lists go stale. `lib/data/leads.ts` computes this from `next_follow_up_at`.
 */
export type FollowUpStatus =
  | "OVERDUE"
  | "TODAY"
  | "UPCOMING"
  | "COMPLETED"
  | "NONE";

export type LeadActivityType =
  | "CREATED"
  | "IMPORTED"
  | "STAGE_CHANGED"
  | "ASSIGNED"
  | "CONTACT_LOGGED"
  | "FOLLOW_UP_SCHEDULED"
  | "FOLLOW_UP_COMPLETED"
  | "NOTE_ADDED"
  | "PACKAGE_SUGGESTED"
  | "GROUP_SELECTED"
  | "QUOTE_SENT"
  | "DEPOSIT_REQUESTED"
  | "BOOKING_CREATED"
  | "LOST"
  | "POSTPONED"
  | "REOPENED"
  | "MERGED"
  /* Manasik Sales Intelligence — meaningful human actions only. */
  | "ENQUIRY_ANALYSED"
  | "INTENT_APPLIED"
  | "OFFERS_BUILT"
  | "OFFERS_COMPARED"
  | "REPLY_DRAFTED"
  | "REPLY_DRAFT_SAVED"
  | "QUOTE_DRAFTED"
  | "QUOTE_STATUS_CHANGED"
  | "CONSENT_UPDATED"
  | "ALERT_DISMISSED";

export interface StaffRow {
  id: string;
  name: string;
  initials: string;
}

export interface LeadPackageRow {
  id: string;
  name: string;
  journey_type: LeadJourneyType;
  currency: string;
  quad_price: number | null;
  triple_price: number | null;
  double_price: number | null;
  single_price: number | null;
  /** Fallback used only when every room price above is null. */
  price_per_person_lkr: number;
}

export interface LeadSourceRow {
  id: string;
  code: LeadSource;
  label: string;
  active: boolean;
  sort_order: number;
}

export interface LeadRow extends ConsentFields {
  id: string;
  /** Human-facing identifier shown in the UI, e.g. `LD-2026-0007`. */
  reference: string;

  full_name: string;
  /** Local subscriber number without the country code, digits only. */
  mobile: string;
  email: string | null;
  city: string;
  preferred_language: string;
  preferred_channel: LeadContactChannel;

  journey_type: LeadJourneyType;
  interested_in: string;
  desired_package_id: string | null;
  /** Snapshot of the package name so a renamed package cannot rewrite history. */
  desired_package_name: string | null;
  preferred_period: string;
  adults: number;
  children: number;
  room_preference: LeadRoomPreference;
  departure_city: string;
  budget_range: string;
  quota_waitlist_interest: boolean;

  source: LeadSource;
  campaign_reference: string | null;
  campaign_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  attribution_type: AttributionType;
  referral_name: string | null;
  assigned_to_id: string;
  assigned_to_name: string;
  stage: LeadStage;
  temperature: LeadTemperature;

  /** Whole rupees. Derived at creation, editable afterwards. */
  estimated_value_lkr: number;

  selected_departure_group_id: string | null;
  booking_id: string | null;

  next_follow_up_at: string | null;
  follow_up_type: FollowUpType | null;
  follow_up_owner_id: string | null;
  follow_up_owner_name: string | null;
  follow_up_attempts: number;
  first_response_at: string | null;

  last_contacted_at: string | null;

  lost_reason: LeadLostReason | null;
  lost_note: string | null;
  postponed_until: string | null;
  duplicate_of_lead_id: string | null;
  duplicate_override_reason: string | null;

  created_at: string;
  updated_at: string;
}

export interface LeadActivityRow {
  id: string;
  lead_id: string;
  type: LeadActivityType;
  message: string;
  actor_name: string;
  created_at: string;
}

export interface LeadNoteRow {
  id: string;
  lead_id: string;
  body: string;
  author_name: string;
  created_at: string;
}

export interface LeadQuotePricingSnapshot {
  currency: string;
  roomPricePerPerson: number;
  depositPerPerson: number;
  paymentMilestones: { label: string; amount: number; dueRule: string }[];
  packageName: string;
  groupLabel: string | null;
  groupDates: string | null;
}

export interface LeadQuoteRow {
  id: string;
  lead_id: string;
  reference: string;
  package_id: string | null;
  departure_group_id: string | null;
  pricing_snapshot: LeadQuotePricingSnapshot;
  adults: number;
  children: number;
  room_preference: LeadRoomPreference;
  total_lkr: number;
  deposit_lkr: number;
  valid_until: string;
  sent_via: "WHATSAPP" | "EMAIL" | "PDF" | null;
  sent_at: string | null;
  created_by_name: string;
  created_at: string;

  /* Quote drafts — supabase/migrations/20260930090000_leads_sales_intelligence.sql */
  status: QuoteStatus;
  occupancy_type: OccupancyType | null;
  infants: number;
  price_per_person: number | null;
  discount_amount: number;
  discount_reason: string | null;
  payment_milestones: QuoteMilestone[];
  inclusions: string[];
  exclusions: string[];
  created_by_user_id: string | null;

  /* Lifecycle — supabase/migrations/20261111090000_p1_4_quotes_lifecycle.sql */
  supersedes_quote_id: string | null;
  viewed_at: string | null;
  cancelled_at: string | null;
  rejection_reason: string | null;
  owner_id: string | null;
  discount_approved_by: string | null;
  discount_approved_at: string | null;
  booking_id: string | null;
  portal_token_hash: string | null;
}

/** `lead_copilot_context` — the staff-approved intent and selected offer. */
export interface LeadCopilotContextRow {
  lead_id: string;
  travel_intent: TravelIntent | null;
  intent_source: ReasoningSource | null;
  intent_applied_at: string | null;
  selected_offer: SelectedOfferSnapshot | null;
  selected_offer_at: string | null;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

/** `lead_copilot_dismissals` — an alert a staff member dismissed. */
export interface LeadCopilotDismissalRow {
  id: string;
  lead_id: string;
  suggestion_type: CopilotSuggestionType;
  fingerprint: string;
  dismissed_by_name: string;
  dismissed_at: string;
}

/** `lead_communication_drafts` — a saved, never-sent customer reply. */
export interface LeadCommunicationDraftRow {
  id: string;
  lead_id: string;
  purpose: ReplyPurpose;
  tone: ReplyTone;
  language: ReplyLanguage;
  body: string;
  offer_id: string | null;
  status: "DRAFT";
  created_by_name: string;
  created_by_user_id: string | null;
  created_at: string;
}
