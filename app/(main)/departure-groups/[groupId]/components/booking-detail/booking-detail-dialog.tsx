"use client";

import { useCallback, useEffect, useState } from "react";

import { DepartureCapabilitiesProvider } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { loadBookingDetailAction, type BookingDetailPayload } from "./booking-detail-actions";
import BookingDetailView from "./booking-detail-view";

interface BookingDetailDialogProps {
  /** The booking to show; `null` keeps the dialog closed. */
  bookingId: string | null;
  onClose: () => void;
}

/**
 * The one place a booking's full detail opens — from the Pilgrims & Bookings
 * tab, the Bookings ledger and every link that points at a booking. Loads the
 * booking when opened and reloads it whenever something inside changes it.
 */
export default function BookingDetailDialog({
  bookingId,
  onClose,
}: BookingDetailDialogProps) {
  const [loaded, setLoaded] = useState<{
    bookingId: string;
    data: BookingDetailPayload;
  } | null>(null);
  const [failure, setFailure] = useState<{
    bookingId: string;
    message: string;
  } | null>(null);

  const reloadBooking = useCallback(async (id: string) => {
    const result = await loadBookingDetailAction({ bookingId: id });
    if (result.ok) {
      setFailure(null);
      setLoaded({ bookingId: id, data: result.data });
    } else {
      setLoaded(null);
      setFailure({ bookingId: id, message: result.error });
    }
  }, []);

  useEffect(() => {
    if (!bookingId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching from a Server Action when the dialog opens
    void reloadBooking(bookingId);
  }, [bookingId, reloadBooking]);

  const current = loaded && loaded.bookingId === bookingId ? loaded.data : null;
  const errorMessage = failure && failure.bookingId === bookingId ? failure.message : null;

  const { capabilities, ...viewProps } = current ?? {};

  return (
    <Dialog
      open={bookingId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="h-[90vh] max-h-[90vh] gap-0 overflow-hidden p-0 sm:h-[85vh] sm:max-w-4xl!">
        {current && capabilities ? (
          <DepartureCapabilitiesProvider value={capabilities}>
            <BookingDetailView
              {...(viewProps as Omit<BookingDetailPayload, "capabilities">)}
              onChanged={() => bookingId && void reloadBooking(bookingId)}
            />
          </DepartureCapabilitiesProvider>
        ) : errorMessage ? (
          <div className="flex h-full flex-col justify-center gap-4 p-6">
            <DialogHeader>
              <DialogTitle>Booking not available</DialogTitle>
              <DialogDescription>{errorMessage}</DialogDescription>
            </DialogHeader>
            <div>
              <Button variant="outline_without_border" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="flex h-full flex-col gap-4 p-6"
            aria-busy="true"
            aria-label="Loading booking"
          >
            <DialogTitle className="sr-only">Loading booking</DialogTitle>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
