/**
 * Server-only read/write access for AI Insights.
 *
 * Backed by `insights` / `insight_evidence` / `insight_outcomes` added in
 * `supabase/migrations/20261022090000_ai_insights.sql`. Generators live in
 * `lib/insights/generators/*.ts` — pure, deterministic functions with no
 * model call. This file only runs them and persists the result.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateCampaignDiagnosisInsights } from "@/lib/insights/generators/campaign-diagnosis";
import { generateConsentGapInsights } from "@/lib/insights/generators/consent-gap";
import { generateLowSurveyScoreInsights } from "@/lib/insights/generators/low-survey-score";
import { generateStalledLeadInsights } from "@/lib/insights/generators/stalled-leads";
import type {
  GeneratedInsight,
  InsightEvidenceRow,
  InsightOutcomeRow,
  InsightOutcomeType,
  InsightRow,
  InsightSeverity,
  InsightStatus,
  InsightSubjectType,
  InsightWithEvidence,
} from "@/lib/types/insights";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class InsightsPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Insights: ${operation} on ${table} failed — ${detail}`);
    this.name = "InsightsPersistenceError";
  }
}

/** Terminal statuses a generator must never silently reopen. */
const TERMINAL_STATUSES: ReadonlySet<InsightStatus> = new Set(["DISMISSED", "RESOLVED"]);

const GENERATORS: ((client: Db) => Promise<GeneratedInsight[]>)[] = [
  generateStalledLeadInsights,
  generateConsentGapInsights,
  generateLowSurveyScoreInsights,
  generateCampaignDiagnosisInsights,
];

/**
 * Runs every registered generator and upserts the results. An insight whose
 * existing row is already DISMISSED/RESOLVED is left untouched — a staff
 * decision about it stands until the situation is gone (the generator
 * simply stops producing it) rather than being overwritten by the next run.
 */
export async function runInsightGenerators(client: Db): Promise<{ generated: number; skipped: number }> {
  const results = await Promise.all(GENERATORS.map((generator) => generator(client)));
  const generatedInsights = results.flat();

  if (generatedInsights.length === 0) return { generated: 0, skipped: 0 };

  const { data: existingRows, error: existingError } = await client
    .from("insights")
    .select("id, insight_type, subject_type, subject_id, status")
    .in(
      "subject_id",
      [...new Set(generatedInsights.map((g) => g.subjectId))],
    );
  if (existingError) throw new InsightsPersistenceError("insights", "select", existingError);

  const existingByKey = new Map(
    ((existingRows ?? []) as Pick<InsightRow, "id" | "insight_type" | "subject_type" | "subject_id" | "status">[]).map(
      (row) => [`${row.insight_type}:${row.subject_type}:${row.subject_id}`, row],
    ),
  );

  let generated = 0;
  let skipped = 0;

  for (const insight of generatedInsights) {
    const key = `${insight.insightType}:${insight.subjectType}:${insight.subjectId}`;
    const existing = existingByKey.get(key);
    if (existing && TERMINAL_STATUSES.has(existing.status)) {
      skipped += 1;
      continue;
    }

    const { data: upserted, error: upsertError } = await client
      .from("insights")
      .upsert(
        {
          insight_type: insight.insightType,
          severity: insight.severity,
          title: insight.title,
          description: insight.description,
          subject_type: insight.subjectType,
          subject_id: insight.subjectId,
          generator_version: insight.generatorVersion,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agency_id,insight_type,subject_type,subject_id" },
      )
      .select("id")
      .single();
    if (upsertError) throw new InsightsPersistenceError("insights", "insert", upsertError);

    const insightId = (upserted as { id: string }).id;
    await client.from("insight_evidence").delete().eq("insight_id", insightId);
    if (insight.evidence.length > 0) {
      const { error: evidenceError } = await client
        .from("insight_evidence")
        .insert(insight.evidence.map((e) => ({ insight_id: insightId, label: e.label, detail: e.detail })));
      if (evidenceError) throw new InsightsPersistenceError("insight_evidence", "insert", evidenceError);
    }
    generated += 1;
  }

  return { generated, skipped };
}

export interface CopilotInsightInput {
  agencyId: string;
  insightType: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  subjectType: InsightSubjectType;
  subjectId: string;
  module: string;
  surface: string;
  confidence: number | null;
  recommendation: string | null;
  requiredCapability?: string | null;
  viewerCapability?: string | null;
  proposalKind?: string | null;
  dataFreshness?: Record<string, string>;
  expiresAt?: string | null;
  runId?: string | null;
  evidence: { label: string; detail: string }[];
}

/**
 * The `origin: 'COPILOT'` counterpart to `runInsightGenerators()`'s
 * RULE-only upsert — Phase 1 (P1.7), the first real write through the v2
 * columns `20261107090000_insights_v2.sql` added but no code populated
 * yet. Used by a model-narrated finding (e.g. the nightly Finance review
 * agent), never by a pure code generator — those keep using
 * `runInsightGenerators()`. Same upsert-by-key posture: a DISMISSED/
 * RESOLVED existing row is left alone rather than resurrected.
 */
export async function createCopilotInsight(client: Db, input: CopilotInsightInput): Promise<{ insightId: string | null; skipped: boolean }> {
  const { data: existing, error: existingError } = await client
    .from("insights")
    .select("id, status")
    .eq("agency_id", input.agencyId)
    .eq("insight_type", input.insightType)
    .eq("subject_type", input.subjectType)
    .eq("subject_id", input.subjectId)
    .maybeSingle();
  if (existingError) throw new InsightsPersistenceError("insights", "select", existingError);
  if (existing && TERMINAL_STATUSES.has((existing as { status: InsightStatus }).status)) {
    return { insightId: null, skipped: true };
  }

  const { data: upserted, error: upsertError } = await client
    .from("insights")
    .upsert(
      {
        agency_id: input.agencyId,
        insight_type: input.insightType,
        severity: input.severity,
        title: input.title,
        description: input.description,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        generator_version: "copilot-v1",
        module: input.module,
        surface: input.surface,
        origin: "COPILOT",
        confidence: input.confidence,
        recommendation: input.recommendation,
        required_capability: input.requiredCapability ?? null,
        viewer_capability: input.viewerCapability ?? null,
        proposal_kind: input.proposalKind ?? null,
        data_freshness: input.dataFreshness ?? {},
        expires_at: input.expiresAt ?? null,
        run_id: input.runId ?? null,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agency_id,insight_type,subject_type,subject_id" },
    )
    .select("id")
    .single();
  if (upsertError) throw new InsightsPersistenceError("insights", "insert", upsertError);

  const insightId = (upserted as { id: string }).id;
  await client.from("insight_evidence").delete().eq("insight_id", insightId);
  if (input.evidence.length > 0) {
    const { error: evidenceError } = await client
      .from("insight_evidence")
      .insert(input.evidence.map((e) => ({ agency_id: input.agencyId, insight_id: insightId, label: e.label, detail: e.detail })));
    if (evidenceError) throw new InsightsPersistenceError("insight_evidence", "insert", evidenceError);
  }

  return { insightId, skipped: false };
}

export async function listInsightsWithEvidence(client: Db, status?: InsightStatus): Promise<InsightWithEvidence[]> {
  let query = client.from("insights").select("*").order("generated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new InsightsPersistenceError("insights", "select", error);

  const insights = (data ?? []) as InsightRow[];
  if (insights.length === 0) return [];

  const { data: evidenceRows, error: evidenceError } = await client
    .from("insight_evidence")
    .select("*")
    .in("insight_id", insights.map((i) => i.id));
  if (evidenceError) throw new InsightsPersistenceError("insight_evidence", "select", evidenceError);

  const evidenceByInsight = new Map<string, InsightEvidenceRow[]>();
  for (const row of (evidenceRows ?? []) as InsightEvidenceRow[]) {
    const list = evidenceByInsight.get(row.insight_id) ?? [];
    list.push(row);
    evidenceByInsight.set(row.insight_id, list);
  }

  return insights.map((insight) => ({ ...insight, evidence: evidenceByInsight.get(insight.id) ?? [] }));
}

export async function listInsightOutcomes(client: Db, insightId: string): Promise<InsightOutcomeRow[]> {
  const { data, error } = await client
    .from("insight_outcomes")
    .select("*")
    .eq("insight_id", insightId)
    .order("created_at", { ascending: false });
  if (error) throw new InsightsPersistenceError("insight_outcomes", "select", error);
  return (data ?? []) as InsightOutcomeRow[];
}

const OUTCOME_TO_STATUS: Record<InsightOutcomeType, InsightStatus> = {
  ACKNOWLEDGED: "ACKNOWLEDGED",
  ACTED_ON: "ACKNOWLEDGED",
  DISMISSED: "DISMISSED",
  FALSE_POSITIVE: "DISMISSED",
  RESOLVED: "RESOLVED",
};

export async function recordInsightOutcome(
  client: Db,
  input: { insightId: string; outcomeType: InsightOutcomeType; note: string | null; actorName: string },
): Promise<void> {
  const { error: outcomeError } = await client.from("insight_outcomes").insert({
    insight_id: input.insightId,
    outcome_type: input.outcomeType,
    note: input.note,
    actor_name: input.actorName,
  });
  if (outcomeError) throw new InsightsPersistenceError("insight_outcomes", "insert", outcomeError);

  const { error: updateError } = await client
    .from("insights")
    .update({ status: OUTCOME_TO_STATUS[input.outcomeType], updated_at: new Date().toISOString() })
    .eq("id", input.insightId);
  if (updateError) throw new InsightsPersistenceError("insights", "update", updateError);
}
