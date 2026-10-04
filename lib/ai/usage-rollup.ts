/**
 * Pure helpers around the `ai_usage_daily` rollup (MI0.1) — which UTC days the cron recomputes, and how
 * the month-to-date figure shown on /management/ai-agent is summed. No I/O, so both are unit-tested.
 */

export interface AiUsageDailyRow {
  day: string;
  surface: string;
  runs: number;
  unpriced_runs: number;
  cost_usd: number | string;
  conversations_enriched: number;
}

export interface AiMonthToDateUsage {
  /** `YYYY-MM` (UTC). */
  month: string;
  costUsd: number;
  runs: number;
  /** Runs whose model had no rate row: they are in `runs` but not in `costUsd`. Surfaced so cost is never silently understated. */
  unpricedRuns: number;
  conversationsEnriched: number;
  bySurface: Array<{ surface: string; costUsd: number; runs: number }>;
}

/** Yesterday and today (UTC), oldest first — runs that land just after midnight still reach the right day. */
export function rollupDaysFor(now: Date): string[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return [yesterday, today];
}

/** First day of `now`'s UTC month, `YYYY-MM-01`. */
export function monthStartFor(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

export function summariseMonthToDate(rows: readonly AiUsageDailyRow[], now: Date): AiMonthToDateUsage {
  const month = now.toISOString().slice(0, 7);
  const surfaces = new Map<string, { costUsd: number; runs: number }>();
  let costUsd = 0;
  let runs = 0;
  let unpricedRuns = 0;
  let conversationsEnriched = 0;

  for (const row of rows) {
    if (!row.day.startsWith(month)) continue;
    const cost = Number(row.cost_usd);
    costUsd += cost;
    runs += row.runs;
    unpricedRuns += row.unpriced_runs;
    conversationsEnriched += row.conversations_enriched;
    const entry = surfaces.get(row.surface) ?? { costUsd: 0, runs: 0 };
    entry.costUsd += cost;
    entry.runs += row.runs;
    surfaces.set(row.surface, entry);
  }

  return {
    month,
    costUsd,
    runs,
    unpricedRuns,
    conversationsEnriched,
    bySurface: [...surfaces.entries()].map(([surface, value]) => ({ surface, ...value })).sort((a, b) => b.costUsd - a.costUsd),
  };
}
