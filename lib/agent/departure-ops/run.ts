/**
 * The turn — one Departure Operations Agent review, one commit or none.
 * See §10.3 of docs/modules/departure-operations-agent-implementation-plan.md.
 * Phase 5's scheduler decides *whether* and *when* to call this (the D9
 * NOOP gate against `departure_group_agent_state` lives there, not here —
 * this function always actually runs the model when called); this module
 * is entirely "given a review should happen right now, run it and commit
 * what passed the guardrails."
 */

import "server-only";

import { mutate } from "@/lib/data/departure-groups";
import {
  createGroupTaskInStore,
  reassignGroupTaskInStore,
  updateGroupTaskStatusInStore,
} from "@/lib/data/departure-groups-tasks";
import { updateReadinessItemInStore } from "@/lib/data/departure-groups-readiness";
import { getAgencySettings } from "@/lib/data/settings-repository";
import type { GroupActor } from "@/lib/types/departure-groups";

import { COPILOT_NAME } from "@/lib/agent/identity";
import { getClient, isAiConfigured, MODEL_ID } from "@/lib/agent/kernel/runner";
import type { ToolTelemetry } from "@/lib/agent/kernel/telemetry";
import { createProposal } from "@/lib/agent/kernel/proposals/service";
import { getExecutor } from "@/lib/agent/kernel/proposals/registry";

import type { DepartureOpsContext } from "@/lib/agent/departure-ops/context";
import { buildOpsSnapshot, effortForTier, type OpsSnapshot } from "@/lib/agent/departure-ops/snapshot";
import { buildDepartureOpsSystemPrompt } from "@/lib/agent/departure-ops/prompt";
import { buildDepartureOpsToolSet } from "@/lib/agent/departure-ops/tools/registry";
import { applyGuardrails, DEFAULT_GUARDRAIL_CONFIG, type GuardrailConfig, type GuardrailViolation } from "@/lib/agent/departure-ops/guardrails";
import { recordDepartureOpsRun, recordDepartureOpsToolCalls } from "@/lib/agent/departure-ops/telemetry";

const MAX_ITERATIONS = 12;

export type DepartureOpsRunStatus =
  | "OK"
  | "TOOL_ERROR"
  | "MODEL_ERROR"
  | "REFUSAL"
  | "INCOMPLETE";

export interface DepartureOpsRunResult {
  status: DepartureOpsRunStatus;
  runId: string | null;
  fingerprint: string;
  tier: OpsSnapshot["group"]["tier"];
  summary: string | null;
  committed: {
    tasks: number;
    findings: number;
    proposals: number;
  };
  guardrailViolations: GuardrailViolation[];
  error?: string;
}

interface AiSettingsRow {
  departure_ops_max_proposals_per_run: number;
  departure_ops_max_tasks_per_run: number;
  departure_ops_rejection_cooldown_days: number;
}

export const DEFAULT_REJECTION_COOLDOWN_DAYS = 14;

/**
 * Fetches the `ai_settings` fields this module needs, defaulting to the
 * same values the migration's own column defaults use if the row is
 * somehow missing. Exported so `scheduler.ts` (Phase 5) can fetch this
 * once and pass it — along with the snapshot it builds for its own D9
 * NOOP check — into `executeDepartureOpsTurn()` rather than this module
 * fetching everything a second time.
 */
export async function loadGuardrailConfig(
  ctx: DepartureOpsContext,
): Promise<{ guardrailConfig: GuardrailConfig; rejectionCooldownDays: number }> {
  const { data } = await ctx.db
    .from("ai_settings")
    .select("departure_ops_max_proposals_per_run, departure_ops_max_tasks_per_run, departure_ops_rejection_cooldown_days")
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();

  const row = (data as AiSettingsRow | null) ?? {
    departure_ops_max_proposals_per_run: DEFAULT_GUARDRAIL_CONFIG.maxProposalsPerRun,
    departure_ops_max_tasks_per_run: DEFAULT_GUARDRAIL_CONFIG.maxTasksPerRun,
    departure_ops_rejection_cooldown_days: DEFAULT_REJECTION_COOLDOWN_DAYS,
  };

  return {
    guardrailConfig: {
      maxProposalsPerRun: row.departure_ops_max_proposals_per_run,
      maxTasksPerRun: row.departure_ops_max_tasks_per_run,
    },
    rejectionCooldownDays: row.departure_ops_rejection_cooldown_days,
  };
}

/**
 * Runs one review turn for one group and commits whatever survived the
 * guardrails. `jobId` links the resulting `departure_ops_runs` row back to
 * the `departure_ops_jobs` row that triggered it.
 *
 * Fetches its own config and builds its own snapshot — the standalone,
 * "just run it" entrypoint. `scheduler.ts`'s job handler calls
 * `executeDepartureOpsTurn()` directly instead, because it has already
 * built the snapshot for its D9 NOOP check and would otherwise pay for it
 * twice.
 */
export async function runDepartureOpsReview(
  ctx: DepartureOpsContext,
  jobId?: string | null,
): Promise<DepartureOpsRunResult> {
  const [{ guardrailConfig, rejectionCooldownDays }, agencySettings] = await Promise.all([
    loadGuardrailConfig(ctx),
    getAgencySettings(ctx.db),
  ]);

  const snapshot = await buildOpsSnapshot(ctx.agencyId, ctx.groupId, ctx.db, { rejectionCooldownDays });
  if (!snapshot) {
    return {
      status: "MODEL_ERROR",
      runId: null,
      fingerprint: "",
      tier: "PLANNING",
      summary: null,
      committed: { tasks: 0, findings: 0, proposals: 0 },
      guardrailViolations: [],
      error: "That departure group no longer exists.",
    };
  }

  return executeDepartureOpsTurn(ctx, {
    snapshot,
    guardrailConfig,
    agencyName: agencySettings.agency_name || "the agency",
    agencyTimezone: agencySettings.timezone,
    jobId,
  });
}

export interface ExecuteTurnParams {
  snapshot: OpsSnapshot;
  guardrailConfig: GuardrailConfig;
  agencyName: string;
  agencyTimezone: string;
  jobId?: string | null;
}

/** The actual turn, given a snapshot and config someone else already built. See `runDepartureOpsReview()`'s doc comment for when to call this directly instead. */
export async function executeDepartureOpsTurn(
  ctx: DepartureOpsContext,
  params: ExecuteTurnParams,
): Promise<DepartureOpsRunResult> {
  const startedAt = Date.now();
  const { snapshot, guardrailConfig, agencyName, agencyTimezone, jobId } = params;

  if (!isAiConfigured()) {
    return {
      status: "MODEL_ERROR",
      runId: null,
      fingerprint: snapshot.fingerprint,
      tier: snapshot.group.tier,
      summary: null,
      committed: { tasks: 0, findings: 0, proposals: 0 },
      guardrailViolations: [],
      error: "OPENROUTER_API_KEY is not configured for this environment.",
    };
  }

  const systemPrompt = buildDepartureOpsSystemPrompt({
    snapshot,
    guardrails: guardrailConfig,
    agencyName,
    agencyTimezone,
  });

  const telemetry: ToolTelemetry = { calls: [] };
  const { tools, buffer } = buildDepartureOpsToolSet(ctx, telemetry);
  const effort = effortForTier(snapshot.group.tier);

  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let stopReason: string | null = null;

  try {
    const runner = getClient().beta.messages.toolRunner({
      model: MODEL_ID,
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      output_config: { effort },
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools,
      messages: [
        {
          role: "user",
          content:
            "Review this departure group now. The full snapshot is in your system prompt — you do not need to re-fetch it unless something you stage changes what the group looks like.",
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
    const runId = await recordDepartureOpsRun(ctx.db, {
      agencyId: ctx.agencyId,
      departureGroupId: ctx.groupId,
      jobId,
      model: MODEL_ID,
      effort,
      usage,
      latencyMs: Date.now() - startedAt,
      status: "MODEL_ERROR",
      stopReason,
      error: error instanceof Error ? error.message : String(error),
      readinessScore: snapshot.readiness.score,
      blockerCount: snapshot.blockers.length,
      tier: snapshot.group.tier,
    });
    await recordDepartureOpsToolCalls(ctx.db, ctx.agencyId, runId, telemetry.calls);
    return {
      status: "MODEL_ERROR",
      runId,
      fingerprint: snapshot.fingerprint,
      tier: snapshot.group.tier,
      summary: null,
      committed: { tasks: 0, findings: 0, proposals: 0 },
      guardrailViolations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let status: DepartureOpsRunStatus = "OK";
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

  // Computed before the run is recorded, not after, so the row that names
  // this run's outcome also carries what the guardrails actually did to
  // it — the corroboration-drop rate (§13's hallucination canary) reads
  // straight off this column rather than needing a second write later.
  const { buffer: clean, violations } = status === "OK" ? applyGuardrails(buffer, snapshot) : { buffer, violations: [] };

  const runId = await recordDepartureOpsRun(ctx.db, {
    agencyId: ctx.agencyId,
    departureGroupId: ctx.groupId,
    jobId,
    model: MODEL_ID,
    effort,
    usage,
    latencyMs: Date.now() - startedAt,
    status,
    stopReason,
    error: errorMessage ?? null,
    readinessScore: snapshot.readiness.score,
    blockerCount: snapshot.blockers.length,
    tier: snapshot.group.tier,
    guardrailViolations: violations,
  });
  await recordDepartureOpsToolCalls(ctx.db, ctx.agencyId, runId, telemetry.calls);

  if (status !== "OK") {
    return {
      status,
      runId,
      fingerprint: snapshot.fingerprint,
      tier: snapshot.group.tier,
      summary: null,
      committed: { tasks: 0, findings: 0, proposals: 0 },
      guardrailViolations: [],
      error: errorMessage,
    };
  }

  const committed = await commitStagedBuffer(ctx, runId, clean);

  return {
    status: "OK",
    runId,
    fingerprint: snapshot.fingerprint,
    tier: snapshot.group.tier,
    summary: buffer.submitted?.summary ?? null,
    committed,
    guardrailViolations: violations,
  };
}

// The name that lands in every activity row this agent writes. Single
// source of truth — see lib/agent/identity.ts.
const AGENT_ACTOR_NAME = COPILOT_NAME;

async function commitStagedBuffer(
  ctx: DepartureOpsContext,
  runId: string,
  buffer: ReturnType<typeof applyGuardrails>["buffer"],
): Promise<DepartureOpsRunResult["committed"]> {
  let tasksCommitted = 0;

  if (
    buffer.tasks.length > 0 ||
    buffer.taskReassignments.length > 0 ||
    buffer.taskStatusUpdates.length > 0 ||
    buffer.readinessItemUpdates.length > 0
  ) {
    // One mutate() call for every Class-1 write this turn — the same store
    // is loaded once and every InStore call runs against it, mirroring how
    // a human batches several edits into one page session. A failure on
    // one item (e.g. a task referencing a readiness item deleted mid-turn)
    // does not block the rest — each *InStore mutator validates its own
    // input and simply no-ops the store on a failure, exactly as it does
    // for a human caller.
    await mutate(
      [ctx.groupId],
      (store, actor) => {
        for (const staged of buffer.tasks) {
          const outcome = createGroupTaskInStore(store, { departureGroupId: ctx.groupId, ...staged.input }, actor);
          if (outcome.ok) tasksCommitted++;
        }
        for (const staged of buffer.taskReassignments) {
          reassignGroupTaskInStore(
            store,
            { id: staged.taskId, departureGroupId: ctx.groupId, ownerName: staged.ownerName, ownerId: staged.ownerId },
            actor,
          );
        }
        for (const staged of buffer.taskStatusUpdates) {
          updateGroupTaskStatusInStore(
            store,
            { id: staged.taskId, departureGroupId: ctx.groupId, status: staged.status },
            actor,
          );
        }
        for (const staged of buffer.readinessItemUpdates) {
          updateReadinessItemInStore(store, { departureGroupId: ctx.groupId, ...staged.input }, actor);
        }
        return { ok: true };
      },
      { client: ctx.db, actor: agentActor(ctx.agencyId) },
    );
  }

  let findingsCommitted = 0;
  if (buffer.findings.length > 0) {
    const { error, count } = await ctx.db
      .from("departure_group_agent_findings")
      .insert(
        buffer.findings.map((f) => ({
          agency_id: ctx.agencyId,
          departure_group_id: ctx.groupId,
          agent_run_id: runId,
          severity: f.severity,
          category: f.category,
          headline: f.headline,
          detail: f.detail,
          corroborating_blocker_id: f.corroboratingBlockerId,
          // Staged task/proposal ids only resolve to real database ids
          // after this same commit — the ids are cross-referenced by the
          // model within the turn (see buffer.ts), not persisted directly.
          linked_task_id: null,
          linked_proposal_id: null,
        })),
        { count: "exact" },
      );
    if (error) throw new Error(`Failed to record findings: ${error.message}`);
    findingsCommitted = count ?? buffer.findings.length;
  }

  let proposalsCommitted = 0;
  for (const staged of buffer.proposals) {
    // Every kind this agent stages used to be DEPARTURE_GROUP-scoped, so
    // `departureGroupId` alone was always the right subject. Phase 1 (P1.2)
    // re-scoped PAYMENT_PLAN_FLAG_FOR_REVIEW to BOOKING — for any kind not
    // scoped to the group itself, the subject is the booking named in its
    // own payload, and the payload's own `departureGroupId` field (which
    // that executor's `execute()` needs) is filled in here rather than
    // relying on the model to have supplied the group's own id.
    const executor = getExecutor(staged.input.kind);
    const payload = staged.input.payload as Record<string, unknown> | undefined;
    const isBookingScoped = executor && executor.subjectType !== "DEPARTURE_GROUP" && typeof payload?.bookingId === "string";
    const subjectId = isBookingScoped ? (payload!.bookingId as string) : undefined;
    const resolvedPayload = isBookingScoped && payload!.departureGroupId === undefined
      ? { ...payload, departureGroupId: ctx.groupId }
      : payload;

    const outcome = await createProposal(
      {
        agencyId: ctx.agencyId,
        departureGroupId: ctx.groupId,
        agentRunId: runId,
        ...staged.input,
        subjectId,
        payload: resolvedPayload,
      },
      ctx.db,
    );
    if (outcome.ok) proposalsCommitted++;
  }

  return { tasks: tasksCommitted, findings: findingsCommitted, proposals: proposalsCommitted };
}

function agentActor(agencyId: string): GroupActor {
  return { id: null, name: AGENT_ACTOR_NAME, agencyId };
}
