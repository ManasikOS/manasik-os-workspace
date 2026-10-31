/**
 * Turns `PERF_TIMING=1` server log lines into a median / p95, so a Dashboard
 * measurement round (docs/runbooks/performance-baseline-runbook.md) produces
 * numbers the same way every time.
 *
 *   node --experimental-strip-types scripts/perf/summarise-perf-log.ts \
 *     [label] < runtime.log
 *
 * `label` defaults to `dashboard.loadData`. Reads stdin, prints one JSON
 * line. Plain Node, no dependencies; the pure functions are tested.
 */

import { pathToFileURL } from "node:url";

/** The `<ms>` of every `[perf] <label> <ms>ms` line for exactly this label. */
export function parsePerfLog(text: string, label: string): number[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(`\\[perf\\] ${escaped} (\\d+)ms\\s*$`);
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = line.exec(raw);
    if (match) values.push(Number(match[1]));
  }
  return values;
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function summarise(values: number[]): { n: number; p50: number; p95: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] };
}

async function main(): Promise<void> {
  const label = process.argv[2] ?? "dashboard.loadData";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const summary = summarise(parsePerfLog(text, label));
  process.stdout.write(`${JSON.stringify({ label, ...(summary ?? { n: 0 }) })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
