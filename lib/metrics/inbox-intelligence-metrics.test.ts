import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadInboxGateSkipReasons,
  loadInboxKpisDaily,
  loadInboxLaneHealth,
  loadInboxLanguageBuckets,
  loadVoiceTranscriptMetrics,
  recentUtcDays,
  summarizeVoiceTranscriptMetrics,
  toInboxKpiDay,
  zeroFillInboxKpis,
} from "./inbox-intelligence-metrics";

const AGENCY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENCY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-20T10:00:00Z");

type Row = Record<string, unknown>;

/**
 * A two-agency in-memory stand-in for the views. It only returns a row when the query filtered by agency,
 * exactly like RLS would for a session client — a query that forgets `.eq("agency_id", …)` gets BOTH agencies'
 * rows back, so the isolation assertions below fail loudly if a loader drops its filter.
 */
function fakeTwoAgencyDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return builder;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return builder;
        },
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: (tables[table] ?? []).filter((row) => filters.every((test) => test(row))), error: null }),
      };
      return builder;
    },
  };
}

const kpiRow = (agency: string, overrides: Row = {}): Row => ({
  agency_id: agency,
  day: "2026-09-19",
  inbound_messages: 10,
  gate_evaluated: 10,
  gate_skipped: 6,
  s0_skip_rate: "0.6000",
  ai_runs: 4,
  ai_cost_usd: "0.0480",
  conversations_enriched: 4,
  cost_per_enriched_conversation_usd: "0.012000",
  ...overrides,
});

describe("zero-filled series", () => {
  it("returns one all-zero entry per day for an agency with no rows, with null rates rather than 0", () => {
    const days = recentUtcDays(NOW, 3);
    expect(days).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    const filled = zeroFillInboxKpis([], days);
    expect(filled).toHaveLength(3);
    for (const day of filled) {
      expect(day).toMatchObject({ inboundMessages: 0, gateEvaluated: 0, gateSkipped: 0, aiRuns: 0, aiCostUsd: 0, conversationsEnriched: 0 });
      expect(day.s0SkipRate).toBeNull();
      expect(day.costPerEnrichedConversationUsd).toBeNull();
    }
  });

  it("keeps a stored day and fills only the gaps around it", () => {
    const stored = toInboxKpiDay(kpiRow(AGENCY_A) as never);
    const filled = zeroFillInboxKpis([stored], recentUtcDays(NOW, 3));
    expect(filled.map((day) => day.inboundMessages)).toEqual([0, 10, 0]);
    expect(filled[1].s0SkipRate).toBe(0.6);
    expect(filled[1].costPerEnrichedConversationUsd).toBe(0.012);
  });

  it("converts numeric strings from Postgres to numbers", () => {
    const day = toInboxKpiDay(kpiRow(AGENCY_A) as never);
    expect(day.aiCostUsd).toBe(0.048);
    expect(typeof day.s0SkipRate).toBe("number");
  });
});

describe("every view is agency-scoped: a two-agency fixture returns no foreign rows", () => {
  const db = fakeTwoAgencyDb({
    inbox_intelligence_kpis_daily: [kpiRow(AGENCY_A, { inbound_messages: 10 }), kpiRow(AGENCY_B, { inbound_messages: 999 })],
    inbox_lane_health: [
      { agency_id: AGENCY_A, lane: "LEGACY_AGENT", queued: 2, running: 0, failed: 0, dead: 0, oldest_queued_age_seconds: 30 },
      { agency_id: AGENCY_B, lane: "LEGACY_AGENT", queued: 500, running: 3, failed: 0, dead: 1, oldest_queued_age_seconds: 900 },
    ],
    inbox_gate_skip_reasons: [
      { agency_id: AGENCY_A, day: "2026-09-19", decision: "SKIP", reason: "ACKNOWLEDGEMENT", decisions: 5, escalated_to_risk: 0 },
      { agency_id: AGENCY_B, day: "2026-09-19", decision: "SKIP", reason: "ACKNOWLEDGEMENT", decisions: 777, escalated_to_risk: 2 },
    ],
    inbox_language_kpis_daily: [
      { agency_id: AGENCY_A, day: "2026-09-19", language_code: "si", conversations: 3 },
      { agency_id: AGENCY_B, day: "2026-09-19", language_code: "ta", conversations: 999 },
    ],
  });

  it("inbox_intelligence_kpis_daily", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const days = await loadInboxKpisDaily(db as any, AGENCY_A, 3, NOW);
    expect(days.reduce((sum, day) => sum + day.inboundMessages, 0)).toBe(10);
  });

  it("inbox_lane_health", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lanes = await loadInboxLaneHealth(db as any, AGENCY_A);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].queued).toBe(2);
  });

  it("inbox_gate_skip_reasons", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reasons = await loadInboxGateSkipReasons(db as any, AGENCY_A, 3, NOW);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].decisions).toBe(5);
  });

  it("inbox_language_kpis_daily", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(loadInboxLanguageBuckets(db as any, AGENCY_A, 3, NOW)).resolves.toEqual([{ day: "2026-09-19", languageCode: "si", conversations: 3 }]);
  });

  it("an agency with no rows in any view gets zeros, not another agency's numbers", async () => {
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const days = await loadInboxKpisDaily(db as any, other, 3, NOW);
    expect(days.every((day) => day.inboundMessages === 0 && day.aiCostUsd === 0)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await loadInboxLaneHealth(db as any, other)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await loadInboxGateSkipReasons(db as any, other, 3, NOW)).toEqual([]);
  });

  it("a failed read throws a readable error instead of returning empty numbers", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ gte: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(loadInboxKpisDaily(broken as any, AGENCY_A, 3, NOW)).rejects.toThrow(/Could not load Inbox KPIs: boom/);
  });
});

describe("the migration defines each view as security_invoker and RLS-protects the new table", () => {
  const sql = [
    readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202090100_mi0_3_inbox_metrics_views.sql"), "utf8"),
    readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261202093600_fix10_inbox_language_kpis.sql"), "utf8"),
  ].join("\n");

  it.each(["inbox_intelligence_kpis_daily", "inbox_lane_health", "inbox_gate_skip_reasons", "inbox_language_kpis_daily"])("%s", (view) => {
    const definition = new RegExp(`create or replace view public\\.${view}\\s+with \\(security_invoker = true\\)`);
    expect(sql).toMatch(definition);
  });

  it("enables RLS on inbox_gate_decisions in the same migration and grants authenticated read only", () => {
    expect(sql).toMatch(/alter table public\.inbox_gate_decisions enable row level security/);
    expect(sql).toMatch(/for select to authenticated\s+using \(agency_id = public\.current_agency_id\(\)\)/);
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/);
  });
});

describe("voice transcript metrics", () => {
  const transcript = (agency: string, overrides: Row = {}): Row => ({
    agency_id: agency,
    status: "COMPLETE",
    failure_reason: null,
    duration_seconds: "30.00",
    requested_at: "2026-09-19T10:00:00Z",
    ...overrides,
  });
  const run = (agency: string, overrides: Row = {}): Row => ({
    agency_id: agency,
    surface: "inbox_voice_transcript",
    status: "OK",
    cost_usd: "0.002",
    latency_ms: 1000,
    created_at: "2026-09-19T10:00:00Z",
    ...overrides,
  });

  it("summarises success, failure reasons, audio duration, cost and latency", () => {
    const summary = summarizeVoiceTranscriptMetrics(
      [
        { status: "COMPLETE", failureReason: null, durationSeconds: 30 },
        { status: "LOW_CONFIDENCE", failureReason: null, durationSeconds: 10 },
        { status: "FAILED", failureReason: "PROVIDER_ERROR", durationSeconds: 5 },
        { status: "FAILED", failureReason: "NO_SPEECH", durationSeconds: null },
        { status: "SKIPPED", failureReason: "DISABLED", durationSeconds: null },
        { status: "PENDING", failureReason: null, durationSeconds: null },
      ],
      [
        { costUsd: 0.002, latencyMs: 1000 },
        { costUsd: 0.004, latencyMs: 3000 },
      ],
    );
    expect(summary).toMatchObject({
      total: 6,
      byStatus: { COMPLETE: 1, LOW_CONFIDENCE: 1, FAILED: 2, SKIPPED: 1, PENDING: 1, PROCESSING: 0 },
      failureReasons: { PROVIDER_ERROR: 1, NO_SPEECH: 1, DISABLED: 1 },
      succeeded: 2,
      successRate: 0.5,
      totalAudioSeconds: 45,
      aiRuns: 2,
      meanLatencyMs: 2000,
    });
    expect(summary.totalCostUsd).toBeCloseTo(0.006, 6);
    expect(summary.costPerTranscriptUsd).toBeCloseTo(0.003, 6);
  });

  it("reports null rates, not zero, when nothing has been processed", () => {
    expect(summarizeVoiceTranscriptMetrics([], [])).toMatchObject({
      total: 0,
      successRate: null,
      meanLatencyMs: null,
      costPerTranscriptUsd: null,
      totalCostUsd: 0,
    });
  });

  it("does not count skipped or still-pending notes against the success rate", () => {
    const summary = summarizeVoiceTranscriptMetrics(
      [
        { status: "SKIPPED", failureReason: "DISABLED", durationSeconds: null },
        { status: "PENDING", failureReason: null, durationSeconds: null },
      ],
      [],
    );
    expect(summary.successRate).toBeNull();
  });

  it("loads only the caller's agency and reads no transcript text", async () => {
    const db = fakeTwoAgencyDb({
      inbox_voice_transcripts: [transcript(AGENCY_A), transcript(AGENCY_B, { status: "FAILED", failure_reason: "TIMEOUT" })],
      ai_runs: [run(AGENCY_A), run(AGENCY_B, { cost_usd: "9.99" })],
    });
    const summary = await loadVoiceTranscriptMetrics(db as never, AGENCY_A, 30, NOW);
    expect(summary).toMatchObject({ total: 1, succeeded: 1, aiRuns: 1, totalAudioSeconds: 30 });
    expect(summary.totalCostUsd).toBeCloseTo(0.002, 6);
    expect(summary.failureReasons).toEqual({});
  });

  it("selects metadata columns only, so transcript content cannot reach a dashboard or log", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/metrics/inbox-intelligence-metrics.ts"), "utf8");
    const voiceSection = source.slice(source.indexOf("loadVoiceTranscriptMetrics"));
    expect(voiceSection).not.toMatch(/transcript_text/);
  });

  it("only counts the last N days", async () => {
    const db = fakeTwoAgencyDb({
      inbox_voice_transcripts: [transcript(AGENCY_A), transcript(AGENCY_A, { requested_at: "2026-06-01T00:00:00Z" })],
      ai_runs: [],
    });
    expect((await loadVoiceTranscriptMetrics(db as never, AGENCY_A, 30, NOW)).total).toBe(1);
  });
});
