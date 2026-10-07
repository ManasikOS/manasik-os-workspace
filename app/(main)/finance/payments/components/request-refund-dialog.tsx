"use client";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
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
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ButtonGroup } from "@/components/ui/button-group";
import { EmptyState } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Search } from "lucide-react";
import React, { useMemo, useState } from "react";

import { REFUND_REASON_LABELS } from "@/lib/data/finance-copy";
import type { RefundReason } from "@/lib/types/finance";

import { createRefundRequestAction } from "../actions";
import { useFinance } from "../finance-store";
import { formatExactCurrency } from "../utils";
import type { RefundableBookingOption } from "../types";

const REFUND_REASONS = Object.keys(REFUND_REASON_LABELS) as RefundReason[];

interface RequestRefundDialogProps {
  /** Pre-filled launch point (a receivables/booking row action). */
  booking: RefundableBookingOption | null;
  /** Header launch — no booking chosen yet, so a picker renders first. */
  headerLaunch?: boolean;
  onClose: () => void;
}

export default function RequestRefundDialog({
  booking,
  headerLaunch,
  onClose,
}: RequestRefundDialogProps) {
  const { refundableBookings } = useFinance();

  const open = booking !== null || headerLaunch === true;
  const [pickerSearch, setPickerSearch] = useState("");
  const [chosen, setChosen] = useState<RefundableBookingOption | null>(booking);

  const [reason, setReason] = useState<RefundReason>("CANCELLATION");
  const [amount, setAmount] = useState<number | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, booking?.id ?? (headerLaunch ? "header" : ""), () => {
    setChosen(booking);
    setPickerSearch("");
    setReason("CANCELLATION");
    setAmount("");
    setReasonNote("");
    setError(null);
  });

  const pickerRows = useMemo(() => {
    const needle = pickerSearch.trim().toLowerCase();
    const matched = needle
      ? refundableBookings.filter((b) =>
          [b.bookingReference, b.primaryContactName]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : refundableBookings;
    return [...matched].sort((a, b) => b.amountPaid - a.amountPaid);
  }, [refundableBookings, pickerSearch]);

  const submit = async () => {
    if (!chosen) return;
    if (amount === "" || amount <= 0) {
      setError("Enter a refund amount greater than zero.");
      return;
    }
    if (amount > chosen.amountPaid) {
      setError(
        `Refund exceeds the ${formatExactCurrency(chosen.amountPaid, "LKR")} collected on this booking.`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await createRefundRequestAction({
      bookingId: chosen.id,
      departureGroupId: chosen.departureGroupId,
      reason,
      reasonNote: reasonNote.trim() || undefined,
      amount,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Could not create this refund request.");
      return;
    }
    toast.add({
      title: "Refund requested",
      description: result.reference
        ? `Reference ${result.reference}, pending approval.`
        : "Pending approval.",
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <DialogTitle>Request Refund</DialogTitle>
          </div>
          {chosen && (
            <DialogDescription>
              {chosen.primaryContactName} · {chosen.bookingReference} —{" "}
              {formatExactCurrency(chosen.amountPaid, "LKR")} collected
            </DialogDescription>
          )}
        </DialogHeader>

        {!chosen ? (
          <div className="flex flex-col gap-3">
            <InputGroup className="shadow-xs">
              <InputGroupAddon>
                <InputGroupText>
                  <Search className="size-4 text-muted-foreground" />
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search booking or customer name..."
                autoFocus
              />
            </InputGroup>
            {pickerRows.length === 0 ? (
              <EmptyState title="No bookings with money collected" />
            ) : (
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto custom-scroll">
                {pickerRows.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="flex items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-muted/60 transition-colors"
                    onClick={() => setChosen(b)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {b.primaryContactName}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums truncate">
                        {b.bookingReference}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums font-semibold text-foreground shrink-0">
                      {formatExactCurrency(b.amountPaid, "LKR")}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Amount *</InputGroupText>
                </InputGroupAddon>
                <ButtonGroup className="w-full px-2.5 tabular-nums">
                  <InputGroupText>LKR</InputGroupText>
                  <CurrencyInput value={amount} onValueChange={setAmount} />
                </ButtonGroup>
              </InputGroup>
              <DropdownMenu>
                <DropdownMenuTrigger className={"cursor-pointer"}>
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText>Reason *</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      value={REFUND_REASON_LABELS[reason]}
                      className="cursor-pointer"
                      readOnly
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {REFUND_REASONS.map((r) => (
                    <DropdownMenuItem key={r} onClick={() => setReason(r)}>
                      {REFUND_REASON_LABELS[r]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Note</InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Optional context for the approver"
                rows={2}
              />
            </InputGroup>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {chosen && (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Request Refund"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
