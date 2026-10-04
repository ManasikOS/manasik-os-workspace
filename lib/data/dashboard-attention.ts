/**
 * Client-safe ranking for the Attention Rail (§5.4). The one place the
 * dashboard is allowed a derivation of its own — and even here it only
 * *orders* counts `dashboard-repository.ts` already computed from the
 * modules that own them; it invents no new severity and no new count.
 */

import type { AttentionRow } from "@/lib/types/dashboard";

const SEVERITY_WEIGHT: Record<AttentionRow["severity"], number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/** `null` (not tied to any one departure) weighs the same as a distant one. */
function proximityWeight(days: number | null): number {
  if (days === null) return 1;
  if (days <= 7) return 3;
  if (days <= 14) return 2;
  if (days <= 30) return 1.5;
  return 1;
}

/**
 * Drops zero-count rows entirely — a healthy agency's rail shrinks rather
 * than showing a wall of green zeros — then ranks what's left by
 * `severity × how soon it bites`, capped to `limit`.
 */
export function rankAttentionRows(candidates: AttentionRow[], limit = 6): AttentionRow[] {
  return candidates
    .filter((row) => row.count > 0)
    .map((row) => ({ row, score: SEVERITY_WEIGHT[row.severity] * proximityWeight(row.minDaysUntilDeparture) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => row);
}
