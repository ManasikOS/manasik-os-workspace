/**
 * The seven metrics §13 of
 * docs/modules/departure-operations-agent-implementation-plan.md names as "the
 * ones that decide whether this is working" — computed from real rows,
 * never simulated. Every function here is a read; nothing writes.
 *
 * Two of the seven needed a schema change before they were even
 * computable (see 20260922090000_departure_ops_metrics.sql's header):
 * "blockers open at T-7" needs a point-in-time blocker count, which only
 * exists if something recorded it at the time; the uncorroborated-finding
 * drop rate needs to know what a run's guardrails actually dropped, which
 * nothing was persisting until that migration.
 *
 * No pre-launch baseline dataset exists anywhere in this schema — "vs
 * baseline" in the plan's own metric descriptions (time-to-green,
 * blockers-at-T7) is therefore reported as a bare current-period number,
 * not a comparison. Establishing a baseline is a one-time export taken
 * before `ACTIVE` mode is ever turned on for an agency (D12's staged
 * rollout already produces exactly the SHADOW-period data a baseline
 * would need) — recording that baseline is this module's caller's job,
 * not something it can retroactively invent.
 */

import "server-only";

import { daysBetween } from "@/lib/data/departure-groups-copy";
import type { Db } from "@/lib/data/departure-groups-repository";

export interface ApprovalRateRow {
  key: string; // a kind, or a risk level
  executed: number;
  rejected: number;
  /** null when there is no decided sample yet — 0/0 is not 0%. */
  approvalRate: number | null;
}

/**
 * Approval rate, split two ways — by kind (which specific asks are
 * trusted) and by risk (whether risk tier itself predicts trust). Only
 * EXECUTED/REJECTED count as "decided" — SUPERSEDED/EXPIRED are queue
 * hygiene, not a human's verdict on the proposal's judgement.
 */
export async function computeApprovalRates(
  agencyId: string,
  client: Db,
  sinceDays = 30,
): Promise<{ byKind: ApprovalRateRow[]; byRisk: ApprovalRateRow[] }> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await client
    .from("agent_proposals")
    .select("kind, risk, status")
    .eq("agency_id", agencyId)
    .in("status", ["EXECUTED", "REJECTED"])
    .gte("decided_at", since);
  if (error) throw new Error(`Failed to load proposals for approval rate: ${error.message}`);

  const rows = (data ?? []) as { kind: string; risk: string; status: string }[];
  return { byKind: rollUp(rows, (r) => r.kind), byRisk: rollUp(rows, (r) => r.risk) };
}

function rollUp<T extends { status: string }>(rows: T[], keyOf: (r: T) => string): ApprovalRateRow[] {
  const buckets = new Map<string, { executed: number; rejected: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = buckets.get(key) ?? { executed: 0, rejected: 0 };
    if (row.status === "EXECUTED") bucket.executed++;
    else bucket.rejected++;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      executed: b.executed,
      rejected: b.rejected,
      approvalRate: b.executed + b.rejected > 0 ? b.executed / (b.executed + b.rejected) : null,
    }))
    .sort((a, b) => (a.approvalRate ?? 1) - (b.approvalRate ?? 1)); // worst-trusted first — the thing worth looking at
}

export interface TimeToGreenResult {
  sampleSize: number;
  medianDays: number | null;
  meanDays: number | null;
}

/** Median/mean days from a group's creation to it being marked READY_TO_DEPART — the mission metric. */
export async function computeTimeToGreen(agencyId: string, client: Db): Promise<TimeToGreenResult> {
  const { data, error } = await client
    .from("departure_groups")
    .select("created_at, ready_at")
    .eq("agency_id", agencyId)
    .not("ready_at", "is", null);
  if (error) throw new Error(`Failed to load groups for time-to-green: ${error.message}`);

  const days = ((data ?? []) as { created_at: string; ready_at: string }[]).map((g) =>
    daysBetween(g.created_at.slice(0, 10), g.ready_at.slice(0, 10)),
  );
  return { sampleSize: days.length, medianDays: median(days), meanDays: mean(days) };
}

export interface BlockersAtT7Result {
  sampleSize: number;
  averageBlockerCount: number | null;
}

/**
 * Average blocker count at the review closest to seven days before
 * departure, across groups that were actually still being reviewed at
 * that point (a group created five days before it departed has no T-7
 * data point and is correctly excluded, not counted as zero).
 */
export async function computeBlockersAtT7(agencyId: string, client: Db): Promise<BlockersAtT7Result> {
  const { data: groups, error: groupsError } = await client
    .from("departure_groups")
    .select("id, departure_date")
    .eq("agency_id", agencyId)
    .not("departure_date", "is", null);
  if (groupsError) throw new Error(`Failed to load groups for T-7 blockers: ${groupsError.message}`);

  const groupRows = (groups ?? []) as { id: string; departure_date: string }[];
  if (groupRows.length === 0) return { sampleSize: 0, averageBlockerCount: null };

  const { data: runs, error: runsError } = await client
    .from("departure_ops_runs")
    .select("departure_group_id, created_at, blocker_count")
    .eq("agency_id", agencyId)
    .in("departure_group_id", groupRows.map((g) => g.id))
    .not("blocker_count", "is", null);
  if (runsError) throw new Error(`Failed to load runs for T-7 blockers: ${runsError.message}`);

  const runRows = (runs ?? []) as { departure_group_id: string; created_at: string; blocker_count: number }[];
  const runsByGroup = new Map<string, typeof runRows>();
  for (const run of runRows) {
    const list = runsByGroup.get(run.departure_group_id) ?? [];
    list.push(run);
    runsByGroup.set(run.departure_group_id, list);
  }

  const counts: number[] = [];
  for (const group of groupRows) {
    const runsForGroup = runsByGroup.get(group.id);
    if (!runsForGroup || runsForGroup.length === 0) continue;
    const target = new Date(group.departure_date);
    target.setUTCDate(target.getUTCDate() - 7);

    let closest = runsForGroup[0];
    let closestDiff = Math.abs(Date.parse(closest.created_at) - target.getTime());
    for (const run of runsForGroup) {
      const diff = Math.abs(Date.parse(run.created_at) - target.getTime());
      if (diff < closestDiff) {
        closest = run;
        closestDiff = diff;
      }
    }
    // Further than 4 days from the T-7 mark isn't really a T-7 reading —
    // a weekly-cadence PLANNING-tier group might never have one at all.
    if (closestDiff <= 4 * 86_400_000) counts.push(closest.blocker_count);
  }

  return { sampleSize: counts.length, averageBlockerCount: mean(counts) };
}

export interface DropRateResult {
  droppedFindings: number;
  keptFindings: number;
  /** null with no findings attempted at all in the window. */
  dropRate: number | null;
}

/** §11's hallucination canary — how often a CRITICAL/WARNING finding failed corroboration and was dropped before it ever reached the risk register. */
export async function computeUncorroboratedFindingDropRate(
  agencyId: string,
  client: Db,
  sinceDays = 30,
): Promise<DropRateResult> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const [{ data: runs, error: runsError }, { count: keptCount, error: findingsError }] = await Promise.all([
    client
      .from("departure_ops_runs")
      .select("guardrail_violations")
      .eq("agency_id", agencyId)
      .gte("created_at", since),
    client
      .from("departure_group_agent_findings")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .gte("created_at", since),
  ]);
  if (runsError) throw new Error(`Failed to load runs for drop rate: ${runsError.message}`);
  if (findingsError) throw new Error(`Failed to count findings for drop rate: ${findingsError.message}`);

  let dropped = 0;
  for (const run of (runs ?? []) as { guardrail_violations: { gate: string }[] }[]) {
    dropped += (run.guardrail_violations ?? []).filter((v) => v.gate === "corroboration").length;
  }
  const kept = keptCount ?? 0;

  return {
    droppedFindings: dropped,
    keptFindings: kept,
    dropRate: dropped + kept > 0 ? dropped / (dropped + kept) : null,
  };
}

export interface NoopRatioResult {
  totalRuns: number;
  noopRuns: number;
  /** null with no runs in the window — never reported as 0, which would read as "the agent is thrashing" when it just hasn't run at all. */
  noopRatio: number | null;
}

/** Should be high (>60% per §13) — a low ratio means the D9 fingerprint is too sensitive and every sweep is paying for a model call that finds nothing new. */
export async function computeNoopRatio(agencyId: string, client: Db, sinceDays = 30): Promise<NoopRatioResult> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await client
    .from("departure_ops_runs")
    .select("status")
    .eq("agency_id", agencyId)
    .gte("created_at", since);
  if (error) throw new Error(`Failed to load runs for NOOP ratio: ${error.message}`);

  const rows = (data ?? []) as { status: string }[];
  const noop = rows.filter((r) => r.status === "NOOP").length;
  return { totalRuns: rows.length, noopRuns: noop, noopRatio: rows.length > 0 ? noop / rows.length : null };
}

export interface CostPerDepartureResult {
  groupsCounted: number;
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Tokens, not currency — Opus pricing changes independently of this code, and a wrong dollar figure is worse than none. Multiply by the current $/token rate at the call site. */
  averageTokensPerDeparture: number | null;
}

/** Tokens × runs, quoted per departure that has actually happened — never per calendar month (§13 is explicit this must not be a monthly bill, which conflates a quiet month with a cheap one). */
export async function computeCostPerDeparture(agencyId: string, client: Db): Promise<CostPerDepartureResult> {
  const { data: groups, error: groupsError } = await client
    .from("departure_groups")
    .select("id")
    .eq("agency_id", agencyId)
    .in("group_status", ["DEPARTED", "COMPLETED"]);
  if (groupsError) throw new Error(`Failed to load departed groups for cost: ${groupsError.message}`);

  const groupIds = ((groups ?? []) as { id: string }[]).map((g) => g.id);
  if (groupIds.length === 0) {
    return { groupsCounted: 0, totalRuns: 0, totalInputTokens: 0, totalOutputTokens: 0, averageTokensPerDeparture: null };
  }

  const { data: runs, error: runsError } = await client
    .from("departure_ops_runs")
    .select("departure_group_id, input_tokens, output_tokens")
    .eq("agency_id", agencyId)
    .in("departure_group_id", groupIds);
  if (runsError) throw new Error(`Failed to load runs for cost: ${runsError.message}`);

  const runRows = (runs ?? []) as { departure_group_id: string; input_tokens: number | null; output_tokens: number | null }[];
  const totalInput = runRows.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0);
  const totalOutput = runRows.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0);
  const groupsWithRuns = new Set(runRows.map((r) => r.departure_group_id)).size;

  return {
    groupsCounted: groupsWithRuns,
    totalRuns: runRows.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    averageTokensPerDeparture: groupsWithRuns > 0 ? (totalInput + totalOutput) / groupsWithRuns : null,
  };
}

export interface SupersedeRateResult {
  decided: number;
  superseded: number;
  /** null with nothing decided in the window. */
  supersedeRate: number | null;
}

/** High means the agent is proposing against stale snapshots often enough to matter — shorten a kind's ttlHours or tighten its dependencyKeys (D6). */
export async function computeSupersedeRate(agencyId: string, client: Db, sinceDays = 30): Promise<SupersedeRateResult> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await client
    .from("agent_proposals")
    .select("status")
    .eq("agency_id", agencyId)
    .in("status", ["EXECUTED", "REJECTED", "SUPERSEDED", "EXPIRED", "FAILED"])
    .gte("updated_at", since);
  if (error) throw new Error(`Failed to load proposals for supersede rate: ${error.message}`);

  const rows = (data ?? []) as { status: string }[];
  const superseded = rows.filter((r) => r.status === "SUPERSEDED").length;
  return { decided: rows.length, superseded, supersedeRate: rows.length > 0 ? superseded / rows.length : null };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
