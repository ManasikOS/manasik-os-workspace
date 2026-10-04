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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Undo2 } from "lucide-react";
import React, { useState } from "react";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import type { FinancePaymentRow } from "@/lib/types/finance";
import { reversePaymentAction } from "../actions";
import { formatExactCurrency } from "../utils";

/**
 * A payment is never deleted (plan F1). This inserts a negative ledger row
 * naming what it reverses, with a mandatory reason — never an amount edit.
 */
export default function ReversePaymentDialog({
  payment,
  onClose,
}: {
  payment: FinancePaymentRow | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(payment !== null, payment?.id ?? "", () => {
    setReason("");
    setError(null);
  });

  if (!payment) return null;

  const submit = async () => {
    if (!reason.trim()) {
      setError("A reversal reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await reversePaymentAction({
      paymentId: payment.id,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not reverse this payment.");
      return;
    }
    toast.add({ title: "Payment reversed" });
    onClose();
  };

  return (
    <Dialog open={payment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Undo2 className="size-5 text-destructive" />
            <DialogTitle>Reverse Payment</DialogTitle>
          </div>
          <DialogDescription>
            {payment.payment_reference} ·{" "}
            {formatExactCurrency(payment.amount, payment.currency)} for{" "}
            {payment.primary_contact_name}. This records a correction — it does
            not delete the original payment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Reversal Reason *
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this payment being reversed?"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting ? "Reversing…" : "Reverse Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
