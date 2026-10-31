/**
 * Campaign pulse block (docs/modules/dashboard-role-blocks-spec.md
 * section 3.2) — pure, client-safe.
 *
 * Every figure is read straight off `listCampaignsWithMetrics()` rows: the
 * lead and booking counts are that loader's own metrics, the targets and end
 * date are the campaign's own fields, and seats left is the linked
 * departure's live `available_seats`. This only picks which active
 * campaigns to show and in what order - it adds no "behind target" verdict,
 * so no new definition of "on track" appears on the dashboard.
 *
 * Carries no spend, revenue or margin.
 */

import type { CampaignWithMetrics } from "@/lib/types/campaigns";
import type { CampaignPulseData, CampaignPulseRow } from "@/lib/types/dashboard";

/** Top N campaigns plus the full active count — progressive disclosure, spec section 2. */
export const CAMPAIGN_PULSE_ROW_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildCampaignPulse(campaigns: CampaignWithMetrics[], nowIso: string): CampaignPulseData {
  const now = Date.parse(nowIso);
  const active = campaigns.filter((c) => c.status === "ACTIVE");

  // Ending soonest first - and an already-overran campaign sorts ahead of
  // every future one, which is where it wants attention. Undated last.
  const endMs = (c: CampaignWithMetrics) => (c.end_date ? Date.parse(c.end_date) : Number.POSITIVE_INFINITY);
  const ordered = [...active].sort((a, b) => endMs(a) - endMs(b));

  const rows: CampaignPulseRow[] = ordered.slice(0, CAMPAIGN_PULSE_ROW_LIMIT).map((c) => {
    const daysToEnd = c.end_date ? Math.ceil((Date.parse(c.end_date) - now) / DAY_MS) : null;
    return {
      campaignId: c.id,
      name: c.name,
      channel: c.channel,
      daysToEnd,
      pastEnd: c.end_date ? Date.parse(c.end_date) < now : false,
      leads: c.metrics.leadCount,
      targetLeads: c.target_leads,
      qualifiedLeads: c.metrics.qualifiedLeadCount,
      bookings: c.metrics.bookingCount,
      targetBookings: c.target_bookings,
      seatsLeft: c.capacity ? c.capacity.availableSeats : null,
      linkedGroupName: c.capacity ? c.capacity.groupName : null,
    };
  });

  return {
    counts: {
      active: active.length,
      scheduled: campaigns.filter((c) => c.status === "SCHEDULED").length,
      paused: campaigns.filter((c) => c.status === "PAUSED").length,
    },
    campaigns: rows,
    total: campaigns.length,
  };
}
