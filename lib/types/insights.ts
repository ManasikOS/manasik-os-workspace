/**
 * Row types for AI Insights.
 *
 * Keep in sync with `supabase/migrations/20261022090000_ai_insights.sql`.
 */

export type InsightSeverity = "INFO" | "WARNING" | "CRITICAL";
/**
 * Kept in sync with `insights_subject_type_check` — widened in
 * `20261107090000_insights_v2.sql` (BOOKING/QUOTE/REFUND_REQUEST/SUPPLIER/
 * BANK_TRANSACTION) and `20261114090000_p1_7_finance_ops_agent.sql`
 * (INVOICE/AGENCY) — this TS union had drifted from the DB constraint
 * since P0.3 added those first five without ever widening this type.
 */
export type InsightSubjectType =
  | "LEAD"
  | "PILGRIM"
  | "DEPARTURE_GROUP"
  | "SURVEY_RESPONSE"
  | "AGENT"
  | "CAMPAIGN"
  | "BOOKING"
  | "QUOTE"
  | "REFUND_REQUEST"
  | "SUPPLIER"
  | "BANK_TRANSACTION"
  | "INVOICE"
  /** An agency-wide/period-level finding with no single natural entity — subject_id is the agency's own id. */
  | "AGENCY";
export type InsightOrigin = "RULE" | "COPILOT";
export type InsightStatus = "OPEN" | "ACKNOWLEDGED" | "DISMISSED" | "RESOLVED";
export type InsightOutcomeType = "ACKNOWLEDGED" | "ACTED_ON" | "DISMISSED" | "FALSE_POSITIVE" | "RESOLVED";

export interface InsightRow {
  id: string;
  insight_type: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  subject_type: InsightSubjectType;
  subject_id: string;
  status: InsightStatus;
  generator_version: string;
  generated_at: string;
  updated_at: string;

  /* v2 (Phase 0, P0.3) — supabase/migrations/20261107090000_insights_v2.sql. Nullable: the 4 original RULE generators don't set most of these. */
  module: string | null;
  surface: string | null;
  origin: InsightOrigin;
  confidence: number | null;
  recommendation: string | null;
  required_capability: string | null;
  viewer_capability: string | null;
  proposal_kind: string | null;
  data_freshness: Record<string, string>;
  expires_at: string | null;
  run_id: string | null;
}

export interface InsightEvidenceRow {
  id: string;
  insight_id: string;
  label: string;
  detail: string;
  created_at: string;
}

export interface InsightOutcomeRow {
  id: string;
  insight_id: string;
  outcome_type: InsightOutcomeType;
  note: string | null;
  actor_name: string;
  created_at: string;
}

/** What one deterministic generator produces before it is persisted. */
export interface GeneratedInsight {
  insightType: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  subjectType: InsightSubjectType;
  subjectId: string;
  generatorVersion: string;
  evidence: { label: string; detail: string }[];
}

export interface InsightWithEvidence extends InsightRow {
  evidence: InsightEvidenceRow[];
}
