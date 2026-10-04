import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import { capabilitiesForMarketing } from "@/lib/access/marketing-access";
import { getGoogleAdsIntegration, getMetaAdsIntegration } from "@/lib/data/ads-integrations-repository";
import {
  getCampaign,
  getCampaignAudienceEligibility,
  getCampaignWeightedAttribution,
  listApprovedWhatsAppTemplateOptions,
  listCampaignAssets,
  listCampaignBookings,
  listCampaignChannelsWithMetrics,
  listCampaignExperiments,
  listCampaignLeads,
  listCampaignQuotes,
  listCampaignSpend,
  listCampaignsWithMetrics,
  listCampaignTouchpoints,
} from "@/lib/data/campaigns-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listInsightsWithEvidence } from "@/lib/data/insights-repository";
import { createClient } from "@/utils/supabase/server";

import CampaignDetailView from "./components/campaign-detail-view";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const { role, agencyId } = await getCurrentStaffRole();
  const can = capabilitiesForMarketing(role);
  if (!can.viewModule) notFound();

  const supabase = createClient(await cookies());
  const campaign = await getCampaign(supabase, campaignId);
  if (!campaign) notFound();

  // Metrics come from the same live computation as the list page — reused
  // rather than re-derived, so the number on this page can never disagree
  // with the number that linked here.
  const [
    allWithMetrics,
    leads,
    quotes,
    bookings,
    spend,
    assets,
    insights,
    channels,
    experiments,
    audienceEligibility,
    whatsappTemplateOptions,
    firstTouches,
    lastTouches,
    assistedTouches,
    weightedAttribution,
    metaAdsIntegration,
    googleAdsIntegration,
  ] = await Promise.all([
    listCampaignsWithMetrics(supabase),
    listCampaignLeads(supabase, campaignId),
    listCampaignQuotes(supabase, campaignId),
    listCampaignBookings(supabase, campaignId),
    listCampaignSpend(supabase, campaignId),
    listCampaignAssets(supabase, campaignId),
    can.viewAttribution ? listInsightsWithEvidence(supabase) : Promise.resolve([]),
    listCampaignChannelsWithMetrics(supabase, campaignId),
    listCampaignExperiments(supabase, campaignId),
    getCampaignAudienceEligibility(supabase, campaignId),
    listApprovedWhatsAppTemplateOptions(supabase),
    can.viewAttribution ? listCampaignTouchpoints(supabase, campaignId, "FIRST") : Promise.resolve([]),
    can.viewAttribution ? listCampaignTouchpoints(supabase, campaignId, "LAST") : Promise.resolve([]),
    can.viewAttribution ? listCampaignTouchpoints(supabase, campaignId, "ASSISTED") : Promise.resolve([]),
    can.viewAttribution ? getCampaignWeightedAttribution(supabase, campaignId) : Promise.resolve([]),
    // Ads-platform connection status is a small enhancement to this page
    // (a "connected" badge), never a reason to fail the whole page load —
    // if the migration for these tables hasn't been applied yet, or the
    // lookup otherwise errors, the page should still render as if
    // disconnected rather than 500.
    agencyId
      ? getMetaAdsIntegration(supabase, agencyId).catch((error) => {
          console.error("Campaign detail: Meta Ads integration lookup failed:", error);
          return null;
        })
      : Promise.resolve(null),
    agencyId
      ? getGoogleAdsIntegration(supabase, agencyId).catch((error) => {
          console.error("Campaign detail: Google Ads integration lookup failed:", error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  const withMetrics = allWithMetrics.find((c) => c.id === campaignId) ?? {
    ...campaign,
    metrics: {
      leadCount: 0,
      qualifiedLeadCount: 0,
      quoteCount: 0,
      acceptedQuoteCount: 0,
      quoteValue: 0,
      bookingCount: 0,
      revenue: 0,
      collected: 0,
      outstanding: 0,
      totalSpend: 0,
      conversionRate: 0,
      qualifiedToQuoteRate: 0,
      quoteToBookingRate: 0,
      costPerQualifiedLead: null,
      costPerBooking: null,
      estimatedGrossMargin: null,
    },
    capacity: null,
  };
  const campaignInsights = insights.filter((i) => i.subject_type === "CAMPAIGN" && i.subject_id === campaignId);

  return (
    <CampaignDetailView
      campaign={withMetrics}
      leads={leads}
      quotes={quotes}
      bookings={bookings}
      spend={spend}
      assets={assets}
      insights={campaignInsights}
      channels={channels}
      experiments={experiments}
      audienceEligibility={audienceEligibility}
      whatsappTemplateOptions={whatsappTemplateOptions}
      firstTouches={firstTouches}
      lastTouches={lastTouches}
      assistedTouches={assistedTouches}
      weightedAttribution={weightedAttribution}
      metaAdsConnected={metaAdsIntegration?.status === "CONNECTED"}
      googleAdsConnected={googleAdsIntegration?.status === "CONNECTED"}
      canManage={can.manageCampaigns}
      canManageStatus={can.manageCampaignStatus}
      canEditSpend={can.editSpend}
      canManageContent={can.manageContent}
      canActOnDiagnosis={can.actOnDiagnosis}
    />
  );
}
