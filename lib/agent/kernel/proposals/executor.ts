/**
 * The executor contract, v2 — Phase 0 (P0.2). Generalises the departure-ops
 * -only contract (kept below as `LegacyProposalExecutor`, consumed only by
 * `group-executor.ts`'s adapter) to any subject type, per §9.1 of
 * docs/modules/departure-operations-agent-implementation-plan.md and §3.2 of
 * docs/modules/manasik-intelligence-implementation-plan.md.
 *
 * An executor still contains no business logic. Its `execute()` calls
 * exactly one existing mutator (through `mutate()` for departure-groups
 * subjects, or the module's own equivalent write path for anything else),
 * with the *approving human's* actor. `loadPack()` is the one new seam:
 * every executor supplies its own Context Pack builder instead of the
 * kernel assuming `buildOpsSnapshot()`.
 */

import "server-only";

import type { z } from "zod";

import type { GroupActor } from "@/lib/types/departure-groups";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { ContextPack, Db } from "@/lib/agent/kernel/proposals/context-pack";
import type { ProposalDiffLine, ProposalRisk } from "@/lib/agent/kernel/proposals/types";

export interface ExecutorContextV2 {
  agencyId: string;
  subjectId: string;
  actor: GroupActor;
  role: StaffRole;
  db: Db;
}

export type ExecutorResult = { ok: true } | { ok: false; error: string };

export interface ProposalExecutor<TPayload, TPack extends ContextPack = ContextPack> {
  kind: string;
  /** A `PermissionModule` key — see `lib/access/role-permissions-shared.ts`. */
  module: string;
  subjectType: string;
  schema: z.ZodType<TPayload>;
  /** A capability key on that module's `Capabilities` interface — asserted against `MODULE_CAPABILITY_KEYS[module]` at registry load time. */
  requiredCapability: string;
  risk: ProposalRisk;
  /** How long this kind of ask stays meaningful before it auto-expires. */
  ttlHours: number;
  /** Builds this executor's Context Pack for one subject. Returns null when the subject no longer exists. */
  loadPack(subjectId: string, agencyId: string, db: Db): Promise<TPack | null>;
  /** Deduplication identity — collapsed into one open proposal per (subjectType, subjectId, fingerprint) by the DB's partial unique index. */
  fingerprint(payload: TPayload): string;
  /** The fields this proposal depends on staying true, read from a fresh pack. Hashed for staleness detection at approval time. */
  dependencySnapshot(payload: TPayload, pack: TPack): Record<string, unknown>;
  /** The mechanical "from -> to" table, computed from the pack — never hand-authored. */
  describe(payload: TPayload, pack: TPack): { humanDiff: ProposalDiffLine[] };
  execute(payload: TPayload, ctx: ExecutorContextV2): Promise<ExecutorResult>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the registry is genuinely heterogeneous; each executor's own methods stay fully typed to its TPayload */
export type AnyProposalExecutor = ProposalExecutor<any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Legacy (departure-groups-only) contract — kept only for group-executor.ts's adapter ── */

import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import type { OpsSnapshot } from "@/lib/agent/departure-ops/snapshot";

export interface ExecutorContext {
  groupId: string;
  actor: GroupActor;
  role: StaffRole;
}

export interface LegacyProposalExecutor<TPayload> {
  kind: string;
  schema: z.ZodType<TPayload>;
  requiredCapability: keyof DepartureGroupCapabilities;
  risk: ProposalRisk;
  ttlHours: number;
  fingerprint(payload: TPayload): string;
  dependencySnapshot(payload: TPayload, snapshot: OpsSnapshot): Record<string, unknown>;
  describe(payload: TPayload, snapshot: OpsSnapshot): { humanDiff: ProposalDiffLine[] };
  execute(payload: TPayload, ctx: ExecutorContext): Promise<ExecutorResult>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyLegacyProposalExecutor = LegacyProposalExecutor<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
