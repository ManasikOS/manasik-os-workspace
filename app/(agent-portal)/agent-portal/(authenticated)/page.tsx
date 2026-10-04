import { cookies } from "next/headers";

import { getPortalAgentSession } from "@/lib/data/agent-portal-auth";
import {
  listCommissionAccrualsForAgent,
  listPortalAllocations,
  listSubmissionsForAgent,
} from "@/lib/data/agent-portal-repository";
import { createClient } from "@/utils/supabase/server";

import AgentPortalDashboardView from "./components/agent-portal-dashboard-view";

export default async function AgentPortalDashboardPage() {
  const supabase = createClient(await cookies());
  const session = await getPortalAgentSession(supabase);
  if (!session) return null; // Guarded by the (authenticated) layout — this should be unreachable.

  const [allocations, submissions, accruals] = await Promise.all([
    listPortalAllocations(supabase, session.id),
    listSubmissionsForAgent(supabase, session.id),
    listCommissionAccrualsForAgent(supabase, session.id),
  ]);

  return (
    <AgentPortalDashboardView
      name={session.name}
      agencyName={session.agencyName}
      allocations={allocations}
      submissions={submissions}
      accruals={accruals}
    />
  );
}
