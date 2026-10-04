/**
 * Server-only read/write access for Feedback surveys.
 *
 * Backed by `surveys` / `survey_questions` / `survey_responses` /
 * `survey_answers` added in `supabase/migrations/20261019090000_feedback_surveys.sql`.
 * Complaints reuse `pilgrim_support_requests` via `lib/data/support-repository.ts`
 * rather than anything here.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  SurveyAnswerRow,
  SurveyQuestionRow,
  SurveyResponseRow,
  SurveyResponseWithPilgrim,
  SurveyRow,
  SurveyWithStats,
} from "@/lib/types/feedback";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class FeedbackPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Feedback: ${operation} on ${table} failed — ${detail}`);
    this.name = "FeedbackPersistenceError";
  }
}

export async function listSurveysWithStats(client: Db): Promise<SurveyWithStats[]> {
  const [surveysResult, responsesResult] = await Promise.all([
    client.from("surveys").select("*").order("created_at", { ascending: false }),
    client.from("survey_responses").select("survey_id, overall_score"),
  ]);
  if (surveysResult.error) throw new FeedbackPersistenceError("surveys", "select", surveysResult.error);
  if (responsesResult.error) throw new FeedbackPersistenceError("survey_responses", "select", responsesResult.error);

  const responses = (responsesResult.data ?? []) as Pick<SurveyResponseRow, "survey_id" | "overall_score">[];

  return ((surveysResult.data ?? []) as SurveyRow[]).map((survey) => {
    const own = responses.filter((r) => r.survey_id === survey.id);
    const scored = own.filter((r) => r.overall_score !== null) as { overall_score: number }[];
    const averageScore = scored.length > 0 ? scored.reduce((sum, r) => sum + r.overall_score, 0) / scored.length : null;
    return { ...survey, responseCount: own.length, averageScore };
  });
}

export async function getSurvey(client: Db, surveyId: string): Promise<SurveyRow | null> {
  const { data, error } = await client.from("surveys").select("*").eq("id", surveyId).maybeSingle();
  if (error) throw new FeedbackPersistenceError("surveys", "select", error);
  return (data as SurveyRow) ?? null;
}

export async function listSurveyQuestions(client: Db, surveyId: string): Promise<SurveyQuestionRow[]> {
  const { data, error } = await client
    .from("survey_questions")
    .select("*")
    .eq("survey_id", surveyId)
    .order("sort_order", { ascending: true });
  if (error) throw new FeedbackPersistenceError("survey_questions", "select", error);
  return (data ?? []) as SurveyQuestionRow[];
}

export async function listSurveyResponses(client: Db, surveyId: string): Promise<SurveyResponseWithPilgrim[]> {
  const { data, error } = await client
    .from("survey_responses")
    .select("*")
    .eq("survey_id", surveyId)
    .order("submitted_at", { ascending: false });
  if (error) throw new FeedbackPersistenceError("survey_responses", "select", error);
  const responses = (data ?? []) as SurveyResponseRow[];
  if (responses.length === 0) return [];

  const pilgrimIds = [...new Set(responses.map((r) => r.pilgrim_id))];
  const { data: pilgrims, error: pilgrimError } = await client
    .from("pilgrims")
    .select("id, full_name")
    .in("id", pilgrimIds);
  if (pilgrimError) throw new FeedbackPersistenceError("pilgrims", "select", pilgrimError);
  const nameById = new Map(((pilgrims ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  return responses.map((r) => ({ ...r, pilgrimName: nameById.get(r.pilgrim_id) ?? "Unknown" }));
}

export async function listSurveyAnswers(client: Db, responseId: string): Promise<SurveyAnswerRow[]> {
  const { data, error } = await client.from("survey_answers").select("*").eq("response_id", responseId);
  if (error) throw new FeedbackPersistenceError("survey_answers", "select", error);
  return (data ?? []) as SurveyAnswerRow[];
}

export interface CreateSurveyInput {
  title: string;
  description: string | null;
  trigger: SurveyRow["trigger"];
  questions: { questionText: string; questionType: SurveyQuestionRow["question_type"] }[];
  createdByName: string;
}

export async function createSurvey(client: Db, input: CreateSurveyInput): Promise<SurveyRow> {
  const { data, error } = await client
    .from("surveys")
    .insert({
      title: input.title,
      description: input.description,
      trigger: input.trigger,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new FeedbackPersistenceError("surveys", "insert", error);
  const survey = data as SurveyRow;

  if (input.questions.length > 0) {
    const { error: questionsError } = await client.from("survey_questions").insert(
      input.questions.map((q, index) => ({
        survey_id: survey.id,
        question_text: q.questionText,
        question_type: q.questionType,
        sort_order: index,
      })),
    );
    if (questionsError) throw new FeedbackPersistenceError("survey_questions", "insert", questionsError);
  }

  return survey;
}

export async function updateSurveyActive(client: Db, surveyId: string, isActive: boolean): Promise<void> {
  const { error } = await client.from("surveys").update({ is_active: isActive }).eq("id", surveyId);
  if (error) throw new FeedbackPersistenceError("surveys", "update", error);
}

export interface RecordSurveyResponseInput {
  surveyId: string;
  pilgrimId: string;
  departureGroupId: string | null;
  answers: { questionId: string; answerRating: number | null; answerText: string | null }[];
  recordedByName: string;
}

export async function recordSurveyResponse(client: Db, input: RecordSurveyResponseInput): Promise<SurveyResponseRow> {
  const ratings = input.answers.map((a) => a.answerRating).filter((v): v is number => v !== null);
  const overallScore = ratings.length > 0 ? ratings.reduce((sum, v) => sum + v, 0) / ratings.length : null;

  const { data, error } = await client
    .from("survey_responses")
    .insert({
      survey_id: input.surveyId,
      pilgrim_id: input.pilgrimId,
      departure_group_id: input.departureGroupId,
      overall_score: overallScore,
      recorded_by_name: input.recordedByName,
    })
    .select("*")
    .single();
  if (error) throw new FeedbackPersistenceError("survey_responses", "insert", error);
  const response = data as SurveyResponseRow;

  if (input.answers.length > 0) {
    const { error: answersError } = await client.from("survey_answers").insert(
      input.answers.map((a) => ({
        response_id: response.id,
        question_id: a.questionId,
        answer_rating: a.answerRating,
        answer_text: a.answerText,
      })),
    );
    if (answersError) throw new FeedbackPersistenceError("survey_answers", "insert", answersError);
  }

  return response;
}
