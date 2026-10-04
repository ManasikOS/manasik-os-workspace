/**
 * Adapts every existing departure-groups executor (the 21 kinds in
 * `kinds/*.ts`, still typed `LegacyProposalExecutor<TPayload>`) into the v2
 * `ProposalExecutor` contract, so `registry.ts` can register them alongside
 * any later module's native v2 executors without rewriting a single one of
 * them. Phase 0 (P0.2).
 *
 * `loadPack()` wraps `buildOpsSnapshot()` in the generic `ContextPack`
 * shape — `pack.facts` IS the `OpsSnapshot`, so every legacy executor's
 * `dependencySnapshot(payload, snapshot)`/`describe(payload, snapshot)`
 * keeps working unchanged against `pack.facts`. Nothing about this file
 * changes departure-ops's existing behaviour — see
 * `lib/agent/kernel/proposals/service.test.ts` for the regression proof.
 */

import "server-only";

import { hashObject } from "@/lib/agent/kernel/hash";
import { buildOpsSnapshot, type OpsSnapshot } from "@/lib/agent/departure-ops/snapshot";
import { buildContextPack, type ContextPack, type Db } from "@/lib/agent/kernel/proposals/context-pack";
import type {
  AnyLegacyProposalExecutor,
  AnyProposalExecutor,
  ExecutorContextV2,
  LegacyProposalExecutor,
} from "@/lib/agent/kernel/proposals/executor";

export type GroupContextPack = ContextPack<OpsSnapshot>;

async function loadGroupPack(subjectId: string, agencyId: string, db: Db): Promise<GroupContextPack | null> {
  const snapshot = await buildOpsSnapshot(agencyId, subjectId, db);
  if (!snapshot) return null;
  return buildContextPack<OpsSnapshot>({
    subject: { type: "DEPARTURE_GROUP", id: subjectId, label: snapshot.group.name ?? subjectId, href: `/departure-groups/${subjectId}` },
    facts: snapshot,
    fingerprint: snapshot.fingerprint ?? hashObject(snapshot),
  });
}

/**
 * Wraps one `LegacyProposalExecutor` as a v2 `ProposalExecutor` scoped to
 * `module: "departure_groups"`, `subjectType: "DEPARTURE_GROUP"`.
 */
export function groupExecutor<TPayload>(legacy: LegacyProposalExecutor<TPayload>): AnyProposalExecutor {
  return {
    kind: legacy.kind,
    module: "departure_groups",
    subjectType: "DEPARTURE_GROUP",
    schema: legacy.schema,
    requiredCapability: legacy.requiredCapability,
    risk: legacy.risk,
    ttlHours: legacy.ttlHours,
    loadPack: loadGroupPack,
    fingerprint: legacy.fingerprint,
    dependencySnapshot: (payload, pack) => legacy.dependencySnapshot(payload, pack.facts),
    describe: (payload, pack) => legacy.describe(payload, pack.facts),
    execute: (payload, ctx: ExecutorContextV2) =>
      legacy.execute(payload, { groupId: ctx.subjectId, actor: ctx.actor, role: ctx.role }),
  };
}

/** Convenience for the registry — wraps a whole array at once. */
export function groupExecutors(legacyList: readonly AnyLegacyProposalExecutor[]): AnyProposalExecutor[] {
  return legacyList.map((e) => groupExecutor(e));
}
