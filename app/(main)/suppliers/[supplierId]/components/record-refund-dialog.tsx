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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Undo2 } from "lucide-react";
import React, { useState } from "react";

import { colomboDayKey } from "@/lib/date";

import { recordSupplierRefundAction } from "../../actions";
import { formatMoney } from "../../utils";
import type { SupplierCommitmentRow } from "../../types";

interface RecordRefundDialogProps {
  commitment: SupplierCommitmentRow | null;
  onClose: () => void;
}

/**
 * Records money a supplier sent back to the agency — a hotel/transport
 * commitment cancelled or disputed after a deposit was already paid, most
 * often. Capped server-side at what was actually paid; never touches the
 * linked group service directly (see `updateCommitmentStatus`'s own
 * comment on why that stays a human decision).
 */
export default function RecordRefundDialog({ commitment, onClose }: RecordRefundDialogProps) {
  const [amount, setAmount] = useState<number | "">("");
  const [refundedAt, setRefundedAt] = useState(colomboDayKey());
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(commitment !== null, commitment?.id ?? "", () => {
    setAmount("");
    setRefundedAt(colomboDayKey());
    setMethod("");
    setReference("");
    setReason("");
    setError(null);
  });

  if (!commitment) return null;

  const submit = async () => {
    if (amount === "" || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (amount > commitment.amount_paid) {
      setError(`Cannot refund more than the ${formatMoney(commitment.amount_paid, commitment.currency)} already paid.`);
      return;
    }
    setSubmitting(true);
    const result = await recordSupplierRefundAction({
      commitmentId: commitment.id,
      amount,
      currency: commitment.currency,
      refundedAt,
      method: method || undefined,
      reference: reference || undefined,
      reason: reason || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record this refund.");
      return;
    }
    toast.add({ title: "Refund recorded" });
    onClose();
  };

  return (
    <Dialog open={commitment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Undo2 className="size-5 text-destructive" />
            <DialogTitle>Record Refund</DialogTitle>
          </div>
          <DialogDescription>
            {commitment.service_label || commitment.reference_code} — {formatMoney(commitment.amount_paid, commitment.currency)} paid to date.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Amount ({commitment.currency}) *</label>
            <InputGroup>
              <CurrencyInput value={amount} onValueChange={setAmount} />
            </InputGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Date Refunded *</label>
            <Input type="date" value={refundedAt} onChange={(e) => setRefundedAt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Method</label>
            <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bank transfer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reference</label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction / receipt no." />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is this being refunded?" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Record Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
