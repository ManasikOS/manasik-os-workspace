/**
 * Row and filter types for Audiences.
 *
 * Keep in sync with `supabase/migrations/20261014090000_audiences.sql`.
 */

import type { ConsentStatus } from "@/lib/types/consent";
import type { LeadSource, LeadStage } from "@/lib/types/leads";
import type { PilgrimJourneyStatus } from "@/lib/types/pilgrims";

export type AudienceSubjectType = "LEAD" | "PILGRIM";
export type AudienceType = "DYNAMIC" | "STATIC";

/**
 * Filter definition for a DYNAMIC audience. Shape depends on subject_type —
 * a LEAD audience filters on pipeline fields, a PILGRIM audience on journey
 * fields — plus a consent-adjacent slice shared by both. Consent fields here
 * only narrow *sizing/preview*; they are re-checked live at send time by
 * whatever actually contacts the audience, never trusted from this snapshot.
 */
export interface LeadAudienceFilters {
  stages?: LeadStage[];
  sources?: LeadSource[];
  campaignId?: string | null;
  doNotContact?: boolean;
  consentStatus?: ConsentStatus[];
  createdAfter?: string | null;
  createdBefore?: string | null;
}

export interface PilgrimAudienceFilters {
  journeyStatuses?: PilgrimJourneyStatus[];
  nationality?: string | null;
  doNotContact?: boolean;
  consentStatus?: ConsentStatus[];
  /**
   * Window on months since the pilgrim's most recent COMPLETED departure —
   * e.g. min 6 / max 12 finds pilgrims whose last completed journey departed
   * 6-12 months ago. Both bounds are inclusive; either may be set alone.
   * Powers PAST_PILGRIM_REACTIVATION campaigns (see CampaignType).
   */
  travelledMonthsAgoMin?: number | null;
  travelledMonthsAgoMax?: number | null;
}

export type AudienceFilters = LeadAudienceFilters | PilgrimAudienceFilters;

export interface AudienceRow {
  id: string;
  name: string;
  description: string | null;
  subject_type: AudienceSubjectType;
  audience_type: AudienceType;
  filters: AudienceFilters | null;
  computed_count: number;
  computed_at: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface AudienceMemberRow {
  id: string;
  audience_id: string;
  subject_type: AudienceSubjectType;
  subject_id: string;
  included: boolean;
  reason: string | null;
  added_by_name: string;
  added_at: string;
}

/** One row of an audience's live membership preview, whichever subject type it is. */
export interface AudienceMemberPreview {
  subjectId: string;
  name: string;
  contact: string | null;
  consentStatus: ConsentStatus;
  doNotContact: boolean;
  detail: string;
}

export interface AudienceWithSize extends AudienceRow {
  /** Live count as of this read — always recomputed for DYNAMIC audiences. */
  liveCount: number;
}
