/**
 * Read-side aggregation for the WhatsApp Billing screen — §5 E10 layer 2 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md.
 *
 * Runs on the ordinary SESSION client (RLS: ADMIN/CEO/FINANCE), exactly
 * like every other Settings screen — unlike the webhook/cron writers in
 * whatsapp-billing-repository.ts, there is a signed-in staff member behind
 * every call here.
 */

import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any -- matches the Db convention in every other lib/data/*-repository.ts */
import type { SupabaseClient } from "@supabase/supabase-js";

import { priceAgentRun, type AgentRunInput, type AiModelRateInput } from "@/lib/agent/whatsapp/analytics";
import { colomboDayKey } from "@/lib/date";

export type Db = SupabaseClient<any, any, any>;

export interface DailySpendPoint {
  day: string;
  cost: number;
  volume: number;
  currency: string | null;
}

export interface CategoryBreakdown {
  category: string;
  cost: number;
  volume: number;
}

export interface BillingSummary {
  monthToDateCost: number;
  currency: string | null;
  daily: DailySpendPoint[];
  byCategory: CategoryBreakdown[];
  byCountry: CategoryBreakdown[];
  byPricingType: CategoryBreakdown[];
  aiCostUsd: number;
  aiConversationCount: number;
  metaVsAttributedVariance: number | null;
}

/** Last 30 Colombo calendar days, inclusive of today. */
function last30DaysKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return colomboDayKey(d);
}

export async function getBillingSummary(db: Db, agencyId: string): Promise<BillingSummary> {
  const since = last30DaysKey();
  const monthStartKey = `${colomboDayKey().slice(0, 7)}-01`;

  const { data: dailyRows } = await db
    .from("whatsapp_billing_daily")
    .select("day, cost, volume, currency, pricing_category, country_code, pricing_type")
    .eq("agency_id", agencyId)
    .gte("day", since)
    .order("day", { ascending: true });

  const rows = (dailyRows ?? []) as Array<{
    day: string;
    cost: number;
    volume: number;
    currency: string;
    pricing_category: string;
    country_code: string;
    pricing_type: string;
  }>;

  const currency = rows[0]?.currency ?? null;

  const byDay = new Map<string, { cost: number; volume: number }>();
  const byCategory = new Map<string, { cost: number; volume: number }>();
  const byCountry = new Map<string, { cost: number; volume: number }>();
  const byPricingType = new Map<string, { cost: number; volume: number }>();
  let monthToDateCost = 0;

  for (const row of rows) {
    const cost = Number(row.cost);
    const volume = Number(row.volume);

    const day = byDay.get(row.day) ?? { cost: 0, volume: 0 };
    day.cost += cost;
    day.volume += volume;
    byDay.set(row.day, day);

    const cat = row.pricing_category || "unknown";
    const catAgg = byCategory.get(cat) ?? { cost: 0, volume: 0 };
    catAgg.cost += cost;
    catAgg.volume += volume;
    byCategory.set(cat, catAgg);

    const country = row.country_code || "unknown";
    const countryAgg = byCountry.get(country) ?? { cost: 0, volume: 0 };
    countryAgg.cost += cost;
    countryAgg.volume += volume;
    byCountry.set(country, countryAgg);

    const type = row.pricing_type || "unknown";
    const typeAgg = byPricingType.get(type) ?? { cost: 0, volume: 0 };
    typeAgg.cost += cost;
    typeAgg.volume += volume;
    byPricingType.set(type, typeAgg);

    if (row.day >= monthStartKey) monthToDateCost += cost;
  }

  // D12 — the AI's own cost, from agent_runs' existing token columns × the
  // dated model rate table. Kept as a separate figure, never merged into
  // Meta's messaging cost (D10) — the legend on the screen keeps them apart.
  // agent_runs is the WhatsApp agent's own table (Departure Ops has departure_ops_runs), so there is
  // no surface column to filter on — an earlier `.eq("surface", "WHATSAPP")` here made the whole query
  // error and its result was discarded, so this figure was always $0. Pricing is shared with the
  // Copilot analytics section so the two screens cannot disagree.
  const { data: runs } = await db
    .from("agent_runs")
    .select("model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, conversation_id, created_at")
    .eq("agency_id", agencyId)
    .gte("created_at", monthStartKey)
    .not("model", "is", null);

  const { data: rates } = await db
    .from("ai_model_rates")
    .select("model, effective_from, input_rate_per_million, output_rate_per_million, cache_read_rate_per_million, cache_write_rate_per_million");

  const rateRows = (rates ?? []) as AiModelRateInput[];

  let aiCostUsd = 0;
  const conversationsSeen = new Set<string>();
  for (const run of (runs ?? []) as Array<
    Pick<AgentRunInput, "model" | "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens" | "created_at"> & {
      conversation_id: string | null;
    }
  >) {
    if (run.conversation_id) conversationsSeen.add(run.conversation_id);
    aiCostUsd += priceAgentRun(run, rateRows) ?? 0;
  }

  // Reconciliation — Meta's own total (above) vs the CRM's attributed total
  // from whatsapp_message_charges for the same window (D10). A persistent
  // gap means messages are being sent outside the CRM.
  const { data: attributedRows } = await db
    .from("whatsapp_message_charges")
    .select("estimated_cost")
    .eq("agency_id", agencyId)
    .gte("charged_on", monthStartKey)
    .not("estimated_cost", "is", null);
  const attributedTotal = ((attributedRows ?? []) as Array<{ estimated_cost: number }>).reduce((s, r) => s + Number(r.estimated_cost), 0);
  const metaVsAttributedVariance = rows.length > 0 ? monthToDateCost - attributedTotal : null;

  const toBreakdown = (m: Map<string, { cost: number; volume: number }>): CategoryBreakdown[] =>
    Array.from(m.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.cost - a.cost);

  return {
    monthToDateCost,
    currency,
    daily: Array.from(byDay.entries()).map(([day, v]) => ({ day, ...v, currency })),
    byCategory: toBreakdown(byCategory),
    byCountry: toBreakdown(byCountry),
    byPricingType: toBreakdown(byPricingType),
    aiCostUsd,
    aiConversationCount: conversationsSeen.size,
    metaVsAttributedVariance,
  };
}
