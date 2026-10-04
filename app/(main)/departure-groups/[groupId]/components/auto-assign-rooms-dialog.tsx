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
import { toast } from "@/components/ui/toast";
import { autoAssignRoomsSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { autoAssignRoomsAction } from "../../actions";
import type {
  DepartureGroupAccommodation,
  DepartureGroupManifestRow,
} from "../../types";
import { describeAutoAssignSkipped } from "../../utils";

interface AutoAssignRoomsDialogProps {
  /** The accommodation (city) this run fills — one run, one hotel, so a
   * pilgrim already roomed in Madinah still gets offered a Makkah bed. */
  accommodation: DepartureGroupAccommodation | null;
  manifest: DepartureGroupManifestRow[];
  departureGroupId: string;
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

/**
 * Bulk-fills every pilgrim who has no room yet in this one accommodation.
 *
 * Travellers on the same booking are kept together where capacity allows —
 * that's the one thing worth explaining before the operator commits, since
 * it's not obvious from a plain "auto-assign" button.
 */
const AutoAssignRoomsDialog = ({
  accommodation,
  manifest,
  departureGroupId,
  open,
  onClose,
}: AutoAssignRoomsDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens; a failure from the last attempt
  // must not greet the operator as if it had just happened.
  useResetOnOpen(open, "", () => {
    setError(null);
  });

  // "Unassigned" here means "no room in this accommodation yet" — a pilgrim
  // already roomed in a different city is still owed a room here.
  const unassigned = manifest.filter(
    (row) =>
      row.roomAssignmentStatus !== "LOCKED" &&
      !row.roomAssignments.some((a) => a.accommodationId === accommodation?.id),
  );
  const freeCapacity = (accommodation?.rooms ?? []).reduce(
    (sum, room) => sum + Math.max(room.occupancyCapacity - room.assignedPilgrimCount, 0),
    0,
  );
  const cityLabel = accommodation
    ? (CITY_LABELS[accommodation.city] ?? accommodation.city)
    : "";

  const submit = () => {
    setError(null);
    if (!accommodation) {
      setError("Pick an accommodation first.");
      return;
    }

    const check = autoAssignRoomsSchema.safeParse({
      departureGroupId,
      accommodationId: accommodation.id,
    });
    if (!check.success) {
      setError("That departure group reference is invalid.");
      return;
    }

    startTransition(async () => {
      const result = await autoAssignRoomsAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Rooms auto-assigned",
        description: `${result.assigned} pilgrim${result.assigned === 1 ? "" : "s"} assigned.${describeAutoAssignSkipped(
          result.skipped,
          result.typeMismatched,
        )}`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>
            Auto Assign Rooms{cityLabel ? ` — ${cityLabel}` : ""}
          </DialogTitle>
          <DialogDescription>
            Fills every pilgrim who has no room yet in{" "}
            {accommodation?.hotelName || "this accommodation"} into available
            rooms. Pilgrims already roomed in another city are unaffected.
          </DialogDescription>
        </DialogHeader>

        {unassigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every pilgrim already has a room in {cityLabel || "this accommodation"}.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
              <li>
                <strong className="font-number text-foreground">
                  {unassigned.length}
                </strong>{" "}
                pilgrim{unassigned.length === 1 ? "" : "s"} need a room here ·{" "}
                <strong className="font-number text-foreground">
                  {freeCapacity}
                </strong>{" "}
                bed{freeCapacity === 1 ? "" : "s"} free.
              </li>
              <li>
                Travellers on the same booking are kept in the same room where
                there&apos;s space for them.
              </li>
              <li>
                Anyone left over once every room is full is reported, not
                dropped — run this again after adding more rooms.
              </li>
            </ul>

            {error && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {unassigned.length > 0 && (
            <Button disabled={isPending} onClick={submit}>
              {isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Auto Assign
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AutoAssignRoomsDialog;
