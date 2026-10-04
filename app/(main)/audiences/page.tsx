import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listAudiences } from "@/lib/data/audiences-repository";
import { createClient } from "@/utils/supabase/server";

import AudiencesListView from "./components/audiences-list-view";

/**
 * Reusable lead/pilgrim segments — supabase/migrations/20261014090000_audiences.sql.
 * Consumers (Campaigns, Announcements) still check live consent before
 * contacting anyone; an audience's size is never a promise that everyone in
 * it is reachable.
 */
export default async function AudiencesPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForLeads(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const audiences = await listAudiences(supabase);

  return <AudiencesListView audiences={audiences} canManage={can.manageSourcesAndAutomation} />;
}
