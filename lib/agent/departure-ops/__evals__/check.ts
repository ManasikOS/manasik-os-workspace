/**
 * The eval runner — §13 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Runs a fixture
 * through the exact derivation logic a live review uses
 * (`buildOpsSnapshotFromStore`) and asserts what the plan says a golden
 * fixture should assert: expected blockers, expected readiness posture,
 * expected tier. No model call — this is a check on the deterministic
 * engine the model is handed, not on what an LLM would do with it. That
 * half (does the model propose the right kind against a given snapshot)
 * needs a live API call and is deliberately out of this module's scope —
 * see the docstring on `EvalCheck.expect`.
 */

import { buildOpsSnapshotFromStore, type EscalationTier, type OpsSnapshot } from "@/lib/agent/departure-ops/snapshot";
import type { DepartureGroupStore, ReadinessAutoSource, ReadinessItemStatus } from "@/lib/types/departure-groups";
import type { GroupReadinessStatus } from "@/app/(main)/departure-groups/types";

export interface EvalExpectation {
  /** Every one of these blocker ids must be present. */
  blockerIdsPresent?: string[];
  /** None of these blocker ids may be present. */
  blockerIdsAbsent?: string[];
  readinessStatus?: GroupReadinessStatus;
  tier?: EscalationTier;
  /** Exact count, when the scenario is precise enough to name one. */
  blockerCount?: number;
  /** The derived status of the (unique) readiness item with this auto_source. */
  readinessItemStatusBySource?: Partial<Record<ReadinessAutoSource, ReadinessItemStatus>>;
}

export interface EvalCheck {
  name: string;
  build: () => { store: DepartureGroupStore; groupId: string; agencyId: string };
  /**
   * What the deterministic engine should conclude. Deliberately does not
   * assert what the model would propose — that requires an actual API
   * call against a live snapshot, which is a different kind of check (an
   * integration test against Anthropic's API, not a fixture-driven unit
   * check) and does not belong in a suite meant to "run before every
   * prompt or tool change" with no network access.
   */
  expect: EvalExpectation;
}

export interface EvalResult {
  name: string;
  pass: boolean;
  failures: string[];
  snapshot: OpsSnapshot | null;
}

export function runEvalCheck(check: EvalCheck): EvalResult {
  const { store, groupId, agencyId } = check.build();
  const snapshot = buildOpsSnapshotFromStore(store, groupId, agencyId);
  const failures: string[] = [];

  if (!snapshot) {
    return { name: check.name, pass: false, failures: ["buildOpsSnapshotFromStore returned null — group not found in its own fixture."], snapshot: null };
  }

  const blockerIds = new Set(snapshot.blockers.map((b) => b.id));

  for (const id of check.expect.blockerIdsPresent ?? []) {
    if (!blockerIds.has(id)) failures.push(`expected blocker "${id}" to be present; blockers were: ${[...blockerIds].join(", ") || "(none)"}`);
  }
  for (const id of check.expect.blockerIdsAbsent ?? []) {
    if (blockerIds.has(id)) failures.push(`expected blocker "${id}" to be absent, but it was present`);
  }
  if (check.expect.readinessStatus && snapshot.readiness.status !== check.expect.readinessStatus) {
    failures.push(`expected readiness status ${check.expect.readinessStatus}, got ${snapshot.readiness.status}`);
  }
  if (check.expect.tier && snapshot.group.tier !== check.expect.tier) {
    failures.push(`expected tier ${check.expect.tier}, got ${snapshot.group.tier}`);
  }
  if (check.expect.blockerCount !== undefined && snapshot.blockers.length !== check.expect.blockerCount) {
    failures.push(`expected exactly ${check.expect.blockerCount} blocker(s), got ${snapshot.blockers.length}: ${[...blockerIds].join(", ")}`);
  }
  for (const [source, expectedStatus] of Object.entries(check.expect.readinessItemStatusBySource ?? {})) {
    const item = snapshot.readiness.items.find((i) => i.autoSource === source);
    if (!item) {
      failures.push(`no readiness item with auto_source ${source} found in this fixture`);
    } else if (item.status !== expectedStatus) {
      failures.push(`expected ${source} readiness item to be ${expectedStatus}, got ${item.status}`);
    }
  }

  return { name: check.name, pass: failures.length === 0, failures, snapshot };
}

export function runEvalSuite(checks: EvalCheck[]): { allPass: boolean; results: EvalResult[] } {
  const results = checks.map(runEvalCheck);
  return { allPass: results.every((r) => r.pass), results };
}
