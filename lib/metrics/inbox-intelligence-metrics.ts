/**
 * Read side of the Inbox intelligence KPIs — MI0.3 of docs/inbox/implementation-plan.md (Architecture §12).
 *
 * Every query runs on the caller's session client (so RLS on the underlying tables decides what is visible;
 * the three views are `security_invoker`) AND is explicitly filtered by agency, matching the other lib/data
 * read models. An agency with no activity yet gets a zero-filled series, not an empty one: "all zero" is the
 * correct first answer for a programme that has not shipped a feature yet, and a missing row would be
 * indistinguishable from a broken query.
 *
 * Rates that have nothing to divide by are `null`, never `0` — a 0 % skip rate on a day with no evaluated
 * messages would read as a failing gate.
 */

import type { Db } from "@/lib/ai/db";

export interface InboxKpiDay {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  inboundMessages: number;
  gateEvaluated: number;
  gateSkipped: number;
  /** null when no message was evaluated that day. */
  s0SkipRate: number | null;
  aiRuns: number;
  aiCostUsd: number;
  conversationsEnriched: number;
  /** null when no conversation was enriched that day. */
  costPerEnrichedConversationUsd: number | null;
}

export interface InboxLaneHealth {
  lane: string;
  queued: number;
  running: number;
  failed: number;
  dead: number;
  oldestQueuedAgeSeconds: number;
}

export interface InboxGateSkipReason {
  day: string;
  decision: "ENRICH" | "SKIP";
  reason: string;
  decisions: number;
  escalatedToRisk: number;
}

export interface InboxLanguageBucket {
  day: string;
  languageCode: string;
  conversations: number;
}

interface KpiDbRow {
  day: string;
  inbound_messages: number | string;
  gate_evaluated: number | string;
  gate_skipped: number | string;
  s0_skip_rate: number | string | null;
  ai_runs: number | string;
  ai_cost_usd: number | string;
  conversations_enriched: number | string;
  cost_per_enriched_conversation_usd: number | string | null;
}

const nullableNumber = (value: number | string | null): number | null => (value === null ? null : Number(value));

export function toInboxKpiDay(row: KpiDbRow): InboxKpiDay {
  return {
    day: row.day,
    inboundMessages: Number(row.inbound_messages),
    gateEvaluated: Number(row.gate_evaluated),
    gateSkipped: Number(row.gate_skipped),
    s0SkipRate: nullableNumber(row.s0_skip_rate),
    aiRuns: Number(row.ai_runs),
    aiCostUsd: Number(row.ai_cost_usd),
    conversationsEnriched: Number(row.conversations_enriched),
    costPerEnrichedConversationUsd: nullableNumber(row.cost_per_enriched_conversation_usd),
  };
}

/** The last `days` UTC days ending at `now`, oldest first. */
export function recentUtcDays(now: Date, days: number): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    keys.push(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return keys;
}

/** One entry per day in `days`: the stored row when there is one, otherwise an all-zero day. */
export function zeroFillInboxKpis(rows: readonly InboxKpiDay[], days: readonly string[]): InboxKpiDay[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return days.map(
    (day) =>
      byDay.get(day) ?? {
        day,
        inboundMessages: 0,
        gateEvaluated: 0,
        gateSkipped: 0,
        s0SkipRate: null,
        aiRuns: 0,
        aiCostUsd: 0,
        conversationsEnriched: 0,
        costPerEnrichedConversationUsd: null,
      },
  );
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`);
}

export async function loadInboxKpisDaily(db: Db, agencyId: string, days = 30, now: Date = new Date()): Promise<InboxKpiDay[]> {
  const window = recentUtcDays(now, days);
  const { data, error } = await db
    .from("inbox_intelligence_kpis_daily")
    .select("day, inbound_messages, gate_evaluated, gate_skipped, s0_skip_rate, ai_runs, ai_cost_usd, conversations_enriched, cost_per_enriched_conversation_usd")
    .eq("agency_id", agencyId)
    .gte("day", window[0]);
  if (error) failed("Inbox KPIs", error);
  return zeroFillInboxKpis(((data ?? []) as KpiDbRow[]).map(toInboxKpiDay), window);
}

export async function loadInboxLaneHealth(db: Db, agencyId: string): Promise<InboxLaneHealth[]> {
  const { data, error } = await db
    .from("inbox_lane_health")
    .select("lane, queued, running, failed, dead, oldest_queued_age_seconds")
    .eq("agency_id", agencyId);
  if (error) failed("queue health", error);
  return ((data ?? []) as Array<Record<string, number | string>>).map((row) => ({
    lane: String(row.lane),
    queued: Number(row.queued),
    running: Number(row.running),
    failed: Number(row.failed),
    dead: Number(row.dead),
    oldestQueuedAgeSeconds: Number(row.oldest_queued_age_seconds),
  }));
}

export async function loadInboxGateSkipReasons(db: Db, agencyId: string, days = 30, now: Date = new Date()): Promise<InboxGateSkipReason[]> {
  const { data, error } = await db
    .from("inbox_gate_skip_reasons")
    .select("day, decision, reason, decisions, escalated_to_risk")
    .eq("agency_id", agencyId)
    .gte("day", recentUtcDays(now, days)[0]);
  if (error) failed("gate skip reasons", error);
  return ((data ?? []) as Array<Record<string, number | string>>).map((row) => ({
    day: String(row.day),
    decision: row.decision === "SKIP" ? "SKIP" : "ENRICH",
    reason: String(row.reason),
    decisions: Number(row.decisions),
    escalatedToRisk: Number(row.escalated_to_risk),
  }));
}

/** Deterministic aggregate of the stored language state, for owner drill-down. */
export async function loadInboxLanguageBuckets(db: Db, agencyId: string, days = 30, now: Date = new Date()): Promise<InboxLanguageBucket[]> {
  const { data, error } = await db.from("inbox_language_kpis_daily").select("day, language_code, conversations").eq("agency_id", agencyId).gte("day", recentUtcDays(now, days)[0]);
  if (error) failed("Inbox language KPIs", error);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ day: String(row.day), languageCode: String(row.language_code), conversations: Number(row.conversations) }));
}

export type VoiceTranscriptMetricStatus = "PENDING" | "PROCESSING" | "COMPLETE" | "LOW_CONFIDENCE" | "FAILED" | "SKIPPED";

export interface VoiceTranscriptMetricRow {
  status: VoiceTranscriptMetricStatus;
  failureReason: string | null;
  durationSeconds: number | null;
}

export interface VoiceTranscriptMetricRun {
  costUsd: number | null;
  latencyMs: number | null;
}

/** Counts and ratios only. Nothing here can carry what a customer said. */
export interface VoiceTranscriptMetrics {
  total: number;
  byStatus: Record<VoiceTranscriptMetricStatus, number>;
  failureReasons: Record<string, number>;
  succeeded: number;
  /** Of notes that reached the provider (complete, low-confidence, failed). null when none did. */
  successRate: number | null;
  totalAudioSeconds: number;
  aiRuns: number;
  totalCostUsd: number;
  costPerTranscriptUsd: number | null;
  meanLatencyMs: number | null;
}

export function summarizeVoiceTranscriptMetrics(
  transcripts: readonly VoiceTranscriptMetricRow[],
  runs: readonly VoiceTranscriptMetricRun[],
): VoiceTranscriptMetrics {
  const byStatus: Record<VoiceTranscriptMetricStatus, number> = { PENDING: 0, PROCESSING: 0, COMPLETE: 0, LOW_CONFIDENCE: 0, FAILED: 0, SKIPPED: 0 };
  const failureReasons: Record<string, number> = {};
  let totalAudioSeconds = 0;
  for (const row of transcripts) {
    byStatus[row.status] += 1;
    if (row.failureReason) failureReasons[row.failureReason] = (failureReasons[row.failureReason] ?? 0) + 1;
    totalAudioSeconds += row.durationSeconds ?? 0;
  }
  const succeeded = byStatus.COMPLETE + byStatus.LOW_CONFIDENCE;
  const attempted = succeeded + byStatus.FAILED;
  const totalCostUsd = runs.reduce((total, run) => total + (run.costUsd ?? 0), 0);
  const timed = runs.filter((run) => run.latencyMs !== null);
  return {
    total: transcripts.length,
    byStatus,
    failureReasons,
    succeeded,
    successRate: attempted === 0 ? null : succeeded / attempted,
    totalAudioSeconds,
    aiRuns: runs.length,
    totalCostUsd,
    costPerTranscriptUsd: succeeded === 0 ? null : totalCostUsd / succeeded,
    meanLatencyMs: timed.length === 0 ? null : timed.reduce((total, run) => total + (run.latencyMs ?? 0), 0) / timed.length,
  };
}

/** Voice transcription health for the last `days` days. Reads status, reason, duration, cost and latency, never text. */
export async function loadVoiceTranscriptMetrics(db: Db, agencyId: string, days = 30, now: Date = new Date()): Promise<VoiceTranscriptMetrics> {
  const since = `${recentUtcDays(now, days)[0]}T00:00:00Z`;
  const [transcripts, runs] = await Promise.all([
    db.from("inbox_voice_transcripts").select("status, failure_reason, duration_seconds").eq("agency_id", agencyId).gte("requested_at", since),
    db.from("ai_runs").select("cost_usd, latency_ms").eq("agency_id", agencyId).eq("surface", "inbox_voice_transcript").gte("created_at", since),
  ]);
  if (transcripts.error) failed("voice transcripts", transcripts.error);
  if (runs.error) failed("voice transcript AI runs", runs.error);
  return summarizeVoiceTranscriptMetrics(
    ((transcripts.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      status: row.status as VoiceTranscriptMetricStatus,
      failureReason: (row.failure_reason as string | null) ?? null,
      durationSeconds: nullableNumber((row.duration_seconds as number | string | null) ?? null),
    })),
    ((runs.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      costUsd: nullableNumber((row.cost_usd as number | string | null) ?? null),
      latencyMs: nullableNumber((row.latency_ms as number | string | null) ?? null),
    })),
  );
}
