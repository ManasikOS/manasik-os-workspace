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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { transportReferenceSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { setTransportReferenceAction } from "../../actions";
import type { DepartureGroupTransport } from "../../types";

interface TransportReferenceDialogProps {
  transport: DepartureGroupTransport | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/** Sets a transport route's booking reference ("Add Reference"). */
const TransportReferenceDialog = ({
  transport,
  departureGroupId,
  open,
  onClose,
}: TransportReferenceDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [bookingReference, setBookingReference] = useState(
    transport?.bookingReference ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, transport?.id ?? "", () => {
    setBookingReference(transport?.bookingReference ?? "");
    setError(null);
  });

  const submit = () => {
    setError(null);

    const payload = {
      id: transport?.id ?? "",
      departureGroupId,
      bookingReference: bookingReference.trim(),
    };

    const check = transportReferenceSchema.safeParse(payload);
    if (!check.success) {
      setError(
        check.error.issues[0]?.message ?? "That reference is not valid.",
      );
      return;
    }

    startTransition(async () => {
      const result = await setTransportReferenceAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Booking reference saved",
        description: result.routeLabel,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Add Booking Reference</DialogTitle>
          <DialogDescription>{transport?.routeLabel}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Booking reference <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={bookingReference}
              onChange={(e) => setBookingReference(e.target.value)}
              placeholder="TRN-REF-0042"
              autoFocus
            />
          </InputGroup>

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
            Save Reference
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransportReferenceDialog;
