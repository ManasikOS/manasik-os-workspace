import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForReports } from "@/lib/access/reports-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listInsightsWithEvidence } from "@/lib/data/insights-repository";
import { createClient } from "@/utils/supabase/server";

import AiInsightsView from "./components/ai-insights-view";

/**
 * AI Insights (D2) — deterministic rule generators over existing data, not
 * a model call. See supabase/migrations/20261022090000_ai_insights.sql and
 * lib/insights/generators/*.ts for what "AI" means here: pure, explainable
 * functions, run on demand ("Refresh insights") rather than a hidden
 * background job, since there's no cron/worker infra in this app yet.
 */
export default async function AiInsightsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForReports(role);
  if (!can.viewOverview) notFound();

  const supabase = createClient(await cookies());
  const insights = await listInsightsWithEvidence(supabase).catch(() => []);

  const canManage = role === "ADMIN" || role === "CEO" || role === "OPERATIONS" || role === "MARKETING";

  return <AiInsightsView insights={insights} canManage={canManage} />;
}
