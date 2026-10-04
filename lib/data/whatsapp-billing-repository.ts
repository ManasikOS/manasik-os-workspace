/**
 * WhatsApp billing and usage tracker data access — §5 E10 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md.
 *
 * Two write paths, kept distinct per D10:
 *  - `upsertMessageCharge` is called from the webhook (fast path, admin
 *    client, no session) whenever a `statuses[].pricing` object arrives —
 *    it is the CRM's own attribution, written without a price.
 *  - `upsertRateObservation` / `upsertBillingDaily` / `priceMessageCharge`
 *    are called from the nightly sync cron (admin client) — Meta's own
 *    cost data, and the derived rates that price the attribution rows.
 *
 * Everything read by the Billing screen goes through the ordinary session
 * client instead (RLS: ADMIN/CEO/FINANCE — see the migration), exactly
 * like the rest of the app; only the two write paths above use the admin
 * client, because neither runs behind a signed-in session.
 */

import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any -- matches the Db convention in every other lib/data/*-repository.ts */
import type { SupabaseClient } from "@supabase/supabase-js";

import { colomboDayKey } from "@/lib/date";
import type {
  WhatsAppBillingBudgetRow,
  WhatsAppTemplateCategory,
  WhatsAppTemplateRow,
  WhatsAppTemplateStatus,
} from "@/lib/types/whatsapp";

export type Db = SupabaseClient<any, any, any>;

export class WhatsAppBillingError extends Error {
  constructor(table: string, op: string, cause: unknown) {
    super(`whatsapp_billing.${table}.${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "WhatsAppBillingError";
  }
}

/* ── Message charges — the attribution half (D10) ────────────────────────── */

export interface MessageChargeInput {
  agencyId: string;
  conversationId?: string | null;
  messageId?: string | null;
  externalMessageId: string;
  direction: "OUTBOUND" | "INBOUND";
  billable: boolean;
  pricingModel?: string | null;
  pricingCategory?: string | null;
  pricingType?: string | null;
  recipientCountry?: string | null;
  templateName?: string | null;
  templateId?: string | null;
  actorKind?: "AI" | "STAFF" | "SYSTEM" | null;
  actorId?: string | null;
  leadId?: string | null;
  departureGroupId?: string | null;
}

/**
 * Idempotent on `(agency_id, external_message_id)` — a Meta status
 * redelivery writes the same row again, never a duplicate charge (F8/E11).
 * Written with `estimated_cost = null`; the nightly sync (E10 layer 1)
 * prices it once a matching rate observation exists for its own day.
 */
export async function upsertMessageCharge(db: Db, input: MessageChargeInput): Promise<void> {
  const { error } = await db.from("whatsapp_message_charges").upsert(
    {
      agency_id: input.agencyId,
      conversation_id: input.conversationId ?? null,
      message_id: input.messageId ?? null,
      external_message_id: input.externalMessageId,
      direction: input.direction,
      billable: input.billable,
      pricing_model: input.pricingModel ?? null,
      pricing_category: input.pricingCategory ?? null,
      pricing_type: input.pricingType ?? null,
      recipient_country: input.recipientCountry ?? null,
      template_name: input.templateName ?? null,
      template_id: input.templateId ?? null,
      actor_kind: input.actorKind ?? null,
      actor_id: input.actorId ?? null,
      lead_id: input.leadId ?? null,
      departure_group_id: input.departureGroupId ?? null,
      charged_on: colomboDayKey(),
    },
    { onConflict: "agency_id,external_message_id", ignoreDuplicates: true },
  );
  if (error) throw new WhatsAppBillingError("whatsapp_message_charges", "upsert", error);
}

/**
 * Enriches an outbound charge row with WHY the message was sent — joins
 * `conversation_messages` (by the same `external_message_id` the webhook's
 * `statuses` entry carries) to `conversations` for `lead_id`. Departure
 * group attribution is left null until booking sessions (Phase 9 of the
 * agent plan) exist to source it from.
 */
export async function findMessageAttribution(
  db: Db,
  agencyId: string,
  externalMessageId: string,
): Promise<{ conversationId: string | null; messageId: string | null; actorKind: "AI" | "STAFF" | "SYSTEM" | null; actorId: string | null; leadId: string | null } | null> {
  const { data, error } = await db
    .from("conversation_messages")
    .select("id, conversation_id, actor_kind, actor_id, conversations(lead_id)")
    .eq("agency_id", agencyId)
    .eq("external_message_id", externalMessageId)
    .maybeSingle();
  if (error) throw new WhatsAppBillingError("conversation_messages", "find_attribution", error);
  if (!data) return null;

  const row = data as {
    id: string;
    conversation_id: string;
    actor_kind: string;
    actor_id: string | null;
    conversations: { lead_id: string | null } | { lead_id: string | null }[] | null;
  };
  const conversationsRel = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations;
  const actorKind = row.actor_kind === "AI" || row.actor_kind === "STAFF" || row.actor_kind === "SYSTEM" ? row.actor_kind : null;

  return {
    conversationId: row.conversation_id,
    messageId: row.id,
    actorKind,
    actorId: row.actor_id,
    leadId: conversationsRel?.lead_id ?? null,
  };
}

export async function listUnpricedCharges(db: Db, agencyId: string, limit = 500) {
  const { data, error } = await db
    .from("whatsapp_message_charges")
    .select("*")
    .eq("agency_id", agencyId)
    .eq("billable", true)
    .is("estimated_cost", null)
    .limit(limit);
  if (error) throw new WhatsAppBillingError("whatsapp_message_charges", "select_unpriced", error);
  return data ?? [];
}

export async function priceMessageCharge(
  db: Db,
  chargeId: string,
  input: { estimatedCost: number; estimatedCurrency: string; rateObservationId: string },
): Promise<void> {
  const { error } = await db
    .from("whatsapp_message_charges")
    .update({
      estimated_cost: input.estimatedCost,
      estimated_currency: input.estimatedCurrency,
      rate_observation_id: input.rateObservationId,
    })
    .eq("id", chargeId);
  if (error) throw new WhatsAppBillingError("whatsapp_message_charges", "price", error);
}

/* ── Rate observations — derived, never hardcoded (D11) ──────────────────── */

export interface RateObservationInput {
  agencyId: string;
  observedOn: string; // date, 'YYYY-MM-DD'
  countryCode: string;
  pricingCategory: string;
  pricingType: string;
  tier: string;
  cost: number;
  volume: number;
  currency: string;
}

export async function upsertRateObservation(db: Db, input: RateObservationInput): Promise<string> {
  const unitRate = input.volume > 0 ? input.cost / input.volume : 0;
  const { data, error } = await db
    .from("whatsapp_rate_observations")
    .upsert(
      {
        agency_id: input.agencyId,
        observed_on: input.observedOn,
        country_code: input.countryCode,
        pricing_category: input.pricingCategory,
        pricing_type: input.pricingType,
        tier: input.tier,
        cost: input.cost,
        volume: input.volume,
        unit_rate: unitRate,
        currency: input.currency,
      },
      { onConflict: "agency_id,observed_on,country_code,pricing_category,pricing_type,tier" },
    )
    .select("id")
    .single();
  if (error) throw new WhatsAppBillingError("whatsapp_rate_observations", "upsert", error);
  return (data as { id: string }).id;
}

/** The most recent observed rate for a bucket on or before `onOrBeforeDate` — D11's "price against the rate observed for its own bucket on its own day", falling back to the nearest earlier day when a same-day observation doesn't exist yet. */
export async function findRateObservation(
  db: Db,
  agencyId: string,
  bucket: { countryCode: string; pricingCategory: string; pricingType: string; tier: string },
  onOrBeforeDate: string,
): Promise<{ id: string; unitRate: number; currency: string } | null> {
  const { data, error } = await db
    .from("whatsapp_rate_observations")
    .select("id, unit_rate, currency")
    .eq("agency_id", agencyId)
    .eq("country_code", bucket.countryCode)
    .eq("pricing_category", bucket.pricingCategory)
    .eq("pricing_type", bucket.pricingType)
    .eq("tier", bucket.tier)
    .lte("observed_on", onOrBeforeDate)
    .order("observed_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new WhatsAppBillingError("whatsapp_rate_observations", "find", error);
  if (!data) return null;
  const row = data as { id: string; unit_rate: number; currency: string };
  return { id: row.id, unitRate: row.unit_rate, currency: row.currency };
}

/**
 * Latest observed Meta-derived unit rate for each template category. This is
 * the projection source used by the Inbox template picker; it deliberately
 * reads the same rows that later price `whatsapp_message_charges` and never a
 * hard-coded rate card. A missing observation stays unknown rather than being
 * presented as free.
 */
export async function findLatestTemplateRates(
  db: Db,
  agencyId: string,
  countryCode: string | null,
  categories: WhatsAppTemplateCategory[],
): Promise<Partial<Record<WhatsAppTemplateCategory, { amount: number; currency: string; observationId: string }>>> {
  if (categories.length === 0) return {};
  const categoryValues = [...new Set(categories.flatMap((category) => [category, category.toLowerCase()]))];
  let query = db
    .from("whatsapp_rate_observations")
    .select("id, pricing_category, pricing_type, unit_rate, currency, observed_on")
    .eq("agency_id", agencyId)
    .in("pricing_category", categoryValues)
    .order("observed_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (countryCode) query = query.eq("country_code", countryCode);
  const { data, error } = await query;
  if (error) throw new WhatsAppBillingError("whatsapp_rate_observations", "find_template_rates", error);

  const rows = (data ?? []) as Array<{ id: string; pricing_category: string; pricing_type: string; unit_rate: number; currency: string }>;
  return projectLatestTemplateRates(rows, categories);
}

export function projectLatestTemplateRates(
  rows: Array<{ id: string; pricing_category: string; pricing_type: string; unit_rate: number; currency: string }>,
  categories: WhatsAppTemplateCategory[],
): Partial<Record<WhatsAppTemplateCategory, { amount: number; currency: string; observationId: string }>> {
  const result: Partial<Record<WhatsAppTemplateCategory, { amount: number; currency: string; observationId: string }>> = {};
  for (const category of categories) {
    const matches = rows.filter((row) => row.pricing_category.toUpperCase() === category);
    const row = matches.find((candidate) => candidate.pricing_type.toLowerCase() === "regular") ?? matches[0];
    if (row && Number.isFinite(Number(row.unit_rate))) {
      result[category] = { amount: Number(row.unit_rate), currency: row.currency, observationId: row.id };
    }
  }
  return result;
}

/* ── Billing daily — Meta's own rollup, verbatim (D10) ───────────────────── */

export interface BillingDailyInput {
  agencyId: string;
  day: string;
  phoneNumberId: string;
  countryCode: string;
  pricingCategory: string;
  pricingType: string;
  tier: string;
  cost: number;
  volume: number;
  currency: string;
  source: "PRICING_ANALYTICS" | "CONVERSATION_ANALYTICS";
}

export async function upsertBillingDaily(db: Db, input: BillingDailyInput): Promise<void> {
  const { error } = await db.from("whatsapp_billing_daily").upsert(
    {
      agency_id: input.agencyId,
      day: input.day,
      phone_number_id: input.phoneNumberId,
      country_code: input.countryCode,
      pricing_category: input.pricingCategory,
      pricing_type: input.pricingType,
      tier: input.tier,
      cost: input.cost,
      volume: input.volume,
      currency: input.currency,
      source: input.source,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "agency_id,day,phone_number_id,country_code,pricing_category,pricing_type,tier" },
  );
  if (error) throw new WhatsAppBillingError("whatsapp_billing_daily", "upsert", error);
}

export async function monthToDateSpend(db: Db, agencyId: string): Promise<{ cost: number; currency: string | null }> {
  const monthStartKey = `${colomboDayKey().slice(0, 7)}-01`; // Colombo calendar month, not UTC (D10's figures must agree with what the agency actually sees "this month")

  const { data, error } = await db
    .from("whatsapp_billing_daily")
    .select("cost, currency")
    .eq("agency_id", agencyId)
    .gte("day", monthStartKey);
  if (error) throw new WhatsAppBillingError("whatsapp_billing_daily", "month_to_date", error);

  const rows = (data ?? []) as Array<{ cost: number; currency: string }>;
  const cost = rows.reduce((sum, r) => sum + Number(r.cost), 0);
  return { cost, currency: rows[0]?.currency ?? null };
}

/* ── Volume tiers — F15's "smallest tier_update_time wins" ───────────────── */

export interface VolumeTierInput {
  agencyId: string;
  pricingCategory: string;
  region: string;
  tierLower: number | null;
  tierUpper: number | null;
  effectiveMonth: string | null;
  tierUpdateTime: string; // ISO timestamp
}

export async function upsertVolumeTierIfEarlier(db: Db, input: VolumeTierInput): Promise<void> {
  const { data: existing, error: selectError } = await db
    .from("whatsapp_volume_tiers")
    .select("id, tier_update_time")
    .eq("agency_id", input.agencyId)
    .eq("pricing_category", input.pricingCategory)
    .eq("region", input.region)
    .eq("effective_month", input.effectiveMonth)
    .maybeSingle();
  if (selectError) throw new WhatsAppBillingError("whatsapp_volume_tiers", "select", selectError);

  // F15 — Meta may send several webhooks describing one tier switch; keep
  // whichever carries the smallest tier_update_time.
  if (existing && new Date((existing as { tier_update_time: string }).tier_update_time) <= new Date(input.tierUpdateTime)) {
    return;
  }

  const { error } = await db.from("whatsapp_volume_tiers").upsert(
    {
      agency_id: input.agencyId,
      pricing_category: input.pricingCategory,
      region: input.region,
      tier_lower: input.tierLower,
      tier_upper: input.tierUpper,
      effective_month: input.effectiveMonth,
      tier_update_time: input.tierUpdateTime,
    },
    { onConflict: "agency_id,pricing_category,region,effective_month" },
  );
  if (error) throw new WhatsAppBillingError("whatsapp_volume_tiers", "upsert", error);
}

/* ── Billing budgets and alerting (E10 layer 3) ──────────────────────────── */

export async function getBillingBudget(db: Db, agencyId: string): Promise<WhatsAppBillingBudgetRow | null> {
  const { data, error } = await db.from("whatsapp_billing_budgets").select("*").eq("agency_id", agencyId).maybeSingle();
  if (error) throw new WhatsAppBillingError("whatsapp_billing_budgets", "select", error);
  return (data as WhatsAppBillingBudgetRow | null) ?? null;
}

export async function upsertBillingBudget(
  db: Db,
  agencyId: string,
  patch: Partial<Omit<WhatsAppBillingBudgetRow, "agency_id" | "updated_at">>,
): Promise<void> {
  const { error } = await db.from("whatsapp_billing_budgets").upsert({ agency_id: agencyId, ...patch }, { onConflict: "agency_id" });
  if (error) throw new WhatsAppBillingError("whatsapp_billing_budgets", "upsert", error);
}

export async function markBudgetAlerted(db: Db, agencyId: string, percent: number): Promise<void> {
  const { error } = await db.from("whatsapp_billing_budgets").update({ last_alerted_percent: percent }).eq("agency_id", agencyId);
  if (error) throw new WhatsAppBillingError("whatsapp_billing_budgets", "mark_alerted", error);
}

/**
 * §5 E10 layer 3 — the spend-control guard itself. "At 100%, optionally
 * block MARKETING template sends only — never utility, authentication, or
 * a human staff reply, and never a reply inside the service window, which
 * is free anyway." The `category` parameter is what enforces that: this
 * function is a hard no-op (always allowed) for anything but `MARKETING`.
 *
 * No call site in this codebase sends a marketing template today — there
 * is no bulk/marketing-blast feature built yet, only the one-to-one Inbox
 * reply and the AI agent's own replies, neither of which is ever a
 * MARKETING-category template. This function exists and is correct so that
 * whichever future feature sends one only has to call it, not reinvent the
 * threshold math; it deliberately is not invoked from anywhere yet, and
 * should not be, until such a feature exists (docs/modules/whatsapp-meta-connection-implementation-plan.md §5 E10, §9 open question 7-adjacent).
 */
export async function checkMarketingSendAllowed(db: Db, agencyId: string, category: string): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (category !== "MARKETING") return { allowed: true };

  const budget = await getBillingBudget(db, agencyId);
  if (!budget?.block_marketing_at_100 || !budget.monthly_budget) return { allowed: true };

  const { cost } = await monthToDateSpend(db, agencyId);
  if (cost < budget.monthly_budget) return { allowed: true };

  return {
    allowed: false,
    reason: `This agency's WhatsApp budget (${budget.currency ?? ""} ${budget.monthly_budget}) has been reached for this month, and marketing sends are set to pause at 100%. Utility, authentication and customer replies are never affected.`,
  };
}

/* ── Templates (E8) — mirrored with Meta's message_templates edge ───────── */

export async function listTemplateRows(db: Db, agencyId: string): Promise<WhatsAppTemplateRow[]> {
  const { data, error } = await db.from("whatsapp_templates").select("*").eq("agency_id", agencyId).order("created_at", { ascending: false });
  if (error) throw new WhatsAppBillingError("whatsapp_templates", "select", error);
  return (data ?? []) as WhatsAppTemplateRow[];
}

export async function upsertTemplateRow(
  db: Db,
  input: {
    agencyId: string;
    name: string;
    language: string;
    category: WhatsAppTemplateCategory;
    status: WhatsAppTemplateStatus;
    components: unknown[];
    externalTemplateId?: string | null;
    rejectedReason?: string | null;
    createdBy?: string | null;
    createdByName?: string | null;
  },
): Promise<void> {
  const { error } = await db.from("whatsapp_templates").upsert(
    {
      agency_id: input.agencyId,
      name: input.name,
      language: input.language,
      category: input.category,
      status: input.status,
      components: input.components,
      external_template_id: input.externalTemplateId ?? null,
      rejected_reason: input.rejectedReason ?? null,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    },
    { onConflict: "agency_id,name,language" },
  );
  if (error) throw new WhatsAppBillingError("whatsapp_templates", "upsert", error);
}

export async function deleteTemplateRow(db: Db, agencyId: string, name: string, language: string): Promise<void> {
  const { error } = await db.from("whatsapp_templates").delete().eq("agency_id", agencyId).eq("name", name).eq("language", language);
  if (error) throw new WhatsAppBillingError("whatsapp_templates", "delete", error);
}

/** Syncs template status from a `message_template_status_update` webhook (F10) — never inserts a template we didn't create; it only patches status if the name/language pair already exists. */
export async function syncTemplateStatus(
  db: Db,
  agencyId: string,
  name: string,
  language: string,
  patch: { status: WhatsAppTemplateStatus; rejectedReason?: string | null; externalTemplateId?: string | null },
): Promise<void> {
  const { error } = await db
    .from("whatsapp_templates")
    .update({
      status: patch.status,
      rejected_reason: patch.rejectedReason ?? null,
      ...(patch.externalTemplateId ? { external_template_id: patch.externalTemplateId } : {}),
    })
    .eq("agency_id", agencyId)
    .eq("name", name)
    .eq("language", language);
  if (error) throw new WhatsAppBillingError("whatsapp_templates", "sync_status", error);
}
