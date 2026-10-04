/**
 * Pure guardrail/cadence logic for the nightly Finance review agent —
 * Phase 1 (P1.7). Deliberately has no `server-only` import (unlike every
 * other file under this directory) so it stays unit-testable, matching
 * every other deterministic-logic module this phase built
 * (`lib/finance/collection-risk.ts`, `lib/bookings/blockers.ts`, etc.) —
 * see `guardrails.test.ts`.
 */

export interface FindingForCorroboration {
  stagedId: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  corroboratingMetricKey: string | null;
}

export interface CorroborationViolation {
  stagedId: string;
  detail: string;
}

/**
 * Every WARNING/CRITICAL finding must cite a real key from the pack's own
 * `metrics` object — plan §P1.7's corroboration guardrail. An INFO finding
 * is exempt (it's an observation, not an alarm). A finding whose named key
 * doesn't actually exist in the pack is treated the same as citing none —
 * the model naming a plausible-sounding but wrong key is exactly the
 * failure mode this exists to catch.
 */
export function checkCorroboration<T extends FindingForCorroboration>(
  findings: readonly T[],
  availableMetricKeys: ReadonlySet<string>,
): { kept: T[]; violations: CorroborationViolation[] } {
  const kept: T[] = [];
  const violations: CorroborationViolation[] = [];

  for (const finding of findings) {
    if (finding.severity === "INFO") {
      kept.push(finding);
      continue;
    }
    if (finding.corroboratingMetricKey && availableMetricKeys.has(finding.corroboratingMetricKey)) {
      kept.push(finding);
      continue;
    }
    violations.push({
      stagedId: finding.stagedId,
      detail: `${finding.severity} finding cites no valid metric key ("${finding.corroboratingMetricKey ?? "none"}") — dropped.`,
    });
  }

  return { kept, violations };
}

/** True when this pack is byte-for-byte the same situation the last run already reviewed — the NOOP gate. */
export function isPackUnchanged(currentFingerprint: string, lastFingerprint: string | null): boolean {
  return lastFingerprint !== null && currentFingerprint === lastFingerprint;
}

const DAY_KEY_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const HOUR_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = DAY_KEY_FORMATTER_CACHE.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    DAY_KEY_FORMATTER_CACHE.set(timezone, formatter);
  }
  return formatter;
}

function hourFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = HOUR_FORMATTER_CACHE.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false });
    HOUR_FORMATTER_CACHE.set(timezone, formatter);
  }
  return formatter;
}

/** `YYYY-MM-DD` for `nowIso`, as the calendar reads it in `timezone` — the general form of `lib/date.ts`'s Colombo-only `colomboDayKey`. */
export function dayKeyInTimezone(nowIso: string, timezone: string): string {
  return dayKeyFormatter(timezone).format(new Date(nowIso));
}

/** The local hour (0-23) `nowIso` falls on in `timezone`. `Intl`'s `en-US`+`hour12:false` reports midnight as "24", normalised back to 0 here. */
function localHour(nowIso: string, timezone: string): number {
  const formatted = hourFormatter(timezone).format(new Date(nowIso));
  const hour = Number.parseInt(formatted, 10);
  return hour === 24 ? 0 : hour;
}

/**
 * True once per agency-local calendar day, from `cadenceHour` (default 6
 * — plan §P1.7's "daily 06:00-agency-time cadence") onward, and only if
 * today's local day differs from the day the last run happened on. Never
 * true twice for the same local day even if called again at, say, 11pm.
 */
export function isCadenceDue(nowIso: string, timezone: string, lastRunDayKey: string | null, cadenceHour = 6): boolean {
  if (localHour(nowIso, timezone) < cadenceHour) return false;
  const today = dayKeyInTimezone(nowIso, timezone);
  return lastRunDayKey !== today;
}
