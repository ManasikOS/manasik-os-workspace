import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  listReferralsWithReferrer,
  listReferrersWithMetrics,
  listRewardAccrualsWithContext,
  listRewardRules,
} from "@/lib/data/referrals-repository";
import { createClient } from "@/utils/supabase/server";

import ReferralsView from "./components/referrals-view";

/**
 * Referrals (M7 remainder) — pilgrim/lead/staff/external referrers, the
 * referrals they bring in, and reward rules/accruals against conversions.
 * Agent/sub-agent commissions (the other half of M7) wait for the Agent
 * Portal slice, where sales_agents will actually exist to attach them to.
 */
export default async function ReferralsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForLeads(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [referrers, referrals, rewardRules, accruals] = await Promise.all([
    listReferrersWithMetrics(supabase).catch(() => []),
    listReferralsWithReferrer(supabase).catch(() => []),
    listRewardRules(supabase).catch(() => []),
    listRewardAccrualsWithContext(supabase).catch(() => []),
  ]);

  return (
    <ReferralsView
      referrers={referrers}
      referrals={referrals}
      rewardRules={rewardRules}
      accruals={accruals}
      canManage={can.manageSourcesAndAutomation}
      canManageRewards={role === "ADMIN" || role === "CEO"}
    />
  );
}
