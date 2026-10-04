/**
 * Deterministic generator: a lead with a follow-up due imminently whose
 * consent status is still UNKNOWN — the moment someone is about to be
 * contacted is exactly when an unset consent status matters, tying the
 * Consent model (20261012090000_consent_and_contactability.sql) back into
 * the day-to-day pipeline rather than leaving it as a silent field.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CLOSED_STAGES } from "@/lib/types/leads";
import type { GeneratedInsight } from "@/lib/types/insights";
import { colomboDayKey } from "@/lib/date";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const CONSENT_GAP_GENERATOR_VERSION = "consent-gap-v1";
const LOOKAHEAD_DAYS = 3;

export async function generateConsentGapInsights(client: Db): Promise<GeneratedInsight[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + LOOKAHEAD_DAYS);

  const { data, error } = await client
    .from("leads")
    .select("id, full_name, next_follow_up_at, consent_status, do_not_contact")
    .eq("consent_status", "UNKNOWN")
    .eq("do_not_contact", false)
    .not("next_follow_up_at", "is", null)
    .lte("next_follow_up_at", cutoff.toISOString())
    .not("stage", "in", `(${CLOSED_STAGES.join(",")})`);
  if (error) throw error;

  return ((data ?? []) as {
    id: string;
    full_name: string;
    next_follow_up_at: string;
  }[]).map((lead) => ({
    insightType: "CONSENT_GAP_BEFORE_FOLLOWUP",
    severity: "WARNING",
    title: `${lead.full_name}'s consent is still unknown`,
    description: `A follow-up is due ${colomboDayKey(lead.next_follow_up_at)}, but this lead has never had a consent status recorded.`,
    subjectType: "LEAD",
    subjectId: lead.id,
    generatorVersion: CONSENT_GAP_GENERATOR_VERSION,
    evidence: [
      { label: "Follow-up due", detail: lead.next_follow_up_at },
      { label: "Consent status", detail: "UNKNOWN" },
    ],
  }));
}
