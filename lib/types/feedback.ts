/**
 * Row types for Feedback surveys.
 *
 * Keep in sync with `supabase/migrations/20261019090000_feedback_surveys.sql`.
 * Complaints are NOT covered here — they reuse `pilgrim_support_requests`
 * (category = 'COMPLAINT'); see `lib/types/pilgrims.ts` / `lib/data/support-repository.ts`.
 */

export type SurveyTrigger = "POST_TRIP" | "MANUAL";
export type SurveyQuestionType = "RATING_1_5" | "RATING_NPS_0_10" | "YES_NO" | "TEXT";

export interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  trigger: SurveyTrigger;
  is_active: boolean;
  created_by_name: string;
  created_at: string;
}

export interface SurveyQuestionRow {
  id: string;
  survey_id: string;
  question_text: string;
  question_type: SurveyQuestionType;
  sort_order: number;
  created_at: string;
}

export interface SurveyResponseRow {
  id: string;
  survey_id: string;
  pilgrim_id: string;
  departure_group_id: string | null;
  overall_score: number | null;
  recorded_by_name: string;
  submitted_at: string;
}

export interface SurveyAnswerRow {
  id: string;
  response_id: string;
  question_id: string;
  answer_rating: number | null;
  answer_text: string | null;
}

export interface SurveyWithStats extends SurveyRow {
  responseCount: number;
  averageScore: number | null;
}

export interface SurveyResponseWithPilgrim extends SurveyResponseRow {
  pilgrimName: string;
}
