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
import { flightTicketingSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { recordFlightTicketingAction } from "../../actions";
import type { DepartureGroupFlight } from "../../types";

interface FlightTicketingDialogProps {
  flights: DepartureGroupFlight[];
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
 * Attaches a PNR / booking code to a flight ("Upload Ticket / PNR").
 *
 * A draft or held flight moves to Confirmed once a PNR is on file — that is
 * what having a PNR means — but seats are only marked ticketed through the
 * dedicated "Mark Tickets Issued" action.
 */
const FlightTicketingDialog = ({
  flights,
  departureGroupId,
  open,
  onClose,
}: FlightTicketingDialogProps) => {
  const [isPending, startTransition] = useTransition();

  const eligible = flights.filter((f) => f.status !== "CANCELLED");
  const [flightId, setFlightId] = useState(eligible[0]?.id ?? "");
  const [pnr, setPnr] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens, so the PNR has to clear each time.
  // A PNR belongs to one sector; carrying the last one over is how the outbound
  // record ends up on the return flight.
  useResetOnOpen(open, "", () => {
    setFlightId(eligible[0]?.id ?? "");
    setPnr("");
    setBookingReference("");
    setError(null);
  });

  const selected =
    eligible.find((f) => f.id === flightId) ?? eligible[0] ?? null;

  const submit = () => {
    setError(null);
    if (!selected) {
      setError("Pick a flight to attach the PNR to.");
      return;
    }

    const payload = {
      flightId: selected.id,
      departureGroupId,
      pnr: pnr.trim(),
      bookingReference: bookingReference.trim() || undefined,
    };

    const check = flightTicketingSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That PNR is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await recordFlightTicketingAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Ticket / PNR uploaded",
        description: `PNR ${result.pnr} attached to ${flightLabel(selected)}.`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Upload Ticket / PNR</DialogTitle>
          <DialogDescription>
            Attach the PNR and booking reference for a flight sector.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a flight before uploading a ticket or PNR.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Flight
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={
                        selected ? flightLabel(selected) : "Select a flight"
                      }
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-64">
                  {eligible.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      onClick={() => setFlightId(f.id)}
                    >
                      {flightLabel(f)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  PNR <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={pnr}
                onChange={(e) => setPnr(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="font-number uppercase"
                autoFocus
              />
            </InputGroup>

            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>Booking reference (optional)</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={bookingReference}
                onChange={(e) => setBookingReference(e.target.value)}
                placeholder={selected?.bookingReference ?? "GROUP-OUT"}
              />
            </InputGroup>

            {error && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {eligible.length > 0 && (
            <Button disabled={isPending} onClick={submit}>
              {isPending && <Loader2 className="animate-spin" />}
              Save PNR
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FlightTicketingDialog;
