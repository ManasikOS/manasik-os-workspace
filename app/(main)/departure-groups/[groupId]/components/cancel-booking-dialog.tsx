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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cancelBookingSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import { cancelGroupBookingAction } from "../../actions";
import type {
  DepartureGroupBooking,
  DepartureGroupManifestRow,
} from "../../types";
import { formatExactCurrency } from "../../utils";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

interface CancelBookingDialogProps {
  booking: DepartureGroupBooking | null;
  /** Travellers on this booking (manifest rows filtered by booking id). */
  travellers: DepartureGroupManifestRow[];
  role: StaffRole;
  currency?: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Cancels a booking and everyone on it.
 *
 * There is no un-cancel, so this asks for the booking reference to be typed —
 * the same bar `ConfirmActionDialog` sets for irreversible group actions — and a
 * reason, which is what makes the entry on the activity trail worth having. What
 * the cancellation will release is listed before the operator commits, and money
 * already collected has to be resolved one way or the other: refunded (marked
 * REFUND_PENDING for finance to pay out) or retained.
 */
const CancelBookingDialog = ({
  booking,
  travellers,
  role,
  currency = "LKR",
  open,
  onClose,
}: CancelBookingDialogProps) => {
  const can = capabilitiesFor(role);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [typedReference, setTypedReference] = useState("");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(String(booking?.amountPaid ?? 0));
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens (so it can animate), so the form
  // has to re-sync from `booking` each time it opens rather than only on
  // first mount.
  useResetOnOpen(open, booking?.id ?? "", () => {
    setTypedReference("");
    setReason("");
    setRefund(String(booking?.amountPaid ?? 0));
    setError(null);
  });

  const assignedRooms = travellers.filter((row) => row.roomId).length;
  const holdsSeats =
    booking?.bookingStatus !== "WAITLIST" &&
    booking?.bookingStatus !== "CANCELLED";
  const alreadyCancelled = booking?.bookingStatus === "CANCELLED";

  // A refund can only be committed by a role that may move money; everyone else
  // cancels and leaves the payout to finance.
  const canRefund = can.recordPayments && can.viewFinance;
  const collected = can.viewFinance ? (booking?.amountPaid ?? 0) : 0;
  const parsedRefund = Math.max(0, Math.round(Number(refund) || 0));
  const refundAmount = canRefund && collected > 0 ? parsedRefund : 0;
  const overRefunding = refundAmount > collected;

  const referenceMatches =
    typedReference.trim().toUpperCase() ===
    (booking?.bookingReference ?? "").toUpperCase();
  const reasonReady = reason.trim().length >= 3;

  const submit = () => {
    setError(null);

    if (!booking) return;

    if (!reasonReady) {
      setError("Give a reason for the cancellation.");
      return;
    }
    if (overRefunding) {
      setError(
        `The refund cannot exceed the ${formatExactCurrency(
          collected,
          currency,
        )} collected on this booking.`,
      );
      return;
    }

    const payload = {
      bookingId: booking.id,
      departureGroupId: booking.departureGroupId,
      reason: reason.trim(),
      refundAmount: refundAmount > 0 ? refundAmount : undefined,
    };

    const check = cancelBookingSchema.safeParse(payload);
    if (!check.success) {
      setError(
        check.error.issues[0]?.message ?? "That cancellation is not valid.",
      );
      return;
    }

    startTransition(async () => {
      const result = await cancelGroupBookingAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const parts = [
        `${result.bookingReference} cancelled for ${result.travellerCount} traveller${
          result.travellerCount === 1 ? "" : "s"
        }.`,
      ];
      if (result.seatsReleased > 0) {
        parts.push(
          `${result.seatsReleased} seat${
            result.seatsReleased === 1 ? "" : "s"
          } back in the pool (${result.availableSeats} available).`,
        );
      }
      if (result.releasedRoomAssignments > 0) {
        parts.push(
          `${result.releasedRoomAssignments} room assignment${
            result.releasedRoomAssignments === 1 ? "" : "s"
          } released.`,
        );
      }
      if (can.viewFinance && result.amountPaid > 0) {
        parts.push(
          result.refundAmount > 0
            ? `${formatExactCurrency(result.refundAmount, currency)} marked for refund.`
            : `${formatExactCurrency(result.amountPaid, currency)} retained.`,
        );
      }

      toast.add({
        title: "Booking cancelled",
        description: parts.join(" "),
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            {booking?.bookingReference} · {booking?.primaryContactName} ·{" "}
            {booking?.travellerCount} traveller
            {booking?.travellerCount === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        {alreadyCancelled ? (
          <p className="text-sm text-muted-foreground">
            This booking is already cancelled.
          </p>
        ) : (
          <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto custom-scroll">
            <ul className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {holdsSeats ? (
                <li>
                  {booking?.travellerCount} seat
                  {booking?.travellerCount === 1 ? "" : "s"} return to the
                  group&apos;s available pool and can be resold.
                </li>
              ) : (
                <li>
                  This booking holds no seats, so the group&apos;s capacity is
                  unchanged.
                </li>
              )}
              {assignedRooms > 0 && (
                <li>
                  {assignedRooms} room assignment
                  {assignedRooms === 1 ? "" : "s"} will be released, locked ones
                  included.
                </li>
              )}
              <li>
                Every traveller moves to <strong>Cancelled</strong> on seats and
                flights. Visa applications are left as they are — withdraw them
                with the visa team.
              </li>
              <li>There is no un-cancel in the system.</li>
            </ul>

            {can.viewFinance && collected > 0 && (
              <Card className="flex flex-col gap-2 rounded-md border border-border/50 px-3 py-3">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">
                    Collected on this booking
                  </span>
                  <span className="font-number font-semibold text-foreground">
                    {formatExactCurrency(collected, currency)}
                  </span>
                </div>

                {canRefund ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText> Refund amount</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={collected}
                          value={refund}
                          onChange={(event) => {
                            setRefund(event.target.value);
                            setError(null);
                          }}
                          className="font-number"
                        />
                      </InputGroup>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setRefund(String(collected))}
                        >
                          Full refund
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setRefund("0")}
                        >
                          Retain everything
                        </Button>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {refundAmount > 0
                        ? `${formatExactCurrency(refundAmount, currency)} is marked refund-pending for finance to pay out; the payout itself is recorded in Payments.`
                        : "Nothing is marked for refund — the money collected stays with the agency as a cancellation charge."}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Your role cannot commit a refund. The booking is cancelled
                    with the money left as collected, for finance to resolve.
                  </p>
                )}
              </Card>
            )}

            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>
                    {" "}
                    Reason <span className="text-destructive">*</span>
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupTextarea
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError(null);
                  }}
                  placeholder="Family withdrew, visa rejected, duplicate booking…"
                  rows={2}
                  autoFocus
                />
              </InputGroup>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="confirm-booking-reference"
                className="text-xs font-medium text-foreground"
              >
                Type{" "}
                <span className="font-number">{booking?.bookingReference}</span>{" "}
                to confirm
              </label>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>
                    {" "}
                    Type{" "}
                    <span className="font-number">
                      {booking?.bookingReference}
                    </span>{" "}
                    to confirm
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="confirm-booking-reference"
                  value={typedReference}
                  onChange={(event) => setTypedReference(event.target.value)}
                  placeholder={booking?.bookingReference}
                  autoComplete="off"
                />
              </InputGroup>
            </div>

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
            Keep Booking
          </Button>
          <Button
            variant="destructive"
            disabled={
              isPending ||
              !booking ||
              alreadyCancelled ||
              !referenceMatches ||
              !reasonReady ||
              overRefunding
            }
            onClick={submit}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Cancel Booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CancelBookingDialog;
