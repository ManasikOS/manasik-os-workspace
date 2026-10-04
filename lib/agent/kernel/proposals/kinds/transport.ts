/**
 * Class-2 transport proposal kinds — see accommodation.ts's header for the
 * shared contract this mirrors.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import {
  markTransportConfirmedInStore,
  setTransportReferenceInStore,
} from "@/lib/data/departure-groups-transport";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── TRANSPORT_MARK_CONFIRMED ─────────────────────────────────────────────── */

const MarkConfirmedSchema = z.object({
  transportId: z.string().uuid(),
});
type MarkConfirmedPayload = z.infer<typeof MarkConfirmedSchema>;

export const transportMarkConfirmedExecutor: LegacyProposalExecutor<MarkConfirmedPayload> = {
  kind: "TRANSPORT_MARK_CONFIRMED",
  schema: MarkConfirmedSchema,
  requiredCapability: "manageTransport",
  risk: "MEDIUM",
  ttlHours: 72,
  fingerprint: (p) => `TRANSPORT_MARK_CONFIRMED:${p.transportId}`,
  dependencySnapshot: (p, snapshot) => {
    const t = snapshot.suppliers.transports.find((row) => row.id === p.transportId);
    return { status: t?.status ?? null, hasReference: t?.hasReference ?? null };
  },
  describe: (p, snapshot) => {
    const t = snapshot.suppliers.transports.find((row) => row.id === p.transportId);
    return { humanDiff: [{ field: "status", from: t?.status ?? null, to: "CONFIRMED" }] };
  },
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        markTransportConfirmedInStore(store, { id: p.transportId, departureGroupId: ctx.groupId }, actor),
      { actor: ctx.actor },
    ),
};

/* ── TRANSPORT_SET_REFERENCE ──────────────────────────────────────────────── */

const SetReferenceSchema = z.object({
  transportId: z.string().uuid(),
  bookingReference: z.string().min(1).optional(),
  supplierName: z.string().min(1).optional(),
});
type SetReferencePayload = z.infer<typeof SetReferenceSchema>;

export const transportSetReferenceExecutor: LegacyProposalExecutor<SetReferencePayload> = {
  kind: "TRANSPORT_SET_REFERENCE",
  schema: SetReferenceSchema,
  requiredCapability: "manageTransport",
  risk: "LOW",
  ttlHours: 72,
  fingerprint: (p) => `TRANSPORT_SET_REFERENCE:${p.transportId}`,
  dependencySnapshot: (p, snapshot) => {
    const t = snapshot.suppliers.transports.find((row) => row.id === p.transportId);
    return { hasReference: t?.hasReference ?? null };
  },
  describe: (p) => ({
    humanDiff: [
      p.bookingReference !== undefined
        ? { field: "bookingReference", from: null, to: p.bookingReference }
        : null,
      p.supplierName !== undefined ? { field: "supplierName", from: null, to: p.supplierName } : null,
    ].filter((line): line is { field: string; from: null; to: string } => line !== null),
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        setTransportReferenceInStore(
          store,
          {
            id: p.transportId,
            departureGroupId: ctx.groupId,
            bookingReference: p.bookingReference,
            supplierName: p.supplierName,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};
