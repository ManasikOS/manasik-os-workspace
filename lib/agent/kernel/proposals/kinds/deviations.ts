/**
 * Class-2 traveller-deviation proposal kinds — see accommodation.ts's
 * header for the shared contract this mirrors.
 *
 * `OpsSnapshot` carries no per-deviation detail (only the aggregate
 * `travellers.blockingDeviations` count — see snapshot.ts's PII posture),
 * so `dependencySnapshot` here cannot do a field-level staleness check the
 * way the supplier kinds do. The safety property is unaffected: both
 * mutators re-check `deviation.status` against the live row inside
 * `mutate()`'s fresh `loadStore()` before doing anything, so a deviation
 * already decided or already arranged by someone else still fails cleanly
 * at execute() time — it just surfaces as an execution error rather than a
 * pre-emptive SUPERSEDED.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import {
  decideDeviationInStore,
  markDeviationArrangedInStore,
} from "@/lib/data/departure-groups-deviations";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── DEVIATION_DECIDE ──────────────────────────────────────────────────────── */

const DecideSchema = z.object({
  deviationId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().min(1).optional(),
});
type DecidePayload = z.infer<typeof DecideSchema>;

export const deviationDecideExecutor: LegacyProposalExecutor<DecidePayload> = {
  kind: "DEVIATION_DECIDE",
  schema: DecideSchema,
  requiredCapability: "manageTravellerCustomisations",
  risk: "MEDIUM",
  ttlHours: 72,
  fingerprint: (p) => `DEVIATION_DECIDE:${p.deviationId}`,
  dependencySnapshot: (_p, snapshot) => ({ blockingDeviations: snapshot.travellers.blockingDeviations }),
  describe: (p) => ({
    humanDiff: [{ field: "status", from: "REQUESTED", to: p.approve ? "APPROVED" : "DECLINED" }],
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        decideDeviationInStore(
          store,
          { departureGroupId: ctx.groupId, deviationId: p.deviationId, approve: p.approve, note: p.note },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── DEVIATION_MARK_ARRANGED ───────────────────────────────────────────────── */

const MarkArrangedSchema = z.object({
  deviationId: z.string().uuid(),
  supplierCommitmentId: z.string().uuid().nullish(),
  notes: z.string().min(1).optional(),
});
type MarkArrangedPayload = z.infer<typeof MarkArrangedSchema>;

export const deviationMarkArrangedExecutor: LegacyProposalExecutor<MarkArrangedPayload> = {
  kind: "DEVIATION_MARK_ARRANGED",
  schema: MarkArrangedSchema,
  requiredCapability: "manageTravellerCustomisations",
  risk: "MEDIUM",
  ttlHours: 72,
  fingerprint: (p) => `DEVIATION_MARK_ARRANGED:${p.deviationId}`,
  dependencySnapshot: (_p, snapshot) => ({ blockingDeviations: snapshot.travellers.blockingDeviations }),
  describe: () => ({ humanDiff: [{ field: "status", from: "APPROVED", to: "ARRANGED" }] }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        markDeviationArrangedInStore(
          store,
          {
            departureGroupId: ctx.groupId,
            deviationId: p.deviationId,
            supplierCommitmentId: p.supplierCommitmentId,
            notes: p.notes,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};
