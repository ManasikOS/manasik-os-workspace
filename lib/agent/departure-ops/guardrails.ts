/**
 * The staged-buffer gate — §11 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Runs over the
 * buffer AFTER `submit_review` fires and BEFORE anything commits, so a
 * violation costs a model call and nothing else.
 *
 * Two gates §11 lists are deliberately NOT here, because they are not
 * properties of one turn's buffer:
 *   - Kill switches (ai_settings.departure_ops_enabled/mode, per-group
 *     mode/suppression) gate whether a review runs AT ALL — Phase 5's
 *     scheduler checks them before a snapshot is even built, not here.
 *   - Auto-demotion (30-day rejection-rate rollup) is a cross-run
 *     aggregate, computed by Phase 5's sweep, not a per-turn check.
 */

import "server-only";

import { getExecutor } from "@/lib/agent/kernel/proposals/registry";
import type { StagedBuffer, StagedFinding, StagedProposal } from "@/lib/agent/departure-ops/buffer";
import type { OpsSnapshot } from "@/lib/agent/departure-ops/snapshot";

export interface GuardrailConfig {
  maxProposalsPerRun: number;
  maxTasksPerRun: number;
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  maxProposalsPerRun: 5,
  maxTasksPerRun: 10,
};

/** ≤ 12 open proposals per group; at the ceiling, only CRITICAL-blocker proposals get through. */
const QUEUE_CEILING = 12;

export interface GuardrailViolation {
  gate: string;
  detail: string;
  stagedId: string;
}

export interface GuardrailOutcome {
  buffer: StagedBuffer;
  violations: GuardrailViolation[];
}

/**
 * Filters a submitted buffer down to what is actually safe to commit.
 * Never throws and never blocks the whole turn over one bad item — a
 * dropped finding or a truncated proposal list is logged in `violations`
 * (the agent_runs record for this turn), not surfaced as a run failure.
 */
export function applyGuardrails(buffer: StagedBuffer, snapshot: OpsSnapshot): GuardrailOutcome {
  const violations: GuardrailViolation[] = [];

  const findings = applyCorroboration(buffer.findings, snapshot, violations);
  const { proposals, tasks } = applyDedupe(buffer, snapshot, violations);
  const boundedTasks = applyTaskBudget(tasks, violations);

  let boundedProposals = applyQueueCeiling(proposals, snapshot, violations);
  boundedProposals = applyProposalBudget(boundedProposals, violations);
  boundedProposals = applyFreezeWindow(boundedProposals, snapshot, violations);
  boundedProposals = applyLifecycleSanity(boundedProposals, snapshot, violations);

  return {
    buffer: { ...buffer, tasks: boundedTasks, findings, proposals: boundedProposals },
    violations,
  };
}

/** Every CRITICAL/WARNING finding must corroborate against a real blocker or readiness item id. An uncorroborated one is dropped, not the run. */
function applyCorroboration(
  findings: StagedFinding[],
  snapshot: OpsSnapshot,
  violations: GuardrailViolation[],
): StagedFinding[] {
  const validIds = new Set<string>([
    ...snapshot.blockers.map((b) => b.id),
    ...snapshot.readiness.items.map((i) => i.id),
  ]);

  return findings.filter((f) => {
    if (f.severity === "INFO") return true;
    if (f.corroboratingBlockerId && validIds.has(f.corroboratingBlockerId)) return true;
    violations.push({
      gate: "corroboration",
      detail: `${f.severity} finding "${f.headline}" names no corroborating blocker or readiness item id — dropped.`,
      stagedId: f.stagedId,
    });
    return false;
  });
}

/** D7: a proposal whose fingerprint was rejected within the cooldown window is dropped, not repeated. Tasks pass through unfiltered here — they have no cross-run rejection history to check against. */
function applyDedupe(
  buffer: StagedBuffer,
  snapshot: OpsSnapshot,
  violations: GuardrailViolation[],
): { proposals: StagedProposal[]; tasks: StagedBuffer["tasks"] } {
  const rejectedFingerprints = new Set(snapshot.work.recentRejections.map((r) => r.fingerprint));

  const proposals = buffer.proposals.filter((p) => {
    const executor = getExecutor(p.input.kind);
    if (!executor) return true; // an unknown kind fails later at create time, not here
    const fingerprint = executor.fingerprint(p.input.payload);
    if (!rejectedFingerprints.has(fingerprint)) return true;
    violations.push({
      gate: "dedupe",
      detail: `Proposal "${p.input.title}" matches a fingerprint rejected within the cooldown window — dropped.`,
      stagedId: p.stagedId,
    });
    return false;
  });

  return { proposals, tasks: buffer.tasks };
}

/** ≤ maxTasksPerRun (default 10). Truncates by staged order — the order the model itself raised them in. */
function applyTaskBudget(
  tasks: StagedBuffer["tasks"],
  violations: GuardrailViolation[],
  config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): StagedBuffer["tasks"] {
  if (tasks.length <= config.maxTasksPerRun) return tasks;
  const dropped = tasks.slice(config.maxTasksPerRun);
  for (const t of dropped) {
    violations.push({ gate: "task-budget", detail: `Task "${t.input.title}" exceeds the per-run task budget — dropped.`, stagedId: t.stagedId });
  }
  return tasks.slice(0, config.maxTasksPerRun);
}

/** ≤ 12 open proposals per group (across prior runs too, via the snapshot's own openProposals count). At the ceiling, only a proposal tied to a CRITICAL blocker gets through. */
function applyQueueCeiling(
  proposals: StagedProposal[],
  snapshot: OpsSnapshot,
  violations: GuardrailViolation[],
): StagedProposal[] {
  const existingOpen = snapshot.work.openProposals.length;
  if (existingOpen + proposals.length <= QUEUE_CEILING) return proposals;

  const hasCriticalEvidence = (p: StagedProposal) =>
    (p.input.evidence ?? []).some((e) =>
      snapshot.blockers.some((b) => b.severity === "CRITICAL" && (b.id === e.filter || b.tab === e.tab)),
    );

  const kept: StagedProposal[] = [];
  let budget = Math.max(QUEUE_CEILING - existingOpen, 0);
  for (const p of proposals) {
    if (budget > 0 && hasCriticalEvidence(p)) {
      kept.push(p);
      budget -= 1;
    } else {
      violations.push({
        gate: "queue-ceiling",
        detail: `Proposal "${p.input.title}" dropped — this group is at the ${QUEUE_CEILING}-proposal queue ceiling and it is not tied to a CRITICAL blocker.`,
        stagedId: p.stagedId,
      });
    }
  }
  return kept;
}

/** ≤ maxProposalsPerRun (default 5). Truncates by staged order, same rationale as the task budget. */
function applyProposalBudget(
  proposals: StagedProposal[],
  violations: GuardrailViolation[],
  config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): StagedProposal[] {
  if (proposals.length <= config.maxProposalsPerRun) return proposals;
  const dropped = proposals.slice(config.maxProposalsPerRun);
  for (const p of dropped) {
    violations.push({ gate: "proposal-budget", detail: `Proposal "${p.input.title}" exceeds the per-run proposal budget — dropped.`, stagedId: p.stagedId });
  }
  return proposals.slice(0, config.maxProposalsPerRun);
}

const FREEZE_WINDOW_KINDS = new Set(["GROUP_UPDATE_DETAILS", "GROUP_UPDATE_PRICING"]);

/** Inside 48h of departure (tier CRITICAL), no date/capacity/pricing proposal is accepted at all. */
function applyFreezeWindow(
  proposals: StagedProposal[],
  snapshot: OpsSnapshot,
  violations: GuardrailViolation[],
): StagedProposal[] {
  if (snapshot.group.tier !== "CRITICAL") return proposals;
  return proposals.filter((p) => {
    if (!FREEZE_WINDOW_KINDS.has(p.input.kind)) return true;
    violations.push({
      gate: "freeze-window",
      detail: `"${p.input.title}" (${p.input.kind}) refused — inside the 48-hour freeze window before departure.`,
      stagedId: p.stagedId,
    });
    return false;
  });
}

/** GROUP_MARK_READY refused at stage time unless every required readiness item is already COMPLETE — the same predicate setGroupLifecycleInStore enforces, checked early so a human never sees a proposal that would bounce. */
function applyLifecycleSanity(
  proposals: StagedProposal[],
  snapshot: OpsSnapshot,
  violations: GuardrailViolation[],
): StagedProposal[] {
  const outstanding = snapshot.readiness.items.filter((i) => i.required && i.status !== "COMPLETE");
  if (outstanding.length === 0) return proposals;
  return proposals.filter((p) => {
    if (p.input.kind !== "GROUP_MARK_READY") return true;
    violations.push({
      gate: "lifecycle-sanity",
      detail: `GROUP_MARK_READY refused — ${outstanding.length} required readiness item(s) are not yet COMPLETE.`,
      stagedId: p.stagedId,
    });
    return false;
  });
}
