"use client";

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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { generateRoomsSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";

import { generateRoomsAction } from "../../actions";
import type { DepartureGroupAccommodation, RoomType } from "../../types";
import { ROOM_TYPE_LABELS } from "../../utils";

interface GenerateRoomsDialogProps {
  accommodation: DepartureGroupAccommodation | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/** Standard bed count per room type — the starting point for capacity, always editable. */
const DEFAULT_CAPACITY: Record<RoomType, number> = {
  QUAD: 4,
  TRIPLE: 3,
  DOUBLE: 2,
  SINGLE: 1,
  OTHER: 2,
};

const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];

/**
 * Creates the physical room inventory for an accommodation block
 * ("Generate Rooms"). Without this, an accommodation's "rooms reserved"
 * count is just a target number with nothing behind it — no rooms exist for
 * Assign Manually or Auto Assign to actually place anyone into.
 */
const GenerateRoomsDialog = ({
  accommodation,
  departureGroupId,
  open,
  onClose,
}: GenerateRoomsDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [roomType, setRoomType] = useState<RoomType>("QUAD");
  const [occupancyCapacity, setOccupancyCapacity] = useState(
    String(DEFAULT_CAPACITY.QUAD),
  );
  const [count, setCount] = useState(
    String(accommodation?.roomsReserved || 10),
  );
  const [startingRoomNumber, setStartingRoomNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, accommodation?.id ?? "", () => {
    setRoomType("QUAD");
    setOccupancyCapacity(String(DEFAULT_CAPACITY.QUAD));
    setCount(String(accommodation?.roomsReserved || 10));
    setStartingRoomNumber("");
    setError(null);
  });

  const submit = () => {
    setError(null);

    const payload = {
      accommodationId: accommodation?.id ?? "",
      departureGroupId,
      roomType,
      occupancyCapacity: Math.max(
        0,
        Math.round(Number(occupancyCapacity) || 0),
      ),
      count: Math.max(0, Math.round(Number(count) || 0)),
      startingRoomNumber: startingRoomNumber.trim() || undefined,
    };

    const check = generateRoomsSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await generateRoomsAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Rooms created",
        description: `${result.created} room${result.created === 1 ? "" : "s"} added to ${result.hotelName}.`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Generate Rooms</DialogTitle>
          <DialogDescription>
            {accommodation?.hotelName ||
              "Adds rooms an operator can assign pilgrims into."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
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
                      onClick={() => {
                        setRoomType(option);
                        setOccupancyCapacity(String(DEFAULT_CAPACITY[option]));
                      }}
                    >
                      {ROOM_TYPE_LABELS[option]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Capacity per room</InputGroupText>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Rooms to create</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                inputMode="numeric"
                min={1}
                autoFocus
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="tabular-nums"
              />
            </InputGroup>
            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Starting number (optional)</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={startingRoomNumber}
                onChange={(e) => setStartingRoomNumber(e.target.value)}
                placeholder="101"
              />
            </InputGroup>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Room numbers count up from the starting number (
            {startingRoomNumber.trim() || "e.g. 101 → 102"}). Leave it blank to
            create unnumbered rooms you can label later.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {isPending && <Loader2 className="animate-spin" />}
            Create Rooms
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GenerateRoomsDialog;
