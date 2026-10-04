import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { getAudience, listAudienceMembers } from "@/lib/data/audiences-repository";
import { createClient } from "@/utils/supabase/server";

import AudienceDetailView from "./components/audience-detail-view";

export default async function AudienceDetailPage({
  params,
}: {
  params: Promise<{ audienceId: string }>;
}) {
  const { audienceId } = await params;
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForLeads(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const audience = await getAudience(supabase, audienceId);
  if (!audience) notFound();

  const members = await listAudienceMembers(supabase, audience, 50);

  return (
    <AudienceDetailView
      audience={audience}
      members={members}
      canManage={can.manageSourcesAndAutomation}
    />
  );
}
