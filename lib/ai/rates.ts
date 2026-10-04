/**
 * Dated model-rate lookup and token pricing — MI0.1 (G11) of docs/inbox/implementation-plan.md.
 *
 * `ai_model_rates` is platform-global reference data: cost per million tokens, one row per
 * `(model, effective_from)`, so a run costs what it cost the day it ran even after a price change.
 * Four token classes are priced separately — input, output, cache-read and cache-write — because a
 * cache read is roughly 10x cheaper than fresh input, and pricing them all at the input rate would make
 * prompt caching look worthless in the ledger.
 *
 * An unpriced model yields `null`, never `0`. Zero would make an unknown model look free.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";

export interface AiModelRateRow {
  model: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  inputRatePerMillion: number;
  outputRatePerMillion: number;
  cacheReadRatePerMillion: number;
  cacheWriteRatePerMillion: number;
}

export interface AiTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** Cost is stored with 8 decimals: a classify call is a few hundredths of a cent. */
const COST_DECIMALS = 8;

interface AiModelRateDbRow {
  model: string;
  effective_from: string;
  input_rate_per_million: number | string;
  output_rate_per_million: number | string;
  cache_read_rate_per_million: number | string;
  cache_write_rate_per_million: number | string;
}

export function toAiModelRateRow(row: AiModelRateDbRow): AiModelRateRow {
  return {
    model: row.model,
    effectiveFrom: row.effective_from,
    inputRatePerMillion: Number(row.input_rate_per_million),
    outputRatePerMillion: Number(row.output_rate_per_million),
    cacheReadRatePerMillion: Number(row.cache_read_rate_per_million),
    cacheWriteRatePerMillion: Number(row.cache_write_rate_per_million),
  };
}

/** The newest rate row for `model` whose `effective_from` is on or before `at`'s UTC day. `null` when none covers it. */
export function selectModelRate(rates: readonly AiModelRateRow[], model: string, at: Date): AiModelRateRow | null {
  const day = at.toISOString().slice(0, 10);
  let best: AiModelRateRow | null = null;
  for (const rate of rates) {
    if (rate.model !== model || rate.effectiveFrom > day) continue;
    if (!best || rate.effectiveFrom > best.effectiveFrom) best = rate;
  }
  return best;
}

/** Dollar cost of `usage` at `rate`, each of the four token classes at its own rate. */
export function priceTokenUsage(rate: AiModelRateRow, usage: AiTokenUsage): number {
  const dollars =
    (usage.input / 1_000_000) * rate.inputRatePerMillion +
    (usage.output / 1_000_000) * rate.outputRatePerMillion +
    (usage.cacheRead / 1_000_000) * rate.cacheReadRatePerMillion +
    (usage.cacheCreation / 1_000_000) * rate.cacheWriteRatePerMillion;
  const scale = 10 ** COST_DECIMALS;
  return Math.round(dollars * scale) / scale;
}

const RATE_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedRates: { rates: AiModelRateRow[]; loadedAt: number } | null = null;

/** Test hook — drops the in-process rate cache. */
export function clearAiModelRateCache(): void {
  cachedRates = null;
}

/** Every rate row, cached in-process for five minutes. Rates change by inserting a new dated row, so a stale minute is harmless. */
export async function loadAiModelRates(db: Db, now: number = Date.now()): Promise<AiModelRateRow[]> {
  if (cachedRates && now - cachedRates.loadedAt < RATE_CACHE_TTL_MS) return cachedRates.rates;

  const { data, error } = await db
    .from("ai_model_rates")
    .select("model, effective_from, input_rate_per_million, output_rate_per_million, cache_read_rate_per_million, cache_write_rate_per_million");
  if (error) throw new Error(`Could not load model rates: ${error.message}`);

  const rates = ((data ?? []) as AiModelRateDbRow[]).map(toAiModelRateRow);
  cachedRates = { rates, loadedAt: now };
  return rates;
}
