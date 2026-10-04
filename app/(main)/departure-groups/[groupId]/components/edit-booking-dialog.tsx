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
import { editBookingSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { updateBookingContactAction } from "../../actions";
import type { DepartureGroupBooking } from "../../types";

interface EditBookingDialogProps {
  booking: DepartureGroupBooking | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Corrects a booking's primary contact name and phone.
 *
 * Deliberately narrow: everything else about a booking already has its own
 * dedicated flow — occupancy tier and pricing through "Customise Traveller",
 * money through "Record Payment", the booking's whole existence through
 * "Move to Another Group" and "Cancel Booking" — so this only ever touches
 * the two fields typed once at "Add Booking" time that had no way back to
 * fix a typo.
 */
const EditBookingDialog = ({ booking, open, onClose }: EditBookingDialogProps) => {
  const [isPending, startTransition] = useTransition();

  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens, so the form has to re-sync from
  // `booking` each time it opens rather than only on first mount.
  useResetOnOpen(open, booking?.id ?? "", () => {
    setPrimaryContactName(booking?.primaryContactName ?? "");
    setPrimaryContactPhone(booking?.primaryContactPhone ?? "");
    setError(null);
  });

  const alreadyCancelled = booking?.bookingStatus === "CANCELLED";
  const unchanged =
    primaryContactName.trim() === (booking?.primaryContactName ?? "") &&
    primaryContactPhone.trim() === (booking?.primaryContactPhone ?? "");

  const submit = () => {
    setError(null);
    if (!booking) return;

    const payload = {
      bookingId: booking.id,
      departureGroupId: booking.departureGroupId,
      primaryContactName: primaryContactName.trim(),
      primaryContactPhone: primaryContactPhone.trim(),
    };

    const check = editBookingSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "Check the highlighted fields.");
      return;
    }

    startTransition(async () => {
      const result = await updateBookingContactAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Booking updated",
        description: `${result.bookingReference} now shows ${result.primaryContactName} (${result.primaryContactPhone}).`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Booking</DialogTitle>
          <DialogDescription>
            {booking?.bookingReference} · {booking?.travellerCount} traveller
            {booking?.travellerCount === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        {alreadyCancelled ? (
          <p className="text-sm text-muted-foreground">
            This booking has been cancelled and can no longer be edited.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Primary contact name</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={primaryContactName}
                  onChange={(event) => {
                    setPrimaryContactName(event.target.value);
                    setError(null);
                  }}
                  placeholder="Full name"
                  autoFocus
                />
              </InputGroup>
            </div>

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Primary contact phone</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={primaryContactPhone}
                  onChange={(event) => {
                    setPrimaryContactPhone(event.target.value);
                    setError(null);
                  }}
                  placeholder="+94 7X XXX XXXX"
                />
              </InputGroup>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Occupancy tier, pricing and travellers are changed from
              Customise Traveller, Record Payment and Move to Another Group —
              this only fixes the contact details on file for this booking.
            </p>

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
          {!alreadyCancelled && (
            <Button disabled={isPending || !booking || unchanged} onClick={submit}>
              {isPending && <Loader2 className="animate-spin" />}
              Save Changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditBookingDialog;
