"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Search } from "lucide-react";
import React, { useMemo, useState } from "react";

import { EmptyState } from "../../components/status-badges";
import type { DepartureGroupBooking } from "../../types";
import { formatDate, formatExactCurrency, initialsOf } from "../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";

interface SelectBookingDialogProps {
  title: string;
  description: string;
  bookings: DepartureGroupBooking[];
  currency: string;
  /** Show the balance and due date on each row. */
  showBalance?: boolean;
  open: boolean;
  onSelect: (bookingId: string) => void;
  onClose: () => void;
}

/**
 * Picks which booking an action applies to.
 *
 * Money is owed by a specific family, so a header-level "Record Payment" has to
 * ask which one rather than guess — picking the largest debtor, or the first
 * row, silently puts the operator in the wrong booking. Searchable because a
 * full group is forty-odd bookings and scrolling for a surname is not a plan.
 */
const SelectBookingDialog = ({
  title,
  description,
  bookings,
  currency,
  showBalance = true,
  open,
  onSelect,
  onClose,
}: SelectBookingDialogProps) => {
  const [search, setSearch] = useState("");

  // The picker stays mounted between opens, and it is reused for both "record a
  // payment" and "send a reminder" — reopening it filtered by the last search
  // hides bookings the operator has not ruled out.
  useResetOnOpen(open, "", () => {
    setSearch("");
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = needle
      ? bookings.filter((booking) =>
          [
            booking.bookingReference,
            booking.primaryContactName,
            booking.primaryContactPhone,
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : bookings;

    // Largest balance first: the operator is usually here to chase the biggest
    // one, but they can still see and pick any of them.
    return [...matched].sort(
      (a, b) => b.outstandingBalance - a.outstandingBalance,
    );
  }, [bookings, search]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {bookings.length > 6 && (
          <InputGroup className="shadow-xs">
            <InputGroupAddon>
              <InputGroupText>
                <Search className="size-4 text-muted-foreground" />
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, reference or phone…"
              autoFocus
            />
          </InputGroup>
        )}

        {rows.length === 0 ? (
          <EmptyState title="No bookings match that search" />
        ) : (
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto custom-scroll">
            {rows.map((booking) => (
              <button
                key={booking.id}
                type="button"
                className="flex items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-muted/60 transition-colors"
                onClick={() => onSelect(booking.id)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                    {initialsOf(booking.primaryContactName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {booking.primaryContactName}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums truncate">
                      {booking.bookingReference} · {booking.travellerCount}{" "}
                      traveller{booking.travellerCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                {showBalance && (
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "text-sm tabular-nums font-semibold",
                        booking.outstandingBalance > 0
                          ? "text-destructive"
                          : TONE_TEXT.success,
                      )}
                    >
                      {formatExactCurrency(
                        booking.outstandingBalance,
                        currency,
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {booking.outstandingBalance > 0
                        ? booking.nextDueAt
                          ? `Due ${formatDate(booking.nextDueAt)}`
                          : "No due date"
                        : "Paid in full"}
                    </p>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SelectBookingDialog;
