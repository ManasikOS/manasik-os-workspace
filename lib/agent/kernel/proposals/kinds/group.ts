/**
 * Class-2 group-level proposal kinds — itinerary/commercial edits and
 * lifecycle transitions. See accommodation.ts's header for the shared
 * contract this mirrors.
 *
 * GROUP_UPDATE_DETAILS and GROUP_UPDATE_PRICING both call
 * `updateGroupDetailsInStore`, split into two kinds because the live app
 * gates them on two different capabilities (`editGroupDetails` vs
 * `overrideCapacityAndPrice` — see `updateGroupDetailsAction`) and because
 * a departure-date change and a reprice are different enough asks that a
 * human should never approve one while meaning the other.
 *
 * GROUP_MARK_READY and GROUP_CLOSE_SALES both call `setGroupLifecycleInStore`
 * with a fixed `action`; every non-CANCEL lifecycle action is gated on
 * `editGroupDetails` in the live app (`setGroupLifecycleAction`), which is
 * why both use it here too. CANCEL itself is Class 3 — FORBIDDEN (D15) —
 * and has no executor at all.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import {
  setGroupLifecycleInStore,
  updateGroupDetailsInStore,
} from "@/lib/data/departure-groups-lifecycle";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── GROUP_UPDATE_DETAILS ─────────────────────────────────────────────────── */

const UpdateDetailsSchema = z.object({
  groupName: z.string().min(1).optional(),
  groupCode: z.string().min(1).optional(),
  departureDate: z.string().optional(),
  returnDate: z.string().optional(),
  minimumGroupSize: z.number().int().positive().optional(),
  salesStatus: z
    .enum(["SELLING", "LIMITED_AVAILABILITY", "WAITLIST", "SALES_CLOSED", "CANCELLED"])
    .optional(),
  branch: z.string().min(1).optional(),
  operationsOwnerName: z.string().nullish(),
  primaryGuideName: z.string().nullish(),
  visaOwnerName: z.string().nullish(),
  financeOwnerName: z.string().nullish(),
  localCoordinatorName: z.string().nullish(),
  localCoordinatorPhone: z.string().nullish(),
  waitlistEnabled: z.boolean().optional(),
  seatHoldExpiryHours: z.number().int().positive().optional(),
});
type UpdateDetailsPayload = z.infer<typeof UpdateDetailsSchema>;

export const groupUpdateDetailsExecutor: LegacyProposalExecutor<UpdateDetailsPayload> = {
  kind: "GROUP_UPDATE_DETAILS",
  schema: UpdateDetailsSchema,
  requiredCapability: "editGroupDetails",
  risk: "HIGH",
  ttlHours: 48,
  fingerprint: (p) => `GROUP_UPDATE_DETAILS:${JSON.stringify(p)}`,
  dependencySnapshot: (_p, snapshot) => ({
    departureDate: snapshot.group.departureDate,
    salesStatus: snapshot.group.salesStatus,
  }),
  describe: (p, snapshot) => ({
    humanDiff: Object.entries(p)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({
        field,
        from:
          field === "departureDate"
            ? snapshot.group.departureDate
            : field === "salesStatus"
              ? snapshot.group.salesStatus
              : null,
        to: value as string | number | boolean | null,
      })),
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) => updateGroupDetailsInStore(store, { groupId: ctx.groupId, ...p }, actor),
      { actor: ctx.actor },
    ),
};

/* ── GROUP_UPDATE_PRICING ─────────────────────────────────────────────────── */

const UpdatePricingSchema = z.object({
  currency: z.string().length(3).optional(),
  quadPrice: z.number().nonnegative().nullish(),
  triplePrice: z.number().nonnegative().nullish(),
  doublePrice: z.number().nonnegative().nullish(),
  singlePrice: z.number().nonnegative().nullish(),
  childPrice: z.number().nonnegative().nullish(),
  infantPrice: z.number().nonnegative().nullish(),
  earlyBirdPrice: z.number().nonnegative().nullish(),
  advanceDeposit: z.number().nonnegative().nullish(),
});
type UpdatePricingPayload = z.infer<typeof UpdatePricingSchema>;

export const groupUpdatePricingExecutor: LegacyProposalExecutor<UpdatePricingPayload> = {
  kind: "GROUP_UPDATE_PRICING",
  schema: UpdatePricingSchema,
  requiredCapability: "overrideCapacityAndPrice",
  risk: "HIGH",
  ttlHours: 48,
  fingerprint: (p) => `GROUP_UPDATE_PRICING:${JSON.stringify(p)}`,
  // The narrow OpsSnapshot deliberately carries no pricing (no supplier
  // cost/margin posture — see snapshot.ts's header) — a reprice's staleness
  // check is therefore just "is the group still in a state a reprice makes
  // sense for", not a field-level price comparison.
  dependencySnapshot: (_p, snapshot) => ({ groupStatus: snapshot.group.groupStatus }),
  describe: (p) => ({
    humanDiff: Object.entries(p)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ field, from: null, to: value as string | number | boolean | null })),
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) => updateGroupDetailsInStore(store, { groupId: ctx.groupId, pricing: p }, actor),
      { actor: ctx.actor },
    ),
};

/* ── GROUP_MARK_READY (D14) ───────────────────────────────────────────────── */

const MarkReadySchema = z.object({});
type MarkReadyPayload = z.infer<typeof MarkReadySchema>;

export const groupMarkReadyExecutor: LegacyProposalExecutor<MarkReadyPayload> = {
  kind: "GROUP_MARK_READY",
  schema: MarkReadySchema,
  requiredCapability: "editGroupDetails",
  risk: "HIGH",
  ttlHours: 24,
  fingerprint: () => "GROUP_MARK_READY",
  dependencySnapshot: (_p, snapshot) => ({
    readinessStatus: snapshot.readiness.status,
    // setGroupLifecycleInStore's own gate re-checks every required item is
    // COMPLETE at execute() time regardless — this is the early, human
    // readable version of the same check (§11's lifecycle-sanity guardrail).
    outstandingRequired: snapshot.readiness.items.filter(
      (i) => i.required && i.status !== "COMPLETE",
    ).length,
  }),
  describe: (_p, snapshot) => ({
    humanDiff: [{ field: "groupStatus", from: snapshot.group.groupStatus, to: "READY_TO_DEPART" }],
  }),
  execute: (_p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        setGroupLifecycleInStore(store, { groupId: ctx.groupId, action: "MARK_READY" }, actor),
      { actor: ctx.actor },
    ),
};

/* ── GROUP_CLOSE_SALES ─────────────────────────────────────────────────────── */

const CloseSalesSchema = z.object({});
type CloseSalesPayload = z.infer<typeof CloseSalesSchema>;

export const groupCloseSalesExecutor: LegacyProposalExecutor<CloseSalesPayload> = {
  kind: "GROUP_CLOSE_SALES",
  schema: CloseSalesSchema,
  requiredCapability: "editGroupDetails",
  risk: "HIGH",
  ttlHours: 24,
  fingerprint: () => "GROUP_CLOSE_SALES",
  dependencySnapshot: (_p, snapshot) => ({ salesStatus: snapshot.group.salesStatus }),
  describe: (_p, snapshot) => ({
    humanDiff: [{ field: "salesStatus", from: snapshot.group.salesStatus, to: "SALES_CLOSED" }],
  }),
  execute: (_p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        setGroupLifecycleInStore(store, { groupId: ctx.groupId, action: "CLOSE_SALES" }, actor),
      { actor: ctx.actor },
    ),
};
