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
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { recordPaymentSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { recordBookingPaymentAction } from "../../actions";
import type { DepartureGroupBooking } from "../../types";
import { formatExactCurrency } from "../../utils";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ButtonGroup } from "@/components/ui/button-group";
import { TONE_TEXT } from "@/lib/ui/tone";

type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "ONLINE";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  CHEQUE: "Cheque",
  ONLINE: "Online",
};

const METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[];

interface RecordPaymentDialogProps {
  booking: DepartureGroupBooking | null;
  currency?: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Records a payment (typically the deposit) against a booking. The amount is
 * capped at the outstanding balance, and the running "balance after this
 * payment" makes the effect obvious before the operator commits.
 */
const RecordPaymentDialog = ({
  booking,
  currency = "LKR",
  open,
  onClose,
}: RecordPaymentDialogProps) => {
  const [isPending, startTransition] = useTransition();
  // Held as a number so a typed decimal survives round-tripping through the
  // currency input — parsing it back out of a string truncated the cents.
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens (so it can animate), so the form
  // has to reset each time it opens rather than only on first mount.
  useResetOnOpen(open, booking?.id ?? "", () => {
    setAmount("");
    setMethod("CASH");
    setNote("");
    setError(null);
  });

  const outstanding = booking?.outstandingBalance ?? 0;
  const parsedAmount = Math.max(0, Math.round(Number(amount) || 0));
  const balanceAfter = Math.max(outstanding - parsedAmount, 0);
  const overpaying = parsedAmount > outstanding;

  const submit = () => {
    setError(null);

    if (!booking) return;

    if (parsedAmount <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (overpaying) {
      setError(
        `Payment exceeds the outstanding balance of ${formatExactCurrency(
          outstanding,
          currency,
        )}.`,
      );
      return;
    }

    const payload = {
      bookingId: booking.id,
      departureGroupId: booking.departureGroupId,
      amount: parsedAmount,
      method,
      note: note.trim() || undefined,
    };

    const check = recordPaymentSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That payment is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await recordBookingPaymentAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: result.paidInFull ? "Booking paid in full" : "Payment recorded",
        description: `${formatExactCurrency(parsedAmount, currency)} recorded for ${
          result.bookingReference
        }. Outstanding: ${formatExactCurrency(
          result.outstandingBalance,
          currency,
        )}.`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl!">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {booking?.bookingReference} · {booking?.primaryContactName}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted/40 w-full px-3 py-2.5 flex items-center justify-between text-md">
          <span className="text-muted-foreground">Outstanding balance</span>
          <span
            className={cn(
              "font-number  font-semibold",
              outstanding > 0 ? "text-destructive" : TONE_TEXT.success,
            )}
          >
            {formatExactCurrency(outstanding, currency)}
          </span>
        </div>

        {outstanding <= 0 ? (
          <p className="text-sm text-muted-foreground">
            This booking is already paid in full — nothing to record.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-5 justify-between">
                <InputGroup>
                  <InputGroupAddon align={"block-start"}>
                    <InputGroupText>
                      {" "}
                      Amount <span className="text-destructive">*</span>
                    </InputGroupText>
                  </InputGroupAddon>
                  <ButtonGroup className="w-full items-center gap-0">
                    <InputGroupInput
                      value={currency}
                      readOnly
                      className="flex-1"
                    />
                    <CurrencyInput
                      value={amount}
                      onValueChange={(val) => {
                        setAmount(val);
                        setError(null);
                      }}
                      placeholder={String(outstanding)}
                      className="font-number flex-6"
                      autoFocus
                    />
                  </ButtonGroup>
                </InputGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <InputGroup className="cursor-pointer">
                      <InputGroupAddon align={"block-start"}>
                        <InputGroupText>Method</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        className="cursor-pointer"
                        readOnly
                        value={METHOD_LABELS[method]}
                      />
                    </InputGroup>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-48">
                    {METHODS.map((option) => (
                      <DropdownMenuItem
                        key={option}
                        onClick={() => setMethod(option)}
                      >
                        {METHOD_LABELS[option]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {/* <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setAmount(outstanding)}
                >
                  Full balance
                </Button>
                {booking && booking.packagePricePerPerson > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    Paid so far:{" "}
                    {formatExactCurrency(booking.amountPaid, currency)} of{" "}
                    {formatExactCurrency(booking.totalBookingValue, currency)}
                  </span>
                )}
              </div> */}
            </div>

            <InputGroup className="overflow-hidden">
              <InputGroupAddon align={"block-start"}>
                <InputGroupText> Note (optional)</InputGroupText>
              </InputGroupAddon>
              <InputGroupTextarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Receipt number, reference, or context…"
                rows={2}
                className="max-h-24 overflow-y-auto break-all"
              />
            </InputGroup>

            <Card className="flex-row px-3 py-3 rounded-sm flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Balance after this payment
              </span>
              <span className="font-number font-semibold text-foreground">
                {formatExactCurrency(balanceAfter, currency)}
              </span>
            </Card>

            {error && (
              <Card className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </Card>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              isPending ||
              !booking ||
              outstanding <= 0 ||
              parsedAmount <= 0 ||
              overpaying
            }
            onClick={submit}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecordPaymentDialog;
