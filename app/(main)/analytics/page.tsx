import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForReports } from "@/lib/access/reports-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listCampaignsWithMetrics } from "@/lib/data/campaigns-repository";
import { listAudiences } from "@/lib/data/audiences-repository";
import { listReferrersWithMetrics, listReferralsWithReferrer } from "@/lib/data/referrals-repository";
import { listLoyaltyPilgrimSummaries } from "@/lib/data/loyalty-repository";
import { listSalesAgentsWithMetrics } from "@/lib/data/agent-portal-repository";
import { listSurveysWithStats } from "@/lib/data/feedback-repository";
import { createClient } from "@/utils/supabase/server";

import AnalyticsView from "./components/analytics-view";

/**
 * Analytics (D1) — read-only cross-cut over the Growth/Relationships
 * modules built in Phase C (Campaigns, Audiences, Referrals, Loyalty,
 * Agent Portal, Feedback). Deliberately does not duplicate the existing
 * Reports module (lib/access/reports-access.ts), which already covers
 * Sales/Finance/Groups/Pilgrims/Suppliers in depth and predates these
 * modules — this page is the one place that ties the newer ones together,
 * reading every number live off each module's own repository rather than
 * caching or recomputing anything itself.
 */
export default async function AnalyticsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForReports(role);
  if (!can.viewOverview) notFound();

  const supabase = createClient(await cookies());
  const [campaigns, audiences, referrers, referrals, loyaltyPilgrims, agents, surveys] = await Promise.all([
    listCampaignsWithMetrics(supabase).catch(() => []),
    listAudiences(supabase).catch(() => []),
    listReferrersWithMetrics(supabase).catch(() => []),
    listReferralsWithReferrer(supabase).catch(() => []),
    listLoyaltyPilgrimSummaries(supabase).catch(() => []),
    listSalesAgentsWithMetrics(supabase).catch(() => []),
    listSurveysWithStats(supabase).catch(() => []),
  ]);

  return (
    <AnalyticsView
      campaigns={campaigns}
      audiences={audiences}
      referrers={referrers}
      referrals={referrals}
      loyaltyPilgrims={loyaltyPilgrims}
      agents={agents}
      surveys={surveys}
    />
  );
}
