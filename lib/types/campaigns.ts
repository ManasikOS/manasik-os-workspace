/**
 * Row types for Campaigns.
 *
 * Keep in sync with `supabase/migrations/20261013090000_campaigns.sql` and
 * `supabase/migrations/20261027090000_campaigns_command_center.sql`.
 */

export type CampaignStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type CampaignChannel =
  | "WHATSAPP"
  | "FACEBOOK"
  | "INSTAGRAM"
  | "TIKTOK"
  | "GOOGLE"
  | "WEBSITE"
  | "REFERRAL"
  | "WALK_IN"
  | "EVENT"
  | "PARTNER"
  | "OTHER";

export type CampaignType =
  | "PACKAGE_LAUNCH"
  | "DEPARTURE_FILL"
  | "RAMADAN_UMRAH"
  | "HAJJ_PRE_REGISTRATION"
  | "HAJJ_EDUCATION"
  | "EARLY_BIRD"
  | "SCHOOL_HOLIDAY_UMRAH"
  | "FAMILY_UMRAH"
  | "WOMENS_GROUP_UMRAH"
  | "SENIOR_FRIENDLY_UMRAH"
  | "REFERRAL_PROGRAM"
  | "PAST_PILGRIM_REACTIVATION"
  | "VISA_DOCUMENT_DEADLINE"
  | "EVENT_ROADSHOW"
  | "PARTNER_AGENT"
  | "CONTENT_EDUCATION"
  | "CUSTOM";

export type CampaignObjective =
  | "GENERATE_ENQUIRIES"
  | "GENERATE_QUALIFIED_LEADS"
  | "GENERATE_QUOTES"
  | "GENERATE_BOOKINGS"
  | "COLLECT_DEPOSITS"
  | "COLLECT_FULL_PAYMENT"
  | "FILL_DEPARTURE"
  | "REACTIVATE_PAST_PILGRIMS"
  | "GENERATE_REFERRALS"
  | "PROMOTE_EVENT"
  | "INCREASE_REPEAT_BOOKINGS";

export type CampaignApprovalStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED";

/**
 * "direct", "assisted", or "unknown" — literally the brief's own language.
 * A campaign_id existing on a lead is not itself evidence of DIRECT
 * attribution; that is a deliberate choice someone makes, not inferred.
 */
export type AttributionType = "DIRECT" | "ASSISTED" | "UNKNOWN";

/** How sure the system is about a touchpoint's attribution — never overstated. */
export type AttributionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type TouchType = "FIRST" | "LAST" | "ASSISTED";

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  channel: CampaignChannel;
  campaign_type: CampaignType;
  objective: CampaignObjective;
  linked_package_id: string | null;
  linked_departure_group_id: string | null;
  audience_id: string | null;
  start_date: string | null;
  end_date: string | null;
  booking_cutoff_at: string | null;
  budget: number | null;
  target_leads: number | null;
  target_qualified_leads: number | null;
  target_quotes: number | null;
  target_bookings: number | null;
  target_seats: number | null;
  target_collected_revenue: number | null;
  target_margin_pct: number | null;
  approval_status: CampaignApprovalStatus;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  notes: string | null;
  owner_id: string | null;
  owner_name: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignSpendEntryRow {
  id: string;
  campaign_id: string;
  amount: number;
  spent_on: string;
  note: string | null;
  created_by_name: string;
  created_at: string;
}

export interface CampaignTouchpointRow {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  booking_id: string | null;
  touch_type: TouchType;
  channel: string | null;
  source_detail: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  tracking_code: string | null;
  attribution_confidence: AttributionConfidence;
  occurred_at: string;
  created_at: string;
}

export type CampaignAssetType =
  | "MESSAGE_TEMPLATE"
  | "LANDING_PAGE"
  | "BROCHURE"
  | "QR_CODE"
  | "TRACKING_LINK"
  | "CREATIVE"
  | "OTHER";

export interface CampaignAssetRow {
  id: string;
  campaign_id: string;
  asset_type: CampaignAssetType;
  reference_id: string | null;
  label: string;
  language: string | null;
  url: string | null;
  qr_code_value: string | null;
  notes: string | null;
  created_by_name: string;
  created_at: string;
}

/** Computed live from leads/bookings/quotes — never stored, never stale. */
export interface CampaignMetrics {
  leadCount: number;
  qualifiedLeadCount: number;
  quoteCount: number;
  acceptedQuoteCount: number;
  /** Sum of lead_quotes.total_lkr for quotes on this campaign's leads. */
  quoteValue: number;
  bookingCount: number;
  /** Sum of booking total_booking_value for bookings attributed to this campaign. */
  revenue: number;
  /** Sum of booking amount_paid for the same set. */
  collected: number;
  /** revenue - collected, i.e. booked but not yet collected. */
  outstanding: number;
  totalSpend: number;
  /** bookingCount / leadCount, 0 when there are no leads yet. */
  conversionRate: number;
  /** quoteCount / qualifiedLeadCount, 0 when there are no qualified leads yet. */
  qualifiedToQuoteRate: number;
  /** bookingCount / quoteCount, 0 when there are no quotes yet. */
  quoteToBookingRate: number;
  /** Cost per qualified lead — null when there are no qualified leads yet. */
  costPerQualifiedLead: number | null;
  /** Cost per booking — null when there are no bookings yet. */
  costPerBooking: number | null;
  /**
   * collected - estimatedDirectCost - totalSpend. null when the campaign has
   * no linked package/departure to estimate a per-pax cost from — an
   * estimate is only shown when there is a real cost basis, never guessed.
   */
  estimatedGrossMargin: number | null;
}

/** Live capacity read from the linked departure group — never copied onto the campaign row. */
export interface CampaignCapacity {
  departureGroupId: string;
  groupName: string;
  groupCode: string;
  departureDate: string;
  capacity: number;
  bookedSeats: number;
  heldSeats: number;
  availableSeats: number;
  salesStatus: string;
  groupStatus: string;
}

export interface CampaignWithMetrics extends CampaignRow {
  metrics: CampaignMetrics;
  capacity: CampaignCapacity | null;
}

/* ── V2: per-channel breakdown, experiments, audience eligibility ───────── */

export type CampaignChannelStatus = "ACTIVE" | "PAUSED" | "ENDED";

export type AdPlatform = "META_ADS" | "GOOGLE_ADS";

export interface CampaignChannelRow {
  id: string;
  campaign_id: string;
  channel: CampaignChannel;
  status: CampaignChannelStatus;
  owner_id: string | null;
  budget_allocation: number | null;
  tracking_link: string | null;
  asset_id: string | null;
  notes: string | null;
  /** Set once this channel is linked to a Meta Ads / Google Ads campaign for spend sync — see V3. */
  external_platform: AdPlatform | null;
  external_campaign_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-channel leads/quotes/bookings/spend — derived from campaign_touchpoints.channel and campaign_spend_entries, never stored. */
export interface CampaignChannelMetrics {
  leadCount: number;
  qualifiedLeadCount: number;
  bookingCount: number;
  spend: number;
}

export interface CampaignChannelWithMetrics extends CampaignChannelRow {
  metrics: CampaignChannelMetrics;
}

export type CampaignExperimentStatus = "DRAFT" | "RUNNING" | "COMPLETE";

export interface CampaignExperimentRow {
  id: string;
  campaign_id: string;
  hypothesis: string;
  primary_metric: string;
  status: CampaignExperimentStatus;
  decision: string | null;
  notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface CampaignExperimentVariantRow {
  id: string;
  experiment_id: string;
  variant_label: string;
  description: string | null;
  audience_split_pct: number | null;
  result_summary: string | null;
  created_at: string;
}

export interface CampaignExperimentWithVariants extends CampaignExperimentRow {
  variants: CampaignExperimentVariantRow[];
}

export interface CampaignAudienceSubject {
  subjectType: "LEAD" | "PILGRIM";
  subjectId: string;
  name: string;
  contact: string | null;
  eligible: boolean;
  exclusionReason: string | null;
}

export interface CampaignAudienceEligibility {
  audienceId: string;
  audienceName: string;
  totalSubjects: number;
  eligibleCount: number;
  excludedCount: number;
  exclusionReasons: { reason: string; count: number }[];
  /** Capped preview list — enough to inspect, not the whole audience for very large ones. */
  subjects: CampaignAudienceSubject[];
}
