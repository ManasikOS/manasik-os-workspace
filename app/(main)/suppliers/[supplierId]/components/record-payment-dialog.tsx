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
import { CurrencyInput } from "@/components/ui/currency-input";
import { InputGroup } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { WalletCards } from "lucide-react";
import React, { useState } from "react";

import { colomboDayKey } from "@/lib/date";

import { recordSupplierPaymentAction } from "../../actions";
import type { SupplierCommitmentRow } from "../../types";

interface RecordPaymentDialogProps {
  commitment: SupplierCommitmentRow | null;
  onClose: () => void;
}

export default function RecordPaymentDialog({ commitment, onClose }: RecordPaymentDialogProps) {
  const [amount, setAmount] = useState<number | "">("");
  const [paidAt, setPaidAt] = useState(colomboDayKey());
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(commitment !== null, commitment?.id ?? "", () => {
    setAmount("");
    setPaidAt(colomboDayKey());
    setMethod("");
    setReference("");
    setError(null);
  });

  if (!commitment) return null;

  const submit = async () => {
    if (amount === "" || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setSubmitting(true);
    const result = await recordSupplierPaymentAction({
      commitmentId: commitment.id,
      amount,
      currency: commitment.currency,
      paidAt,
      method,
      reference,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record this payment.");
      return;
    }
    toast.add({ title: "Payment recorded" });
    onClose();
  };

  return (
    <Dialog open={commitment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <WalletCards className="size-5 text-primary" />
            <DialogTitle>Record Payment</DialogTitle>
          </div>
          <DialogDescription>{commitment.service_label || commitment.reference_code} — recorded here until the Finance module lands.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Amount ({commitment.currency}) *</label>
            <InputGroup>
              <CurrencyInput value={amount} onValueChange={setAmount} />
            </InputGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date Paid *</label>
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Method</label>
            <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bank transfer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reference</label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction / receipt no." />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
