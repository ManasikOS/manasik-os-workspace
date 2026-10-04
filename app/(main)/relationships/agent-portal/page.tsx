import { cookies } from "next/headers";

import { getCurrentStaffRole, listPackageTemplateOptions } from "@/lib/data/departure-groups";
import {
  listAgentSubmissionsWithAgent,
  listAllSettlementsWithContext,
  listCommissionAccrualsWithContext,
  listCommissionRules,
  listSalesAgentsWithMetrics,
} from "@/lib/data/agent-portal-repository";
import { createClient } from "@/utils/supabase/server";

import AgentPortalView from "./components/agent-portal-view";

/**
 * Agent / Sub-Agent Portal (Phase C10, M14) — the agent directory, package
 * allocations, booking submissions, and the commission tracking deferred
 * from Referrals (supabase/migrations/20261021090000_agent_portal.sql).
 * No agent-facing login exists yet — see that migration's header.
 */
export default async function AgentPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const { role } = await getCurrentStaffRole();
  const canManage = role === "ADMIN" || role === "CEO" || role === "OPERATIONS";
  const canManageCommissions = role === "ADMIN" || role === "CEO";

  const supabase = createClient(await cookies());
  const [agents, submissions, commissionRules, accruals, settlements, packages] = await Promise.all([
    listSalesAgentsWithMetrics(supabase).catch(() => []),
    listAgentSubmissionsWithAgent(supabase).catch(() => []),
    listCommissionRules(supabase).catch(() => []),
    listCommissionAccrualsWithContext(supabase).catch(() => []),
    listAllSettlementsWithContext(supabase).catch(() => []),
    listPackageTemplateOptions({ includeDrafts: true }),
  ]);

  const initialTab = tab === "commissions" || tab === "submissions" ? tab : "agents";

  return (
    <AgentPortalView
      agents={agents}
      submissions={submissions}
      commissionRules={commissionRules}
      accruals={accruals}
      settlements={settlements}
      packages={packages}
      canManage={canManage}
      canManageCommissions={canManageCommissions}
      initialTab={initialTab}
    />
  );
}
