/**
 * Server-only read/write access for Campaigns.
 *
 * Backed by `campaigns` / `campaign_spend_entries` added in
 * `supabase/migrations/20261013090000_campaigns.sql`, the `campaign_id` /
 * `attribution_type` columns added to `leads` and `departure_group_bookings`
 * by the same migration, and the command-center extension in
 * `supabase/migrations/20261027090000_campaigns_command_center.sql`
 * (campaign_type, objective, linked package/departure/audience, targets,
 * campaign_touchpoints, campaign_assets). Metrics are computed live here —
 * never stored on the campaign row itself, so a metric can never disagree
 * with the leads/quotes/bookings it counts. See
 * docs/modules/campaigns-command-center-implementation-plan.md.
 *
 * Booking-level attribution is read directly (untyped column selection)
 * rather than through `DepartureGroupBookingRow` — that type is
 * constructed as object literals in many places across
 * `lib/data/departure-groups.ts`, and extending it here would mean
 * touching that module's construction sites for a read-only metric. See
 * the module's implementation notes.
 */

import "server-only";

import { missingContactExclusion } from "@/lib/data/campaign-audience-rules";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAudienceSubjectIds } from "@/lib/data/audiences-repository";
import type {
  AttributionType,
  CampaignAssetRow,
  CampaignAssetType,
  CampaignAudienceEligibility,
  CampaignAudienceSubject,
  CampaignCapacity,
  CampaignChannel,
  CampaignChannelRow,
  CampaignChannelStatus,
  CampaignChannelWithMetrics,
  CampaignExperimentRow,
  CampaignExperimentStatus,
  CampaignExperimentVariantRow,
  CampaignExperimentWithVariants,
  CampaignMetrics,
  CampaignObjective,
  CampaignRow,
  CampaignSpendEntryRow,
  CampaignStatus,
  CampaignTouchpointRow,
  CampaignType,
  CampaignWithMetrics,
  TouchType,
} from "@/lib/types/campaigns";
import type { ConsentChannel } from "@/lib/types/consent";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class CampaignPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Campaigns: ${operation} on ${table} failed — ${detail}`);
    this.name = "CampaignPersistenceError";
  }
}

interface DepartureGroupCapacityRow {
  id: string;
  group_name: string;
  group_code: string;
  departure_date: string;
  capacity: number;
  booked_seats: number;
  held_seats: number;
  available_seats: number;
  sales_status: string;
  group_status: string;
}

interface DepartureGroupCostingRow {
  departure_group_id: string;
  list_price: number | null;
  confirmed_pax: number | null;
  estimated_gross_margin: number | null;
}

/**
 * Every campaign with live metrics. Several round trips (campaigns, spend,
 * lead/quote/booking counts, linked-departure capacity, departure costing)
 * rather than a database view, since this table set is new and a view can
 * follow once the shape has proven stable — same reasoning as
 * `listAllItinerarySummaries`.
 */
export async function listCampaignsWithMetrics(client: Db): Promise<CampaignWithMetrics[]> {
  const [campaignsResult, spendResult, leadsResult, bookingsResult] = await Promise.all([
    client.from("campaigns").select("*").order("created_at", { ascending: false }),
    client.from("campaign_spend_entries").select("campaign_id, amount"),
    client.from("leads").select("id, campaign_id, stage").not("campaign_id", "is", null),
    client
      .from("departure_group_bookings")
      .select("campaign_id, booking_status, total_booking_value, amount_paid")
      .not("campaign_id", "is", null),
  ]);

  if (campaignsResult.error) throw new CampaignPersistenceError("campaigns", "select", campaignsResult.error);
  if (spendResult.error) throw new CampaignPersistenceError("campaign_spend_entries", "select", spendResult.error);
  if (leadsResult.error) throw new CampaignPersistenceError("leads", "select", leadsResult.error);
  if (bookingsResult.error)
    throw new CampaignPersistenceError("departure_group_bookings", "select", bookingsResult.error);

  const campaigns = (campaignsResult.data ?? []) as CampaignRow[];
  const QUALIFIED_STAGES = new Set(["QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "DEPOSIT_PENDING", "BOOKED"]);
  const attributedLeads = (leadsResult.data ?? []) as { id: string; campaign_id: string; stage: string }[];

  // Quotes have no campaign_id of their own — they're a lead-side concept —
  // so a per-campaign quote count/value is one extra hop through
  // lead_quotes, scoped to exactly the leads already attributed to a
  // campaign above.
  const quoteStatsByCampaign = new Map<string, { count: number; accepted: number; value: number }>();
  if (attributedLeads.length > 0) {
    const { data: quotesData, error: quotesError } = await client
      .from("lead_quotes")
      .select("lead_id, status, total_lkr")
      .in("lead_id", attributedLeads.map((l) => l.id));
    if (quotesError) throw new CampaignPersistenceError("lead_quotes", "select", quotesError);
    const campaignByLeadId = new Map(attributedLeads.map((l) => [l.id, l.campaign_id]));
    for (const row of (quotesData ?? []) as { lead_id: string; status: string; total_lkr: number }[]) {
      const campaignId = campaignByLeadId.get(row.lead_id);
      if (!campaignId) continue;
      const acc = quoteStatsByCampaign.get(campaignId) ?? { count: 0, accepted: 0, value: 0 };
      acc.count += 1;
      if (row.status === "ACCEPTED") acc.accepted += 1;
      acc.value += Number(row.total_lkr ?? 0);
      quoteStatsByCampaign.set(campaignId, acc);
    }
  }

  const spendByCampaign = new Map<string, number>();
  for (const row of (spendResult.data ?? []) as { campaign_id: string; amount: number }[]) {
    spendByCampaign.set(row.campaign_id, (spendByCampaign.get(row.campaign_id) ?? 0) + Number(row.amount));
  }

  const leadStatsByCampaign = new Map<string, { total: number; qualified: number }>();
  for (const row of attributedLeads) {
    const acc = leadStatsByCampaign.get(row.campaign_id) ?? { total: 0, qualified: 0 };
    acc.total += 1;
    if (QUALIFIED_STAGES.has(row.stage)) acc.qualified += 1;
    leadStatsByCampaign.set(row.campaign_id, acc);
  }

  const bookingStatsByCampaign = new Map<
    string,
    { count: number; revenue: number; collected: number }
  >();
  for (const row of (bookingsResult.data ?? []) as {
    campaign_id: string;
    booking_status: string;
    total_booking_value: number;
    amount_paid: number;
  }[]) {
    if (row.booking_status === "CANCELLED") continue;
    const acc = bookingStatsByCampaign.get(row.campaign_id) ?? { count: 0, revenue: 0, collected: 0 };
    acc.count += 1;
    acc.revenue += Number(row.total_booking_value);
    acc.collected += Number(row.amount_paid);
    bookingStatsByCampaign.set(row.campaign_id, acc);
  }

  // Capacity + costing for whichever campaigns actually link to a departure —
  // read live, never copied onto the campaign row (see available_seats,
  // a generated column, on departure_groups).
  const linkedGroupIds = [...new Set(campaigns.map((c) => c.linked_departure_group_id).filter((id): id is string => !!id))];
  const capacityByGroup = new Map<string, DepartureGroupCapacityRow>();
  const costingByGroup = new Map<string, DepartureGroupCostingRow>();
  if (linkedGroupIds.length > 0) {
    const [groupsResult, costingResult] = await Promise.all([
      client
        .from("departure_groups")
        .select("id, group_name, group_code, departure_date, capacity, booked_seats, held_seats, available_seats, sales_status, group_status")
        .in("id", linkedGroupIds),
      client
        .from("departure_group_costing")
        .select("departure_group_id, list_price, confirmed_pax, estimated_gross_margin")
        .in("departure_group_id", linkedGroupIds),
    ]);
    if (groupsResult.error) throw new CampaignPersistenceError("departure_groups", "select", groupsResult.error);
    // departure_group_costing is a best-effort view; missing rows just mean no margin estimate.
    if (!costingResult.error) {
      for (const row of (costingResult.data ?? []) as DepartureGroupCostingRow[]) {
        costingByGroup.set(row.departure_group_id, row);
      }
    }
    for (const row of (groupsResult.data ?? []) as DepartureGroupCapacityRow[]) {
      capacityByGroup.set(row.id, row);
    }
  }

  return campaigns.map((campaign) => {
    const leadStats = leadStatsByCampaign.get(campaign.id) ?? { total: 0, qualified: 0 };
    const bookingStats = bookingStatsByCampaign.get(campaign.id) ?? { count: 0, revenue: 0, collected: 0 };
    const quoteStats = quoteStatsByCampaign.get(campaign.id) ?? { count: 0, accepted: 0, value: 0 };
    const totalSpend = spendByCampaign.get(campaign.id) ?? 0;

    let estimatedGrossMargin: number | null = null;
    const group = campaign.linked_departure_group_id ? capacityByGroup.get(campaign.linked_departure_group_id) : undefined;
    const costing = campaign.linked_departure_group_id ? costingByGroup.get(campaign.linked_departure_group_id) : undefined;
    if (costing && costing.list_price && costing.confirmed_pax) {
      const departureBookedRevenue = costing.list_price * costing.confirmed_pax;
      if (departureBookedRevenue > 0 && costing.estimated_gross_margin != null) {
        const marginRatio = costing.estimated_gross_margin / departureBookedRevenue;
        estimatedGrossMargin = bookingStats.collected * marginRatio - totalSpend;
      }
    }

    const metrics: CampaignMetrics = {
      leadCount: leadStats.total,
      qualifiedLeadCount: leadStats.qualified,
      quoteCount: quoteStats.count,
      acceptedQuoteCount: quoteStats.accepted,
      quoteValue: quoteStats.value,
      bookingCount: bookingStats.count,
      revenue: bookingStats.revenue,
      collected: bookingStats.collected,
      outstanding: Math.max(bookingStats.revenue - bookingStats.collected, 0),
      totalSpend,
      conversionRate: leadStats.total > 0 ? bookingStats.count / leadStats.total : 0,
      qualifiedToQuoteRate: leadStats.qualified > 0 ? quoteStats.count / leadStats.qualified : 0,
      quoteToBookingRate: quoteStats.count > 0 ? bookingStats.count / quoteStats.count : 0,
      costPerQualifiedLead: leadStats.qualified > 0 ? totalSpend / leadStats.qualified : null,
      costPerBooking: bookingStats.count > 0 ? totalSpend / bookingStats.count : null,
      estimatedGrossMargin,
    };

    const capacity: CampaignCapacity | null = group
      ? {
          departureGroupId: group.id,
          groupName: group.group_name,
          groupCode: group.group_code,
          departureDate: group.departure_date,
          capacity: group.capacity,
          bookedSeats: group.booked_seats,
          heldSeats: group.held_seats,
          availableSeats: group.available_seats,
          salesStatus: group.sales_status,
          groupStatus: group.group_status,
        }
      : null;

    return { ...campaign, metrics, capacity } satisfies CampaignWithMetrics;
  });
}

export async function getCampaign(client: Db, campaignId: string): Promise<CampaignRow | null> {
  const { data, error } = await client.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error) throw new CampaignPersistenceError("campaigns", "select", error);
  return data as CampaignRow | null;
}

export interface CreateCampaignInput {
  name: string;
  channel: CampaignChannel;
  campaignType: CampaignType;
  objective: CampaignObjective;
  linkedPackageId: string | null;
  linkedDepartureGroupId: string | null;
  audienceId: string | null;
  startDate: string | null;
  endDate: string | null;
  bookingCutoffAt: string | null;
  budget: number | null;
  targetLeads: number | null;
  targetQualifiedLeads: number | null;
  targetQuotes: number | null;
  targetBookings: number | null;
  targetSeats: number | null;
  targetCollectedRevenue: number | null;
  targetMarginPct: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  notes: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdByName: string;
}

export async function createCampaign(client: Db, input: CreateCampaignInput): Promise<CampaignRow> {
  const { data, error } = await client
    .from("campaigns")
    .insert({
      name: input.name,
      channel: input.channel,
      campaign_type: input.campaignType,
      objective: input.objective,
      linked_package_id: input.linkedPackageId,
      linked_departure_group_id: input.linkedDepartureGroupId,
      audience_id: input.audienceId,
      start_date: input.startDate,
      end_date: input.endDate,
      booking_cutoff_at: input.bookingCutoffAt,
      budget: input.budget,
      target_leads: input.targetLeads,
      target_qualified_leads: input.targetQualifiedLeads,
      target_quotes: input.targetQuotes,
      target_bookings: input.targetBookings,
      target_seats: input.targetSeats,
      target_collected_revenue: input.targetCollectedRevenue,
      target_margin_pct: input.targetMarginPct,
      utm_source: input.utmSource,
      utm_medium: input.utmMedium,
      utm_campaign: input.utmCampaign,
      notes: input.notes,
      owner_id: input.ownerId,
      owner_name: input.ownerName,
      created_by_name: input.createdByName,
    })
    .select("*")
    .single();
  if (error) throw new CampaignPersistenceError("campaigns", "insert", error);
  return data as CampaignRow;
}

export async function updateCampaignStatus(client: Db, campaignId: string, status: CampaignStatus): Promise<void> {
  const { error } = await client.from("campaigns").update({ status }).eq("id", campaignId);
  if (error) throw new CampaignPersistenceError("campaigns", "update", error);
}

export async function listCampaignSpend(client: Db, campaignId: string): Promise<CampaignSpendEntryRow[]> {
  const { data, error } = await client
    .from("campaign_spend_entries")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("spent_on", { ascending: false });
  if (error) throw new CampaignPersistenceError("campaign_spend_entries", "select", error);
  return (data ?? []) as CampaignSpendEntryRow[];
}

export async function addCampaignSpend(
  client: Db,
  input: { campaignId: string; amount: number; spentOn: string; note: string | null; createdByName: string },
): Promise<void> {
  const { error } = await client.from("campaign_spend_entries").insert({
    campaign_id: input.campaignId,
    amount: input.amount,
    spent_on: input.spentOn,
    note: input.note,
    created_by_name: input.createdByName,
  });
  if (error) throw new CampaignPersistenceError("campaign_spend_entries", "insert", error);
}

export interface CampaignLeadRow {
  id: string;
  reference: string;
  fullName: string;
  stage: string;
  attributionType: string;
  createdAt: string;
}

/** A campaign's attributed leads, for its own Leads tab. */
export async function listCampaignLeads(client: Db, campaignId: string): Promise<CampaignLeadRow[]> {
  const { data, error } = await client
    .from("leads")
    .select("id, reference, full_name, stage, attribution_type, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw new CampaignPersistenceError("leads", "select", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    fullName: row.full_name,
    stage: row.stage,
    attributionType: row.attribution_type,
    createdAt: row.created_at,
  }));
}

export interface CampaignQuoteRow {
  id: string;
  reference: string;
  leadId: string;
  leadFullName: string;
  status: string;
  totalLkr: number;
  depositLkr: number;
  discountAmount: number;
  roomPreference: string;
  validUntil: string;
  createdAt: string;
}

/**
 * A campaign's attributed quotes, for its own Quotes tab — one extra hop
 * through lead_quotes since quotes have no campaign_id of their own (see
 * listCampaignsWithMetrics).
 */
export async function listCampaignQuotes(client: Db, campaignId: string): Promise<CampaignQuoteRow[]> {
  const { data: leadRows, error: leadError } = await client
    .from("leads")
    .select("id, full_name")
    .eq("campaign_id", campaignId);
  if (leadError) throw new CampaignPersistenceError("leads", "select", leadError);

  const leads = (leadRows ?? []) as { id: string; full_name: string }[];
  if (leads.length === 0) return [];

  const { data: quoteRows, error: quoteError } = await client
    .from("lead_quotes")
    .select("id, reference, lead_id, status, total_lkr, deposit_lkr, discount_amount, room_preference, valid_until, created_at")
    .in("lead_id", leads.map((l) => l.id))
    .order("created_at", { ascending: false });
  if (quoteError) throw new CampaignPersistenceError("lead_quotes", "select", quoteError);

  const nameByLeadId = new Map(leads.map((l) => [l.id, l.full_name]));
  return (quoteRows ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    leadId: row.lead_id,
    leadFullName: nameByLeadId.get(row.lead_id) ?? "Unknown lead",
    status: row.status,
    totalLkr: Number(row.total_lkr ?? 0),
    depositLkr: Number(row.deposit_lkr ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    roomPreference: row.room_preference,
    validUntil: row.valid_until,
    createdAt: row.created_at,
  }));
}

export interface CampaignBookingRow {
  id: string;
  departureGroupId: string;
  bookingReference: string;
  primaryContactName: string;
  bookingStatus: string;
  totalBookingValue: number;
  amountPaid: number;
  attributionType: string;
}

/** A campaign's attributed bookings, for its own Bookings tab. */
export async function listCampaignBookings(client: Db, campaignId: string): Promise<CampaignBookingRow[]> {
  const { data, error } = await client
    .from("departure_group_bookings")
    .select(
      "id, departure_group_id, booking_reference, primary_contact_name, booking_status, total_booking_value, amount_paid, attribution_type",
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw new CampaignPersistenceError("departure_group_bookings", "select", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    departureGroupId: row.departure_group_id,
    bookingReference: row.booking_reference,
    primaryContactName: row.primary_contact_name,
    bookingStatus: row.booking_status,
    totalBookingValue: Number(row.total_booking_value),
    amountPaid: Number(row.amount_paid),
    attributionType: row.attribution_type,
  }));
}

export interface CampaignOption {
  id: string;
  name: string;
  status: CampaignStatus;
}

/** For the lead drawer's "Attribute to campaign" picker. */
export async function listCampaignOptions(client: Db): Promise<CampaignOption[]> {
  const { data, error } = await client
    .from("campaigns")
    .select("id, name, status")
    .not("status", "eq", "ARCHIVED")
    .order("name", { ascending: true });
  if (error) throw new CampaignPersistenceError("campaigns", "select", error);
  return (data ?? []) as CampaignOption[];
}

export interface BookingCampaignAttribution {
  campaignId: string | null;
  attributionType: AttributionType;
}

/**
 * A single booking's own campaign_id/attribution_type — untyped column
 * selection for the same reason `CampaignBookingRow` above is: those two
 * columns don't exist on `DepartureGroupBookingRow`
 * (lib/types/departure-groups.ts), and adding them there would mean
 * touching every one of that type's many object-literal construction sites
 * in lib/data/departure-groups.ts for what is otherwise a two-column,
 * campaign-scoped concern. Read/set here instead, alongside its booking on
 * the booking's own detail screen.
 */
export async function getBookingCampaignAttribution(client: Db, bookingId: string): Promise<BookingCampaignAttribution> {
  const { data, error } = await client
    .from("departure_group_bookings")
    .select("campaign_id, attribution_type")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new CampaignPersistenceError("departure_group_bookings", "select", error);
  return {
    campaignId: (data?.campaign_id as string | null) ?? null,
    attributionType: (data?.attribution_type as AttributionType | undefined) ?? "UNKNOWN",
  };
}

export async function setBookingCampaignAttribution(
  client: Db,
  bookingId: string,
  campaignId: string | null,
  attributionType: AttributionType,
): Promise<void> {
  const { error } = await client
    .from("departure_group_bookings")
    .update({ campaign_id: campaignId, attribution_type: attributionType })
    .eq("id", bookingId);
  if (error) throw new CampaignPersistenceError("departure_group_bookings", "update", error);
}

/* ── Command-center additions: offer/audience option pickers ───────────── */

export interface CampaignPackageOption {
  id: string;
  title: string;
  internalCode: string;
}

/** Minimal package picker for the campaign create/edit Offer section. */
export async function listCampaignPackageOptions(client: Db): Promise<CampaignPackageOption[]> {
  const { data, error } = await client
    .from("packages")
    .select("id, title, internal_code")
    .order("updated_at", { ascending: false });
  if (error) throw new CampaignPersistenceError("packages", "select", error);
  return (data ?? []).map((row) => ({ id: row.id, title: row.title || "Untitled package", internalCode: row.internal_code }));
}

export interface CampaignDepartureGroupOption {
  id: string;
  groupName: string;
  groupCode: string;
  packageTemplateId: string;
  departureDate: string;
  availableSeats: number;
  salesStatus: string;
  groupStatus: string;
}

/**
 * Departure group picker for the campaign create/edit Offer section —
 * carries live capacity/status inline so marketing sees whether a group is
 * even promotable before linking a campaign to it (the brief's capacity-
 * protection rule).
 */
export async function listCampaignDepartureGroupOptions(client: Db): Promise<CampaignDepartureGroupOption[]> {
  const { data, error } = await client
    .from("departure_groups")
    .select("id, group_name, group_code, package_template_id, departure_date, available_seats, sales_status, group_status")
    .not("group_status", "in", "(DEPARTED,COMPLETED,CLOSED,CANCELLED)")
    .order("departure_date", { ascending: true });
  if (error) throw new CampaignPersistenceError("departure_groups", "select", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    groupName: row.group_name,
    groupCode: row.group_code,
    packageTemplateId: row.package_template_id,
    departureDate: row.departure_date,
    availableSeats: row.available_seats,
    salesStatus: row.sales_status,
    groupStatus: row.group_status,
  }));
}

export interface CampaignAudienceOption {
  id: string;
  name: string;
  subjectType: string;
  audienceType: string;
  computedCount: number;
}

/** Saved-audience picker for the campaign create/edit Audience section. */
export async function listCampaignAudienceOptions(client: Db): Promise<CampaignAudienceOption[]> {
  const { data, error } = await client
    .from("audiences")
    .select("id, name, subject_type, audience_type, computed_count")
    .order("name", { ascending: true });
  if (error) throw new CampaignPersistenceError("audiences", "select", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    subjectType: row.subject_type,
    audienceType: row.audience_type,
    computedCount: row.computed_count,
  }));
}

/**
 * Checks whether a departure group can still be promoted — used server-side
 * at campaign create/activate time, per
 * docs/modules/campaigns-command-center-implementation-plan.md §6.2/§8: a campaign
 * must not continue promoting a full or closed departure.
 */
export async function getCampaignCapacityWarning(client: Db, departureGroupId: string): Promise<string | null> {
  const { data, error } = await client
    .from("departure_groups")
    .select("available_seats, sales_status")
    .eq("id", departureGroupId)
    .maybeSingle();
  if (error) throw new CampaignPersistenceError("departure_groups", "select", error);
  if (!data) return null;
  if (data.sales_status === "SALES_CLOSED" || data.sales_status === "CANCELLED") {
    return "This departure's sales are closed — promoting it will generate enquiries operations cannot fulfil.";
  }
  if (data.available_seats === 0) {
    return "This departure has no seats available — consider linking a different departure or package variant.";
  }
  return null;
}

/* ── Command-center additions: attribution touchpoints ──────────────────── */

export interface AddCampaignTouchpointInput {
  campaignId: string;
  leadId: string | null;
  bookingId: string | null;
  touchType: TouchType;
  channel: string | null;
  sourceDetail: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  trackingCode: string | null;
  attributionConfidence: CampaignTouchpointRow["attribution_confidence"];
  occurredAt: string | null;
  /**
   * Only needed when `client` is a service-role admin client with no staff
   * session for `agency_id`'s column default (`current_agency_id()`) to
   * resolve — e.g. the WhatsApp webhook/agent path. Staff-triggered callers
   * on the session-scoped client should omit this and let the default apply.
   */
  agencyId?: string;
}

export async function addCampaignTouchpoint(client: Db, input: AddCampaignTouchpointInput): Promise<void> {
  const { error } = await client.from("campaign_touchpoints").insert({
    ...(input.agencyId ? { agency_id: input.agencyId } : {}),
    campaign_id: input.campaignId,
    lead_id: input.leadId,
    booking_id: input.bookingId,
    touch_type: input.touchType,
    channel: input.channel,
    source_detail: input.sourceDetail,
    utm_source: input.utmSource,
    utm_medium: input.utmMedium,
    utm_campaign: input.utmCampaign,
    utm_content: input.utmContent,
    utm_term: input.utmTerm,
    tracking_code: input.trackingCode,
    attribution_confidence: input.attributionConfidence,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
  });
  if (error) throw new CampaignPersistenceError("campaign_touchpoints", "insert", error);
}

/**
 * The three attribution views the brief asks for — first touch, last touch,
 * assisted — read straight from campaign_touchpoints. No weighting/decay
 * logic: each view is simply "every touchpoint of this type", left to the
 * reader to interpret. See the module's plan §5 point 4.
 */
export async function listCampaignTouchpoints(
  client: Db,
  campaignId: string,
  touchType?: TouchType,
): Promise<CampaignTouchpointRow[]> {
  let query = client
    .from("campaign_touchpoints")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("occurred_at", { ascending: false });
  if (touchType) query = query.eq("touch_type", touchType);
  const { data, error } = await query;
  if (error) throw new CampaignPersistenceError("campaign_touchpoints", "select", error);
  return (data ?? []) as CampaignTouchpointRow[];
}

/* ── Command-center additions: campaign assets ──────────────────────────── */

export interface AddCampaignAssetInput {
  campaignId: string;
  assetType: CampaignAssetType;
  referenceId: string | null;
  label: string;
  language: string | null;
  url: string | null;
  qrCodeValue: string | null;
  notes: string | null;
  createdByName: string;
}

export async function addCampaignAsset(client: Db, input: AddCampaignAssetInput): Promise<void> {
  const { error } = await client.from("campaign_assets").insert({
    campaign_id: input.campaignId,
    asset_type: input.assetType,
    reference_id: input.referenceId,
    label: input.label,
    language: input.language,
    url: input.url,
    qr_code_value: input.qrCodeValue,
    notes: input.notes,
    created_by_name: input.createdByName,
  });
  if (error) throw new CampaignPersistenceError("campaign_assets", "insert", error);
}

export async function listCampaignAssets(client: Db, campaignId: string): Promise<CampaignAssetRow[]> {
  const { data, error } = await client
    .from("campaign_assets")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw new CampaignPersistenceError("campaign_assets", "select", error);
  return (data ?? []) as CampaignAssetRow[];
}

/** For the Content tab's MESSAGE_TEMPLATE picker — only templates Meta has actually approved. */
export interface WhatsAppTemplateOption {
  id: string;
  name: string;
  language: string;
  category: string;
}

export async function listApprovedWhatsAppTemplateOptions(client: Db): Promise<WhatsAppTemplateOption[]> {
  const { data, error } = await client
    .from("whatsapp_templates")
    .select("id, name, language, category")
    .eq("status", "APPROVED")
    .order("name", { ascending: true });
  if (error) throw new CampaignPersistenceError("whatsapp_templates", "select", error);
  return (data ?? []) as WhatsAppTemplateOption[];
}

/* ── V2: campaign_channels — per-channel breakdown ───────────────────────── */

export interface AddCampaignChannelInput {
  campaignId: string;
  channel: CampaignChannel;
  ownerId: string | null;
  budgetAllocation: number | null;
  trackingLink: string | null;
  assetId: string | null;
  notes: string | null;
}

export async function addCampaignChannel(client: Db, input: AddCampaignChannelInput): Promise<void> {
  const { error } = await client.from("campaign_channels").insert({
    campaign_id: input.campaignId,
    channel: input.channel,
    owner_id: input.ownerId,
    budget_allocation: input.budgetAllocation,
    tracking_link: input.trackingLink,
    asset_id: input.assetId,
    notes: input.notes,
  });
  if (error) throw new CampaignPersistenceError("campaign_channels", "insert", error);
}

export async function updateCampaignChannelStatus(
  client: Db,
  channelId: string,
  status: CampaignChannelStatus,
): Promise<void> {
  const { error } = await client.from("campaign_channels").update({ status }).eq("id", channelId);
  if (error) throw new CampaignPersistenceError("campaign_channels", "update", error);
}

/**
 * Every channel row for a campaign, with leads/qualified/bookings/spend
 * derived from campaign_touchpoints.channel and campaign_spend_entries —
 * never stored on the channel row itself, same "derive, don't cache"
 * convention as the campaign-level metrics. Touchpoint data only exists
 * once something writes to campaign_touchpoints (a later integration); until
 * then every channel simply reads zero leads, which is honest, not broken.
 */
export async function listCampaignChannelsWithMetrics(client: Db, campaignId: string): Promise<CampaignChannelWithMetrics[]> {
  const { data: channelRows, error: channelError } = await client
    .from("campaign_channels")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (channelError) throw new CampaignPersistenceError("campaign_channels", "select", channelError);
  const channels = (channelRows ?? []) as CampaignChannelRow[];
  if (channels.length === 0) return [];

  const [touchpointsResult, spendResult] = await Promise.all([
    client.from("campaign_touchpoints").select("channel, lead_id").eq("campaign_id", campaignId),
    client.from("campaign_spend_entries").select("amount, note").eq("campaign_id", campaignId),
  ]);
  if (touchpointsResult.error) throw new CampaignPersistenceError("campaign_touchpoints", "select", touchpointsResult.error);
  if (spendResult.error) throw new CampaignPersistenceError("campaign_spend_entries", "select", spendResult.error);

  const leadIdsByChannel = new Map<string, Set<string>>();
  for (const row of (touchpointsResult.data ?? []) as { channel: string | null; lead_id: string | null }[]) {
    if (!row.channel || !row.lead_id) continue;
    const set = leadIdsByChannel.get(row.channel) ?? new Set<string>();
    set.add(row.lead_id);
    leadIdsByChannel.set(row.channel, set);
  }

  const allLeadIds = [...new Set([...leadIdsByChannel.values()].flatMap((s) => [...s]))];
  const stageByLeadId = new Map<string, string>();
  if (allLeadIds.length > 0) {
    const { data: leadRows, error: leadError } = await client.from("leads").select("id, stage").in("id", allLeadIds);
    if (leadError) throw new CampaignPersistenceError("leads", "select", leadError);
    for (const row of (leadRows ?? []) as { id: string; stage: string }[]) stageByLeadId.set(row.id, row.stage);
  }
  const QUALIFIED_STAGES = new Set(["QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "DEPOSIT_PENDING", "BOOKED"]);

  // Spend is only attributed per channel when its note starts with "[CHANNEL] " —
  // there's no channel column on campaign_spend_entries (it's campaign-wide by
  // design, see the V1 plan), so unattributed spend is simply left out of every
  // channel's own total rather than guessed at.
  const spendByChannel = new Map<string, number>();
  for (const row of (spendResult.data ?? []) as { amount: number; note: string | null }[]) {
    const match = row.note?.match(/^\[(\w+)\]/);
    if (!match) continue;
    spendByChannel.set(match[1], (spendByChannel.get(match[1]) ?? 0) + Number(row.amount));
  }

  return channels.map((channel) => {
    const leadIds = leadIdsByChannel.get(channel.channel) ?? new Set<string>();
    let qualified = 0;
    let booked = 0;
    for (const leadId of leadIds) {
      const stage = stageByLeadId.get(leadId);
      if (stage && QUALIFIED_STAGES.has(stage)) qualified += 1;
      if (stage === "BOOKED") booked += 1;
    }
    return {
      ...channel,
      metrics: {
        leadCount: leadIds.size,
        qualifiedLeadCount: qualified,
        bookingCount: booked,
        spend: spendByChannel.get(channel.channel) ?? 0,
      },
    } satisfies CampaignChannelWithMetrics;
  });
}

/* ── V2: campaign_experiments / campaign_experiment_variants ─────────────── */

export interface CreateCampaignExperimentInput {
  campaignId: string;
  hypothesis: string;
  primaryMetric: string;
  variants: { variantLabel: string; description: string | null; audienceSplitPct: number | null }[];
}

export async function createCampaignExperiment(client: Db, input: CreateCampaignExperimentInput): Promise<void> {
  const { data, error } = await client
    .from("campaign_experiments")
    .insert({ campaign_id: input.campaignId, hypothesis: input.hypothesis, primary_metric: input.primaryMetric })
    .select("id")
    .single();
  if (error) throw new CampaignPersistenceError("campaign_experiments", "insert", error);

  const experimentId = (data as { id: string }).id;
  if (input.variants.length > 0) {
    const { error: variantError } = await client.from("campaign_experiment_variants").insert(
      input.variants.map((v) => ({
        experiment_id: experimentId,
        variant_label: v.variantLabel,
        description: v.description,
        audience_split_pct: v.audienceSplitPct,
      })),
    );
    if (variantError) throw new CampaignPersistenceError("campaign_experiment_variants", "insert", variantError);
  }
}

export async function updateCampaignExperiment(
  client: Db,
  experimentId: string,
  input: { status?: CampaignExperimentStatus; decision?: string | null; notes?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (input.status) {
    update.status = input.status;
    if (input.status === "RUNNING") update.started_at = new Date().toISOString();
    if (input.status === "COMPLETE") update.ended_at = new Date().toISOString();
  }
  if (input.decision !== undefined) update.decision = input.decision;
  if (input.notes !== undefined) update.notes = input.notes;
  const { error } = await client.from("campaign_experiments").update(update).eq("id", experimentId);
  if (error) throw new CampaignPersistenceError("campaign_experiments", "update", error);
}

export async function listCampaignExperiments(client: Db, campaignId: string): Promise<CampaignExperimentWithVariants[]> {
  const { data: experimentRows, error: experimentError } = await client
    .from("campaign_experiments")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (experimentError) throw new CampaignPersistenceError("campaign_experiments", "select", experimentError);
  const experiments = (experimentRows ?? []) as CampaignExperimentRow[];
  if (experiments.length === 0) return [];

  const { data: variantRows, error: variantError } = await client
    .from("campaign_experiment_variants")
    .select("*")
    .in("experiment_id", experiments.map((e) => e.id))
    .order("created_at", { ascending: true });
  if (variantError) throw new CampaignPersistenceError("campaign_experiment_variants", "select", variantError);

  const variantsByExperiment = new Map<string, CampaignExperimentVariantRow[]>();
  for (const row of (variantRows ?? []) as CampaignExperimentVariantRow[]) {
    const list = variantsByExperiment.get(row.experiment_id) ?? [];
    list.push(row);
    variantsByExperiment.set(row.experiment_id, list);
  }

  return experiments.map((e) => ({ ...e, variants: variantsByExperiment.get(e.id) ?? [] }));
}

/* ── V2: Audience tab — eligible/excluded breakdown ──────────────────────── */

const CAMPAIGN_CHANNEL_TO_CONSENT: Partial<Record<CampaignChannel, ConsentChannel>> = {
  WHATSAPP: "WHATSAPP",
};
const RECENT_TOUCH_WINDOW_DAYS = 14;
const SUBJECT_PREVIEW_LIMIT = 200;

/**
 * A campaign's own Audience tab: resolves campaign.audience_id the same way
 * Announcements resolves a broadcast target (lib/data/announcements-repository.ts
 * `resolveRecipients`), re-checking consent live rather than trusting the
 * audience's cached size, then adds two campaign-specific exclusion checks
 * Announcements has no reason to make: "already booked this departure" (only
 * when the campaign links one) and "duplicate phone number" within the
 * resolved set. A subject can carry more than one exclusion reason in
 * principle; only the first one found is reported, in the same priority
 * order as the brief's own example.
 */
export async function getCampaignAudienceEligibility(client: Db, campaignId: string): Promise<CampaignAudienceEligibility | null> {
  const { data: campaignRow, error: campaignError } = await client
    .from("campaigns")
    .select("audience_id, channel, linked_departure_group_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError) throw new CampaignPersistenceError("campaigns", "select", campaignError);
  if (!campaignRow?.audience_id) return null;

  const { data: audienceRow, error: audienceError } = await client
    .from("audiences")
    .select("id, name")
    .eq("id", campaignRow.audience_id)
    .maybeSingle();
  if (audienceError) throw new CampaignPersistenceError("audiences", "select", audienceError);
  if (!audienceRow) return null;

  const resolved = await resolveAudienceSubjectIds(client, campaignRow.audience_id);
  if (resolved.subjectIds.length === 0) {
    return {
      audienceId: audienceRow.id,
      audienceName: audienceRow.name,
      totalSubjects: 0,
      eligibleCount: 0,
      excludedCount: 0,
      exclusionReasons: [],
      subjects: [],
    };
  }

  const table = resolved.subjectType === "LEAD" ? "leads" : "pilgrims";
  const nameCol = "full_name";
  const contactCol = resolved.subjectType === "LEAD" ? "mobile" : "whatsapp_number";
  const { data: subjectRows, error: subjectError } = await client
    .from(table)
    .select(`id, ${nameCol}, ${contactCol}, do_not_contact, contactable_channels`)
    .in("id", resolved.subjectIds);
  if (subjectError) throw new CampaignPersistenceError(table, "select", subjectError);

  // "Already booked this departure" — only meaningful when the campaign
  // links one, and only checkable for LEAD audiences (leads.booking_id) and
  // PILGRIM audiences (departure_group_pilgrims), each looked up separately.
  const alreadyBookedIds = new Set<string>();
  if (campaignRow.linked_departure_group_id) {
    if (resolved.subjectType === "LEAD") {
      const { data: bookedLeads, error: bookedError } = await client
        .from("leads")
        .select("id, booking_id")
        .in("id", resolved.subjectIds)
        .not("booking_id", "is", null);
      if (bookedError) throw new CampaignPersistenceError("leads", "select", bookedError);
      const bookingIds = ((bookedLeads ?? []) as { id: string; booking_id: string }[]).map((r) => r.booking_id);
      if (bookingIds.length > 0) {
        const { data: bookingsInGroup } = await client
          .from("departure_group_bookings")
          .select("id")
          .in("id", bookingIds)
          .eq("departure_group_id", campaignRow.linked_departure_group_id);
        const bookingIdsInGroup = new Set(((bookingsInGroup ?? []) as { id: string }[]).map((r) => r.id));
        for (const row of (bookedLeads ?? []) as { id: string; booking_id: string }[]) {
          if (bookingIdsInGroup.has(row.booking_id)) alreadyBookedIds.add(row.id);
        }
      }
    } else {
      const { data: pilgrimsInGroup } = await client
        .from("departure_group_pilgrims")
        .select("pilgrim_id")
        .eq("departure_group_id", campaignRow.linked_departure_group_id)
        .in("pilgrim_id", resolved.subjectIds);
      for (const row of (pilgrimsInGroup ?? []) as { pilgrim_id: string }[]) alreadyBookedIds.add(row.pilgrim_id);
    }
  }

  // "Received a similar campaign recently" — another campaign of the same
  // type touched this subject within the last 14 days. Only ever non-empty
  // once something is actually writing to campaign_touchpoints.
  const recentTouchIds = new Set<string>();
  if (resolved.subjectType === "LEAD") {
    const since = new Date(Date.now() - RECENT_TOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentTouches } = await client
      .from("campaign_touchpoints")
      .select("lead_id")
      .neq("campaign_id", campaignId)
      .in("lead_id", resolved.subjectIds)
      .gte("occurred_at", since);
    for (const row of (recentTouches ?? []) as { lead_id: string }[]) recentTouchIds.add(row.lead_id);
  }

  // Duplicate phone numbers within this resolved set — the first occurrence
  // of a number is not excluded, later ones are.
  const seenContacts = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const row of (subjectRows ?? []) as Record<string, unknown>[]) {
    const contact = (row[contactCol] as string | null) ?? null;
    if (!contact) continue;
    if (seenContacts.has(contact)) duplicateIds.add(row.id as string);
    else seenContacts.add(contact);
  }

  const requiredChannel = CAMPAIGN_CHANNEL_TO_CONSENT[campaignRow.channel as CampaignChannel];
  const exclusionCounts = new Map<string, number>();
  const subjects: CampaignAudienceSubject[] = [];

  for (const row of (subjectRows ?? []) as Record<string, unknown>[]) {
    const id = row.id as string;
    const doNotContact = row.do_not_contact as boolean;
    const channels = (row.contactable_channels as ConsentChannel[] | null) ?? [];

    let exclusionReason: string | null = null;
    if (doNotContact) exclusionReason = "Marked do-not-contact";
    else if (missingContactExclusion(campaignRow.channel as string, row[contactCol] as string | null)) {
      // A lead from Messenger or Instagram has no phone until they give one; a WhatsApp campaign cannot reach them.
      exclusionReason = missingContactExclusion(campaignRow.channel as string, row[contactCol] as string | null);
    } else if (requiredChannel && !channels.includes(requiredChannel)) exclusionReason = `Not opted in for ${requiredChannel}`;
    else if (alreadyBookedIds.has(id)) exclusionReason = "Already booked this departure";
    else if (duplicateIds.has(id)) exclusionReason = "Duplicate phone number";
    else if (recentTouchIds.has(id)) exclusionReason = "Received a similar campaign in the last 14 days";

    if (exclusionReason) exclusionCounts.set(exclusionReason, (exclusionCounts.get(exclusionReason) ?? 0) + 1);

    if (subjects.length < SUBJECT_PREVIEW_LIMIT) {
      subjects.push({
        subjectType: resolved.subjectType,
        subjectId: id,
        name: (row[nameCol] as string) ?? "Unknown",
        contact: (row[contactCol] as string | null) ?? null,
        eligible: !exclusionReason,
        exclusionReason,
      });
    }
  }

  const excludedCount = [...exclusionCounts.values()].reduce((sum, n) => sum + n, 0);

  return {
    audienceId: audienceRow.id,
    audienceName: audienceRow.name,
    totalSubjects: resolved.subjectIds.length,
    eligibleCount: resolved.subjectIds.length - excludedCount,
    excludedCount,
    exclusionReasons: [...exclusionCounts.entries()].map(([reason, count]) => ({ reason, count })),
    subjects,
  };
}

/* ── V3: ad-platform spend sync ──────────────────────────────────────────── */

export async function linkCampaignChannelExternalCampaign(
  client: Db,
  channelId: string,
  platform: "META_ADS" | "GOOGLE_ADS",
  externalCampaignId: string,
): Promise<void> {
  const { error } = await client
    .from("campaign_channels")
    .update({ external_platform: platform, external_campaign_id: externalCampaignId })
    .eq("id", channelId);
  if (error) throw new CampaignPersistenceError("campaign_channels", "update", error);
}

export interface SyncedSpendEntry {
  spentOn: string; // YYYY-MM-DD
  amount: number;
  note: string | null;
}

/**
 * Upserts one platform's daily spend entries for one campaign/channel —
 * keyed by (campaign_id, source, external_id, spent_on), see the unique
 * index in 20261029090000_campaigns_ad_platform_integrations.sql §F, so
 * re-running a sync for the same date range updates the same rows instead
 * of creating duplicates. `externalId` is the ad platform's own campaign id
 * — stable across syncs, unlike a row id campaigns.actions.ts has no
 * knowledge of.
 */
export async function upsertSyncedCampaignSpend(
  client: Db,
  input: { campaignId: string; source: "META_ADS" | "GOOGLE_ADS"; externalId: string; entries: SyncedSpendEntry[]; createdByName: string },
): Promise<void> {
  if (input.entries.length === 0) return;
  const { error } = await client.from("campaign_spend_entries").upsert(
    input.entries.map((e) => ({
      campaign_id: input.campaignId,
      amount: e.amount,
      spent_on: e.spentOn,
      note: e.note,
      source: input.source,
      external_id: input.externalId,
      created_by_name: input.createdByName,
    })),
    { onConflict: "campaign_id,source,external_id,spent_on" },
  );
  if (error) throw new CampaignPersistenceError("campaign_spend_entries", "insert", error);
}

/* ── V3: weighted / time-decay attribution ───────────────────────────────── */

export interface WeightedAttributionRow {
  channel: string | null;
  touchCount: number;
  /** Sum of this channel's exponential-decay weight across every booking's touchpoints, as a share of 1.0 per booking. */
  weightedBookings: number;
  /** weightedBookings × that booking's collected amount, summed — an apportioned view of collected revenue, not a duplicate count. */
  weightedCollectedRevenue: number;
}

/**
 * Configurable time-decay attribution: for each booking with at least one
 * touchpoint, every touchpoint's weight is `2^(-daysBeforeBooking / halfLifeDays)`
 * (an exponential half-life — a touch exactly one half-life before the
 * booking counts for half as much as a touch on the booking day itself),
 * normalized so one booking's touchpoint weights sum to 1. A channel's
 * `weightedBookings` is the sum of its share across every booking, and
 * `weightedCollectedRevenue` apportions that booking's actual collected
 * amount by the same share — so summing this column across channels never
 * exceeds the campaign's real total collected revenue.
 *
 * Only ever produces results once something writes to campaign_touchpoints
 * with a booking_id — see docs/modules/campaigns-command-center-implementation-plan.md
 * §7.3 and the follow-up task on automatic touchpoint creation.
 */
export async function getCampaignWeightedAttribution(
  client: Db,
  campaignId: string,
  halfLifeDays = 7,
): Promise<WeightedAttributionRow[]> {
  const { data: touchRows, error: touchError } = await client
    .from("campaign_touchpoints")
    .select("booking_id, channel, occurred_at")
    .eq("campaign_id", campaignId)
    .not("booking_id", "is", null);
  if (touchError) throw new CampaignPersistenceError("campaign_touchpoints", "select", touchError);

  const touches = (touchRows ?? []) as { booking_id: string; channel: string | null; occurred_at: string }[];
  if (touches.length === 0) return [];

  const bookingIds = [...new Set(touches.map((t) => t.booking_id))];
  const { data: bookingRows, error: bookingError } = await client
    .from("departure_group_bookings")
    .select("id, amount_paid, created_at, booking_status")
    .in("id", bookingIds);
  if (bookingError) throw new CampaignPersistenceError("departure_group_bookings", "select", bookingError);

  const bookingById = new Map(
    ((bookingRows ?? []) as { id: string; amount_paid: number; created_at: string; booking_status: string }[])
      .filter((b) => b.booking_status !== "CANCELLED")
      .map((b) => [b.id, b]),
  );

  const touchesByBooking = new Map<string, { channel: string | null; occurred_at: string }[]>();
  for (const t of touches) {
    if (!bookingById.has(t.booking_id)) continue;
    const list = touchesByBooking.get(t.booking_id) ?? [];
    list.push({ channel: t.channel, occurred_at: t.occurred_at });
    touchesByBooking.set(t.booking_id, list);
  }

  const statsByChannel = new Map<string | null, { touchCount: number; weightedBookings: number; weightedCollectedRevenue: number }>();

  for (const [bookingId, bookingTouches] of touchesByBooking) {
    const booking = bookingById.get(bookingId);
    if (!booking) continue;
    const bookingTime = new Date(booking.created_at).getTime();

    const rawWeights = bookingTouches.map((t) => {
      const daysBefore = Math.max((bookingTime - new Date(t.occurred_at).getTime()) / (1000 * 60 * 60 * 24), 0);
      return { channel: t.channel, weight: Math.pow(2, -daysBefore / halfLifeDays) };
    });
    const totalWeight = rawWeights.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight === 0) continue;

    for (const w of rawWeights) {
      const share = w.weight / totalWeight;
      const acc = statsByChannel.get(w.channel) ?? { touchCount: 0, weightedBookings: 0, weightedCollectedRevenue: 0 };
      acc.touchCount += 1;
      acc.weightedBookings += share;
      acc.weightedCollectedRevenue += share * Number(booking.amount_paid ?? 0);
      statsByChannel.set(w.channel, acc);
    }
  }

  return [...statsByChannel.entries()]
    .map(([channel, stats]) => ({ channel, ...stats }))
    .sort((a, b) => b.weightedCollectedRevenue - a.weightedCollectedRevenue);
}
