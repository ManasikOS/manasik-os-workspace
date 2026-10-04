"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { markFlightTicketsIssuedAction } from "../../actions";
import type { DepartureGroupFlight, DepartureGroupManifestRow } from "../../types";
import { TONE_CLASS } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface MarkTicketsIssuedDialogProps {
  flights: DepartureGroupFlight[];
  manifest: DepartureGroupManifestRow[];
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

function flightLabel(flight: DepartureGroupFlight): string {
  const direction = flight.direction === "OUTBOUND" ? "Outbound" : "Return";
  return `${direction} · ${flight.airline}${
    flight.flightNumber ? ` ${flight.flightNumber}` : ""
  }`;
}

/**
 * Bulk-flips a flight's held seats to ticketed.
 *
 * Only the outbound flight's ticketing is tracked per pilgrim in this
 * schema, so marking the return flight only updates the flight's own
 * counters — the dialog says so up front rather than implying more happens.
 */
const MarkTicketsIssuedDialog = ({
  flights,
  manifest,
  departureGroupId,
  open,
  onClose,
}: MarkTicketsIssuedDialogProps) => {
  const [isPending, startTransition] = useTransition();

  const eligible = flights.filter(
    (f) => f.status !== "CANCELLED" && f.seatsHeld > 0,
  );
  const [flightId, setFlightId] = useState(eligible[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens, and a flight leaves this list the
  // moment its held seats are ticketed — so re-point at what is still eligible
  // rather than leaving the picker on a flight that is no longer offered.
  useResetOnOpen(open, "", () => {
    setFlightId(eligible[0]?.id ?? "");
    setError(null);
  });

  const selected = eligible.find((f) => f.id === flightId) ?? eligible[0] ?? null;

  // The travellers this run would flip to Ticketed — same PENDING/not-cancelled
  // shape `markFlightTicketsIssuedInStore` filters by, just without the booking
  // hold check the server enforces. Surfaced so this bulk, document-blind sweep
  // doesn't disagree silently with who has actually had a ticket file uploaded
  // and reviewed via "Upload Tickets" — the two are still two different ways to
  // reach the same status, not a shared source of truth.
  const pendingForOutbound = manifest.filter(
    (row) =>
      row.flightStatus === "PENDING" &&
      row.seatStatus !== "CANCELLED" &&
      row.seatStatus !== "WAITLIST",
  );
  const withoutDocument = pendingForOutbound.filter((row) => !row.ticketFilePath);

  const submit = () => {
    setError(null);
    if (!selected) {
      setError("Pick a flight with seats held.");
      return;
    }

    startTransition(async () => {
      const result = await markFlightTicketsIssuedAction({
        flightId: selected.id,
        departureGroupId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Tickets marked issued",
        description: `${result.seatsTicketed} seat${
          result.seatsTicketed === 1 ? "" : "s"
        } ticketed on ${flightLabel(selected)}.${
          result.pilgrimsUpdated > 0
            ? ` ${result.pilgrimsUpdated} pilgrim${
                result.pilgrimsUpdated === 1 ? "" : "s"
              } moved to Ticketed.`
            : ""
        }`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Mark Tickets Issued</DialogTitle>
          <DialogDescription>
            Moves every held seat on the chosen flight to ticketed.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No flight currently has seats held to ticket.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Flight</span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={selected ? flightLabel(selected) : "Select a flight"}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-64">
                  {eligible.map((f) => (
                    <DropdownMenuItem key={f.id} onClick={() => setFlightId(f.id)}>
                      {flightLabel(f)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {selected && (
              <Card className="flex-row px-3 py-2.5 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Seats to ticket</span>
                <span className="font-number font-semibold text-foreground">
                  {selected.seatsTicketed} → {selected.seatsHeld} of{" "}
                  {selected.seatCapacity}
                </span>
              </Card>
            )}

            {selected?.direction === "RETURN" && (
              <p className="text-[11px] text-muted-foreground">
                Per-pilgrim ticketing status tracks the outbound journey only —
                this updates the return flight&apos;s own counters.
              </p>
            )}

            {selected?.direction === "OUTBOUND" &&
              pendingForOutbound.length > 0 &&
              withoutDocument.length > 0 && (
                <div className={cn("flex items-start gap-2 rounded-sm px-3 py-2 text-xs", TONE_CLASS.warning)}>
                  <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    {withoutDocument.length} of {pendingForOutbound.length}{" "}
                    traveller{pendingForOutbound.length === 1 ? "" : "s"} about
                    to be marked ticketed{" "}
                    {withoutDocument.length === 1 ? "has" : "have"} no ticket
                    document uploaded yet. This still marks them Ticketed —
                    upload their tickets first from the per-pilgrim table below
                    if the airline hasn&apos;t issued documents you can attach.
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {eligible.length > 0 && (
            <Button disabled={isPending} onClick={submit}>
              {isPending && <Loader2 className="animate-spin" />}
              Mark Tickets Issued
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MarkTicketsIssuedDialog;
