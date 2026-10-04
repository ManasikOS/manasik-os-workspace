/**
 * Shared agent observability — the `ToolTelemetry` accumulator every tool
 * set is wrapped with, `wrapWithTelemetryAndRedaction()`, and the
 * `agent_runs` / `agent_tool_calls` writers for the WhatsApp agent
 * specifically. Moved out of `lib/agent/tools/registry.ts` and
 * `lib/agent/drain.ts` (now under `lib/agent/whatsapp/`) in Phase 0.
 *
 * The original intent (see the departure-operations-agent plan's D10) was
 * for a second agent to record into these same two tables, distinguished
 * by a `surface` column — that plan changed after F-DRIFT of that same
 * document found the live `agent_runs`/`agent_jobs` did not match their
 * own migration files. The Departure Operations Agent writes to its own
 * `departure_ops_runs`/`departure_ops_tool_calls` instead (see
 * `lib/agent/departure-ops/telemetry.ts`), which is a **different shape**
 * (a required `departure_group_id`, no `conversation_id`/`surface`), not a
 * copy of the writers below. `wrapWithTelemetryAndRedaction()` and
 * `ToolTelemetry` are still genuinely shared — every agent's tool set is
 * wrapped in exactly this, regardless of which table its run ends up in.
 *
 * The redaction allowlist here is a second, defensive pass over every tool
 * result, independent of whichever agent is calling — the underlying data
 * sources (departure-groups-ai.ts, the lead tools' hand-picked column
 * selects, and this agent's own snapshot builders) already omit sensitive
 * fields by construction. This is the backstop for a future tool that
 * forgets to scope its own `.select()`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- every tool has a genuinely different input type; BetaRunnableTool<any> is the SDK's own shape for a heterogeneous tool array */
import "server-only";

import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

import type { Db } from "@/lib/data/whatsapp-repository";
// Moved to lib/ai/trust/redaction.ts in Phase 0 (P0.3) so every surface's
// Context Pack, not just this agent's tool results, gets the same
// backstop. Re-exported here so nothing importing `FORBIDDEN_KEYS` from
// this file breaks.
import { FORBIDDEN_KEYS } from "@/lib/ai/trust/redaction";

export { FORBIDDEN_KEYS };

export interface ToolCallRecord {
  toolName: string;
  arguments: unknown;
  resultSummary: string;
  isError: boolean;
  latencyMs: number;
}

/** Mutable accumulator the wrapped tools push into — read once the turn ends. */
export interface ToolTelemetry {
  calls: ToolCallRecord[];
}

/** Field names that must never reach an external surface or a log a customer/supplier could see, wherever they appear. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !FORBIDDEN_KEYS.has(key))
        .map(([key, v]) => [key, redact(v)]),
    );
  }
  return value;
}

const RESULT_SUMMARY_MAX_CHARS = 500;

/**
 * `betaTool`'s `run` return type is `string | Array<BetaToolResultContentBlockParam>`
 * — every tool in this codebase returns a JSON string, so the redaction pass
 * only needs to handle that shape; non-string returns pass through
 * untouched. Telemetry is recorded regardless of shape, and never throws
 * itself — a telemetry failure must never take down a tool call that
 * otherwise succeeded.
 */
export function wrapWithTelemetryAndRedaction<T extends { name: string; run: (...args: any[]) => any }>(
  tool: T,
  telemetry: ToolTelemetry,
): T {
  const originalRun = tool.run.bind(tool);
  return {
    ...tool,
    run: async (...args: Parameters<T["run"]>) => {
      const startedAt = Date.now();
      let isError = false;
      let output: unknown;

      try {
        output = await originalRun(...args);
      } catch (error) {
        isError = true;
        output = error instanceof Error ? error.message : String(error);
        telemetry.calls.push({
          toolName: tool.name,
          arguments: args[0],
          resultSummary: String(output).slice(0, RESULT_SUMMARY_MAX_CHARS),
          isError,
          latencyMs: Date.now() - startedAt,
        });
        throw error;
      }

      const redacted =
        typeof output === "string"
          ? (() => {
              try {
                return JSON.stringify(redact(JSON.parse(output)));
              } catch {
                return output; // not JSON (e.g. a plain error string) — nothing to redact
              }
            })()
          : output;

      telemetry.calls.push({
        toolName: tool.name,
        arguments: args[0],
        resultSummary: typeof redacted === "string" ? redacted.slice(0, RESULT_SUMMARY_MAX_CHARS) : "[non-text tool result]",
        isError,
        latencyMs: Date.now() - startedAt,
      });

      return redacted;
    },
  } as T;
}

// Widened the same way buildToolSet's array is — a heterogeneous tool set,
// not this module's concern which agent assembled it.
export type AnyRunnableTool = BetaRunnableTool<any>;

/* ── agent_runs / agent_tool_calls writers ──────────────────────────────── */

export interface AgentRunInput {
  agencyId: string;
  /** 'WHATSAPP' is the column default — every pre-existing writer omits this and keeps working unchanged. */
  surface?: "WHATSAPP" | "DEPARTURE_OPS";
  /**
   * The channel the turn answered on. Only written when it is not WHATSAPP: the column defaults to WHATSAPP, so
   * every existing writer stays byte-for-byte unchanged (the live table has drifted from the migrations before —
   * see the note on `surface` below — and an unknown column fails the whole insert).
   */
  channel?: "WHATSAPP" | "MESSENGER" | "INSTAGRAM";
  conversationId?: string | null;
  departureGroupId?: string | null;
  jobId?: string | null;
  model: string;
  effort: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
  status: string;
  stopReason: string | null;
  error?: string | null;
}

/** Inserts one `agent_runs` row and returns its id. Throws on failure — a turn whose own record can't be written is not a turn to trust. */
export async function recordAgentRun(db: Db, input: AgentRunInput): Promise<string> {
  const { data, error } = await db
    .from("agent_runs")
    .insert({
      agency_id: input.agencyId,
      conversation_id: input.conversationId ?? null,
      // Only sent when set: the live agent_runs table has neither `surface` nor `departure_group_id` (drift, see
      // the ai_runs migration header). Even an undefined value makes the client name the column, which failed
      // every WhatsApp turn with "Could not find the 'surface' column".
      ...(input.surface ? { surface: input.surface } : {}),
      ...(input.channel && input.channel !== "WHATSAPP" ? { channel: input.channel } : {}),
      ...(input.departureGroupId ? { departure_group_id: input.departureGroupId } : {}),
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
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to record agent_runs: ${error.message}`);
  return (data as { id: string }).id;
}

/** Inserts every `agent_tool_calls` row for one run. No-ops on an empty list rather than sending an empty insert. */
export async function recordAgentToolCalls(
  db: Db,
  agencyId: string,
  agentRunId: string,
  calls: ToolCallRecord[],
): Promise<void> {
  if (calls.length === 0) return;

  const { error } = await db.from("agent_tool_calls").insert(
    calls.map((call) => ({
      agency_id: agencyId,
      agent_run_id: agentRunId,
      tool_name: call.toolName,
      arguments: call.arguments ?? {},
      result_summary: call.resultSummary,
      is_error: call.isError,
      latency_ms: call.latencyMs,
    })),
  );

  if (error) throw new Error(`Failed to record agent_tool_calls: ${error.message}`);
}
