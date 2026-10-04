/**
 * Deterministic generators for "Manasik Marketing Intelligence" — Campaign
 * Diagnosis. Pure rules over campaigns/leads/lead_quotes/departure_groups/
 * campaign_spend_entries, no model call — same posture as
 * `stalled-leads.ts`. See
 * docs/modules/campaigns-command-center-implementation-plan.md §7.
 *
 * Each function below answers one of the brief's own diagnosis examples:
 *   - quote response bottleneck  → Example 1 (qualified leads waiting on a quote)
 *   - capacity conflict          → Example 2 (promoting a departure with too few seats left)
 *   - booking cutoff approaching → seats still open close to the hard cutoff
 *   - budget pacing              → spend-to-date vs bookings-to-date vs time remaining
 *
 * These never claim more certainty than the data supports: a capacity
 * conflict is reported only against `departure_groups.available_seats` (a
 * generated column, never stale), and a margin/quality claim is never made
 * here — see the module's plan §7.2 for what the AI layer must not do.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GeneratedInsight } from "@/lib/types/insights";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const CAMPAIGN_DIAGNOSIS_GENERATOR_VERSION = "campaign-diagnosis-v1";

const ACTIVE_STATUSES = new Set(["ACTIVE", "SCHEDULED", "PAUSED"]);
const QUALIFIED_STAGES = new Set(["QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "DEPOSIT_PENDING", "BOOKED"]);
const QUOTE_RESPONSE_SLA_HOURS = 24;
const BOOKING_CUTOFF_WARNING_DAYS = 10;

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  budget: number | null;
  start_date: string | null;
  end_date: string | null;
  booking_cutoff_at: string | null;
  linked_departure_group_id: string | null;
  target_bookings: number | null;
}

interface LeadRow {
  id: string;
  campaign_id: string;
  stage: string;
  created_at: string;
}

export async function generateCampaignDiagnosisInsights(client: Db): Promise<GeneratedInsight[]> {
  const { data: campaignRows, error: campaignError } = await client
    .from("campaigns")
    .select("id, name, status, budget, start_date, end_date, booking_cutoff_at, linked_departure_group_id, target_bookings")
    .in("status", [...ACTIVE_STATUSES]);
  if (campaignError) throw campaignError;

  const campaigns = (campaignRows ?? []) as CampaignRow[];
  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c) => c.id);

  const [leadsResult, spendResult, bookingsResult] = await Promise.all([
    client.from("leads").select("id, campaign_id, stage, created_at").in("campaign_id", campaignIds),
    client.from("campaign_spend_entries").select("campaign_id, amount").in("campaign_id", campaignIds),
    client
      .from("departure_group_bookings")
      .select("campaign_id, booking_status")
      .in("campaign_id", campaignIds)
      .not("booking_status", "eq", "CANCELLED"),
  ]);
  if (leadsResult.error) throw leadsResult.error;
  if (spendResult.error) throw spendResult.error;
  if (bookingsResult.error) throw bookingsResult.error;

  const leads = (leadsResult.data ?? []) as LeadRow[];
  const leadIds = leads.map((l) => l.id);

  const { data: quoteRows, error: quoteError } =
    leadIds.length > 0
      ? await client.from("lead_quotes").select("lead_id, created_at").in("lead_id", leadIds)
      : { data: [], error: null };
  if (quoteError) throw quoteError;
  const quotedLeadIds = new Set(((quoteRows ?? []) as { lead_id: string }[]).map((q) => q.lead_id));

  const spendByCampaign = new Map<string, number>();
  for (const row of (spendResult.data ?? []) as { campaign_id: string; amount: number }[]) {
    spendByCampaign.set(row.campaign_id, (spendByCampaign.get(row.campaign_id) ?? 0) + Number(row.amount));
  }

  const bookingCountByCampaign = new Map<string, number>();
  for (const row of (bookingsResult.data ?? []) as { campaign_id: string }[]) {
    bookingCountByCampaign.set(row.campaign_id, (bookingCountByCampaign.get(row.campaign_id) ?? 0) + 1);
  }

  const leadsByCampaign = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const list = leadsByCampaign.get(lead.campaign_id) ?? [];
    list.push(lead);
    leadsByCampaign.set(lead.campaign_id, list);
  }

  const linkedGroupIds = [...new Set(campaigns.map((c) => c.linked_departure_group_id).filter((id): id is string => !!id))];
  const groupById = new Map<string, { available_seats: number; sales_status: string; group_name: string }>();
  if (linkedGroupIds.length > 0) {
    const { data: groupRows, error: groupError } = await client
      .from("departure_groups")
      .select("id, available_seats, sales_status, group_name")
      .in("id", linkedGroupIds);
    if (groupError) throw groupError;
    for (const row of (groupRows ?? []) as { id: string; available_seats: number; sales_status: string; group_name: string }[]) {
      groupById.set(row.id, row);
    }
  }

  const now = Date.now();
  const insights: GeneratedInsight[] = [];

  for (const campaign of campaigns) {
    const campaignLeads = leadsByCampaign.get(campaign.id) ?? [];
    const qualifiedLeads = campaignLeads.filter((l) => QUALIFIED_STAGES.has(l.stage));
    const unquotedQualified = qualifiedLeads.filter((l) => !quotedLeadIds.has(l.id));

    // 1. Quote response bottleneck (brief Example 1).
    const overdueUnquoted = unquotedQualified.filter(
      (l) => (now - new Date(l.created_at).getTime()) / (1000 * 60 * 60) >= QUOTE_RESPONSE_SLA_HOURS,
    );
    if (overdueUnquoted.length >= 3) {
      insights.push({
        insightType: "CAMPAIGN_QUOTE_RESPONSE_BOTTLENECK",
        severity: overdueUnquoted.length >= 10 ? "CRITICAL" : "WARNING",
        title: `${campaign.name}: quote response is the bottleneck, not lead volume`,
        description: `${qualifiedLeads.length} qualified leads exist, but ${overdueUnquoted.length} have waited more than ${QUOTE_RESPONSE_SLA_HOURS} hours without a quote. Do not increase spend until these are resolved.`,
        subjectType: "CAMPAIGN",
        subjectId: campaign.id,
        generatorVersion: CAMPAIGN_DIAGNOSIS_GENERATOR_VERSION,
        evidence: [
          { label: "Qualified leads", detail: String(qualifiedLeads.length) },
          { label: "Quotes sent", detail: String(qualifiedLeads.length - unquotedQualified.length) },
          { label: `Qualified leads unquoted after ${QUOTE_RESPONSE_SLA_HOURS}h`, detail: String(overdueUnquoted.length) },
        ],
      });
    }

    // 2. Capacity conflict (brief Example 2) — the campaign is generating
    // more leads than the linked departure has seats to seat.
    if (campaign.linked_departure_group_id) {
      const group = groupById.get(campaign.linked_departure_group_id);
      if (group) {
        const openLeadCount = campaignLeads.filter((l) => !["LOST", "BOOKED", "DUPLICATE", "SPAM"].includes(l.stage)).length;
        if (group.sales_status === "SALES_CLOSED" || group.sales_status === "CANCELLED") {
          insights.push({
            insightType: "CAMPAIGN_CAPACITY_CONFLICT",
            severity: "CRITICAL",
            title: `${campaign.name}: promoting a departure that is no longer selling`,
            description: `${group.group_name} has sales_status "${group.sales_status}" but this campaign is still ${campaign.status.toLowerCase()}. Pause the campaign or relink it to an open departure.`,
            subjectType: "CAMPAIGN",
            subjectId: campaign.id,
            generatorVersion: CAMPAIGN_DIAGNOSIS_GENERATOR_VERSION,
            evidence: [
              { label: "Linked departure", detail: group.group_name },
              { label: "Sales status", detail: group.sales_status },
            ],
          });
        } else if (group.available_seats > 0 && openLeadCount > group.available_seats * 2) {
          insights.push({
            insightType: "CAMPAIGN_CAPACITY_CONFLICT",
            severity: "WARNING",
            title: `${campaign.name}: demand is outpacing remaining capacity`,
            description: `${openLeadCount} open enquiries are active for ${group.group_name}, which has only ${group.available_seats} seats left. Confirm additional inventory before sending another broadcast.`,
            subjectType: "CAMPAIGN",
            subjectId: campaign.id,
            generatorVersion: CAMPAIGN_DIAGNOSIS_GENERATOR_VERSION,
            evidence: [
              { label: "Linked departure", detail: group.group_name },
              { label: "Available seats", detail: String(group.available_seats) },
              { label: "Open enquiries", detail: String(openLeadCount) },
            ],
          });
        }
      }
    }

    // 3. Booking cutoff approaching with seats/target unmet.
    if (campaign.booking_cutoff_at) {
      const daysToCutoff = Math.ceil((new Date(campaign.booking_cutoff_at).getTime() - now) / (1000 * 60 * 60 * 24));
      const bookingCount = bookingCountByCampaign.get(campaign.id) ?? 0;
      const targetBookings = campaign.target_bookings;
      if (daysToCutoff >= 0 && daysToCutoff <= BOOKING_CUTOFF_WARNING_DAYS && targetBookings != null && bookingCount < targetBookings) {
        insights.push({
          insightType: "CAMPAIGN_BOOKING_CUTOFF_APPROACHING",
          severity: daysToCutoff <= 3 ? "CRITICAL" : "WARNING",
          title: `${campaign.name}: booking cutoff in ${daysToCutoff} day${daysToCutoff === 1 ? "" : "s"}, target not yet met`,
          description: `${bookingCount} of ${targetBookings} target bookings confirmed with ${daysToCutoff} days left before the booking cutoff.`,
          subjectType: "CAMPAIGN",
          subjectId: campaign.id,
          generatorVersion: CAMPAIGN_DIAGNOSIS_GENERATOR_VERSION,
          evidence: [
            { label: "Days to booking cutoff", detail: String(daysToCutoff) },
            { label: "Bookings so far", detail: String(bookingCount) },
            { label: "Target bookings", detail: String(targetBookings) },
          ],
        });
      }
    }

    // 4. Budget pacing — spend far ahead of bookings, with campaign window
    // more than half elapsed.
    const spend = spendByCampaign.get(campaign.id) ?? 0;
    if (campaign.budget && campaign.budget > 0 && campaign.end_date) {
      const spendRatio = spend / campaign.budget;
      const start = campaign.start_date ? new Date(campaign.start_date).getTime() : now;
      const end = new Date(campaign.end_date).getTime();
      const totalWindow = end - start;
      const elapsedRatio = totalWindow > 0 ? Math.min(Math.max((now - start) / totalWindow, 0), 1) : 1;
      const bookingCount = bookingCountByCampaign.get(campaign.id) ?? 0;
      if (spendRatio >= 0.8 && elapsedRatio < 0.6 && bookingCount === 0) {
        insights.push({
          insightType: "CAMPAIGN_BUDGET_AT_RISK",
          severity: spendRatio >= 1 ? "CRITICAL" : "WARNING",
          title: `${campaign.name}: budget spent well ahead of schedule with no bookings yet`,
          description: `${Math.round(spendRatio * 100)}% of budget spent with ${Math.round(elapsedRatio * 100)}% of the campaign window elapsed, and no confirmed bookings yet.`,
          subjectType: "CAMPAIGN",
          subjectId: campaign.id,
          generatorVersion: CAMPAIGN_DIAGNOSIS_GENERATOR_VERSION,
          evidence: [
            { label: "Spend", detail: `${Math.round(spendRatio * 100)}% of budget` },
            { label: "Campaign window elapsed", detail: `${Math.round(elapsedRatio * 100)}%` },
            { label: "Bookings so far", detail: String(bookingCount) },
          ],
        });
      }
    }
  }

  return insights;
}
