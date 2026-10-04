import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listAgencyOpenProposals } from "@/lib/data/departure-groups-agent";
import { createClient } from "@/utils/supabase/server";

import ApprovalsQueue from "./approvals-queue";

/**
 * The Departure Operations Agent's approval queue, across every group in
 * the agency — §12.2 of docs/modules/departure-operations-agent-implementation-plan.md.
 * The daily driver: every proposal a human hasn't yet decided on, ranked
 * risk-first. Deliberately its own route rather than woven into the
 * Operations Control Center's existing snapshot/tab system — that system
 * is scoped to one hydration of live groups; proposals are a different,
 * decision-queue shape best read directly.
 */
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForOperations(role);
  if (!can.viewModule) notFound();
  if (!agencyId) notFound();

  const supabase = createClient(await cookies());
  const proposals = await listAgencyOpenProposals(agencyId, supabase);

  return <ApprovalsQueue proposals={proposals} role={role} />;
}
