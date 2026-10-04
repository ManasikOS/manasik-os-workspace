/**
 * Deterministic generator: a lead that hasn't been contacted in a while and
 * isn't in a closed stage. Pure rule, no model call — see the migration
 * header at supabase/migrations/20261022090000_ai_insights.sql.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CLOSED_STAGES, LEAD_STAGE_LABELS } from "@/lib/types/leads";
import type { GeneratedInsight } from "@/lib/types/insights";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const STALLED_LEAD_GENERATOR_VERSION = "stalled-lead-v1";
const STALLED_THRESHOLD_DAYS = 7;

export async function generateStalledLeadInsights(client: Db): Promise<GeneratedInsight[]> {
  const { data, error } = await client
    .from("leads")
    .select("id, full_name, stage, last_contacted_at, created_at")
    .not("stage", "in", `(${CLOSED_STAGES.join(",")})`);
  if (error) throw error;

  const now = Date.now();
  const insights: GeneratedInsight[] = [];

  for (const lead of (data ?? []) as {
    id: string;
    full_name: string;
    stage: string;
    last_contacted_at: string | null;
    created_at: string;
  }[]) {
    const referenceDate = lead.last_contacted_at ?? lead.created_at;
    const daysSince = Math.floor((now - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < STALLED_THRESHOLD_DAYS) continue;

    insights.push({
      insightType: "STALLED_LEAD",
      severity: daysSince >= 14 ? "CRITICAL" : "WARNING",
      title: `${lead.full_name} has gone quiet`,
      description: `No contact recorded in ${daysSince} days while still in "${LEAD_STAGE_LABELS[lead.stage as keyof typeof LEAD_STAGE_LABELS] ?? lead.stage}".`,
      subjectType: "LEAD",
      subjectId: lead.id,
      generatorVersion: STALLED_LEAD_GENERATOR_VERSION,
      evidence: [
        { label: "Stage", detail: LEAD_STAGE_LABELS[lead.stage as keyof typeof LEAD_STAGE_LABELS] ?? lead.stage },
        { label: "Days since last contact", detail: String(daysSince) },
        { label: lead.last_contacted_at ? "Last contacted" : "Created", detail: referenceDate },
      ],
    });
  }

  return insights;
}
