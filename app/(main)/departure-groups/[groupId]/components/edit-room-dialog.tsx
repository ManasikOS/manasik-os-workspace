"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { updateRoomSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";

import { deleteRoomAction, updateRoomAction } from "../../actions";
import type { DepartureGroupRoom, RoomType } from "../../types";
import { ROOM_TYPE_LABELS } from "../../utils";

interface EditRoomDialogProps {
  room: DepartureGroupRoom | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];

/** Edits or deletes a single room ("Edit Room"). */
const EditRoomDialog = ({
  room,
  departureGroupId,
  open,
  onClose,
}: EditRoomDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [roomNumber, setRoomNumber] = useState(room?.roomNumber ?? "");
  const [roomType, setRoomType] = useState<RoomType>(room?.roomType ?? "QUAD");
  const [occupancyCapacity, setOccupancyCapacity] = useState(
    String(room?.occupancyCapacity ?? 1),
  );
  const [blocked, setBlocked] = useState(room?.status === "BLOCKED");
  const [notes, setNotes] = useState(room?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useResetOnOpen(open, room?.id ?? "", () => {
    setRoomNumber(room?.roomNumber ?? "");
    setRoomType(room?.roomType ?? "QUAD");
    setOccupancyCapacity(String(room?.occupancyCapacity ?? 1));
    setBlocked(room?.status === "BLOCKED");
    setNotes(room?.notes ?? "");
    setError(null);
    setConfirmingDelete(false);
  });

  const submit = () => {
    setError(null);

    const payload = {
      id: room?.id ?? "",
      departureGroupId,
      roomNumber: roomNumber.trim() || undefined,
      roomType,
      occupancyCapacity: Math.max(
        0,
        Math.round(Number(occupancyCapacity) || 0),
      ),
      blocked,
      notes: notes.trim() || undefined,
    };

    const check = updateRoomSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That room is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await updateRoomAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({ title: "Room updated", description: result.roomLabel });
      onClose();
    });
  };

  const remove = () => {
    if (!room) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await deleteRoomAction({ id: room.id, departureGroupId });
      if (!result.ok) {
        setConfirmingDelete(false);
        setError(result.error);
        return;
      }

      toast.add({ title: "Room deleted", description: result.roomLabel });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Edit Room</DialogTitle>
          <DialogDescription>{room?.hotelName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Room number</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="101"
                autoFocus
              />
            </InputGroup>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Room type
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={ROOM_TYPE_LABELS[roomType]}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {ROOM_TYPES.map((option) => (
                    <DropdownMenuItem
                      key={option}
                      onClick={() => setRoomType(option)}
                    >
                      {ROOM_TYPE_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Capacity</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              type="number"
              inputMode="numeric"
              min={1}
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
              value={occupancyCapacity}
              onChange={(e) => setOccupancyCapacity(e.target.value)}
              className="tabular-nums"
            />
          </InputGroup>

          <label className="flex items-center gap-2 text-xs text-foreground group/field">
            <Checkbox
              checked={blocked}
              onCheckedChange={(v) => setBlocked(v === true)}
            />
            Blocked (out of service — hidden from Assign Manually and Auto
            Assign)
          </label>

          <InputGroup className="overflow-hidden min-h-fit">
            <InputGroupAddon align="block-start">
              <InputGroupText>Notes (optional)</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="max-h-24 overflow-y-auto"
            />
          </InputGroup>

          {room && room.assignedPilgrimCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {room.assignedPilgrimCount} pilgrim
              {room.assignedPilgrimCount === 1 ? "" : "s"} currently in this
              room — capacity cannot go below that.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={
              isPending || Boolean(room && room.assignedPilgrimCount > 0)
            }
            title={
              room && room.assignedPilgrimCount > 0
                ? "Move everyone out of this room before deleting it."
                : undefined
            }
            onClick={remove}
          >
            {isPending && confirmingDelete ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            {confirmingDelete ? "Click again to confirm" : "Delete Room"}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={isPending} onClick={submit}>
              {isPending && !confirmingDelete && (
                <Loader2 className="animate-spin" />
              )}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditRoomDialog;
