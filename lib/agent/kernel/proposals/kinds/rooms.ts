/**
 * Class-2 rooming proposal kinds. ROOMS_GENERATE/ROOMS_AUTO_ASSIGN are LOW
 * risk (§5): bulk conveniences over reversible operational data (room
 * inventory, seat assignments), not supplier or traveller commitments. See
 * accommodation.ts's header for the shared contract this mirrors.
 *
 * ROOM_SWAP_SUGGESTED is scoped deliberately narrow: a "swap" here is one
 * `assignPilgrimToRoomInStore` call moving the requester into a room a
 * desired roommate already occupies WITH A SPARE BED — never a true
 * two-person exchange (that would need a second, purpose-built mutator,
 * which doesn't exist yet, and an executor's execute() calls exactly one
 * existing `*InStore` mutator per §9.1). When both rooms are already full,
 * `get_unarranged_roommate_requests` reports `simpleMoveAvailable: false`
 * and the model is told to raise a task instead of guessing a multi-person
 * reshuffle. This does not touch the deviation's own status — approving a
 * swap and marking the request ARRANGED stay two separate actions.
 */

import { z } from "zod";

import { mutate } from "@/lib/data/departure-groups";
import { assignPilgrimToRoomInStore, autoAssignRoomsInStore, generateRoomsInStore } from "@/lib/data/departure-groups-rooming";
import type { LegacyProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── ROOMS_GENERATE ────────────────────────────────────────────────────────── */

const GenerateSchema = z.object({
  accommodationId: z.string().uuid(),
  roomType: z.enum(["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "OTHER"]),
  occupancyCapacity: z.number().int().positive(),
  count: z.number().int().positive(),
  startingRoomNumber: z.string().nullish(),
});
type GeneratePayload = z.infer<typeof GenerateSchema>;

export const roomsGenerateExecutor: LegacyProposalExecutor<GeneratePayload> = {
  kind: "ROOMS_GENERATE",
  schema: GenerateSchema,
  requiredCapability: "manageRooming",
  risk: "LOW",
  ttlHours: 168,
  fingerprint: (p) => `ROOMS_GENERATE:${p.accommodationId}:${p.roomType}:${p.count}`,
  dependencySnapshot: (p, snapshot) => {
    const a = snapshot.suppliers.accommodations.find((row) => row.id === p.accommodationId);
    return { accommodationStatus: a?.status ?? null };
  },
  describe: (p) => ({
    humanDiff: [{ field: "rooms", from: null, to: `+${p.count} ${p.roomType}` }],
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        generateRoomsInStore(
          store,
          {
            accommodationId: p.accommodationId,
            departureGroupId: ctx.groupId,
            roomType: p.roomType,
            occupancyCapacity: p.occupancyCapacity,
            count: p.count,
            startingRoomNumber: p.startingRoomNumber,
          },
          actor,
        ),
      { actor: ctx.actor },
    ),
};

/* ── ROOMS_AUTO_ASSIGN ─────────────────────────────────────────────────────── */

const AutoAssignSchema = z.object({
  accommodationId: z.string().uuid(),
});
type AutoAssignPayload = z.infer<typeof AutoAssignSchema>;

export const roomsAutoAssignExecutor: LegacyProposalExecutor<AutoAssignPayload> = {
  kind: "ROOMS_AUTO_ASSIGN",
  schema: AutoAssignSchema,
  requiredCapability: "manageRooming",
  risk: "LOW",
  ttlHours: 72,
  fingerprint: (p) => `ROOMS_AUTO_ASSIGN:${p.accommodationId}`,
  dependencySnapshot: (_p, snapshot) => ({ roomsAssigned: snapshot.travellers.roomsAssigned }),
  describe: () => ({ humanDiff: [{ field: "roomAssignmentStatus", from: "UNASSIGNED", to: "ASSIGNED" }] }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        autoAssignRoomsInStore(store, { departureGroupId: ctx.groupId, accommodationId: p.accommodationId }, actor),
      { actor: ctx.actor },
    ),
};

/* ── ROOM_SWAP_SUGGESTED ───────────────────────────────────────────────────── */

const RoomSwapSchema = z.object({
  deviationId: z.string().uuid(),
  pilgrimId: z.string().uuid(),
  roomId: z.string().uuid(),
  requesterName: z.string().min(1),
  requesterCurrentRoomLabel: z.string().min(1),
  roommateName: z.string().min(1),
  targetRoomLabel: z.string().min(1),
});
type RoomSwapPayload = z.infer<typeof RoomSwapSchema>;

export const roomSwapSuggestedExecutor: LegacyProposalExecutor<RoomSwapPayload> = {
  kind: "ROOM_SWAP_SUGGESTED",
  schema: RoomSwapSchema,
  requiredCapability: "manageRooming",
  risk: "LOW",
  ttlHours: 72,
  // One open proposal per unresolved roommate request.
  fingerprint: (p) => `ROOM_SWAP_SUGGESTED:${p.deviationId}`,
  dependencySnapshot: (_p, snapshot) => ({ roomsAssigned: snapshot.travellers.roomsAssigned }),
  describe: (p) => ({
    humanDiff: [{ field: "room", from: p.requesterCurrentRoomLabel, to: p.targetRoomLabel }],
  }),
  execute: (p, ctx) =>
    mutate(
      [ctx.groupId],
      (store, actor) =>
        assignPilgrimToRoomInStore(store, { departureGroupId: ctx.groupId, pilgrimId: p.pilgrimId, roomId: p.roomId }, actor),
      { actor: ctx.actor },
    ),
};
