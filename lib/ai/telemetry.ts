/**
 * The unified `ai_runs` / `ai_tool_calls` writers every surface's AI call
 * goes through — Phase 0 (P0.1) of
 * docs/modules/manasik-intelligence-build-roadmap.md.
 *
 * Deliberately its own fresh pair of tables, NOT an alteration of
 * `agent_runs`/`agent_tool_calls`. Those two (along with `agent_jobs`,
 * `conversations`, `conversation_messages`, `booking_sessions`) have
 * documented, unresolved schema drift between their migration files and
 * the live database — see the header of
 * `supabase/migrations/20260919090000_departure_operations_agent.sql`
 * ("why this does not touch agent_jobs / agent_runs / agent_tool_calls"):
 * the live `agent_runs` has `tier`/`role`/`model_requested`/`model_served`/
 * `cost_usd`/`turn_count`, not this repo's `model`/`effort`/`stop_reason`
 * shape, and no migration in this repo has ever been applied through
 * tracked history. The Departure Operations Agent already set the
 * precedent of sidestepping this by writing to its own
 * `departure_ops_runs`/`departure_ops_tool_calls` instead of entangling
 * itself with that dispute. This module follows the same precedent for
 * every other surface: `ai_runs`/`ai_tool_calls` are new tables (migration
 * `_p0_1_ai_runs`), and `lib/agent/kernel/telemetry.ts`'s
 * `agent_runs`/`agent_tool_calls` writers for the WhatsApp agent are left
 * completely alone.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import type { AiTier } from "@/lib/ai/provider";
import { loadAiModelRates, priceTokenUsage, selectModelRate, type AiTokenUsage } from "@/lib/ai/rates";

/** Re-exported so a future tool-wrapping surface doesn't need to import from `lib/agent/kernel/telemetry.ts` directly. */
export { FORBIDDEN_KEYS } from "@/lib/ai/trust/redaction";

export interface RecordAiRunInput {
  agencyId: string;
  surface: string;
  tier: AiTier | null;
  subjectType: string | null;
  subjectId: string | null;
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
  status: string;
  stopReason: string | null;
  error?: string | null;
  /** The Context Pack's own fingerprint, when this run read one — a looping agent's NOOP gate (Phase 1, P1.7) compares today's pack fingerprint against the most recent row here instead of needing its own state table. */
  packFingerprint?: string | null;
}

/**
 * Inserts one `agent_runs` row (the table's name predates this module —
 * kept, not renamed, since ~50 rows of production history and every
 * existing dashboard query already key off it) and returns its id.
 * Never throws — a telemetry failure must never take down the AI call it
 * describes; the caller gets `null` back and carries on.
 */
export async function recordAiRun(db: Db, input: RecordAiRunInput): Promise<string | null> {
  try {
    const cost = await estimateCostUsd(db, input.model, input.usage);
    const { data, error } = await db
      .from("ai_runs")
      .insert({
        agency_id: input.agencyId,
        surface: input.surface,
        tier: input.tier,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        model: input.model,
        input_tokens: input.usage.input,
        output_tokens: input.usage.output,
        cache_read_tokens: input.usage.cacheRead,
        cache_creation_tokens: input.usage.cacheCreation,
        cost_usd: cost,
        latency_ms: input.latencyMs,
        status: input.status,
        stop_reason: input.stopReason,
        error: input.error ?? null,
        pack_fingerprint: input.packFingerprint ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("recordAiRun failed (non-fatal):", error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (error) {
    console.error("recordAiRun failed (non-fatal):", error);
    return null;
  }
}

export interface AiToolCallRecord {
  toolName: string;
  arguments: unknown;
  resultSummary: string;
  isError: boolean;
  latencyMs: number;
}

/** Inserts every `agent_tool_calls` row for one run. No-ops on an empty list. Never throws. */
export async function recordAiToolCalls(
  db: Db,
  agencyId: string,
  runId: string | null,
  calls: AiToolCallRecord[],
): Promise<void> {
  if (!runId || calls.length === 0) return;
  try {
    const { error } = await db.from("ai_tool_calls").insert(
      calls.map((call) => ({
        agency_id: agencyId,
        ai_run_id: runId,
        tool_name: call.toolName,
        arguments: call.arguments ?? {},
        result_summary: call.resultSummary,
        is_error: call.isError,
        latency_ms: call.latencyMs,
      })),
    );
    if (error) console.error("recordAiToolCalls failed (non-fatal):", error.message);
  } catch (error) {
    console.error("recordAiToolCalls failed (non-fatal):", error);
  }
}

/**
 * Dollar cost of one run at the rate in force now (`ai_model_rates`, dated, cached five minutes —
 * see `lib/ai/rates.ts`). Input, output, cache-read and cache-write tokens are priced separately.
 * `null` — never `0` — when no rate covers the model or the rate table cannot be read: an unpriced
 * model must show up as "unknown", not as free. Never throws.
 */
export async function estimateCostUsd(db: Db, model: string, usage: AiTokenUsage, at: Date = new Date()): Promise<number | null> {
  try {
    const rate = selectModelRate(await loadAiModelRates(db), model, at);
    return rate ? priceTokenUsage(rate, usage) : null;
  } catch (error) {
    console.error("estimateCostUsd failed (non-fatal, cost recorded as unknown):", error);
    return null;
  }
}
