"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { fetchCampaignDailyInsights, listAdAccountCampaigns, MetaAdsError } from "@/lib/ads/meta-client";
import { countDynamicAudience, createAudience } from "@/lib/data/audiences-repository";
import { getMarketingReasoningProvider } from "@/lib/copilot/marketing/llm/openrouter-provider";
import type { AudienceProposalFilters } from "@/lib/copilot/marketing/types";
import { fetchCampaignDailyMetrics, GoogleAdsError, listCustomerCampaigns, refreshGoogleAdsAccessToken } from "@/lib/ads/google-client";
import { readAdsSecret } from "@/lib/ads/vault";
import { capabilitiesFor } from "@/lib/access/departure-groups-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForMarketing } from "@/lib/access/marketing-access";
import {
  getGoogleAdsIntegration,
  getMetaAdsIntegration,
  markGoogleAdsError,
  markGoogleAdsSynced,
  markMetaAdsError,
  markMetaAdsSynced,
} from "@/lib/data/ads-integrations-repository";
import {
  addCampaignAsset,
  addCampaignChannel,
  addCampaignSpend,
  createCampaign,
  createCampaignExperiment,
  getCampaign,
  getCampaignCapacityWarning,
  linkCampaignChannelExternalCampaign,
  setBookingCampaignAttribution,
  updateCampaignChannelStatus,
  updateCampaignExperiment,
  updateCampaignStatus,
  upsertSyncedCampaignSpend,
  type AddCampaignAssetInput,
  type AddCampaignChannelInput,
  type CreateCampaignExperimentInput,
  type CreateCampaignInput,
} from "@/lib/data/campaigns-repository";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { recordInsightOutcome } from "@/lib/data/insights-repository";
import { requireUser } from "@/lib/dal";
import type { AttributionType, CampaignChannelStatus, CampaignExperimentStatus, CampaignStatus } from "@/lib/types/campaigns";
import type { InsightOutcomeType } from "@/lib/types/insights";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

async function db() {
  return createClient(await cookies());
}

async function requireCanManage() {
  await requireUser();
  const { role, name, staffId, agencyId } = await getCurrentStaffRole();
  return { ok: capabilitiesForMarketing(role).manageCampaigns, name, staffId, agencyId };
}

async function requireCanManageStatus() {
  await requireUser();
  const { role, name, staffId } = await getCurrentStaffRole();
  return { ok: capabilitiesForMarketing(role).manageCampaignStatus, name, staffId };
}

async function requireCanEditSpend() {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { ok: capabilitiesForMarketing(role).editSpend, name };
}

function revalidateCampaigns(campaignId?: string) {
  revalidatePath("/campaigns");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
}

export async function createCampaignAction(
  input: Omit<CreateCampaignInput, "createdByName" | "ownerId" | "ownerName"> & {
    ownerName?: string | null;
  },
): Promise<ActionResult & { campaignId?: string }> {
  const { ok, name, staffId } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create campaigns." };
  if (!input.name.trim()) return { ok: false, error: "Give the campaign a name." };

  const supabase = await db();

  // Capacity protection: a campaign must not launch aggressively promoting a
  // departure that is already full or closed — see
  // docs/modules/campaigns-command-center-implementation-plan.md §6.2/§8. This is a
  // warning, not a hard block, since a campaign can still be saved as DRAFT
  // for later (e.g. once more capacity opens up).
  let warning: string | undefined;
  if (input.linkedDepartureGroupId) {
    const capacityWarning = await getCampaignCapacityWarning(supabase, input.linkedDepartureGroupId);
    if (capacityWarning) warning = capacityWarning;
  }

  const created = await createCampaign(supabase, {
    ...input,
    ownerId: staffId ?? null,
    ownerName: input.ownerName ?? name ?? null,
    createdByName: name ?? "Staff",
  });
  revalidateCampaigns();
  return { ok: true, campaignId: created.id, warning };
}

export async function updateCampaignStatusAction(
  campaignId: string,
  status: CampaignStatus,
): Promise<ActionResult> {
  const { ok } = await requireCanManageStatus();
  if (!ok) return { ok: false, error: "Your role cannot change campaign status." };

  const supabase = await db();

  let warning: string | undefined;
  if (status === "ACTIVE" || status === "SCHEDULED") {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("linked_departure_group_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaign?.linked_departure_group_id) {
      const capacityWarning = await getCampaignCapacityWarning(supabase, campaign.linked_departure_group_id);
      if (capacityWarning) warning = capacityWarning;
    }
  }

  await updateCampaignStatus(supabase, campaignId, status);
  revalidateCampaigns(campaignId);
  return { ok: true, warning };
}

export async function addCampaignSpendAction(input: {
  campaignId: string;
  amount: number;
  spentOn: string;
  note?: string;
}): Promise<ActionResult> {
  const { ok, name } = await requireCanEditSpend();
  if (!ok) return { ok: false, error: "Your role cannot record campaign spend." };
  if (input.amount <= 0) return { ok: false, error: "Enter a spend amount greater than zero." };

  const supabase = await db();
  await addCampaignSpend(supabase, {
    campaignId: input.campaignId,
    amount: input.amount,
    spentOn: input.spentOn,
    note: input.note?.trim() || null,
    createdByName: name ?? "Staff",
  });
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

export async function addCampaignAssetAction(
  input: Omit<AddCampaignAssetInput, "createdByName">,
): Promise<ActionResult> {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  if (!capabilitiesForMarketing(role).manageContent) {
    return { ok: false, error: "Your role cannot add campaign content." };
  }
  if (!input.label.trim()) return { ok: false, error: "Give the asset a label." };

  const supabase = await db();
  await addCampaignAsset(supabase, { ...input, createdByName: name ?? "Staff" });
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

export async function addCampaignChannelAction(
  input: Omit<AddCampaignChannelInput, "ownerId"> & { ownerId?: string | null },
): Promise<ActionResult> {
  const { ok, staffId } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot add a campaign channel." };

  const supabase = await db();
  await addCampaignChannel(supabase, { ...input, ownerId: input.ownerId ?? staffId ?? null });
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

export async function updateCampaignChannelStatusAction(input: {
  campaignId: string;
  channelId: string;
  status: CampaignChannelStatus;
}): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot change a campaign channel." };

  const supabase = await db();
  await updateCampaignChannelStatus(supabase, input.channelId, input.status);
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

/**
 * Lists the connected Meta/Google Ads account's own campaigns, for the
 * "link this channel to an external campaign" picker — reads the agency's
 * stored token from Vault via the admin client (RLS never exposes Vault
 * refs to the regular client), never persists anything itself.
 */
export async function listAdPlatformCampaignsAction(
  platform: "META_ADS" | "GOOGLE_ADS",
): Promise<{ ok: true; campaigns: { id: string; name: string; status: string }[] } | { ok: false; error: string }> {
  const { ok, agencyId } = await requireCanManage();
  if (!ok || !agencyId) return { ok: false, error: "Your role cannot link campaigns to an ad platform." };

  const admin = createAdminClient();
  try {
    if (platform === "META_ADS") {
      const integration = await getMetaAdsIntegration(admin, agencyId);
      if (!integration?.credential_ref || !integration.ad_account_id) return { ok: false, error: "Meta Ads is not connected." };
      const accessToken = await readAdsSecret(admin, integration.credential_ref);
      if (!accessToken) return { ok: false, error: "Meta Ads connection is missing its token — reconnect it." };
      const campaigns = await listAdAccountCampaigns(accessToken, integration.ad_account_id);
      return { ok: true, campaigns };
    }
    const integration = await getGoogleAdsIntegration(admin, agencyId);
    if (!integration?.credential_ref || !integration.customer_id) return { ok: false, error: "Google Ads is not connected." };
    const refreshToken = await readAdsSecret(admin, integration.credential_ref);
    if (!refreshToken) return { ok: false, error: "Google Ads connection is missing its token — reconnect it." };
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!clientId || !clientSecret || !developerToken) return { ok: false, error: "Google Ads is not configured on this deployment." };
    const { accessToken } = await refreshGoogleAdsAccessToken({ refreshToken, clientId, clientSecret });
    const campaigns = await listCustomerCampaigns({
      accessToken,
      developerToken,
      customerId: integration.customer_id,
      loginCustomerId: integration.login_customer_id,
    });
    return { ok: true, campaigns };
  } catch (error) {
    const message =
      error instanceof MetaAdsError || error instanceof GoogleAdsError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not list campaigns from the ad platform.";
    return { ok: false, error: message };
  }
}

export async function linkCampaignChannelExternalCampaignAction(input: {
  campaignId: string;
  channelId: string;
  platform: "META_ADS" | "GOOGLE_ADS";
  externalCampaignId: string;
}): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot link a campaign channel." };

  const supabase = await db();
  await linkCampaignChannelExternalCampaign(supabase, input.channelId, input.platform, input.externalCampaignId);
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

/**
 * Pulls daily spend for one linked channel from the connected ad platform
 * and upserts it into campaign_spend_entries (source-tagged, deduped by
 * external campaign id + day — see upsertSyncedCampaignSpend). Read-only
 * against the ad platform: never touches budget, bidding or delivery, per
 * the plan's rule that this integration only ever reads.
 */
export async function syncCampaignChannelSpendAction(input: {
  campaignId: string;
  channelId: string;
  platform: "META_ADS" | "GOOGLE_ADS";
  externalCampaignId: string;
  since: string;
  until: string;
}): Promise<ActionResult> {
  const { ok, agencyId, name } = await requireCanManage();
  if (!ok || !agencyId) return { ok: false, error: "Your role cannot sync ad platform spend." };

  const admin = createAdminClient();
  const supabase = await db();

  try {
    if (input.platform === "META_ADS") {
      const integration = await getMetaAdsIntegration(admin, agencyId);
      if (!integration?.credential_ref) return { ok: false, error: "Meta Ads is not connected." };
      const accessToken = await readAdsSecret(admin, integration.credential_ref);
      if (!accessToken) return { ok: false, error: "Meta Ads connection is missing its token — reconnect it." };

      const insights = await fetchCampaignDailyInsights(accessToken, input.externalCampaignId, input.since, input.until);
      await upsertSyncedCampaignSpend(supabase, {
        campaignId: input.campaignId,
        source: "META_ADS",
        externalId: input.externalCampaignId,
        entries: insights.map((row) => ({ spentOn: row.date, amount: row.spend, note: `${row.impressions} impressions, ${row.clicks} clicks` })),
        createdByName: name ?? "Meta Ads sync",
      });
      await markMetaAdsSynced(admin, agencyId);
    } else {
      const integration = await getGoogleAdsIntegration(admin, agencyId);
      if (!integration?.credential_ref || !integration.customer_id) return { ok: false, error: "Google Ads is not connected." };
      const refreshToken = await readAdsSecret(admin, integration.credential_ref);
      if (!refreshToken) return { ok: false, error: "Google Ads connection is missing its token — reconnect it." };
      const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
      const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
      if (!clientId || !clientSecret || !developerToken) return { ok: false, error: "Google Ads is not configured on this deployment." };
      const { accessToken } = await refreshGoogleAdsAccessToken({ refreshToken, clientId, clientSecret });

      const metrics = await fetchCampaignDailyMetrics({
        accessToken,
        developerToken,
        customerId: integration.customer_id,
        loginCustomerId: integration.login_customer_id,
        campaignId: input.externalCampaignId,
        since: input.since,
        until: input.until,
      });
      await upsertSyncedCampaignSpend(supabase, {
        campaignId: input.campaignId,
        source: "GOOGLE_ADS",
        externalId: input.externalCampaignId,
        entries: metrics.map((row) => ({
          spentOn: row.date,
          amount: row.costMicros / 1_000_000,
          note: `${row.impressions} impressions, ${row.clicks} clicks, ${row.conversions} conversions`,
        })),
        createdByName: name ?? "Google Ads sync",
      });
      await markGoogleAdsSynced(admin, agencyId);
    }
  } catch (error) {
    const message =
      error instanceof MetaAdsError || error instanceof GoogleAdsError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not sync spend from the ad platform.";
    if (input.platform === "META_ADS") await markMetaAdsError(admin, agencyId, message);
    else await markGoogleAdsError(admin, agencyId, message);
    return { ok: false, error: message };
  }

  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

export async function createCampaignExperimentAction(
  input: CreateCampaignExperimentInput,
): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create a campaign experiment." };
  if (!input.hypothesis.trim()) return { ok: false, error: "State the hypothesis being tested." };
  if (input.variants.length < 2) return { ok: false, error: "An experiment needs at least two variants to compare." };

  const supabase = await db();
  await createCampaignExperiment(supabase, input);
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

export async function updateCampaignExperimentAction(input: {
  campaignId: string;
  experimentId: string;
  status?: CampaignExperimentStatus;
  decision?: string;
  notes?: string;
}): Promise<ActionResult> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot update a campaign experiment." };

  const supabase = await db();
  await updateCampaignExperiment(supabase, input.experimentId, {
    status: input.status,
    decision: input.decision,
    notes: input.notes,
  });
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}

/**
 * Drafts a target audience for this campaign via Manasik Marketing
 * Intelligence — never creates anything itself. The model may only pick
 * from real enum values (see llm/openrouter-provider.ts); the count shown
 * alongside the draft is computed live via the same `countDynamicAudience`
 * the Audiences module itself uses, never estimated by the model.
 */
export async function suggestCampaignAudienceAction(
  campaignId: string,
): Promise<
  | { ok: true; rationale: string; proposal: AudienceProposalFilters; liveCount: number; source: "RULES" | "LLM"; note: string | null }
  | { ok: false; error: string }
> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot draft a campaign audience." };

  const supabase = await db();
  const campaign = await getCampaign(supabase, campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  let linkedDeparture: { groupName: string; departureDate: string; availableSeats: number } | null = null;
  if (campaign.linked_departure_group_id) {
    const { data } = await supabase
      .from("departure_groups")
      .select("group_name, departure_date, available_seats")
      .eq("id", campaign.linked_departure_group_id)
      .maybeSingle();
    if (data) linkedDeparture = { groupName: data.group_name, departureDate: data.departure_date, availableSeats: data.available_seats };
  }

  const outcome = await getMarketingReasoningProvider().proposeAudience({
    campaignName: campaign.name,
    campaignTypeLabel: campaign.campaign_type,
    objectiveLabel: campaign.objective,
    linkedDeparture,
  });
  if (!outcome.proposal) return { ok: false, error: outcome.note ?? "No audience suggestion available." };

  const liveCount = await countDynamicAudience(supabase, outcome.proposal.proposal.subjectType, outcome.proposal.proposal.filters);
  return {
    ok: true,
    rationale: outcome.proposal.rationale,
    proposal: outcome.proposal.proposal,
    liveCount,
    source: outcome.source,
    note: outcome.note,
  };
}

/**
 * Turns an AI-suggested draft into a real, saved Audience — an explicit
 * human click, never automatic. Also links the new audience to this
 * campaign directly, since that's virtually always what the click means.
 */
export async function createAudienceFromCampaignProposalAction(input: {
  campaignId: string;
  name: string;
  proposal: AudienceProposalFilters;
}): Promise<ActionResult & { audienceId?: string }> {
  const { ok, name } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot create an audience." };
  if (!input.name.trim()) return { ok: false, error: "Give the audience a name." };

  const supabase = await db();
  const audience = await createAudience(supabase, {
    name: input.name.trim(),
    description: `Drafted by Manasik Marketing Intelligence for ${input.campaignId}.`,
    subjectType: input.proposal.subjectType,
    audienceType: "DYNAMIC",
    filters: input.proposal.filters,
    createdByName: name ?? "Staff",
  });

  const { error } = await supabase.from("campaigns").update({ audience_id: audience.id }).eq("id", input.campaignId);
  if (error) return { ok: false, error: error.message };

  revalidateCampaigns(input.campaignId);
  return { ok: true, audienceId: audience.id };
}

/**
 * Drafts campaign content (a WhatsApp message, landing copy, etc.) via
 * Manasik Marketing Intelligence. Returns text only — saving it as a
 * campaign_assets row (or a WhatsApp template submission) is a separate,
 * explicit human action; this never sends anything.
 */
export async function draftCampaignContentAction(input: {
  campaignId: string;
  language: "English" | "Tamil" | "Sinhala";
  tone: "WARM" | "PROFESSIONAL" | "SHORT_WHATSAPP";
}): Promise<{ ok: true; draftText: string; source: "RULES" | "LLM" } | { ok: false; error: string }> {
  const { ok } = await requireCanManage();
  if (!ok) return { ok: false, error: "Your role cannot draft campaign content." };

  const supabase = await db();
  const campaign = await getCampaign(supabase, input.campaignId);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const knownFacts: string[] = [];
  if (campaign.budget) knownFacts.push(`Budget: ${campaign.budget}`);
  if (campaign.booking_cutoff_at) knownFacts.push(`Booking cutoff: ${campaign.booking_cutoff_at.slice(0, 10)}`);
  if (campaign.linked_departure_group_id) {
    const { data } = await supabase
      .from("departure_groups")
      .select("group_name, departure_date, available_seats")
      .eq("id", campaign.linked_departure_group_id)
      .maybeSingle();
    if (data) knownFacts.push(`Departure: ${data.group_name}, ${data.departure_date}, ${data.available_seats} seats left`);
  }

  const outcome = await getMarketingReasoningProvider().draftContent({
    campaignName: campaign.name,
    campaignTypeLabel: campaign.campaign_type,
    objectiveLabel: campaign.objective,
    channel: campaign.channel,
    language: input.language,
    tone: input.tone,
    knownFacts,
  });
  if (!outcome.draftText) return { ok: false, error: outcome.note ?? "No content draft available." };
  return { ok: true, draftText: outcome.draftText, source: outcome.source };
}

/**
 * Attributes a lead to a campaign — the wiring that makes the campaign's
 * lead/booking/revenue metrics mean something. `attributionType` is left to
 * the person attributing it, never inferred: "unknown" is the honest
 * default even once a campaign_id is set.
 */
export async function setLeadCampaignAction(input: {
  leadId: string;
  campaignId: string | null;
  attributionType: AttributionType;
}): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesForLeads(role).editLead) {
    return { ok: false, error: "Your role cannot change a lead's campaign attribution." };
  }

  const supabase = await db();
  const { error } = await supabase
    .from("leads")
    .update({ campaign_id: input.campaignId, attribution_type: input.attributionType })
    .eq("id", input.leadId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/leads");
  revalidateCampaigns(input.campaignId ?? undefined);
  return { ok: true };
}

/**
 * Attributes a booking to a campaign directly — a booking can be attributed
 * without its originating lead ever having been (a walk-in that later saw a
 * retargeting ad, for instance). Gated the same as editing the booking
 * itself, not by the Marketing capability `setLeadCampaignAction` uses.
 */
export async function setBookingCampaignAction(input: {
  bookingId: string;
  groupId: string;
  campaignId: string | null;
  attributionType: AttributionType;
}): Promise<ActionResult> {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  if (!capabilitiesFor(role).editGroupDetails) {
    return { ok: false, error: "Your role cannot change a booking's campaign attribution." };
  }

  const supabase = await db();
  try {
    await setBookingCampaignAttribution(supabase, input.bookingId, input.campaignId, input.attributionType);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update attribution." };
  }

  revalidatePath(`/departure-groups/${input.groupId}/bookings/${input.bookingId}`);
  revalidateCampaigns(input.campaignId ?? undefined);
  return { ok: true };
}

/**
 * Acts on a CAMPAIGN insight from the campaign's own AI Analysis tab — the
 * same deterministic insights engine as /ai-insights
 * (lib/data/insights-repository.ts), just revalidating this campaign's page
 * too so the diagnosis card reflects the outcome immediately.
 */
export async function recordCampaignInsightOutcomeAction(input: {
  campaignId: string;
  insightId: string;
  outcomeType: InsightOutcomeType;
  note?: string;
}): Promise<ActionResult> {
  await requireUser();
  const { role, name } = await getCurrentStaffRole();
  if (!capabilitiesForMarketing(role).actOnDiagnosis) {
    return { ok: false, error: "Your role cannot act on campaign diagnosis." };
  }

  const supabase = await db();
  await recordInsightOutcome(supabase, {
    insightId: input.insightId,
    outcomeType: input.outcomeType,
    note: input.note?.trim() || null,
    actorName: name ?? "Staff",
  });
  revalidatePath("/ai-insights");
  revalidateCampaigns(input.campaignId);
  return { ok: true };
}
