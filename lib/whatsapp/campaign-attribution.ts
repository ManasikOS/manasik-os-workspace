/**
 * Resolves a campaign from the opening WhatsApp message of a conversation —
 * the only automatic (non-staff) source of campaign attribution this app
 * has, per docs/modules/campaigns-command-center-implementation-plan.md §9.
 *
 * The only signal trustworthy enough to write a HIGH-confidence
 * `campaign_touchpoints` row is an exact match against a tracking code a
 * staff member deliberately registered as a `campaign_assets` row
 * (asset_type QR_CODE or TRACKING_LINK, e.g. a wa.me click-to-chat link whose
 * prefilled text includes the code, or a QR code printed with it). There is
 * no Meta ad-platform integration in this repo (see the plan's non-goals),
 * so a Click-to-WhatsApp-Ads `referral` payload cannot be mapped to a
 * specific campaign yet — this resolver deliberately does not guess from it.
 * No match means no touchpoint is written; never a lower-confidence guess.
 */
import "server-only";

import type { Db } from "@/lib/data/whatsapp-repository";

export interface ResolvedCampaignAttribution {
  campaignId: string;
  channel: string;
  trackingCode: string;
  sourceDetail: string;
}

export async function resolveCampaignAttributionFromMessageText(
  db: Db,
  agencyId: string,
  messageText: string,
): Promise<ResolvedCampaignAttribution | null> {
  const text = messageText.trim();
  if (!text) return null;

  // Two plain queries rather than a PostgREST embedded-join filter, matching
  // this codebase's convention of reading related tables directly (see the
  // header note in lib/data/campaigns-repository.ts) — a campaign's active
  // set is small, so this stays cheap on every inbound message.
  const { data: campaigns, error: campaignsError } = await db
    .from("campaigns")
    .select("id, channel")
    .eq("agency_id", agencyId)
    .in("status", ["ACTIVE", "SCHEDULED"]);

  // Never fail the webhook/agent turn over an attribution lookup — an
  // unattributed lead is the safe failure mode, not a broken message flow.
  if (campaignsError || !campaigns || campaigns.length === 0) return null;

  const campaignById = new Map((campaigns as { id: string; channel: string }[]).map((c) => [c.id, c.channel]));

  const { data: assets, error: assetsError } = await db
    .from("campaign_assets")
    .select("campaign_id, asset_type, qr_code_value")
    .eq("agency_id", agencyId)
    .in("asset_type", ["QR_CODE", "TRACKING_LINK"])
    .in("campaign_id", Array.from(campaignById.keys()))
    .not("qr_code_value", "is", null);
  if (assetsError || !assets) return null;

  const tokens = new Set(
    text
      .toUpperCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );

  for (const asset of assets as { campaign_id: string; asset_type: string; qr_code_value: string | null }[]) {
    const code = asset.qr_code_value?.trim();
    if (!code || !tokens.has(code.toUpperCase())) continue;

    const channel = campaignById.get(asset.campaign_id);
    if (!channel) continue; // asset's campaign fell outside the active set fetched above

    const label = asset.asset_type === "QR_CODE" ? "QR code" : "click-to-chat link";
    return {
      campaignId: asset.campaign_id,
      channel,
      trackingCode: code,
      sourceDetail: `WhatsApp ${label} ${code}`,
    };
  }

  return null;
}
