"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { assignRoomSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { CheckCircle2, Loader2, LockOpen, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { assignPilgrimToRoomAction, unlockRoomAssignmentAction } from "../../actions";
import type {
  DepartureGroupAccommodation,
  DepartureGroupManifestRow,
  RoomType,
} from "../../types";
import { ROOM_TYPE_LABELS } from "../../utils";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface AssignRoomDialogProps {
  accommodations: DepartureGroupAccommodation[];
  manifest: DepartureGroupManifestRow[];
  departureGroupId: string;
  role: StaffRole;
  open: boolean;
  onClose: () => void;
}

const CITY_LABELS: Record<string, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

interface RoomOption {
  id: string;
  accommodationId: string;
  label: string;
  remaining: number;
  roomType: RoomType;
}

/**
 * Assigns pilgrims to rooms one at a time, staying open between assignments
 * so an operator can work through the whole unassigned list in one sitting.
 * Each successful assignment refreshes the underlying manifest/room data via
 * `router.refresh()`, which flows back down into this dialog's props.
 */
const AssignRoomDialog = ({
  accommodations,
  manifest,
  departureGroupId,
  role,
  open,
  onClose,
}: AssignRoomDialogProps) => {
  const can = capabilitiesFor(role);
  const [isPending, startTransition] = useTransition();
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justAssigned, setJustAssigned] = useState<string[]>([]);

  // "Unassigned" here means "no room anywhere yet" — a reasonable default
  // list to start from, though any pilgrim can be picked (see `assignable`).
  const unassigned = manifest.filter(
    (row) => row.roomAssignmentStatus === "UNASSIGNED",
  );
  const locked = manifest.filter((row) => row.roomAssignmentStatus === "LOCKED");
  // A pilgrim holds one room per accommodation — Makkah and Madinah at once
  // — so picking one who already has a room here is only a *move* when the
  // target room is in the SAME accommodation as their existing one (see
  // `isMove` below); otherwise it's a second, simultaneous assignment.
  const assignable = manifest.filter(
    (row) => row.roomAssignmentStatus !== "LOCKED",
  );

  const roomOptions: RoomOption[] = accommodations.flatMap((accommodation) =>
    accommodation.rooms
      .filter((room) => room.assignedPilgrimCount < room.occupancyCapacity)
      .map((room) => ({
        id: room.id,
        accommodationId: accommodation.id,
        label: `${CITY_LABELS[accommodation.city] ?? accommodation.city} · ${
          accommodation.hotelName
        } · Room ${room.roomNumber ?? "—"} (${room.roomType}) — ${
          room.occupancyCapacity - room.assignedPilgrimCount
        } free`,
        remaining: room.occupancyCapacity - room.assignedPilgrimCount,
        roomType: room.roomType,
      })),
  );

  const [pilgrimId, setPilgrimId] = useState(unassigned[0]?.id ?? "");
  const [roomId, setRoomId] = useState(roomOptions[0]?.id ?? "");

  // "Assigned this session" is exactly that. The dialog stays mounted between
  // opens, so without this it would still be listing work done an hour ago.
  useResetOnOpen(open, "", () => {
    setJustAssigned([]);
    setError(null);
    setPilgrimId("");
    setRoomId("");
  });

  // Keep the pickers pointed at a still-valid option as the lists shrink.
  // Defaults to someone who still needs a room, but any assignable pilgrim
  // (including an already-roomed one, for a move) can be picked instead.
  const selectedPilgrim =
    assignable.find((row) => row.id === pilgrimId) ??
    unassigned[0] ??
    assignable[0] ??
    null;
  const selectedRoom =
    roomOptions.find((room) => room.id === roomId) ?? roomOptions[0] ?? null;
  // Only a room the pilgrim already holds in the SAME accommodation counts
  // as "the room being replaced" — a room they hold in a different city is a
  // separate, simultaneous assignment and is left untouched either way.
  const existingAssignmentHere = selectedPilgrim?.roomAssignments.find(
    (a) => a.accommodationId === selectedRoom?.accommodationId,
  );
  const isMove = Boolean(
    existingAssignmentHere && existingAssignmentHere.roomId !== selectedRoom?.id,
  );

  const submit = () => {
    setError(null);
    if (!selectedPilgrim || !selectedRoom) {
      setError("Pick a pilgrim and a room.");
      return;
    }

    const payload = {
      departureGroupId,
      pilgrimId: selectedPilgrim.id,
      roomId: selectedRoom.id,
    };

    const check = assignRoomSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That assignment is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await assignPilgrimToRoomAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setJustAssigned((prev) => [
        `${result.pilgrimName} → ${result.roomLabel}`,
        ...prev,
      ]);
      setPilgrimId("");
      setRoomId("");
    });
  };

  const unlock = (pilgrimId: string) => {
    setError(null);
    setUnlockingId(pilgrimId);
    startTransition(async () => {
      const result = await unlockRoomAssignmentAction({
        departureGroupId,
        pilgrimId,
      });
      setUnlockingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader>
          <DialogTitle>Assign Rooms Manually</DialogTitle>
          <DialogDescription>
            {unassigned.length} pilgrim{unassigned.length === 1 ? "" : "s"} still
            have no room anywhere. A pilgrim can hold one room per hotel — pick
            someone who already has a Makkah room to also give them a Madinah
            one; picking a room in the SAME hotel they&apos;re already in
            moves them instead.
          </DialogDescription>
        </DialogHeader>

        {locked.length > 0 && can.unlockRoomAssignments && (
          <div className="flex flex-col gap-1.5 rounded-sm bg-muted/40 px-3 py-2.5 max-h-32 overflow-y-auto custom-scroll">
            <span className="text-[11px] text-muted-foreground">
              Locked — cannot be reassigned until unlocked
            </span>
            {locked.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-2 text-xs text-foreground"
              >
                <span>
                  {row.fullName}{" "}
                  <span className="text-muted-foreground text-[11px]">
                    {row.roomLabel ?? "—"}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isPending && unlockingId === row.id}
                  onClick={() => unlock(row.id)}
                >
                  {isPending && unlockingId === row.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <LockOpen className="size-3.5" />
                  )}
                  Unlock
                </Button>
              </div>
            ))}
          </div>
        )}

        {assignable.length === 0 ? (
          <div className={`flex items-center gap-2 text-sm ${TONE_TEXT.success}`}>
            <CheckCircle2 className="size-4" />
            Every pilgrim has a room.
          </div>
        ) : roomOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rooms have free capacity right now.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Pilgrim</span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={selectedPilgrim?.fullName ?? "Select a pilgrim"}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-72 max-h-64">
                  {assignable.map((row) => (
                    <DropdownMenuItem key={row.id} onClick={() => setPilgrimId(row.id)}>
                      {row.fullName}{" "}
                      <span className="text-muted-foreground text-[11px] ml-1">
                        {row.roomAssignments.length > 0
                          ? `currently ${row.roomAssignments
                              .map(
                                (a) =>
                                  `${CITY_LABELS[a.city] ?? a.city} ${a.roomLabel}`,
                              )
                              .join(" · ")}`
                          : row.bookingReference}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Room</span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={selectedRoom?.label ?? "Select a room"}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-72 max-h-64">
                  {roomOptions.map((room) => (
                    <DropdownMenuItem key={room.id} onClick={() => setRoomId(room.id)}>
                      {room.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {isMove && selectedPilgrim && existingAssignmentHere && (
              <div className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.info}`}>
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  {selectedPilgrim.fullName} is currently in{" "}
                  {existingAssignmentHere.roomLabel} at this hotel. This will
                  move them out of it — a pilgrim can only hold one room per
                  hotel. Any room they hold at a different hotel is
                  unaffected.
                </span>
              </div>
            )}

            {selectedPilgrim &&
              selectedRoom &&
              selectedPilgrim.roomOccupancyType &&
              selectedPilgrim.roomOccupancyType !== selectedRoom.roomType && (
                <div className={`flex items-start gap-2 rounded-sm px-3 py-2 text-xs ${TONE_CLASS.warning}`}>
                  <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    {selectedPilgrim.fullName} is billed for{" "}
                    {ROOM_TYPE_LABELS[selectedPilgrim.roomOccupancyType]}, but
                    this room is {ROOM_TYPE_LABELS[selectedRoom.roomType]}.
                    You can still assign it — double check this is intended.
                  </span>
                </div>
              )}

            {error && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {justAssigned.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-sm bg-muted/40 px-3 py-2.5 max-h-32 overflow-y-auto custom-scroll">
            <span className="text-[11px] text-muted-foreground">
              Assigned this session
            </span>
            {justAssigned.map((line, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-foreground">
                <Badge variant="outline" className="text-[10px]">
                  {i + 1}
                </Badge>
                {line}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          {assignable.length > 0 && roomOptions.length > 0 && (
            <Button disabled={isPending} onClick={submit}>
              {isPending && <Loader2 className="animate-spin" />}
              {isMove ? "Move" : "Assign"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AssignRoomDialog;
