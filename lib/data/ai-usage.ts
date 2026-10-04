/**
 * Read side of the month-to-date AI cost card on /management/ai-agent (MI0.1). Runs on the ordinary SESSION
 * client so RLS decides who gets rows, and is also explicitly filtered by agency like every lib/data read model.
 */

import "server-only";

import { monthStartFor, summariseMonthToDate, type AiMonthToDateUsage, type AiUsageDailyRow } from "@/lib/ai/usage-rollup";
import type { Db } from "@/lib/ai/db";

export async function getAiMonthToDateUsage(db: Db, agencyId: string, now: Date = new Date()): Promise<AiMonthToDateUsage> {
  const { data, error } = await db
    .from("ai_usage_daily")
    .select("day, surface, runs, unpriced_runs, cost_usd, conversations_enriched")
    .eq("agency_id", agencyId)
    .gte("day", monthStartFor(now));
  if (error) throw new Error(`Could not load AI usage: ${error.message}`);
  return summariseMonthToDate((data ?? []) as AiUsageDailyRow[], now);
}
