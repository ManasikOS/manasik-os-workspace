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
import { accommodationReferenceSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { setAccommodationReferenceAction } from "../../actions";
import type { DepartureGroupAccommodation } from "../../types";

interface AccommodationReferenceDialogProps {
  accommodation: DepartureGroupAccommodation | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/** Sets an accommodation block's booking reference ("Add Booking Reference"). */
const AccommodationReferenceDialog = ({
  accommodation,
  departureGroupId,
  open,
  onClose,
}: AccommodationReferenceDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [bookingReference, setBookingReference] = useState(
    accommodation?.bookingReference ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, accommodation?.id ?? "", () => {
    setBookingReference(accommodation?.bookingReference ?? "");
    setError(null);
  });

  const submit = () => {
    setError(null);

    const payload = {
      id: accommodation?.id ?? "",
      departureGroupId,
      bookingReference: bookingReference.trim(),
    };

    const check = accommodationReferenceSchema.safeParse(payload);
    if (!check.success) {
      setError(
        check.error.issues[0]?.message ?? "That reference is not valid.",
      );
      return;
    }

    startTransition(async () => {
      const result = await setAccommodationReferenceAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Booking reference saved",
        description: result.hotelName,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Add Booking Reference</DialogTitle>
          <DialogDescription>{accommodation?.hotelName}</DialogDescription>
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
              placeholder="HTL-REF-0042"
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

export default AccommodationReferenceDialog;
