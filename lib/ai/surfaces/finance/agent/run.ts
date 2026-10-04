/**
 * The turn — one nightly Finance review, one commit or none. Mirrors
 * `lib/agent/departure-ops/run.ts`'s shape (build context, run the tool
 * loop, guardrail the staged buffer, commit) but writes through the
 * generic Phase 0 kernel throughout: `ai_runs`/`ai_tool_calls` for
 * telemetry (`lib/ai/telemetry.ts`), `insights` for findings
 * (`createCopilotInsight`), `agent_proposals` for proposals
 * (`createProposal`) — no Finance-specific tables of its own.
 */

import "server-only";

import { getClient, isAiConfigured, MODEL_ID } from "@/lib/agent/kernel/runner";
import type { ToolTelemetry } from "@/lib/agent/kernel/telemetry";
import { createProposal } from "@/lib/agent/kernel/proposals/service";
import { createCopilotInsight } from "@/lib/data/insights-repository";
import { hashObject } from "@/lib/agent/kernel/hash";
import { recordAiRun, recordAiToolCalls } from "@/lib/ai/telemetry";
import type { Db } from "@/lib/ai/db";
import type { FinancePeriodPack } from "@/lib/ai/surfaces/finance/pack";

import { buildFinanceOpsSystemPrompt } from "./prompt";
import { buildFinanceOpsToolSet, type FinanceOpsBuffer } from "./tools";
import { checkCorroboration } from "./guardrails";

const MAX_ITERATIONS = 10;
const SURFACE = "FINANCE_OPS";

/** `ai_runs.status`'s own check constraint has no INCOMPLETE value — it maps to MODEL_ERROR for storage; `FinanceOpsRunResult.status` keeps the finer-grained distinction for the caller. */
function toAiRunsStatus(status: FinanceOpsRunStatus): string {
  return status === "INCOMPLETE" ? "MODEL_ERROR" : status;
}

export type FinanceOpsMode = "SHADOW" | "PROPOSE" | "ACTIVE";

export type FinanceOpsRunStatus = "OK" | "TOOL_ERROR" | "MODEL_ERROR" | "REFUSAL" | "INCOMPLETE";

export interface FinanceOpsRunResult {
  status: FinanceOpsRunStatus;
  runId: string | null;
  fingerprint: string;
  summary: string | null;
  committed: { findings: number; proposals: number };
  guardrailViolations: string[];
  error?: string;
}

export interface ExecuteFinanceOpsTurnParams {
  pack: FinancePeriodPack;
  agencyName: string;
  agencyTimezone: string;
  /** SHADOW never commits a proposal, only findings — see this directory's README-equivalent (this file's own header) and `scheduler.ts`. */
  mode: FinanceOpsMode;
}

export async function executeFinanceOpsTurn(
  ctx: { agencyId: string; db: Db },
  params: ExecuteFinanceOpsTurnParams,
): Promise<FinanceOpsRunResult> {
  const startedAt = Date.now();
  const { pack, agencyName, agencyTimezone, mode } = params;
  const fingerprint = hashObject(pack.metrics);

  if (!isAiConfigured()) {
    return {
      status: "MODEL_ERROR",
      runId: null,
      fingerprint,
      summary: null,
      committed: { findings: 0, proposals: 0 },
      guardrailViolations: [],
      error: "OPENROUTER_API_KEY is not configured for this environment.",
    };
  }

  const systemPrompt = buildFinanceOpsSystemPrompt({ pack, agencyName, agencyTimezone });
  const telemetry: ToolTelemetry = { calls: [] };
  const { tools, buffer } = buildFinanceOpsToolSet({ agencyId: ctx.agencyId, db: ctx.db }, telemetry);

  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let stopReason: string | null = null;

  try {
    const runner = getClient().beta.messages.toolRunner({
      model: MODEL_ID,
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools,
      messages: [
        {
          role: "user",
          content:
            "Run tonight's Finance review now. The current snapshot is already in your system prompt — use the read tools to look at the actual accounts, lines, and groups behind it before raising anything.",
        },
      ],
      max_iterations: MAX_ITERATIONS,
    });

    for await (const message of runner) {
      stopReason = message.stop_reason ?? stopReason;
      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreation += message.usage.cache_creation_input_tokens ?? 0;
    }
  } catch (error) {
    const runId = await recordAiRun(ctx.db, {
      agencyId: ctx.agencyId,
      surface: SURFACE,
      tier: "reason",
      subjectType: "AGENCY",
      subjectId: ctx.agencyId,
      model: MODEL_ID,
      usage,
      latencyMs: Date.now() - startedAt,
      status: "MODEL_ERROR",
      stopReason,
      error: error instanceof Error ? error.message : String(error),
      packFingerprint: fingerprint,
    });
    await recordAiToolCalls(ctx.db, ctx.agencyId, runId, telemetry.calls);
    return {
      status: "MODEL_ERROR",
      runId,
      fingerprint,
      summary: null,
      committed: { findings: 0, proposals: 0 },
      guardrailViolations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let status: FinanceOpsRunStatus = "OK";
  let errorMessage: string | undefined;

  if (stopReason === "refusal") {
    status = "REFUSAL";
  } else if (telemetry.calls.some((call) => call.isError)) {
    status = "TOOL_ERROR";
    errorMessage = telemetry.calls.find((call) => call.isError)?.resultSummary;
  } else if (!buffer.submitted) {
    status = "INCOMPLETE";
    errorMessage = "The run ended without calling submit_review — nothing was committed.";
  }

  const availableMetricKeys = new Set(Object.keys(pack.metrics));
  const { kept: keptFindings, violations } =
    status === "OK" ? checkCorroboration(buffer.findings, availableMetricKeys) : { kept: [], violations: [] };

  const runId = await recordAiRun(ctx.db, {
    agencyId: ctx.agencyId,
    surface: SURFACE,
    tier: "reason",
    subjectType: "AGENCY",
    subjectId: ctx.agencyId,
    model: MODEL_ID,
    usage,
    latencyMs: Date.now() - startedAt,
    status: toAiRunsStatus(status),
    stopReason,
    error: errorMessage ?? null,
    packFingerprint: fingerprint,
  });
  await recordAiToolCalls(ctx.db, ctx.agencyId, runId, telemetry.calls);

  if (status !== "OK") {
    return {
      status,
      runId,
      fingerprint,
      summary: null,
      committed: { findings: 0, proposals: 0 },
      guardrailViolations: violations.map((v) => v.detail),
      error: errorMessage,
    };
  }

  const committed = await commitFinanceOpsBuffer(ctx, runId, { ...buffer, findings: keptFindings }, mode);

  return {
    status: "OK",
    runId,
    fingerprint,
    summary: buffer.submitted?.summary ?? null,
    committed,
    guardrailViolations: violations.map((v) => v.detail),
  };
}

async function commitFinanceOpsBuffer(
  ctx: { agencyId: string; db: Db },
  runId: string | null,
  buffer: FinanceOpsBuffer,
  mode: FinanceOpsMode,
): Promise<{ findings: number; proposals: number }> {
  let findingsCommitted = 0;
  for (const finding of buffer.findings) {
    const subjectId = finding.subjectType === "AGENCY" ? ctx.agencyId : finding.subjectId;
    const outcome = await createCopilotInsight(ctx.db, {
      agencyId: ctx.agencyId,
      insightType: `FINANCE_OPS_${finding.severity}`,
      severity: finding.severity,
      title: finding.headline,
      description: finding.detail,
      subjectType: finding.subjectType,
      subjectId,
      module: "finance",
      surface: SURFACE,
      confidence: null,
      recommendation: null,
      runId,
      evidence: finding.corroboratingMetricKey ? [{ label: "Corroborating metric", detail: finding.corroboratingMetricKey }] : [],
    });
    if (!outcome.skipped) findingsCommitted += 1;
  }

  // SHADOW never touches agent_proposals — plan §P1.7: "ship in SHADOW"
  // means the loop runs for real and produces real findings, not that it
  // starts staging real proposals a human's approvals queue would show.
  let proposalsCommitted = 0;
  if (mode !== "SHADOW") {
    for (const proposal of buffer.proposals) {
      const outcome = await createProposal(
        {
          agencyId: ctx.agencyId,
          subjectId: proposal.subjectId,
          agentRunId: runId,
          kind: proposal.kind,
          payload: proposal.payload,
          title: proposal.title,
          rationale: proposal.rationale,
        },
        ctx.db,
      );
      if (outcome.ok) proposalsCommitted += 1;
    }
  }

  return { findings: findingsCommitted, proposals: proposalsCommitted };
}
