/**
 * Class-2 accommodation proposal kinds — §5 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Each `execute()`
 * wraps exactly one existing mutator through `mutate()`; see
 * lib/agent/kernel/proposals/executor.ts for the contract.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import {
  markAccommodationConfirmedInStore,
  setAccommodationReferenceInStore,
  setAccommodationVoucherInStore,
  updateAccommodationInStore,
} from "@/lib/data/departure-groups-rooming";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── ACCOMMODATION_MARK_CONFIRMED ─────────────────────────────────────────── */

const MarkConfirmedSchema = z.object({
  accommodationId: z.string().uuid(),
});
type MarkConfirmedPayload = z.infer<typeof MarkConfirmedSchema>;

export const accommodationMarkConfirmedExecutor: LegacyProposalExecutor<MarkConfirmedPayload> = {
  kind: "ACCOMMODATION_MARK_CONFIRMED",
  schema: MarkConfirmedSchema,
  requiredCapability: "manageAccommodation",
  risk: "MEDIUM",
  ttlHours: 72,
  fingerprint: (p) => `ACCOMMODATION_MARK_CONFIRMED:${p.accommodationId}`,
  dependencySnapshot: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return { status: a?.status ?? null, hasReference: a?.hasReference ?? null, hasVoucher: a?.hasVoucher ?? null };
  },
  describe: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return { humanDiff: [{ field: "status", from: a?.status ?? null, to: "CONFIRMED" }] };
  },
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        markAccommodationConfirmedInStore(store, { id: p.accommodationId, departureGroupId: ctx.groupId }, actor),
      { actor: ctx.actor },
    ),
};

/* ── ACCOMMODATION_SET_REFERENCE ──────────────────────────────────────────── */

const SetReferenceSchema = z.object({
  accommodationId: z.string().uuid(),
  bookingReference: z.string().min(1).optional(),
  supplierName: z.string().min(1).optional(),
});
type SetReferencePayload = z.infer<typeof SetReferenceSchema>;

export const accommodationSetReferenceExecutor: LegacyProposalExecutor<SetReferencePayload> = {
  kind: "ACCOMMODATION_SET_REFERENCE",
  schema: SetReferenceSchema,
  requiredCapability: "manageAccommodation",
  risk: "LOW",
  ttlHours: 72,
  fingerprint: (p) => `ACCOMMODATION_SET_REFERENCE:${p.accommodationId}`,
  dependencySnapshot: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return { hasReference: a?.hasReference ?? null };
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
        setAccommodationReferenceInStore(
          store,
          {
            id: p.accommodationId,
            departureGroupId: ctx.groupId,
            bookingReference: p.bookingReference,
            supplierName: p.supplierName,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── ACCOMMODATION_SET_VOUCHER ────────────────────────────────────────────── */

const SetVoucherSchema = z.object({
  accommodationId: z.string().uuid(),
  voucherUrl: z.string().url(),
});
type SetVoucherPayload = z.infer<typeof SetVoucherSchema>;

export const accommodationSetVoucherExecutor: LegacyProposalExecutor<SetVoucherPayload> = {
  kind: "ACCOMMODATION_SET_VOUCHER",
  schema: SetVoucherSchema,
  requiredCapability: "manageAccommodation",
  risk: "LOW",
  ttlHours: 72,
  fingerprint: (p) => `ACCOMMODATION_SET_VOUCHER:${p.accommodationId}`,
  dependencySnapshot: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return { hasVoucher: a?.hasVoucher ?? null };
  },
  describe: (p) => ({ humanDiff: [{ field: "voucherUrl", from: null, to: p.voucherUrl }] }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        setAccommodationVoucherInStore(
          store,
          { id: p.accommodationId, departureGroupId: ctx.groupId, voucherUrl: p.voucherUrl },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── ACCOMMODATION_UPDATE ─────────────────────────────────────────────────── */

const UpdateSchema = z.object({
  accommodationId: z.string().uuid(),
  hotelName: z.string().min(1),
  supplierName: z.string().min(1).nullish(),
  supplierId: z.string().uuid().nullish(),
  bookingReference: z.string().nullish(),
  status: z.enum(["NOT_REQUESTED", "REQUESTED", "CONFIRMED", "COMPLETED", "CANCELLED"]),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  roomCapacity: z.number().int().nonnegative(),
  roomsReserved: z.number().int().nonnegative(),
  mealPlan: z.string().nullish(),
  distanceDescription: z.string().nullish(),
  notes: z.string().nullish(),
});
type UpdatePayload = z.infer<typeof UpdateSchema>;

export const accommodationUpdateExecutor: LegacyProposalExecutor<UpdatePayload> = {
  kind: "ACCOMMODATION_UPDATE",
  schema: UpdateSchema,
  requiredCapability: "manageAccommodation",
  risk: "MEDIUM",
  ttlHours: 72,
  fingerprint: (p) => `ACCOMMODATION_UPDATE:${p.accommodationId}`,
  dependencySnapshot: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return { status: a?.status ?? null, nights: a?.nights ?? null };
  },
  describe: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return {
      humanDiff: [
        { field: "hotelName", from: null, to: p.hotelName },
        { field: "status", from: a?.status ?? null, to: p.status },
      ],
    };
  },
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        updateAccommodationInStore(
          store,
          {
            id: p.accommodationId,
            departureGroupId: ctx.groupId,
            hotelName: p.hotelName,
            supplierName: p.supplierName,
            supplierId: p.supplierId,
            bookingReference: p.bookingReference,
            status: p.status,
            checkInDate: p.checkInDate,
            checkOutDate: p.checkOutDate,
            roomCapacity: p.roomCapacity,
            roomsReserved: p.roomsReserved,
            mealPlan: p.mealPlan,
            distanceDescription: p.distanceDescription,
            notes: p.notes,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};
