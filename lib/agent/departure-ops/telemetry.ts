/**
 * `departure_ops_runs` / `departure_ops_tool_calls` writers — this agent's
 * own observability tables, deliberately separate from `agent_runs`/
 * `agent_tool_calls` (see F-DRIFT and D10 in
 * docs/modules/departure-operations-agent-implementation-plan.md for why). Mirrors
 * `lib/agent/kernel/telemetry.ts`'s `recordAgentRun`/`recordAgentToolCalls`
 * in spirit, not in table name — the shapes have genuinely diverged
 * (`departure_group_id` is required here; there is no `conversation_id` or
 * `surface`).
 */

import "server-only";

import type { ToolCallRecord } from "@/lib/agent/kernel/telemetry";
import type { Db } from "@/lib/data/departure-groups-repository";
import type { GuardrailViolation } from "@/lib/agent/departure-ops/guardrails";

export interface DepartureOpsRunInput {
  agencyId: string;
  departureGroupId: string;
  jobId?: string | null;
  model: string;
  effort: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
  status: string;
  stopReason: string | null;
  error?: string | null;
  /**
   * §13's material summary of the snapshot this run acted on — never the
   * full snapshot (see snapshot.ts's header on why that stays a read
   * model, not a second store). `null` for a run that never reached a
   * snapshot (e.g. MODEL_ERROR before one was built).
   */
  readinessScore?: number | null;
  blockerCount?: number | null;
  tier?: string | null;
  /** applyGuardrails()'s violations for this run — [] for a run with nothing staged, or one that never reached guardrails. */
  guardrailViolations?: GuardrailViolation[];
}

/** Inserts one `departure_ops_runs` row and returns its id. Throws on failure — a turn whose own record can't be written is not a turn to trust. */
export async function recordDepartureOpsRun(db: Db, input: DepartureOpsRunInput): Promise<string> {
  const { data, error } = await db
    .from("departure_ops_runs")
    .insert({
      agency_id: input.agencyId,
      departure_group_id: input.departureGroupId,
      job_id: input.jobId ?? null,
      model: input.model,
      effort: input.effort,
      input_tokens: input.usage.input,
      output_tokens: input.usage.output,
      cache_read_tokens: input.usage.cacheRead,
      cache_creation_tokens: input.usage.cacheCreation,
      latency_ms: input.latencyMs,
      status: input.status,
      stop_reason: input.stopReason,
      error: input.error ?? null,
      readiness_score: input.readinessScore ?? null,
      blocker_count: input.blockerCount ?? null,
      tier: input.tier ?? null,
      guardrail_violations: input.guardrailViolations ?? [],
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to record departure_ops_runs: ${error.message}`);
  return (data as { id: string }).id;
}

/** Inserts every `departure_ops_tool_calls` row for one run. No-ops on an empty list. */
export async function recordDepartureOpsToolCalls(
  db: Db,
  agencyId: string,
  runId: string,
  calls: ToolCallRecord[],
): Promise<void> {
  if (calls.length === 0) return;

  const { error } = await db.from("departure_ops_tool_calls").insert(
    calls.map((call) => ({
      agency_id: agencyId,
      agent_run_id: runId,
      tool_name: call.toolName,
      arguments: call.arguments ?? {},
      result_summary: call.resultSummary,
      is_error: call.isError,
      latency_ms: call.latencyMs,
    })),
  );

  if (error) throw new Error(`Failed to record departure_ops_tool_calls: ${error.message}`);
}
