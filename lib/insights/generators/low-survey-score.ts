/**
 * Deterministic generator: a survey response with a low overall score,
 * worth a follow-up call before it becomes a public complaint or a lost
 * repeat customer. Reads survey_responses (20261019090000_feedback_surveys.sql)
 * directly — no model call.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GeneratedInsight } from "@/lib/types/insights";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const LOW_SURVEY_SCORE_GENERATOR_VERSION = "low-survey-score-v1";
/** On a 1–5 scale, 2 or below is the line — NPS-style (0–10) responses are not scored on this same scale and are skipped. */
const LOW_SCORE_THRESHOLD = 2;

export async function generateLowSurveyScoreInsights(client: Db): Promise<GeneratedInsight[]> {
  const { data, error } = await client
    .from("survey_responses")
    .select("id, pilgrim_id, overall_score, survey_id, surveys(title)")
    .not("overall_score", "is", null)
    .lte("overall_score", LOW_SCORE_THRESHOLD);
  if (error) throw error;

  const responses = (data ?? []) as {
    id: string;
    pilgrim_id: string;
    overall_score: number;
    survey_id: string;
    surveys: { title: string } | { title: string }[] | null;
  }[];
  if (responses.length === 0) return [];

  const pilgrimIds = [...new Set(responses.map((r) => r.pilgrim_id))];
  const { data: pilgrims, error: pilgrimError } = await client
    .from("pilgrims")
    .select("id, full_name")
    .in("id", pilgrimIds);
  if (pilgrimError) throw pilgrimError;
  const nameById = new Map(((pilgrims ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return responses.map((r) => {
    const surveyTitle = Array.isArray(r.surveys) ? r.surveys[0]?.title : r.surveys?.title;
    return {
      insightType: "LOW_SURVEY_SCORE",
      severity: r.overall_score <= 1 ? "CRITICAL" : "WARNING",
      title: `${nameById.get(r.pilgrim_id) ?? "A pilgrim"} rated their experience poorly`,
      description: `Scored ${r.overall_score}/5 on "${surveyTitle ?? "a survey"}" — worth a follow-up before it becomes a lost repeat customer.`,
      subjectType: "SURVEY_RESPONSE",
      subjectId: r.id,
      generatorVersion: LOW_SURVEY_SCORE_GENERATOR_VERSION,
      evidence: [
        { label: "Score", detail: `${r.overall_score}/5` },
        { label: "Survey", detail: surveyTitle ?? "Unknown" },
      ],
    } satisfies GeneratedInsight;
  });
}
