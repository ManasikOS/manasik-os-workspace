/**
 * The scheduler — §10.1/§10.2 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Two halves:
 *
 *   `sweepDueGroups()` — cheap, frequent (every 15 minutes via the cron
 *   route). Decides WHICH groups are due and enqueues one
 *   DEPARTURE_OPS_REVIEW job per group. Never calls the model.
 *
 *   `reviewGroupIfDue()` — what a claimed DEPARTURE_OPS_REVIEW job runs.
 *   The D9 NOOP gate lives here: builds one snapshot, and only calls
 *   `executeDepartureOpsTurn()` (the actual model turn, Phase 4) if the
 *   group's material state has actually moved since last time.
 */

import "server-only";

import { daysBetween } from "@/lib/data/departure-groups-copy";
import { colomboDayKey } from "@/lib/date";
import type { Db } from "@/lib/data/departure-groups-repository";
import { getAgencySettings } from "@/lib/data/settings-repository";

import type { DepartureGroupAgentStateRow, DepartureOpsAgencyMode } from "@/lib/agent/kernel/proposals/types";
import { recordDepartureOpsRun } from "@/lib/agent/departure-ops/telemetry";
import {
  buildOpsSnapshot,
  escalationTierFor,
  type EscalationTier,
} from "@/lib/agent/departure-ops/snapshot";
import {
  executeDepartureOpsTurn,
  loadGuardrailConfig,
  type DepartureOpsRunResult,
} from "@/lib/agent/departure-ops/run";
import type { DepartureOpsContext } from "@/lib/agent/departure-ops/context";

/* ── Cadence (§10.1) ──────────────────────────────────────────────────────── */

const CADENCE_HOURS: Record<EscalationTier, number> = {
  PLANNING: 24 * 7,
  BUILDING: 24 * 3,
  CONFIRMING: 24,
  FINALISING: 12,
  IMMINENT: 6,
  CRITICAL: 2,
  // POST doesn't reschedule itself — reviewGroupIfDue() flips the state's
  // mode to OFF after a POST-tier run completes (D11: "on demand... then
  // mode = OFF"). This value only matters if that write somehow doesn't
  // land — a week is a safe, inert fallback either way.
  POST: 24 * 7,
};

export function nextRunAtFor(tier: EscalationTier, from: Date = new Date()): Date {
  return new Date(from.getTime() + CADENCE_HOURS[tier] * 3_600_000);
}

/** The cheap tier lookup — departure_date alone, no snapshot. Used by the sweep to reschedule without paying for a full hydration per group. */
export function tierFromDepartureDate(departureDate: string, now: Date = new Date()): EscalationTier {
  return escalationTierFor(daysBetween(colomboDayKey(now.toISOString()), departureDate));
}

/* ── Per-group review, with the D9 gate ──────────────────────────────────── */

export type ReviewOutcome =
  | { kind: "SKIPPED"; reason: string }
  | { kind: "NOOP"; runId: string; fingerprint: string; tier: EscalationTier }
  | { kind: "RAN"; result: DepartureOpsRunResult };

/**
 * Runs — or correctly declines to run — one group's review. This is what a
 * claimed `DEPARTURE_OPS_REVIEW` job calls. Every exit updates
 * `departure_group_agent_state` so the next sweep schedules correctly;
 * `SKIPPED` exits (kill switches) push `next_run_at` out by the group's own
 * cadence rather than leaving it due, so a disabled agency's groups don't
 * get reselected every single sweep.
 */
export async function reviewGroupIfDue(
  ctx: DepartureOpsContext,
  jobId?: string | null,
): Promise<ReviewOutcome> {
  const now = new Date();

  const [{ data: stateRow }, { data: aiSettingsRow }] = await Promise.all([
    ctx.db
      .from("departure_group_agent_state")
      .select("*")
      .eq("departure_group_id", ctx.groupId)
      .maybeSingle(),
    ctx.db
      .from("ai_settings")
      .select("departure_ops_enabled, departure_ops_mode")
      .eq("agency_id", ctx.agencyId)
      .maybeSingle(),
  ]);

  const state = stateRow as DepartureGroupAgentStateRow | null;
  const aiSettings = (aiSettingsRow as { departure_ops_enabled: boolean; departure_ops_mode: DepartureOpsAgencyMode } | null) ?? {
    departure_ops_enabled: false,
    departure_ops_mode: "SHADOW",
  };

  const effectiveMode: DepartureOpsAgencyMode =
    !state || state.mode === "INHERIT" ? aiSettings.departure_ops_mode : state.mode;

  const suppressed = state?.suppressed_until && new Date(state.suppressed_until).getTime() > now.getTime();

  if (!aiSettings.departure_ops_enabled || effectiveMode === "OFF" || suppressed) {
    // Fall back to a plain weekly re-check when there's nothing more
    // specific to schedule against yet — a state row genuinely may not
    // exist here (a group predating the seeding trigger/backfill, or one
    // whose insert raced this read).
    await upsertState(ctx, {
      next_run_at: (suppressed ? new Date(state!.suppressed_until as string) : nextRunAtFor("PLANNING", now)).toISOString(),
    });
    return {
      kind: "SKIPPED",
      reason: suppressed ? "suppressed" : !aiSettings.departure_ops_enabled ? "agency disabled" : "mode is OFF",
    };
  }

  const { guardrailConfig, rejectionCooldownDays } = await loadGuardrailConfig(ctx);
  const snapshot = await buildOpsSnapshot(ctx.agencyId, ctx.groupId, ctx.db, { rejectionCooldownDays });
  if (!snapshot) {
    return { kind: "SKIPPED", reason: "group no longer exists" };
  }

  const overdueRequiredItem = snapshot.readiness.items.some(
    (i) => i.required && i.status !== "COMPLETE" && i.daysOverdue !== null && i.daysOverdue > 0,
  );
  const materialStateUnchanged =
    !!state &&
    state.last_fingerprint === snapshot.fingerprint &&
    state.last_tier === snapshot.group.tier &&
    !overdueRequiredItem;

  if (materialStateUnchanged) {
    const runId = await recordDepartureOpsRun(ctx.db, {
      agencyId: ctx.agencyId,
      departureGroupId: ctx.groupId,
      jobId,
      model: "n/a",
      effort: "low",
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      latencyMs: 0,
      status: "NOOP",
      stopReason: null,
      readinessScore: snapshot.readiness.score,
      blockerCount: snapshot.blockers.length,
      tier: snapshot.group.tier,
    });
    await upsertState(ctx, {
      last_run_at: now.toISOString(),
      next_run_at: nextRunAtFor(snapshot.group.tier, now).toISOString(),
      last_fingerprint: snapshot.fingerprint,
      last_tier: snapshot.group.tier,
      consecutive_noop_runs: (state?.consecutive_noop_runs ?? 0) + 1,
    });
    return { kind: "NOOP", runId, fingerprint: snapshot.fingerprint, tier: snapshot.group.tier };
  }

  const agencySettings = await getAgencySettings(ctx.db);
  const result = await executeDepartureOpsTurn(ctx, {
    snapshot,
    guardrailConfig,
    agencyName: agencySettings.agency_name || "the agency",
    agencyTimezone: agencySettings.timezone,
    jobId,
  });

  await upsertState(ctx, {
    last_run_at: now.toISOString(),
    next_run_at: nextRunAtFor(snapshot.group.tier, now).toISOString(),
    last_fingerprint: result.fingerprint,
    last_tier: result.tier,
    consecutive_noop_runs: 0,
    // D11: a POST-tier group gets its one close-out review, then goes
    // quiet — an explicit OFF, not just a long next_run_at, so it reads
    // correctly in the UI and never has to be re-derived.
    ...(result.tier === "POST" ? { mode: "OFF" as const } : {}),
  });

  return { kind: "RAN", result };
}

async function upsertState(
  ctx: DepartureOpsContext,
  patch: Partial<Omit<DepartureGroupAgentStateRow, "departure_group_id" | "agency_id">>,
): Promise<void> {
  const { error } = await ctx.db.from("departure_group_agent_state").upsert(
    { departure_group_id: ctx.groupId, agency_id: ctx.agencyId, ...patch },
    { onConflict: "departure_group_id" },
  );
  if (error) throw new Error(`Failed to update departure_group_agent_state: ${error.message}`);
}

/* ── The sweep ────────────────────────────────────────────────────────────── */

const LIVE_GROUP_STATUSES = ["PLANNING", "PREPARING", "READY_TO_DEPART", "DEPARTED"] as const;

export interface SweepResult {
  enqueued: number;
  alreadyQueued: number;
  rescheduled: number;
}

/**
 * Selects due groups and enqueues one `DEPARTURE_OPS_REVIEW` job per group
 * — never calls the model itself. Cheap enough to run every 15 minutes:
 * one query against `departure_group_agent_state`, one against
 * `departure_groups` for the matched ids, and a tier computed from
 * `departure_date` alone (§10.1's cheap lookup, not a full snapshot) to
 * push `next_run_at` out so the same group isn't reselected before its job
 * even runs.
 */
export async function sweepDueGroups(client: Db, options?: { maxGroups?: number }): Promise<SweepResult> {
  const maxGroups = options?.maxGroups ?? 200;
  const nowIso = new Date().toISOString();

  const { data: dueStateRows, error: stateError } = await client
    .from("departure_group_agent_state")
    .select("departure_group_id, agency_id")
    .lte("next_run_at", nowIso)
    .neq("mode", "OFF")
    .limit(maxGroups);
  if (stateError) throw new Error(`Failed to select due groups: ${stateError.message}`);

  const due = (dueStateRows ?? []) as { departure_group_id: string; agency_id: string }[];
  if (due.length === 0) return { enqueued: 0, alreadyQueued: 0, rescheduled: 0 };

  const groupIds = due.map((r) => r.departure_group_id);
  const { data: groupRows, error: groupsError } = await client
    .from("departure_groups")
    .select("id, agency_id, departure_date, group_status")
    .in("id", groupIds)
    .in("group_status", LIVE_GROUP_STATUSES);
  if (groupsError) throw new Error(`Failed to load due groups: ${groupsError.message}`);

  const groups = (groupRows ?? []) as { id: string; agency_id: string; departure_date: string; group_status: string }[];

  let enqueued = 0;
  let alreadyQueued = 0;
  let rescheduled = 0;
  const now = new Date();

  for (const group of groups) {
    const { error: insertError } = await client.from("departure_ops_jobs").insert({
      agency_id: group.agency_id,
      kind: "DEPARTURE_OPS_REVIEW",
      payload: { groupId: group.id },
    });

    if (insertError) {
      // 23505 = the partial unique index already has a QUEUED row for this
      // group — exactly the coalescing F5 exists for, not a failure.
      if (insertError.code === "23505") {
        alreadyQueued++;
      } else {
        throw new Error(`Failed to enqueue DEPARTURE_OPS_REVIEW for ${group.id}: ${insertError.message}`);
      }
    } else {
      enqueued++;
    }

    const tier = tierFromDepartureDate(group.departure_date, now);
    const { error: rescheduleError } = await client
      .from("departure_group_agent_state")
      .update({ next_run_at: nextRunAtFor(tier, now).toISOString() })
      .eq("departure_group_id", group.id);
    if (!rescheduleError) rescheduled++;
  }

  return { enqueued, alreadyQueued, rescheduled };
}

/**
 * §9.3 — expires proposals past their `expires_at`. Proactive
 * dependency-hash supersession (the other half of §9.3) is deliberately
 * NOT run here: `approveProposal()` already re-validates the hash the
 * moment anyone tries to approve a stale proposal (D6), so nothing unsafe
 * ships by leaving the *proactive* sweep-time version — a queue-hygiene
 * nicety, not a safety property — for a later pass.
 */
export async function expireStaleProposals(client: Db): Promise<number> {
  const { data, error } = await client
    .from("agent_proposals")
    .update({ status: "EXPIRED" })
    .eq("status", "PROPOSED")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw new Error(`Failed to expire stale proposals: ${error.message}`);
  return (data ?? []).length;
}
