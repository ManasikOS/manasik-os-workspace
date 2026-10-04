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
import { toast } from "@/components/ui/toast";
import { ShieldCheck } from "lucide-react";
import React, { useState } from "react";

import type { FinancePaymentRow } from "@/lib/types/finance";
import { verifyPaymentAction } from "../actions";
import { formatExactCurrency } from "../utils";

export default function VerifyPaymentDialog({
  payment,
  onClose,
}: {
  payment: FinancePaymentRow | null;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!payment) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await verifyPaymentAction({ paymentId: payment.id });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not verify this payment.");
      return;
    }
    toast.add({ title: "Payment verified" });
    onClose();
  };

  return (
    <Dialog open={payment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <ShieldCheck className="size-5 text-primary" />
            <DialogTitle>Verify Payment</DialogTitle>
          </div>
          <DialogDescription>
            {payment.payment_reference} ·{" "}
            {formatExactCurrency(payment.amount, payment.currency)} — confirm
            the proof and reference number have been checked.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Verifying…" : "Mark Verified"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
