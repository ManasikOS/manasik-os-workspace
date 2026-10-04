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
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { Banknote } from "lucide-react";
import React, { useState } from "react";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { PAYMENT_METHOD_LABELS } from "@/lib/data/finance-copy";
import type { FinanceRefundRequestRow, PaymentMethod } from "@/lib/types/finance";
import { payRefundAction } from "../actions";
import { formatExactCurrency } from "../utils";

const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "BANK_TRANSFER", "CARD", "ONLINE", "CHEQUE", "OTHER"];

interface PayRefundDialogProps {
  refund: FinanceRefundRequestRow | null;
  onClose: () => void;
}

/** Pays out an approved refund request — the step that actually moves money out. */
export default function PayRefundDialog({ refund, onClose }: PayRefundDialogProps) {
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(refund !== null, refund?.id ?? "", () => {
    setMethod("BANK_TRANSFER");
    setReferenceNumber("");
    setNote("");
    setError(null);
  });

  if (!refund) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await payRefundAction({
      refundRequestId: refund.id,
      method,
      referenceNumber: referenceNumber.trim() || undefined,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not pay out this refund.");
      return;
    }
    toast.add({
      title: "Refund paid",
      description: result.paymentReference ? `Ledger reference ${result.paymentReference}.` : undefined,
    });
    onClose();
  };

  return (
    <Dialog open={refund !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Banknote className="size-5 text-primary" />
            <DialogTitle>Pay Out Refund</DialogTitle>
          </div>
          <DialogDescription>
            {refund.reference} · {formatExactCurrency(refund.amount, refund.currency)} to{" "}
            {refund.primary_contact_name} ({refund.booking_reference}). This records the money actually leaving.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger className={"cursor-pointer"}>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Method *</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput value={PAYMENT_METHOD_LABELS[method]} className="cursor-pointer" readOnly />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              {PAYMENT_METHODS.map((m) => (
                <DropdownMenuItem key={m} onClick={() => setMethod(m)}>
                  {PAYMENT_METHOD_LABELS[m]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Reference Number</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Bank transfer ID / cheque number"
            />
          </InputGroup>

          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Note</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" rows={2} />
          </InputGroup>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Paying…" : "Pay Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
