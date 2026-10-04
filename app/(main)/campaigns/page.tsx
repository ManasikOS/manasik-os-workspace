import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForMarketing } from "@/lib/access/marketing-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  listCampaignAudienceOptions,
  listCampaignDepartureGroupOptions,
  listCampaignPackageOptions,
  listCampaignsWithMetrics,
} from "@/lib/data/campaigns-repository";
import { createClient } from "@/utils/supabase/server";

import CampaignsListView from "./components/campaigns-list-view";

/**
 * Marketing campaigns — a commercial growth initiative linked to a real
 * Package/Departure Group and Audience, with metrics (leads, qualified
 * leads, quotes, bookings, revenue, margin) computed live from attributed
 * records. See docs/modules/campaigns-command-center-implementation-plan.md.
 */
export default async function CampaignsPage() {
  const { role } = await getCurrentStaffRole();
  const can = capabilitiesForMarketing(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const [campaigns, packageOptions, departureGroupOptions, audienceOptions] = await Promise.all([
    listCampaignsWithMetrics(supabase),
    listCampaignPackageOptions(supabase),
    listCampaignDepartureGroupOptions(supabase),
    listCampaignAudienceOptions(supabase),
  ]);

  return (
    <CampaignsListView
      campaigns={campaigns}
      canManage={can.manageCampaigns}
      packageOptions={packageOptions}
      departureGroupOptions={departureGroupOptions}
      audienceOptions={audienceOptions}
    />
  );
}
