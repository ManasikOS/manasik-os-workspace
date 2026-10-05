/**
 * How an Inbox cron route walks through the agencies without ever running out of time (BUG-11 in
 * docs/progress/2026-10-05-inbox-security-and-bug-audit.md).
 *
 * The SLA and retention sweeps used to visit every agency one after another in a fixed order with no time limit. As agencies grow the
 * run eventually outlasts the function limit, the platform kills it, and because the order never changes the agencies at the end of the
 * list are the ones cut off every single time. Two rules fix both halves:
 *   - a budget: when time is nearly up the run stops starting new agencies and says so, instead of being killed half-way through one;
 *   - a rotating start: each run begins at a different agency, so whoever was cut off last time goes first soon after.
 * The start is worked out from the clock, not stored, so it needs no table and two overlapping runs simply start in the same place.
 */

/** Stays inside the function limit even when a few agencies are slow. The email poll already uses the same figure. */
export const CRON_AGENCY_BUDGET_MS = 45_000;

/** The same list, starting at `start` and wrapping round. */
export function rotateFrom<T>(items: readonly T[], start: number): T[] {
  if (items.length === 0) return [];
  const offset = ((Math.trunc(start) % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * Where this run starts. It moves on by one every `sliceMs` (use the route's schedule interval), so successive runs begin at
 * successive agencies and a run that was cut short is followed by one that begins further along.
 */
export function rotationStart(length: number, nowMs: number, sliceMs: number): number {
  if (length <= 0 || sliceMs <= 0) return 0;
  return Math.floor(nowMs / sliceMs) % length;
}

export interface AgencyRunOutcome {
  /** Agencies this run started (including ones that then failed). */
  visited: number;
  /** Agencies whose work threw. The run carries on with the next one. */
  failed: number;
  /** Agencies left for the next run because the budget ran out. */
  notReached: number;
  deadlineReached: boolean;
}

export async function forEachAgencyWithinBudget<T extends { id: string }>(
  agencies: readonly T[],
  options: {
    /** The route's schedule interval; the starting agency moves on by one each time this much time passes. */
    sliceMs: number;
    budgetMs?: number;
    now?: () => number;
    run: (agency: T) => Promise<void>;
    onError?: (agency: T, cause: unknown) => void;
  },
): Promise<AgencyRunOutcome> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (options.budgetMs ?? CRON_AGENCY_BUDGET_MS);
  const ordered = rotateFrom(agencies, rotationStart(agencies.length, startedAt, options.sliceMs));

  const outcome: AgencyRunOutcome = { visited: 0, failed: 0, notReached: 0, deadlineReached: false };
  for (const [index, agency] of ordered.entries()) {
    if (now() >= deadline) {
      outcome.deadlineReached = true;
      outcome.notReached = ordered.length - index;
      break;
    }
    outcome.visited += 1;
    try {
      await options.run(agency);
    } catch (cause) {
      outcome.failed += 1;
      options.onError?.(agency, cause);
    }
  }
  return outcome;
}
